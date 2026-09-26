using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class AiCaseExportService : IAiCaseExportService
{
    private static readonly JsonSerializerOptions PrettyJson = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly IWebHostEnvironment _environment;
    private readonly OpenAiSettings _settings;

    public AiCaseExportService(IWebHostEnvironment environment, IOptions<OpenAiSettings> settings)
    {
        _environment = environment;
        _settings = settings.Value;
    }

    public string Export(AiCaseDraft draft, GameCase gameCase, string caseJson, int errorCount)
    {
        var generatedRoot = Path.GetFullPath(Path.Combine(_environment.ContentRootPath, "GeneratedCaseJson"));
        Directory.CreateDirectory(generatedRoot);
        var caseSegment = ToSafeArtifactSegment(gameCase.CaseId, "case");
        var draftSegment = ToSafeArtifactSegment(draft.Id, "draft");
        var folderName = $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{caseSegment}-{draftSegment}";
        var folder = ResolveContainedPath(generatedRoot, folderName);
        if (Directory.Exists(folder))
            folder = ResolveContainedPath(generatedRoot, $"{folderName}-{Guid.NewGuid():N}"[..Math.Min(folderName.Length + 9, 180)]);
        Directory.CreateDirectory(folder);

        void WriteFile(string name, object value) =>
            File.WriteAllText(Path.Combine(folder, name), JsonSerializer.Serialize(value, PrettyJson));

        File.WriteAllText(Path.Combine(folder, "case.json"), caseJson);
        WriteFile("manifest.json", new
        {
            draftId = draft.Id,
            caseId = gameCase.CaseId,
            title = gameCase.Title,
            provider = draft.Provider,
            logicModel = _settings.LogicModel,
            imageModel = _settings.ImageModel,
            prompt = draft.Prompt,
            storyPreview = draft.StoryPreview,
            assetManifest = draft.AssetManifest,
            settings = draft.Settings,
            generatedAt = DateTime.UtcNow
        });
        WriteFile("stages.json", gameCase.Stages);
        WriteFile("scenes.json", gameCase.Stages.SelectMany(stage => stage.Scenes));
        WriteFile("characters.json", gameCase.Characters);
        WriteFile("items.json", gameCase.Items);
        WriteFile("clues.json", gameCase.Clues);
        WriteFile("dialogues.json", gameCase.Dialogues);
        WriteFile("conversation-nodes.json", gameCase.ConversationNodes);
        WriteFile("evidence-challenges.json", gameCase.EvidenceChallenges);
        WriteFile("deductions.json", gameCase.Deductions);
        WriteFile("required-teamwork-chains.json", gameCase.RequiredTeamworkChains);
        WriteFile("hints.json", gameCase.Hints);
        WriteFile("interactions.json", gameCase.Interactions);
        WriteFile("puzzles.json", gameCase.Puzzles);
        WriteFile("final-logic.json", gameCase.FinalLogic);
        if (draft.CaseTruth is not null)
        {
            WriteFile("case-truth.json", draft.CaseTruth);
            WriteFile("proof-graph.json", draft.CaseTruth.ProofGraph);
            WriteFile("semantic-validation-report.json", new
            {
                truthSchemaVersion = draft.TruthSchemaVersion,
                truthHash = draft.TruthHash,
                truthReviewer = draft.TruthReviewerResult,
                truthValidation = draft.TruthValidationReport,
                blindSolvabilityReview = draft.BlindSolvabilityReview,
                artifactProvenance = draft.ArtifactProvenance
            });
        }
        WriteFile("asset-manifest.json", draft.AssetManifest);
        WriteFile("asset-prompts.json", new Dictionary<string, object?>
        {
            ["language"] = gameCase.Language,
            ["art_style"] = gameCase.ArtStyle,
            ["sub_style"] = gameCase.SubStyle,
            ["character_style"] = gameCase.CharacterStyle,
            ["visualStyleContract"] = AiVisualStyleDefaults.PixelArtContract,
            ["imageModel"] = _settings.ImageModel,
            ["assets"] = draft.AssetManifest.Assets.Select(asset => new
            {
                asset.AssetType,
                asset.TargetId,
                asset.Url,
                asset.Model,
                asset.PipelineVersion,
                asset.Prompt,
                asset.ProcessingStatus
            }),
            ["placements"] = gameCase.Stages.SelectMany(stage => stage.Scenes).Select(scene => new
            {
                scene.SceneId,
                scene.PlacementPlan
            })
        });
        WriteFile("validation-report.json", new { isValid = errorCount == 0, errorCount, validatedAt = DateTime.UtcNow });
        return folder;
    }

    internal static string ToSafeArtifactSegment(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var buffer = new List<char>(Math.Min(value.Length, 80));
        var pendingSeparator = false;
        foreach (var character in value.Trim())
        {
            var allowed = char.IsLetterOrDigit(character) || character is '-' or '_';
            if (!allowed || invalid.Contains(character) || character is '/' or '\\' or '.')
            {
                pendingSeparator = buffer.Count > 0;
                continue;
            }
            if (pendingSeparator && buffer.Count < 80 && buffer[^1] != '-') buffer.Add('-');
            pendingSeparator = false;
            if (buffer.Count < 80) buffer.Add(character);
        }
        var segment = new string(buffer.ToArray()).Trim('-', '_', '.', ' ');
        return string.IsNullOrWhiteSpace(segment) ? fallback : segment;
    }

    internal static string ResolveContainedPath(string generatedRoot, string segment)
    {
        var root = Path.GetFullPath(generatedRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var candidate = Path.GetFullPath(Path.Combine(root, segment));
        var prefix = root + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Generated case export path escaped the configured artifact root.");
        return candidate;
    }
}
