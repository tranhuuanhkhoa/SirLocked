using MongoDB.Driver;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Cutscene;

namespace SirLocked.Api.Services;

public partial class AiCaseService
{
    private static readonly TimeSpan IntroProgressTimeout = TimeSpan.FromMinutes(30);

    private async Task<List<AiDraftResponse>> BuildDraftResponsesAsync(List<AiCaseDraft> drafts, bool includeJson)
    {
        var responses = drafts.Select(draft => AiDraftResponse.From(draft, includeJson)).ToList();
        var caseIds = drafts.Where(NeedsIntroProgress).Select(draft => draft.ImportedCaseId!).Distinct().ToList();
        if (caseIds.Count == 0) return responses;

        var versionsTask = _db.CaseCutscenes.Find(version => caseIds.Contains(version.CaseId)
                && version.Trigger == CutsceneTriggers.Intro
                && (version.Status == CutsceneStatus.Approved || version.Status == CutsceneStatus.Draft))
            .SortByDescending(version => version.Version)
            .Project(version => new CaseCutscene
            {
                CaseId = version.CaseId, Status = version.Status, CreatedAt = version.CreatedAt, ApprovedAt = version.ApprovedAt
            }).ToListAsync();
        var requestsTask = _db.AiBridgeRequests.Find(request => request.OwnerType == AiBridgeOwnerTypes.Cutscene
                && caseIds.Contains(request.OwnerId))
            .SortByDescending(request => request.CreatedAt)
            .Project(request => new AiBridgeRequest
            {
                OwnerId = request.OwnerId, Status = request.Status, Step = request.Step,
                LeaseExpiresAt = request.LeaseExpiresAt, CancelledAt = request.CancelledAt
            }).ToListAsync();
        await Task.WhenAll(versionsTask, requestsTask);
        var versions = versionsTask.Result.ToLookup(version => version.CaseId);
        var requests = requestsTask.Result.ToLookup(request => request.OwnerId);
        var now = DateTime.UtcNow;

        for (var index = 0; index < drafts.Count; index++)
        {
            var draft = drafts[index];
            if (!NeedsIntroProgress(draft)) continue;
            var saved = versions[draft.ImportedCaseId!];
            var version = saved.FirstOrDefault(item => item.Status == CutsceneStatus.Approved) ?? saved.FirstOrDefault();
            ApplyIntroProgress(responses[index], version, requests[draft.ImportedCaseId!].FirstOrDefault(), now);
        }
        return responses;
    }

    private static bool NeedsIntroProgress(AiCaseDraft draft) => !string.IsNullOrEmpty(draft.ImportedCaseId)
        && draft.IntroCutsceneStatus is AiIntroCutsceneStatuses.Queued or AiIntroCutsceneStatuses.Exists;

    internal static void ApplyIntroProgress(AiDraftResponse draft, CaseCutscene? version, AiBridgeRequest? request, DateTime now)
    {
        var startedAt = draft.IntroCutsceneStartedAt
            ?? draft.OrderStatusHistory.FirstOrDefault(change => change.Status == AiOrderStatuses.Submitted)?.At
            ?? draft.UpdatedAt;
        draft.IntroCutsceneStartedAt = startedAt;
        if (version is not null)
        {
            var ready = version.Status == CutsceneStatus.Approved;
            draft.IntroCutsceneStatus = ready ? AiIntroCutsceneStatuses.Ready : AiIntroCutsceneStatuses.AwaitingApproval;
            draft.IntroCutsceneFinishedAt = ready ? version.ApprovedAt ?? version.CreatedAt : version.CreatedAt;
        }
        else if (request?.Status == AiBridgeStatuses.Cancelled)
        {
            draft.IntroCutsceneStatus = AiIntroCutsceneStatuses.Failed;
            draft.IntroCutsceneFinishedAt = request.CancelledAt ?? now;
        }
        else if (draft.IntroCutsceneStatus == AiIntroCutsceneStatuses.Queued && now >= startedAt + IntroProgressTimeout)
        {
            draft.IntroCutsceneStatus = AiIntroCutsceneStatuses.TimedOut;
            draft.IntroCutsceneFinishedAt = startedAt + IntroProgressTimeout;
        }
        else if (draft.IntroCutsceneStatus == AiIntroCutsceneStatuses.Queued
            && request?.Status == AiBridgeStatuses.Taken && request.LeaseExpiresAt > now)
        {
            draft.IntroCutsceneStep = request.Step;
        }
    }
}
