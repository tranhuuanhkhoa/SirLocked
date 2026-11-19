using System.Text.RegularExpressions;
using MongoDB.Bson;
using MongoDB.Driver;
using MongoDB.Driver.Linq;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Bridge;

/// <summary>
/// draft_ask: the bot asks the creator a question with 2-4 options; its request waits in AWAITING_DECISION and leaves the
/// bot's list. The creator (or an admin) answers in /admin/ai; the request is PENDING again and the studio machine is told.
/// </summary>
public sealed partial class AiDecisionService(MongoDbContext db, AiBridgeRequestStore store, IAiDraftWorkflowCoordinator workflow)
{
    public const int MinOptions = 2;
    public const int MaxOptions = 4;

    [GeneratedRegex("^[a-z0-9-]{1,60}$")]
    private static partial Regex KeyPattern();

    [GeneratedRegex("^[a-z0-9-]{1,40}$")]
    private static partial Regex OptionIdPattern();

    /// <summary>An autopilot order never waits for its creator: the bot decides, follows the order, and notes the choice in report.md.</summary>
    public static void EnsureMayAsk(AiCaseDraft draft)
    {
        if (draft.Order?.ReviewMode == AiCaseReviewModes.Auto)
            throw ApiException.Conflict(
                "This order runs without questions: pick the option that best follows the order yourself and note the choice in report.md.",
                "AI_DECISION_AUTOPILOT", "ai.decision.autopilot");
    }

    public static void ValidateAsk(AiDecisionAskRequest? body)
    {
        if (body is null) throw Invalid("A question body is required.");
        if (!KeyPattern().IsMatch(body.Key ?? string.Empty)) throw Invalid("key must be 1-60 characters of a-z, 0-9 and '-'.");
        var question = (body.Question ?? string.Empty).Trim();
        if (question.Length is 0 or > 500) throw Invalid("question must be 1-500 characters.");
        var options = body.Options ?? new List<AiDecisionOption>();
        if (options.Count is < MinOptions or > MaxOptions) throw Invalid($"Give {MinOptions} to {MaxOptions} options.");
        foreach (var option in options)
        {
            if (!OptionIdPattern().IsMatch(option.Id ?? string.Empty)) throw Invalid("Each option id must be 1-40 characters of a-z, 0-9 and '-'.");
            var label = (option.Label ?? string.Empty).Trim();
            if (label.Length is 0 or > 80) throw Invalid("Each option label must be 1-80 characters.");
            if ((option.Detail ?? string.Empty).Length > 300) throw Invalid("An option detail is at most 300 characters.");
            if (option.Generations is < 0) throw Invalid("generations must be 0 or more.");
        }
        if (options.Select(option => option.Id).Distinct(StringComparer.Ordinal).Count() != options.Count)
            throw Invalid("Option ids must be different.");
    }

    public async Task<AiDecision> AskAsync(string requestId, AiDecisionAskRequest body, CancellationToken ct)
    {
        ValidateAsk(body);
        var request = await store.GetAsync(requestId, ct) ?? throw ApiException.NotFound("Bridge request not found.");
        if (request.OwnerType != AiBridgeOwnerTypes.CaseDraft || request.Status != AiBridgeStatuses.Taken)
            throw ApiException.Conflict("Take the request (bridge_take) before asking a question about it.",
                "BRIDGE_REQUEST_NOT_TAKEN", "ai.bridge.notTaken");
        var draft = await db.AiCaseDrafts.Find(item => item.Id == request.OwnerId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("AI draft not found.");
        EnsureMayAsk(draft);
        if (draft.Decisions.Any(item => item.Key == body.Key && item.Status == AiDecisionStatuses.Open))
            throw ApiException.Conflict($"A question '{body.Key}' is already waiting for the creator.",
                "AI_DECISION_DUPLICATE", "ai.decision.duplicate");

        var awaiting = await store.AwaitDecisionAsync(requestId, ct)
            ?? throw ApiException.Conflict("Take the request (bridge_take) before asking a question about it.",
                "BRIDGE_REQUEST_NOT_TAKEN", "ai.bridge.notTaken");
        var decision = new AiDecision
        {
            Id = ObjectId.GenerateNewId().ToString(),
            Key = body.Key,
            RequestId = awaiting.Id,
            Question = body.Question.Trim(),
            Options = body.Options.Select(option => new AiDecisionOption
            {
                Id = option.Id, Label = option.Label.Trim(), Detail = (option.Detail ?? string.Empty).Trim(), Generations = option.Generations
            }).ToList(),
            Status = AiDecisionStatuses.Open,
            AskedAt = DateTime.UtcNow
        };
        await db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draft.Id,
            Builders<AiCaseDraft>.Update.Push(item => item.Decisions, decision).Set(item => item.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
        await workflow.SyncOrderStatusAsync(draft.Id, ct);
        return decision;
    }

    public async Task<AiDraftResponse> AnswerAsync(CurrentUser user, string draftId, string decisionId, string? optionId, CancellationToken ct)
    {
        if (!ObjectId.TryParse(draftId, out _)) throw ApiException.NotFound("AI draft not found.");
        var draft = await db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("AI draft not found.");
        AiCaseService.EnsureDraftAccess(user, draft);
        var decision = draft.Decisions.FirstOrDefault(item => item.Id == decisionId)
            ?? throw ApiException.NotFound("This question does not exist.");
        if (decision.Status != AiDecisionStatuses.Open) throw Closed();
        if (decision.Options.All(option => option.Id != optionId))
            throw ApiException.BadRequest("Pick one of the question's options.",
                new ApiErrorDetails("AI_DECISION_OPTION_UNKNOWN", "ai.decision.optionUnknown"));

        var now = DateTime.UtcNow;
        var answered = await db.AiCaseDrafts.FindOneAndUpdateAsync(
            Builders<AiCaseDraft>.Filter.And(
                Builders<AiCaseDraft>.Filter.Eq(item => item.Id, draftId),
                Builders<AiCaseDraft>.Filter.ElemMatch(item => item.Decisions,
                    item => item.Id == decisionId && item.Status == AiDecisionStatuses.Open)),
            Builders<AiCaseDraft>.Update
                .Set(item => item.Decisions.FirstMatchingElement().Status, AiDecisionStatuses.Answered)
                .Set(item => item.Decisions.FirstMatchingElement().ChosenOptionId, optionId)
                .Set(item => item.Decisions.FirstMatchingElement().AnsweredByUserId, user.Id)
                .Set(item => item.Decisions.FirstMatchingElement().AnsweredAt, now)
                .Set(item => item.UpdatedAt, now),
            new FindOneAndUpdateOptions<AiCaseDraft> { ReturnDocument = ReturnDocument.After },
            ct) ?? throw Closed(); // someone else answered first, or the draft was cancelled

        await store.ResumeAfterDecisionAsync(decision.RequestId, ct);
        await workflow.SyncOrderStatusAsync(draftId, ct);
        var latest = await db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(ct) ?? answered;
        return AiDraftResponse.From(latest, includeJson: false);
    }

    /// <summary>A cancelled draft closes its open questions: a late answer is refused.</summary>
    public static async Task CancelOpenAsync(MongoDbContext db, string draftId, CancellationToken ct = default)
    {
        var draft = await db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync(ct);
        if (draft is null || draft.Decisions.All(item => item.Status != AiDecisionStatuses.Open)) return;
        foreach (var decision in draft.Decisions.Where(item => item.Status == AiDecisionStatuses.Open))
            decision.Status = AiDecisionStatuses.Cancelled;
        await db.AiCaseDrafts.UpdateOneAsync(item => item.Id == draftId,
            Builders<AiCaseDraft>.Update.Set(item => item.Decisions, draft.Decisions), cancellationToken: ct);
    }

    private static ApiException Invalid(string message) =>
        ApiException.BadRequest(message, new ApiErrorDetails("AI_DECISION_INVALID", "ai.decision.invalid"));

    private static ApiException Closed() =>
        ApiException.Conflict("This question was already answered or closed.", "AI_DECISION_CLOSED", "ai.decision.closed");
}
