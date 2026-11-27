using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

internal static class CaseTextLocalization
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly ConditionalWeakTable<GameCase, GameCase> AlternateViews = new();
    private static readonly ConditionalWeakTable<GameCase, GameCase> Originals = new();

    public static string? RequestLanguage(HttpContext? context)
    {
        var language = context?.Request.Headers["X-SirLocked-Language"].ToString();
        return language is CaseLanguages.English or CaseLanguages.Vietnamese ? language : null;
    }

    public static string Alternate(string language) =>
        CaseLanguages.Normalize(language) == CaseLanguages.Vietnamese ? CaseLanguages.English : CaseLanguages.Vietnamese;

    public static string Key(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    public static string Lookup(GameCase source, string text) =>
        string.IsNullOrWhiteSpace(text) ? text : source.AlternateLanguageText?.GetValueOrDefault(Key(text)) ?? text;

    public static GameCase Original(GameCase view) => Originals.TryGetValue(view, out var source) ? source : view;

    public static GameCase ForPlayer(GameCase canonical, string? language)
    {
        if (language != Alternate(canonical.Language) || canonical.AlternateLanguageText is not { Count: > 0 })
            return canonical;

        return AlternateViews.GetValue(canonical, source =>
        {
            var copy = JsonSerializer.Deserialize<GameCase>(JsonSerializer.SerializeToUtf8Bytes(source, Json), Json)!;
            copy.Language = Alternate(source.Language);
            Visit(copy, text => Lookup(source, text));
            // This view contains the chosen text. Keep the canonical dictionary out of playback snapshots.
            copy.AlternateLanguageText = null;
            Originals.Add(copy, source);
            return copy;
        });
    }

    public static IReadOnlyList<string> Collect(GameCase gameCase)
    {
        var texts = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        Visit(gameCase, text =>
        {
            if (!string.IsNullOrWhiteSpace(text) && seen.Add(text)) texts.Add(text);
            return text;
        });
        return texts;
    }

    private static void Visit(GameCase gameCase, Func<string, string> text)
    {
        gameCase.Title = text(gameCase.Title);
        gameCase.Summary = text(gameCase.Summary);
        foreach (var stage in gameCase.Stages)
        {
            stage.Title = text(stage.Title);
            foreach (var scene in stage.Scenes)
            {
                scene.Title = text(scene.Title);
                scene.Description = text(scene.Description);
                foreach (var hotspot in scene.Hotspots) hotspot.Label = text(hotspot.Label);
                if (scene.Runtime is not { } runtime) continue;
                foreach (var zone in runtime.ClueZones) zone.Label = text(zone.Label);
                foreach (var exit in runtime.Transitions) exit.Label = text(exit.Label);
            }
        }
        foreach (var character in gameCase.Characters)
        {
            character.Role = text(character.Role);
            character.Description = text(character.Description);
        }
        foreach (var item in gameCase.Items)
        {
            item.Name = text(item.Name);
            item.Description = text(item.Description);
            item.InspectText = text(item.InspectText);
        }
        foreach (var clue in gameCase.Clues)
        {
            clue.Title = text(clue.Title);
            clue.Content = text(clue.Content);
            clue.InventoryDescription = text(clue.InventoryDescription);
            clue.NarrativeMeaning = text(clue.NarrativeMeaning);
        }
        var fragmentsByDialogue = gameCase.TestimonyFragments.ToLookup(fragment => fragment.DialogueId);
        foreach (var dialogue in gameCase.Dialogues)
        {
            dialogue.Question = text(dialogue.Question);
            dialogue.Answer = text(dialogue.Answer);
            foreach (var fragment in fragmentsByDialogue[dialogue.DialogueId]) fragment.Text = text(fragment.Text);
        }
        var dialogueIds = gameCase.Dialogues.Select(dialogue => dialogue.DialogueId).ToHashSet(StringComparer.Ordinal);
        foreach (var fragment in gameCase.TestimonyFragments.Where(fragment => !dialogueIds.Contains(fragment.DialogueId)))
            fragment.Text = text(fragment.Text);
        foreach (var node in gameCase.ConversationNodes)
        {
            foreach (var line in node.Lines) line.Text = text(line.Text);
            foreach (var choice in node.Choices) choice.Label = text(choice.Label);
        }
        foreach (var challenge in gameCase.EvidenceChallenges)
        {
            challenge.Prompt = text(challenge.Prompt);
            challenge.SuccessResponse = text(challenge.SuccessResponse);
            challenge.FailureResponse = text(challenge.FailureResponse);
            challenge.RevealTitle = text(challenge.RevealTitle);
        }
        foreach (var deduction in gameCase.Deductions)
        {
            deduction.Prompt = text(deduction.Prompt);
            deduction.SuccessResponse = text(deduction.SuccessResponse);
            deduction.FailureResponse = text(deduction.FailureResponse);
            foreach (var option in deduction.Options) option.Label = text(option.Label);
        }
        foreach (var hint in gameCase.Hints) hint.Text = text(hint.Text);
        foreach (var interaction in gameCase.Interactions)
        {
            interaction.SuccessMessage = text(interaction.SuccessMessage);
            interaction.FailureMessage = text(interaction.FailureMessage);
        }
        foreach (var puzzle in gameCase.Puzzles)
        {
            puzzle.Prompt = text(puzzle.Prompt);
            puzzle.SuccessMessage = text(puzzle.SuccessMessage);
            puzzle.FailureMessage = text(puzzle.FailureMessage);
            puzzle.ParamsJson = VisitPuzzleText(puzzle.ParamsJson, text);
            puzzle.RevealJson = VisitPuzzleText(puzzle.RevealJson, text);
        }
        var ending = gameCase.FinalLogic;
        ending.WinEnding = text(ending.WinEnding);
        ending.FailEnding = text(ending.FailEnding);
        ending.Motive = text(ending.Motive);
        ending.Method = text(ending.Method);
        foreach (var option in ending.MotiveOptions.Concat(ending.MethodOptions)) option.Label = text(option.Label);

        if (gameCase.Board is { } board)
        {
            board.CenterKicker = text(board.CenterKicker);
            board.CenterTitle = text(board.CenterTitle);
            board.CenterSubtitle = text(board.CenterSubtitle);
            board.Summary = text(board.Summary);
            foreach (var link in board.Links) link.Label = text(link.Label);
        }
        if (gameCase.Timeline is { } timeline)
        {
            timeline.Title = text(timeline.Title);
            timeline.Prompt = text(timeline.Prompt);
            foreach (var point in timeline.Events)
            {
                point.Label = text(point.Label);
                point.Detail = text(point.Detail);
                point.DayLabel = text(point.DayLabel);
                point.TimeLabel = text(point.TimeLabel);
            }
        }
    }

    private static string VisitPuzzleText(string json, Func<string, string> text)
    {
        if (string.IsNullOrWhiteSpace(json)) return json;
        JsonNode? root;
        try { root = JsonNode.Parse(json); }
        catch (JsonException) { return json; }
        var changed = false;
        VisitNode(root);
        return changed ? root!.ToJsonString() : json;

        void VisitNode(JsonNode? node)
        {
            if (node is JsonArray array)
            {
                foreach (var entry in array) VisitNode(entry);
            }
            if (node is not JsonObject obj) return;
            foreach (var (key, value) in obj.ToArray())
            {
                // Codes, reference readings, identifiers and solution values must always match across languages.
                if (key is "title" or "label" or "name" or "short" or "role" or "quote" or "labelTitle"
                        or "labelKick" or "labelQuote" or "caption" or "description" or "text"
                    && value is JsonValue field && field.TryGetValue<string>(out var current))
                {
                    var translated = text(current);
                    if (translated == current) continue;
                    obj[key] = translated;
                    changed = true;
                }
                else VisitNode(value);
            }
        }
    }
}
