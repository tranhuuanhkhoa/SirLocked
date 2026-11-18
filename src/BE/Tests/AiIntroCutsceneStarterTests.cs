using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Cutscene;
using Xunit;

namespace SirLocked.Tests;

/// <summary>After a new (OPEN_COOP_1) draft is imported its intro cutscene is queued; nothing ever blocks the import.</summary>
public sealed class AiIntroCutsceneStarterTests
{
    private static readonly AiDraftSettings NewDraft = new() { PipelineVersion = AiPipelineVersions.OpenCoop1, Difficulty = "easy" };

    [Fact]
    public async Task NewDraft_QueuesTheIntroOfTheImportedCase()
    {
        var calls = new List<string>();
        var starter = new AiIntroCutsceneStarter((caseId, _) => { calls.Add(caseId); return Task.CompletedTask; });
        Assert.Equal(AiIntroCutsceneStatuses.Queued, await starter.StartAsync(NewDraft, "case-ai-1", CancellationToken.None));
        Assert.Equal(["case-ai-1"], calls);
    }

    [Fact]
    public async Task OldDraft_DoesNotQueueAnIntro()
    {
        var called = false;
        var starter = new AiIntroCutsceneStarter((_, _) => { called = true; return Task.CompletedTask; });
        Assert.Equal(AiIntroCutsceneStatuses.Skipped, await starter.StartAsync(new AiDraftSettings(), "case-ai-1", CancellationToken.None));
        Assert.False(called);
    }

    [Fact]
    public async Task AnIntroThatAlreadyExists_IsKept()
    {
        var starter = new AiIntroCutsceneStarter((_, _) => throw ApiException.Conflict("exists", "CUTSCENE_REGENERATE_CONFIRM", "cutscene.regenerate.confirm"));
        Assert.Equal(AiIntroCutsceneStatuses.Exists, await starter.StartAsync(NewDraft, "case-ai-1", CancellationToken.None));
    }

    [Fact]
    public async Task AFailure_IsReportedNotThrown()
    {
        var starter = new AiIntroCutsceneStarter((_, _) => throw new InvalidOperationException(new string('x', 500)));
        var status = await starter.StartAsync(NewDraft, "case-ai-1", CancellationToken.None);
        Assert.StartsWith(AiIntroCutsceneStatuses.Failed, status);
        Assert.True(status.Length <= 320);
    }
}
