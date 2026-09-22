using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public sealed class ProjectionContentSchemaFactory : IProjectionContentSchemaFactory
{
    /// <summary>
    /// Locked array slots (clue conclusion links, dialogue statement links, puzzle answer keys) are
    /// deliberately absent: OpenAI strict schemas reject <c>const</c> on arrays, and the values are
    /// server-owned anyway. <see cref="ProjectionContentLocks"/> restores them from the plan before
    /// the content is canonicalized or compiled.
    /// </summary>
    public JsonObject Build(GameplayProjectionPlan plan)
    {
        var skeleton = plan.Skeleton;
        return Object(
            ("schemaVersion", Const(GameplayProjectionVersions.Content)),
            ("planHash", Const(plan.PlanHash)),
            ("case", Object(
                ("title", Text(160)),
                ("summary", Text(800)))),
            ("stages", SlotMap(skeleton.Stages.Select(stage =>
                (stage.StageId, Object(
                    ("stageId", Const(stage.StageId)),
                    ("title", Text(160))))))),
            ("scenes", SlotMap(skeleton.Stages.SelectMany(stage => stage.Scenes).Select(scene =>
            {
                var slot = plan.Scenes[scene.SceneId];
                return (scene.SceneId, Object(
                    ("sceneId", Const(scene.SceneId)),
                    ("truthLocationId", Const(slot.TruthLocationId)),
                    ("title", Text(160)),
                    ("description", Text(1000)),
                    ("visualDescription", AsciiText(1200))));
            }))),
            ("characters", SlotMap(skeleton.Characters.Select(character =>
                (character.CharacterId, Object(
                    ("characterId", Const(character.CharacterId)),
                    ("name", Text(120)),
                    ("role", Text(160)),
                    ("description", Text(800)),
                    ("visualDescription", AsciiText(1000))))))),
            ("items", SlotMap(skeleton.Items.Select(item =>
                (item.ItemId, Object(
                    ("itemId", Const(item.ItemId)),
                    ("name", Text(120)),
                    ("description", Text(600)),
                    ("inspectText", Text(600)),
                    ("visualDescription", AsciiText(800)),
                    ("interactionReason", Text(500))))))),
            ("clues", SlotMap(skeleton.Clues.Select(clue =>
            {
                var slot = plan.Clues[clue.ClueId];
                return (clue.ClueId, Object(
                    ("clueId", Const(clue.ClueId)),
                    ("traceId", Const(slot.TraceId)),
                    ("sceneId", Const(slot.SceneId)),
                    ("sourceActionId", Const(slot.SourceActionId)),
                    ("title", Text(160)),
                    ("content", Text(800)),
                    ("visualDescription", AsciiText(800)),
                    ("inventoryDescription", Text(600)),
                    ("narrativeMeaning", Text(800))));
            }))),
            ("dialogues", SlotMap(skeleton.Dialogues.Select(dialogue =>
            {
                var slot = plan.Dialogues[dialogue.DialogueId];
                return (dialogue.DialogueId, Object(
                    ("dialogueId", Const(dialogue.DialogueId)),
                    ("characterId", Const(slot.CharacterId)),
                    ("question", Text(500)),
                    ("answer", Text(1600))));
            }))),
            ("testimonyFragments", SlotMap(skeleton.TestimonyFragments.Select(fragment =>
                (fragment.Id, Object(
                    ("fragmentId", Const(fragment.Id)),
                    ("text", Text(500))))))),
            ("evidenceChallenges", SlotMap(skeleton.EvidenceChallenges.Select(challenge =>
                (challenge.ChallengeId, Object(
                    ("challengeId", Const(challenge.ChallengeId)),
                    ("prompt", Text(500)),
                    ("successResponse", Text(800)),
                    ("failureResponse", Text(500)),
                    ("revealTitle", Text(200))))))),
            ("conversationNodes", SlotMap(skeleton.ConversationNodes.Select(node =>
                (node.NodeId, Object(
                    ("nodeId", Const(node.NodeId)),
                    ("lines", FixedStringArray(node.Lines.Count, 600)),
                    ("choiceLabels", ExactStringMap(node.Choices.Select(choice => choice.ChoiceId), 300))))))),
            ("puzzles", SlotMap(skeleton.Puzzles.Select(puzzle =>
                (puzzle.PuzzleId, Object(
                    ("puzzleId", Const(puzzle.PuzzleId)),
                    ("prompt", Text(600)),
                    ("correctCode", Const(puzzle.CorrectCode)),
                    ("investigationPurpose", Text(500)),
                    ("successMessage", Text(140)),
                    ("failureMessage", Text(140))))))),
            ("interactions", SlotMap(skeleton.Interactions.Select(interaction =>
                (interaction.InteractionId, Object(
                    ("interactionId", Const(interaction.InteractionId)),
                    ("successMessage", Text(140)),
                    ("failureMessage", Text(140))))))),
            ("deductions", SlotMap(skeleton.Deductions.Select(deduction =>
                (deduction.DeductionId, Object(
                    ("deductionId", Const(deduction.DeductionId)),
                    ("conclusionId", Const(deduction.ConclusionId)),
                    ("prompt", Text(600)),
                    ("optionLabels", ExactStringMap(deduction.Options.Select(option => option.Id), 400)),
                    ("successResponse", Text(500)),
                    ("failureResponse", Text(500))))))),
            ("requiredTeamworkChains", SlotMap(skeleton.RequiredTeamworkChains.Select(chain =>
                (chain.ChainId, Object(
                    ("chainId", Const(chain.ChainId)),
                    ("description", Text(500))))))),
            ("hints", SlotMap(skeleton.Hints.Select(hint =>
                (hint.HintId, Object(
                    ("hintId", Const(hint.HintId)),
                    ("text", Text(500))))))),
            ("finalLogic", Object(
                ("motiveOptionLabels", ExactStringMap(
                    skeleton.FinalLogic.MotiveOptions.Select(option => option.Id), 500)),
                ("methodOptionLabels", ExactStringMap(
                    skeleton.FinalLogic.MethodOptions.Select(option => option.Id), 500)),
                ("winEnding", Text(1000)),
                ("failEnding", Text(1000)))));
    }

    private static JsonObject SlotMap(IEnumerable<(string Id, JsonObject Schema)> slots)
    {
        var properties = new JsonObject();
        var required = new JsonArray();
        foreach (var (id, schema) in slots.OrderBy(slot => slot.Id, StringComparer.Ordinal))
        {
            properties[id] = schema;
            required.Add(id);
        }
        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = required,
            ["additionalProperties"] = false
        };
    }

    private static JsonObject Object(params (string Name, JsonNode Schema)[] properties)
    {
        var propertyNode = new JsonObject();
        var required = new JsonArray();
        foreach (var (name, schema) in properties)
        {
            propertyNode[name] = schema;
            required.Add(name);
        }
        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = propertyNode,
            ["required"] = required,
            ["additionalProperties"] = false
        };
    }

    private static JsonObject Text(int maximum) => new()
    {
        ["type"] = "string",
        ["minLength"] = 1,
        ["maxLength"] = maximum
    };

    /// <summary>
    /// Art direction consumed by the image pipeline. It must stay printable English/ASCII even when
    /// the case language is Vietnamese, so the pattern enforces what
    /// <c>AiGenerationContract.ValidateSafeVisualText</c> checks deterministically.
    /// </summary>
    private static JsonObject AsciiText(int maximum)
    {
        var schema = Text(maximum);
        schema["pattern"] = "^[ -~]+$";
        return schema;
    }

    private static JsonObject Const(string value) => new()
    {
        ["type"] = "string",
        ["const"] = value
    };

    private static JsonObject StringArray(int minimum, int maximum, int maxLength) => new()
    {
        ["type"] = "array",
        ["minItems"] = minimum,
        ["maxItems"] = maximum,
        ["items"] = Text(maxLength)
    };

    private static JsonObject FixedStringArray(int count, int maxLength) =>
        StringArray(count, count, maxLength);

    private static JsonObject ExactStringMap(IEnumerable<string> ids, int maxLength)
    {
        var properties = new JsonObject();
        var required = new JsonArray();
        foreach (var id in ids.OrderBy(id => id, StringComparer.Ordinal))
        {
            properties[id] = Text(maxLength);
            required.Add(id);
        }
        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = required,
            ["additionalProperties"] = false
        };
    }
}
