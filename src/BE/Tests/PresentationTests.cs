using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public class PresentationTests
{
    [Theory]
    [InlineData(AiDraftStatus.ReadyToPublish, true)]
    [InlineData(AiDraftStatus.Imported, false)]
    [InlineData(AiDraftStatus.Published, false)]
    [InlineData(AiDraftStatus.GeneratedInvalid, false)]
    [InlineData(AiDraftStatus.FullLogicAwaitingApproval, false)]
    [InlineData(AiDraftStatus.SceneLayoutAwaitingApproval, false)]
    public void PaidPresentationRequiresAnAttachableDraftBeforeItsFirstPublication(string status, bool allowed)
    {
        var reason = PresentationPolicy.GenerationStatusDisabledReason(status);
        Assert.Equal(allowed, reason is null);
        if (!allowed) Assert.Contains("before its first import or publish", reason);
    }

    [Fact]
    public void Projection_WithholdsRevealEndingAndTheirAssetIdsUntilAuthoritativeEligibility()
    {
        var gameCase = Case(); var room = Room();
        var initial = JsonSerializer.Serialize(PresentationPolicy.Project(room, gameCase, "a"));
        Assert.Contains("intro-safe", initial);
        Assert.DoesNotContain("PRIVATE_REVEAL", initial);
        Assert.DoesNotContain("PRIVATE_ENDING", initial);
        room.GameplayState!.ResolvedConfrontationRecords.Add(new() { ChallengeId = "challenge" });
        var revealed = JsonSerializer.Serialize(PresentationPolicy.Project(room, gameCase, "a"));
        Assert.Contains("PRIVATE_REVEAL", revealed);
        Assert.DoesNotContain("PRIVATE_ENDING", revealed);
        room.Status = RoomStatus.Completed;
        room.GameplayState.FinalAccusationSnapshot = new() { Success = true };
        Assert.Contains("PRIVATE_ENDING", JsonSerializer.Serialize(PresentationPolicy.Project(room, gameCase, "a")));
        Assert.Empty(PresentationPolicy.Project(room, gameCase, "outsider")!.Cutscenes);
    }

    [Fact]
    public void PortraitsFollowEachPlayersSceneWithoutMutatingCanonicalOrPublicDetail()
    {
        var gameCase = Case(); var room = Room();
        var a = new GameStateResponse { VisibleScene = new() { Characters = [CaseCharacterDto.From(gameCase.Characters[0])] } };
        var b = new GameStateResponse { VisibleScene = new() { Characters = [CaseCharacterDto.From(gameCase.Characters[0])] } };
        PresentationPolicy.Apply(a, room, gameCase, "a");
        PresentationPolicy.Apply(b, room, gameCase, "b");
        Assert.NotNull(a.VisibleScene.Characters[0].Presentation?.PortraitVideoUrl);
        Assert.Null(b.VisibleScene.Characters[0].Presentation);
        Assert.Null(CasePublicDetailResponse.FromCase(gameCase).Characters[0].Presentation);
        Assert.DoesNotContain("PRIVATE", JsonSerializer.Serialize(CasePublicDetailResponse.FromCase(gameCase)));
        Assert.Equal("scene-b", room.GameplayState!.PlayerSceneIds["b"]);
    }

    [Fact]
    public void EndingOutcomeIsProjectedOnlyToMatchingResultAndLegacyCasesRemainOptional()
    {
        var gameCase = Case();
        Assert.Single(PresentationPolicy.ProjectResult(gameCase, "room", true)!.Cutscenes);
        Assert.Empty(PresentationPolicy.ProjectResult(gameCase, "room", false)!.Cutscenes);
        Assert.Null(PresentationPolicy.ProjectResult(new GameCase(), "room", true));
    }

    [Fact]
    public void StoryboardValidationRejectsArbitrarySourcesAndOverBudgetEconomyShapes()
    {
        var gameCase = Case();
        var clip = Clip(); clip.SourceImageUrl = "https://untrusted.invalid/image.png";
        Assert.Throws<ApiException>(() => PresentationPolicy.ValidateAndCopy([clip], gameCase));
        clip = Clip(); clip.DurationSeconds = 7;
        Assert.Throws<ApiException>(() => PresentationPolicy.ValidateAndCopy([clip], gameCase));
        var duplicateIntro = Clip(); duplicateIntro.Id = "other";
        Assert.Throws<ApiException>(() => PresentationPolicy.ValidateAndCopy([Clip(), duplicateIntro], gameCase));
        clip = Clip(); clip.Kind = "REVEAL"; clip.TargetId = "challenge";
        Assert.Throws<ApiException>(() => PresentationPolicy.ValidateAndCopy([clip], gameCase));
        clip.GenerateVideo = false;
        Assert.Single(PresentationPolicy.ValidateAndCopy([clip], gameCase));
    }

    [Fact]
    public void QuoteRequiresExplicitVersionedPriceAndIgnoresStillPanels()
    {
        var settings = new PresentationVideoSettings();
        Assert.Null(PresentationPolicy.Estimate([Clip()], settings));
        settings.PricePerSecondUsd = .2m;
        Assert.Null(PresentationPolicy.Estimate([Clip()], settings));
        settings.PricingVersion = "test-price";
        Assert.Equal(.8m, PresentationPolicy.Estimate([Clip()], settings));
        var still = Clip(); still.GenerateVideo = false;
        Assert.Equal(0m, PresentationPolicy.Estimate([still], settings));
    }

    [Fact]
    public void FingerprintIgnoresPublicationAndNeverMutatesPresentation()
    {
        var gameCase = Case(); var original = gameCase.Presentation;
        var hash = PresentationPolicy.Fingerprint(gameCase);
        gameCase.Status = CaseStatus.Published;
        gameCase.UpdatedAt = DateTime.UtcNow.AddDays(1);
        Assert.Equal(hash, PresentationPolicy.Fingerprint(gameCase));
        Assert.Same(original, gameCase.Presentation);
        gameCase.Characters[0].ImageUrl = "/assets/changed.png";
        Assert.NotEqual(hash, PresentationPolicy.Fingerprint(gameCase));
    }

    [Fact]
    public void RegeneratingOneClipPreservesOtherApprovedMediaAndRequiresItsFullQuote()
    {
        var selected = Clip(); selected.VideoAssetId = "old-selected"; selected.Approved = true;
        var retained = Clip(); retained.Id = "retained"; retained.Status = "READY"; retained.Approved = true;
        retained.VideoAssetId = "retained-video"; retained.PosterAssetId = "retained-poster"; retained.JobId = "old-job";
        var package = new PresentationPackage { Clips = [selected, retained] };
        var settings = new PresentationVideoSettings { PricePerSecondUsd = .2m, PricingVersion = "verified" };
        Assert.Throws<ApiException>(() => PresentationPolicy.PrepareGeneration(package, ["intro"], settings, .79m));
        Assert.Equal("old-selected", selected.VideoAssetId);
        PresentationPolicy.PrepareGeneration(package, ["intro"], settings, .8m);
        Assert.Equal("QUEUED", selected.Status);
        Assert.Null(selected.VideoAssetId);
        Assert.False(selected.Approved);
        Assert.Equal("retained-video", retained.VideoAssetId);
        Assert.Equal("retained-poster", retained.PosterAssetId);
        Assert.Equal("old-job", retained.JobId);
        Assert.True(retained.Approved);
        Assert.Equal(["intro"], package.GenerationClipIds);
    }

    [Fact]
    public void EditingOnePromptKeepsOtherMediaButCaptionChangesRequireFreshReview()
    {
        var existing = Clip(); existing.Status = "READY"; existing.Approved = true;
        existing.PosterAssetId = "poster"; existing.VideoAssetId = "video";
        var changedPrompt = Clip(); changedPrompt.Prompt = "Changed motion.";
        PresentationPolicy.PreserveUnchangedMedia([changedPrompt], new() { Clips = [existing] });
        Assert.Null(changedPrompt.VideoAssetId);
        var changedCaption = Clip(); changedCaption.Caption = "Revised narration.";
        PresentationPolicy.PreserveUnchangedMedia([changedCaption], new() { Clips = [existing] });
        Assert.Equal("video", changedCaption.VideoAssetId);
        Assert.Equal("READY", changedCaption.Status);
        Assert.False(changedCaption.Approved);
        var unchanged = Clip();
        PresentationPolicy.PreserveUnchangedMedia([unchanged], new() { Clips = [existing] });
        Assert.True(unchanged.Approved);
    }

    [Fact]
    public void AuthoredSpriteMetadataRoundtripsAndSurvivesPortraitProjection()
    {
        var gameCase = Case();
        gameCase.Characters[0].Presentation = new() { SpriteSheet = new()
        {
            Url = "/assets/sheet.png", FrameWidth = 128, FrameHeight = 256, FrameCount = 6, Fps = 4,
            IdleFrames = [0, 1, 2, 3, 4, 5], AnchorX = .5, AnchorY = 1
        } };
        var decoded = JsonSerializer.Deserialize<GameCase>(JsonSerializer.Serialize(gameCase))!;
        var result = new CaseValidationResult();
        CaseValidationService.ValidatePresentationSprites(decoded, result);
        Assert.True(result.IsValid);
        var response = new GameStateResponse { VisibleScene = new() { Characters = [CaseCharacterDto.From(decoded.Characters[0])] } };
        PresentationPolicy.Apply(response, Room(), decoded, "a");
        Assert.Equal(6, response.VisibleScene.Characters[0].Presentation!.SpriteSheet!.FrameCount);
        Assert.NotNull(response.VisibleScene.Characters[0].Presentation!.PortraitVideoUrl);
        decoded.Characters[0].Presentation!.SpriteSheet!.IdleFrames = [6];
        result = new();
        CaseValidationService.ValidatePresentationSprites(decoded, result);
        Assert.False(result.IsValid);
    }

    [Theory]
    [InlineData(RoomStatus.Waiting, true)]
    [InlineData(RoomStatus.Ready, true)]
    [InlineData(RoomStatus.InProgress, true)]
    [InlineData(RoomStatus.Completed, false)]
    [InlineData(RoomStatus.Abandoned, false)]
    public void OverwriteProtectionIncludesReadyLobbyAndExcludesOtherCases(string status, bool expected)
    {
        var predicate = CaseService.ReferencingActiveCase("case").Compile();
        Assert.Equal(expected, predicate(new GameRoom { CaseId = "case", Status = status }));
        Assert.False(predicate(new GameRoom { CaseId = "different", Status = status }));
    }

    [Fact]
    public async Task WorkerPersistsProviderIdThenResumesPollingWithOneLeaseAndNoDuplicateSubmit()
    {
        var f = new Fixture();
        await f.Run();
        Assert.Equal("PENDING", f.Store.Jobs["job"].Status);
        Assert.Equal("provider-id", f.Store.Jobs["job"].ProviderRequestId);
        Assert.Equal("test", Assert.Single(f.Accounting.Leases).PriceVersion);
        Assert.Empty(f.Accounting.Recorded);
        f.Store.Jobs["job"].NextPollAt = DateTime.UtcNow.AddSeconds(-1);
        // New processor instance is equivalent to a process restart; only Mongo state is retained.
        await f.Run();
        Assert.Equal("READY", f.Store.Jobs["job"].Status);
        Assert.Equal(1, f.Provider.SubmitCount);
        Assert.Equal(1, f.Provider.PollCount);
        Assert.Equal(f.Accounting.Leases[0].Id, Assert.Single(f.Accounting.Recorded).Id);
        Assert.Equal("AWAITING_APPROVAL", f.Store.Package.Status);
        Assert.NotNull(f.Store.Package.Clips[0].VideoAssetId);
        await f.Run();
        Assert.Equal(1, f.Provider.SubmitCount);
    }

    [Fact]
    public async Task AmbiguousSubmitAndRestartNeverAutomaticallyRepeatPaidPost()
    {
        var f = new Fixture(); f.Provider.ThrowOnSubmit = true;
        await f.Run();
        Assert.Equal("SUBMISSION_UNKNOWN", f.Store.Jobs["job"].Status);
        Assert.Equal("NEEDS_RECOVERY", f.Store.Package.Status);
        await f.Run();
        Assert.Equal(1, f.Provider.SubmitCount);
        Assert.Single(f.Accounting.Leases);
        Assert.Single(f.Accounting.Recorded);
    }

    [Fact]
    public async Task CrashAfterIntentBeforeProviderIdRequiresRecoveryWithoutAnyPost()
    {
        var f = new Fixture();
        f.Store.Jobs["job"] = new() { Id = "job", DraftId = "draft", GenerationId = "generation", ClipId = "intro", Status = "SUBMITTING" };
        await f.Run();
        Assert.Equal("SUBMISSION_UNKNOWN", f.Store.Jobs["job"].Status);
        Assert.Equal(0, f.Provider.SubmitCount);
    }

    [Fact]
    public async Task CrashAfterTerminalJobWriteReconcilesPackageOnRestart()
    {
        var f = new Fixture();
        f.Store.Jobs["job"] = new() { Id = "job", DraftId = "draft", GenerationId = "generation", ClipId = "intro", Status = "READY" };
        f.Store.Assets["job-poster"] = new() { Id = "job-poster" };
        await f.Run();
        Assert.Equal("AWAITING_APPROVAL", f.Store.Package.Status);
        Assert.Equal("job-poster", f.Store.Package.Clips[0].PosterAssetId);
        Assert.Equal(0, f.Provider.SubmitCount);
    }

    [Fact]
    public async Task RevokedBudgetConfigurationPreventsQueuedProviderCalls()
    {
        var f = new Fixture(); f.Quota.Enabled = false;
        await f.Run();
        Assert.Equal("FAILED", f.Store.Jobs["job"].Status);
        Assert.Equal(0, f.Provider.SubmitCount);
        Assert.Empty(f.Accounting.Leases);
    }

    [Theory]
    [InlineData(408, "unknown")]
    [InlineData(500, "unknown")]
    [InlineData(503, "unknown")]
    [InlineData(400, "rejected")]
    [InlineData(429, "rejected")]
    public async Task ProviderHttpErrorsDistinguishAmbiguousAcceptanceFromRejectedRequests(int status, string expected)
    {
        using var client = new HttpClient(new ResponseHandler(status));
        var provider = new XaiPresentationVideoProvider(client, Options.Create(new PresentationVideoSettings()));
        var result = await provider.SubmitAsync(Clip(), "data:image/png;base64,AQ==", "test-model", CancellationToken.None);
        Assert.Equal(expected, result.Status);
    }

    [Fact]
    public async Task LosingSubmissionClaimPreventsPaidPostEvenAfterBudgetReservation()
    {
        var f = new Fixture(); f.Store.LoseSubmissionClaim = true;
        await f.Run();
        Assert.Equal(0, f.Provider.SubmitCount);
        Assert.Equal("FAILED", f.Store.Jobs["job"].Status);
    }

    [Fact]
    public async Task AccountingFailureRetainsTerminalCheckpointAndRetriesWithoutProviderResubmission()
    {
        var f = new Fixture(); f.Provider.RejectSubmit = true; f.Accounting.FailRecords = 1;
        await f.Run();
        Assert.Equal("SETTLING", f.Store.Jobs["job"].Status);
        Assert.NotNull(f.Store.Jobs["job"].ProviderTerminalBody);
        f.Store.Jobs["job"].NextPollAt = DateTime.UtcNow.AddSeconds(-1);
        await f.Run();
        Assert.Equal("FAILED", f.Store.Jobs["job"].Status);
        Assert.Equal("FALLBACK_READY", f.Store.Package.Clips[0].Status);
        Assert.Equal(1, f.Provider.SubmitCount);
        Assert.Single(f.Accounting.Recorded);
    }

    [Fact]
    public async Task PendingProviderJobBlocksOtherQueuedClipsBetweenPolls()
    {
        var f = new Fixture();
        var second = Clip(); second.Id = "second"; second.JobId = "job-two"; second.Status = "QUEUED";
        f.Store.Package.Clips.Add(second);
        await f.Run();
        Assert.Equal(1, f.Provider.SubmitCount);
        await f.Run();
        Assert.Equal(1, f.Provider.SubmitCount);
        Assert.Equal("QUEUED", f.Store.Jobs["job-two"].Status);
    }

    private static GameCase Case() => new()
    {
        CaseId = "case", CoverImageUrl = "/assets/cover.png",
        Characters = [new() { CharacterId = "npc", ImageUrl = "/assets/npc.png" }],
        EvidenceChallenges = [new() { ChallengeId = "challenge" }],
        Stages = [new() { Scenes = [new() { SceneId = "scene-a", CharacterIds = ["npc"] }, new() { SceneId = "scene-b" }] }],
        Presentation = new() { Version = "bundle", Clips = [
            new() { Id = "intro-safe", Kind = "INTRO", PosterAssetId = "safe" },
            new() { Id = "reveal", Kind = "REVEAL", TargetId = "challenge", Caption = "PRIVATE_REVEAL", PosterAssetId = "PRIVATE_REVEAL_POSTER" },
            new() { Id = "ending", Kind = "ENDING", TargetId = "WON", Caption = "PRIVATE_ENDING", VideoAssetId = "PRIVATE_ENDING_VIDEO" },
            new() { Id = "portrait", Kind = "PORTRAIT", TargetId = "npc", VideoAssetId = "portrait-video" }
        ] }
    };
    private static GameRoom Room() => new()
    {
        Id = "room", Status = RoomStatus.InProgress, Players = [new() { UserId = "a" }, new() { UserId = "b" }],
        GameplayState = new() { PlayerSceneIds = new() { ["a"] = "scene-a", ["b"] = "scene-b" } }
    };
    private static PresentationStoryboardClip Clip() => new() { Id = "intro", Kind = "INTRO", SourceImageUrl = "/assets/cover.png", Prompt = "Subtle camera push.", DurationSeconds = 4 };

    private sealed class Fixture
    {
        public readonly MemoryStore Store = new(); public readonly Provider Provider = new(); public readonly Accounting Accounting = new();
        public readonly AiQuotaSettings Quota = new() { Enabled = true, GlobalBudgetUsd = 100m };
        public Fixture()
        {
            var clip = Clip(); clip.JobId = "job"; clip.Status = "QUEUED";
            Store.Package = new() { Id = "draft", GenerationId = "generation", Status = "GENERATING", Clips = [clip], Model = "video-test", PricingVersion = "test", PricePerSecondUsd = .2m };
        }
        public Task Run() => new PresentationVideoProcessor(Store, Provider, new Media(), Accounting,
            Options.Create(new PresentationVideoSettings { Enabled = true, PricePerSecondUsd = .2m, PricingVersion = "test", Model = "video-test" }),
            Options.Create(Quota), Options.Create(new AiUsageSettings { MaxDraftUsd = 100m })).ProcessNextAsync("worker", CancellationToken.None);
    }
    private sealed class Provider : IPresentationVideoProvider
    {
        public int SubmitCount, PollCount; public bool ThrowOnSubmit, RejectSubmit;
        public Task<VideoProviderResponse> SubmitAsync(PresentationStoryboardClip clip, string imageDataUri, string model, CancellationToken ct)
        {
            SubmitCount++; if (ThrowOnSubmit) throw new HttpRequestException("test transport loss");
            if (RejectSubmit) return Task.FromResult(new VideoProviderResponse("rejected", null, null, "{\"error\":\"rejected\"}", 400));
            return Task.FromResult(new VideoProviderResponse("pending", "provider-id", null, "{}", 200));
        }
        public Task<VideoProviderResponse> PollAsync(string requestId, CancellationToken ct)
        { PollCount++; return Task.FromResult(new VideoProviderResponse("done", requestId, "https://vidgen.x.ai/clip.mp4", "{\"usage\":{\"cost_in_usd_ticks\":8000000000}}", 200)); }
    }
    private sealed class Media : IPresentationMediaStorage
    {
        public Task<PresentationMediaBytes> ReadSourceAsync(string url, CancellationToken ct) => Task.FromResult(new PresentationMediaBytes([1, 2], "image/png"));
        public Task<PresentationMediaAsset> UploadPosterAsync(PresentationVideoJob job, PresentationMediaBytes source, CancellationToken ct) => Task.FromResult(new PresentationMediaAsset { Id = job.Id + "-poster", DraftId = job.DraftId });
        public Task<PresentationMediaAsset> UploadVideoAsync(PresentationVideoJob job, string providerUrl, CancellationToken ct) => Task.FromResult(new PresentationMediaAsset { Id = job.Id + "-video", DraftId = job.DraftId });
        public Task<PresentationMediaBytes> DownloadAsync(PresentationMediaAsset asset, CancellationToken ct) => Task.FromResult(new PresentationMediaBytes([1, 2], "video/mp4"));
    }
    private sealed class Accounting : IAiUsageAccounting
    {
        public List<AiCallLease> Leases = new(), Recorded = new();
        public int FailRecords;
        public Task<AiCallLease> BeforeCallAsync(string draftId, string step, string kind, string model, CancellationToken cancellationToken = default, decimal? reservationUsd = null, string? priceVersion = null)
        { var lease = new AiCallLease { DraftId = draftId, ReservedUsd = reservationUsd ?? 0, PriceVersion = priceVersion ?? "" }; Leases.Add(lease); return Task.FromResult(lease); }
        public Task RecordAsync(AiCallLease lease, string? responseBody, int? statusCode, CancellationToken cancellationToken = default)
        { if (FailRecords-- > 0) throw new InvalidOperationException("test storage failure"); Recorded.Add(lease); return Task.CompletedTask; }
    }
    private sealed class MemoryStore : IPresentationStore
    {
        public PresentationPackage Package = new();
        public Dictionary<string, PresentationVideoJob> Jobs = new();
        public Dictionary<string, PresentationMediaAsset> Assets = new();
        public bool LoseSubmissionClaim;
        private static T Clone<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value))!;
        public Task<PresentationPackage?> GetPackageAsync(string draftId, CancellationToken ct = default) => Task.FromResult<PresentationPackage?>(Clone(Package));
        public Task<bool> SavePackageAsync(PresentationPackage package, long expectedVersion, CancellationToken ct = default)
        { if (Package.Version != expectedVersion) return Task.FromResult(false); package.Version++; Package = Clone(package); return Task.FromResult(true); }
        public Task InsertJobAsync(PresentationVideoJob job, CancellationToken ct = default) { Jobs.TryAdd(job.Id, Clone(job)); return Task.CompletedTask; }
        public Task SaveJobAsync(PresentationVideoJob job, CancellationToken ct = default)
        {
            if (Jobs[job.Id].Revision != job.Revision) throw new PresentationJobConflictException();
            job.Revision++; Jobs[job.Id] = Clone(job); return Task.CompletedTask;
        }
        public Task<bool> TryTransitionJobAsync(PresentationVideoJob job, string expectedStatus, string? expectedClaim, CancellationToken ct = default)
        {
            if (!Jobs.TryGetValue(job.Id, out var stored) || stored.Status != expectedStatus || stored.SubmissionClaim != expectedClaim || stored.Revision != job.Revision) return Task.FromResult(false);
            if (LoseSubmissionClaim && expectedStatus == "PREPARING") { stored.Status = "FAILED"; stored.Revision++; return Task.FromResult(false); }
            job.Revision++; Jobs[job.Id] = Clone(job); return Task.FromResult(true);
        }
        public Task<PresentationVideoJob?> GetJobAsync(string jobId, CancellationToken ct = default) => Task.FromResult(Jobs.TryGetValue(jobId, out var job) ? Clone(job) : null);
        public Task<List<PresentationPackage>> GetPendingPackagesAsync(CancellationToken ct = default) => Task.FromResult(Package.Status == "GENERATING" ? new List<PresentationPackage> { Clone(Package) } : new());
        public Task<PresentationVideoJob?> NextJobAsync(DateTime now, CancellationToken ct = default)
        {
            var active = Jobs.Values.FirstOrDefault(job => job.Status is "PREPARING" or "SUBMITTING" or "PENDING" or "DOWNLOADING" or "SETTLING" or "SUBMISSION_UNKNOWN");
            if (active is not null) return Task.FromResult(active.Status != "SUBMISSION_UNKNOWN" && active.NextPollAt <= now ? Clone(active) : null);
            return Task.FromResult(Jobs.Values.FirstOrDefault(job => job.Status == "QUEUED") is { } queued ? Clone(queued) : null);
        }
        public Task SaveAssetAsync(PresentationMediaAsset asset, CancellationToken ct = default) { Assets[asset.Id] = Clone(asset); return Task.CompletedTask; }
        public Task<PresentationMediaAsset?> GetAssetAsync(string assetId, CancellationToken ct = default) => Task.FromResult(Assets.GetValueOrDefault(assetId));
        public Task<bool> AcquireLeaseAsync(string owner, DateTime now, CancellationToken ct = default) => Task.FromResult(true);
        public Task ReleaseLeaseAsync(string owner, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class ResponseHandler(int status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage((System.Net.HttpStatusCode)status) { Content = new StringContent("{\"error\":\"test\"}") });
    }
}
