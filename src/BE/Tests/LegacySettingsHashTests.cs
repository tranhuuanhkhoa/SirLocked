using System.Text.Json;
using MongoDB.Bson;
using SirLocked.Api.Models;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Projection;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// A draft created before difficulty levels must hash its settings exactly as before, or its saved projection plan
/// is reported stale (AI_PROJECTION_PLAN_STALE) after deploy.
/// </summary>
public sealed class LegacySettingsHashTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void LegacySettings_SerializeWithoutTheNewFields()
    {
        var legacy = new AiDraftSettings { GenerationPreset = AiGenerationPresets.NormalRandom, StageCount = 4, Difficulty = "medium" };
        var json = JsonSerializer.SerializeToNode(legacy, Web)!.AsObject();
        Assert.False(json.ContainsKey("pipelineVersion"));
        Assert.False(json.ContainsKey("leaning"));
        Assert.False(legacy.ToBsonDocument().Contains(nameof(AiDraftSettings.PipelineVersion)));
        Assert.False(legacy.ToBsonDocument().Contains(nameof(AiDraftSettings.Leaning)));
    }

    [Fact]
    public void LegacySettings_HashIsStableAcrossARoundTrip()
    {
        var legacy = new AiDraftSettings { GenerationPreset = AiGenerationPresets.NormalRandom, StageCount = 4 };
        var stored = JsonSerializer.Deserialize<AiDraftSettings>(
            """{"stageCount":4,"difficulty":"medium","generationPreset":"NORMAL_RANDOM"}""", Web)!;
        Assert.Equal(ProjectionCanonicalizer.HashObject(JsonSerializer.SerializeToNode(stored, Web)!),
            ProjectionCanonicalizer.HashObject(JsonSerializer.SerializeToNode(legacy, Web)!));
        Assert.False(AiPipelineVersions.IsOpenCoop(stored));
    }
}
