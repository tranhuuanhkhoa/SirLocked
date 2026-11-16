using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Bridge;

/// <summary>
/// What a player can learn by playing the case, for the "blind detective" check. Built from a whitelist: every field
/// is copied on purpose, so solution data (culprit, motive and method, correct options, puzzle solutions, truth,
/// red-herring flags, reveal texts) can never slip in through a new model property.
/// </summary>
public static class AiPlayerViewBuilder
{
    /// <summary>Property names that would reveal the solution; the player view never contains them.</summary>
    public static readonly IReadOnlySet<string> ForbiddenPropertyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "finalLogic", "culpritId", "culprit", "motive", "method", "correctMotiveId", "correctMethodId",
        "correctEvidenceId", "correctOptionId", "correctCode", "correctSequence", "solution", "solutionJson",
        "reveal", "revealJson", "revealTitle", "successResponse", "successMessage", "isRedHerring", "isCritical",
        "isEvidence", "requiredEvidenceIds", "requiredEvidenceLinks", "narrativeMeaning", "supportsConclusionIds",
        "revealsConclusionIds", "basedOnTruthIds", "sourceActionId", "winEnding", "failEnding", "sortKey",
        "conclusionId", "investigationPurpose", "independentSourceGroup", "caseTruth", "truth"
    };

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static JsonObject Build(GameCase gameCase)
    {
        var scenes = gameCase.Stages.SelectMany(stage => stage.Scenes.Select(scene => new { stage.StageId, Scene = scene }));
        var view = new
        {
            gameCase.CaseId,
            gameCase.Title,
            gameCase.Summary,
            gameCase.Language,
            gameCase.EstimatedMinutes,
            Stages = gameCase.Stages.Select(stage => new
            {
                stage.StageId,
                stage.Title,
                Scenes = stage.Scenes.Select(scene => new
                {
                    scene.SceneId,
                    scene.Title,
                    scene.Description,
                    scene.CharacterIds,
                    scene.ItemIds,
                    Clickable = scene.Hotspots.Select(hotspot => new { hotspot.Type, hotspot.TargetId, hotspot.Label }),
                    Atmosphere = scene.Runtime is not { } runtime ? null : new
                    {
                        runtime.Indoor,
                        runtime.TimeOfDay,
                        Weather = runtime.Weather?.Type
                    }
                })
            }),
            Characters = gameCase.Characters.Select(character => new
            {
                character.CharacterId,
                character.Name,
                character.Role,
                character.Description
            }),
            Items = gameCase.Items.Select(item => new { item.ItemId, item.Name, item.Description, item.InspectText }),
            Clues = gameCase.Clues.Select(clue => new
            {
                clue.ClueId,
                clue.Title,
                clue.Content,
                clue.InventoryDescription,
                clue.SceneId
            }),
            Dialogues = gameCase.Dialogues.Select(dialogue => new
            {
                dialogue.DialogueId,
                dialogue.CharacterId,
                dialogue.Question,
                dialogue.Answer
            }),
            Conversations = gameCase.ConversationNodes.Select(node => new
            {
                node.NodeId,
                node.CharacterId,
                node.IsRoot,
                Lines = node.Lines.Select(line => new { line.Speaker, line.Text }),
                Choices = node.Choices.Select(choice => new { choice.ChoiceId, choice.Label, choice.NextNodeId })
            }),
            TestimonyStatements = gameCase.TestimonyFragments.Select(fragment => new
            {
                fragment.Id,
                fragment.DialogueId,
                fragment.Text
            }),
            Confrontations = gameCase.EvidenceChallenges.Select(challenge => new
            {
                challenge.ChallengeId,
                challenge.DialogueId,
                challenge.Prompt,
                challenge.CandidateEvidenceIds,
                challenge.CandidateTestimonyFragmentIds,
                challenge.FailureResponse
            }),
            Interactions = gameCase.Interactions.Select(interaction => new
            {
                interaction.InteractionId,
                interaction.Type,
                interaction.TargetId,
                interaction.RequiredItemIds,
                interaction.FailureMessage
            }),
            Puzzles = gameCase.Puzzles.Select(puzzle => new
            {
                puzzle.PuzzleId,
                puzzle.Type,
                puzzle.Kind,
                puzzle.TargetId,
                puzzle.Prompt,
                puzzle.Options,
                puzzle.Difficulty,
                Params = ParseObject(puzzle.ParamsJson),
                puzzle.FailureMessage
            }),
            Deductions = gameCase.Deductions.Select(deduction => new
            {
                deduction.DeductionId,
                deduction.Prompt,
                Options = deduction.Options.Select(option => new { option.Id, option.Label }),
                deduction.FailureResponse
            }),
            // Only the first, general hint of each question: orders 2 and 3 point at the answer (the player
            // has to ask for them), so showing them would make the blind detective's test meaningless.
            Hints = gameCase.Hints.Where(hint => hint.Order <= 1)
                .Select(hint => new { hint.ContextType, hint.TargetId, hint.Order, hint.Text }),
            Timeline = gameCase.Timeline is not { } timeline ? null : new
            {
                timeline.Title,
                timeline.Prompt,
                Events = timeline.Events.Select(item => new { item.EventId, item.Label, item.Detail, item.DayLabel, item.TimeLabel, item.IsFixed })
            },
            FinalAccusationForm = new
            {
                Suspects = gameCase.Characters.Select(character => new { character.CharacterId, character.Name }),
                MotiveOptions = gameCase.FinalLogic.MotiveOptions.Select(option => new { option.Id, option.Label }),
                MethodOptions = gameCase.FinalLogic.MethodOptions.Select(option => new { option.Id, option.Label }),
                EvidenceSlots = Math.Max(gameCase.FinalLogic.RequiredEvidenceIds.Count, gameCase.FinalLogic.RequiredEvidenceLinks.Count)
            }
        };
        return JsonSerializer.SerializeToNode(view, Json)!.AsObject();
    }

    private static JsonNode? ParseObject(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonNode.Parse(json); }
        catch (JsonException) { return null; }
    }
}
