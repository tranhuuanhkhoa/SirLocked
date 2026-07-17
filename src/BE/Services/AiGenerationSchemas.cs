using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Model-owned case fields. Persistence/runtime/style fields are injected by the server after generation.
/// </summary>
public sealed class GeneratedCaseLogic
{
    public string CaseId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; }
    public List<CaseStage> Stages { get; set; } = new();
    public List<CaseCharacter> Characters { get; set; } = new();
    public List<CaseItem> Items { get; set; } = new();
    public List<CaseClue> Clues { get; set; } = new();
    public List<CaseDialogue> Dialogues { get; set; } = new();
    public List<ConversationNode> ConversationNodes { get; set; } = new();
    public List<EvidenceChallenge> EvidenceChallenges { get; set; } = new();
    public List<DeductionChallenge> Deductions { get; set; } = new();
    public List<RequiredTeamworkChain> RequiredTeamworkChains { get; set; } = new();
    public List<CaseHint> Hints { get; set; } = new();
    public List<CaseInteraction> Interactions { get; set; } = new();
    public List<CasePuzzle> Puzzles { get; set; } = new();
    public FinalLogic FinalLogic { get; set; } = new();

    public static GeneratedCaseLogic FromGameCase(GameCase value) => new()
    {
        CaseId = value.CaseId,
        Title = value.Title,
        Summary = value.Summary,
        EstimatedMinutes = value.EstimatedMinutes,
        Stages = value.Stages,
        Characters = value.Characters,
        Items = value.Items,
        Clues = value.Clues,
        Dialogues = value.Dialogues,
        ConversationNodes = value.ConversationNodes,
        EvidenceChallenges = value.EvidenceChallenges,
        Deductions = value.Deductions,
        RequiredTeamworkChains = value.RequiredTeamworkChains,
        Hints = value.Hints,
        Interactions = value.Interactions,
        Puzzles = value.Puzzles,
        FinalLogic = value.FinalLogic
    };

    public GameCase ToGameCase(AiDraftSettings settings) => new()
    {
        CaseId = CaseId,
        Title = Title,
        Summary = Summary,
        Language = CaseLanguages.Normalize(settings.Language),
        ArtStyle = AiVisualStyleDefaults.ArtStyle,
        SubStyle = AiVisualStyleDefaults.SubStyle,
        CharacterStyle = AiVisualStyleDefaults.CharacterStyle,
        Status = CaseStatus.Draft,
        MechanicsVersion = CaseMechanicsVersions.InvestigationV2,
        GenerationMode = CaseGenerationModes.CameraEmbedded,
        EstimatedMinutes = EstimatedMinutes,
        CoverImageUrl = string.Empty,
        Stages = Stages,
        Characters = Characters,
        Items = Items,
        Clues = Clues,
        Dialogues = Dialogues,
        ConversationNodes = ConversationNodes,
        EvidenceChallenges = EvidenceChallenges,
        Deductions = Deductions,
        RequiredTeamworkChains = RequiredTeamworkChains,
        Hints = Hints,
        Interactions = Interactions,
        Puzzles = Puzzles,
        FinalLogic = FinalLogic
    };
}

public static class AiStrictSchemaProvider
{
    private static readonly NullabilityInfoContext Nullability = new();

    private static readonly IReadOnlyDictionary<Type, HashSet<string>> ExcludedProperties =
        new Dictionary<Type, HashSet<string>>
        {
            [typeof(CaseScene)] = new(StringComparer.Ordinal)
            {
                nameof(CaseScene.BackgroundUrl), nameof(CaseScene.PlacementPlan), nameof(CaseScene.Runtime)
            },
            [typeof(CaseCharacter)] = new(StringComparer.Ordinal) { nameof(CaseCharacter.ImageUrl) },
            [typeof(CaseItem)] = new(StringComparer.Ordinal) { nameof(CaseItem.ImageUrl) }
        };

    public static JsonObject StoryPreviewSchema() => BuildObjectSchema(typeof(AiStoryPreview));

    public static JsonObject CaseLogicSchema() => BuildObjectSchema(typeof(GeneratedCaseLogic));

    private static JsonObject BuildObjectSchema(Type type)
    {
        var properties = new JsonObject();
        var required = new JsonArray();

        foreach (var property in type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
        {
            if (!property.CanRead || IsExcluded(type, property.Name)) continue;

            var name = property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name
                ?? JsonNamingPolicy.CamelCase.ConvertName(property.Name);
            properties[name] = BuildSchema(property.PropertyType, Nullability.Create(property));
            required.Add(name);
        }

        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = required,
            ["additionalProperties"] = false
        };
    }

    private static JsonNode BuildSchema(Type type, NullabilityInfo? nullability = null)
    {
        var nullableUnderlying = Nullable.GetUnderlyingType(type);
        if (nullableUnderlying is not null)
        {
            return WithNull(BuildSchema(nullableUnderlying));
        }

        if (type == typeof(string))
        {
            var schema = new JsonObject { ["type"] = "string" };
            return nullability?.ReadState == NullabilityState.Nullable ? WithNull(schema) : schema;
        }
        if (type == typeof(bool)) return new JsonObject { ["type"] = "boolean" };
        if (type == typeof(int) || type == typeof(long)) return new JsonObject { ["type"] = "integer" };
        if (type == typeof(float) || type == typeof(double) || type == typeof(decimal))
            return new JsonObject { ["type"] = "number" };

        if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(List<>))
        {
            var elementType = type.GetGenericArguments()[0];
            return new JsonObject
            {
                ["type"] = "array",
                ["items"] = BuildSchema(elementType, nullability?.GenericTypeArguments.FirstOrDefault())
            };
        }

        if (type.IsEnum)
        {
            return new JsonObject
            {
                ["type"] = "string",
                ["enum"] = new JsonArray(Enum.GetNames(type).Select(name => (JsonNode?)JsonValue.Create(name)).ToArray())
            };
        }

        return BuildObjectSchema(type);
    }

    private static JsonObject WithNull(JsonNode schema)
    {
        var typeNode = schema["type"];
        schema["type"] = new JsonArray(typeNode?.DeepClone(), JsonValue.Create("null"));
        return (JsonObject)schema;
    }

    private static bool IsExcluded(Type type, string propertyName) =>
        ExcludedProperties.TryGetValue(type, out var names) && names.Contains(propertyName);
}
