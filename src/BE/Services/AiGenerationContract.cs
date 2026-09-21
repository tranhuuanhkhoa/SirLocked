using System.Text.RegularExpressions;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

public sealed record CrackGenerationBudget(
    int MinCracks,
    int MaxCracks,
    int MinTestimonies,
    int MaxTestimonies,
    int MinEvidence,
    int MaxEvidence,
    int TargetTestimonies,
    int TargetEvidence,
    int MaxPairsPerCrack,
    int MaxPairsPerCase)
{
    public void EnsureValid(string preset)
    {
        if (MinCracks < 1 || MaxCracks < MinCracks
            || MinTestimonies < 2 || MaxTestimonies < MinTestimonies
            || MinEvidence < 3 || MaxEvidence < MinEvidence
            || TargetTestimonies < MinTestimonies || TargetTestimonies > MaxTestimonies
            || TargetEvidence < MinEvidence || TargetEvidence > MaxEvidence
            || MaxPairsPerCrack < MinTestimonies * MinEvidence
            || MaxPairsPerCase < MinCracks * MinTestimonies * MinEvidence)
        {
            throw new InvalidOperationException($"Crack generation budget for {preset} is invalid.");
        }
    }
}

public static class CrackGenerationBudgets
{
    private static readonly IReadOnlyDictionary<string, CrackGenerationBudget> Values =
        new Dictionary<string, CrackGenerationBudget>(StringComparer.Ordinal)
        {
            [AiGenerationPresets.ShortDemo] = new(1, 1, 2, 4, 3, 6, 2, 3, 12, 12),
            [AiGenerationPresets.NormalRandom] = new(1, 2, 2, 4, 3, 6, 3, 3, 18, 30),
            [AiGenerationPresets.PuzzleHeavy] = new(1, 2, 2, 4, 3, 6, 2, 4, 18, 30),
            [AiGenerationPresets.DialogueHeavy] = new(1, 2, 2, 4, 3, 6, 4, 3, 18, 30),
            [AiGenerationPresets.FullFeature] = new(2, 3, 2, 4, 3, 6, 3, 5, 24, 60),
            [AiGenerationPresets.CrackTheLieV3] = new(1, 1, 3, 3, 3, 3, 3, 3, 9, 9)
        };

    static CrackGenerationBudgets()
    {
        foreach (var (preset, budget) in Values) budget.EnsureValid(preset);
        var missing = AiGenerationPresets.All.Where(preset => !Values.ContainsKey(preset)).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException($"Missing Crack generation budgets: {string.Join(", ", missing)}.");
    }

    public static CrackGenerationBudget For(string? preset) =>
        Values[AiGenerationPresets.Normalize(preset)];

    public static IReadOnlyDictionary<string, CrackGenerationBudget> All => Values;
}

public sealed record AiGenerationContract(
    int MinStages,
    int MaxStages,
    int MinScenes,
    int MaxScenes,
    int MinCharacters,
    int MaxCharacters,
    int MinClues,
    int MaxClues,
    int MinDialogues,
    int MaxDialogues,
    int EvidenceChallenges,
    int Deductions,
    int TeamworkChains,
    int MinPuzzles,
    int MaxPuzzles,
    int MinInteractions,
    int MaxInteractions,
    int MinConversationCharacters = 0,
    int MaxEvidenceChallenges = -1)
{
    private static readonly Regex UnsafeVisualTerms = new(
        @"\b(bulletin board|duty board|notice board|signage|sign|label|ledger|manifest|telegram|document|paper|readable|written|writing|letters?|numbers?|text|annotation|caption|screen|monitor|camera display|user interface|ui overlay|clock numerals?|initials?|notation)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex ProhibitedCameraCompositionTerms = new(
        @"\b(macro|close[- ]?up|close view|close photograph|photographed|photograph of|zoom(?:ed)?|inset|callout|panel view|framed detail|montage|split screen)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex VietnameseDiacritics = new(
        "[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex VietnameseWords = new(
        @"\b(và|của|là|một|những|được|trong|không|với|cho|đã|khi|này|đó|tại|từ|người|vật|bằng|sau|trước)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static AiGenerationContract For(string preset, int requestedStages)
    {
        var normalized = AiGenerationPresets.Normalize(preset);
        return normalized switch
        {
            AiGenerationPresets.CrackTheLieV3 => new(1, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 0, 0, 0, 0, 0, 0),
            AiGenerationPresets.ShortDemo => new(2, 2, 2, 3, 4, 4, 6, 8, 6, 8, 2, 1, 1, 1, 1, 1, 1),
            AiGenerationPresets.PuzzleHeavy => new(5, 6, 5, 6, 4, 5, 9, 12, 6, 10, 2, 1, 1, 3, 3, 2, 4),
            AiGenerationPresets.DialogueHeavy => new(5, 6, 5, 6, 5, 5, 10, 12, 12, 16, 3, 2, 1, 0, 1, 0, 2, 3),
            AiGenerationPresets.FullFeature => new(6, 6, 6, 6, 5, 5, 10, 12, 12, 16, 3, 2, 2, 3, 3, 2, 4),
            _ => new(
                Math.Clamp(requestedStages, 2, 6), Math.Clamp(requestedStages, 2, 6),
                Math.Clamp(requestedStages, 2, 6), 6,
                4, 5, 8, 10, 8, 12, 2, 1, 1, 0, 2, 0, 2)
        };
    }

    public static AiGenerationContract For(AiDraftSettings settings)
    {
        var contract = For(settings.GenerationPreset, settings.StageCount);
        if (!settings.IncludeCrackTheLie) return contract;
        var budget = CrackGenerationBudgets.For(settings.GenerationPreset);
        return contract with { EvidenceChallenges = budget.MinCracks, MaxEvidenceChallenges = budget.MaxCracks };
    }

    public string PromptRequirements() =>
        $"Stages {MinStages}-{MaxStages}; total scenes {MinScenes}-{MaxScenes}; characters {MinCharacters}-{MaxCharacters}; " +
        $"clues {MinClues}-{MaxClues}; dialogues {MinDialogues}-{MaxDialogues}; " +
        (MaxEvidenceChallenges > 0 && MaxEvidenceChallenges != EvidenceChallenges
            ? $"{EvidenceChallenges}-{MaxEvidenceChallenges} evidenceChallenges, "
            : $"exactly {EvidenceChallenges} evidenceChallenges, ") +
        $"{Deductions} deductions and {TeamworkChains} requiredTeamworkChains; puzzles {MinPuzzles}-{MaxPuzzles}; " +
        $"interactions {MinInteractions}-{MaxInteractions}; conversation trees must cover at least {MinConversationCharacters} distinct characters.";

    public CaseValidationResult Validate(GameCase gameCase, AiDraftSettings settings)
    {
        var result = new CaseValidationResult();
        var sceneCount = gameCase.Stages.Sum(stage => stage.Scenes.Count);

        AddRange(result, "stages", gameCase.Stages.Count, MinStages, MaxStages);
        AddRange(result, "stages[].scenes", sceneCount, MinScenes, MaxScenes);
        AddRange(result, "characters", gameCase.Characters.Count, MinCharacters, MaxCharacters);
        AddRange(result, "items", gameCase.Items.Count, 0, 8);
        AddRange(result, "clues", gameCase.Clues.Count, MinClues, MaxClues);
        AddRange(result, "dialogues", gameCase.Dialogues.Count, MinDialogues, MaxDialogues);
        AddRange(result, "evidenceChallenges", gameCase.EvidenceChallenges.Count, EvidenceChallenges,
            MaxEvidenceChallenges > 0 ? MaxEvidenceChallenges : EvidenceChallenges);
        AddRange(result, "deductions", gameCase.Deductions.Count, Deductions, Deductions);
        AddRange(result, "requiredTeamworkChains", gameCase.RequiredTeamworkChains.Count, TeamworkChains, TeamworkChains);
        AddRange(result, "puzzles", gameCase.Puzzles.Count, MinPuzzles, MaxPuzzles);
        AddRange(result, "interactions", gameCase.Interactions.Count, MinInteractions, MaxInteractions);

        var preset = AiGenerationPresets.Normalize(settings.GenerationPreset);
        if (preset is AiGenerationPresets.PuzzleHeavy or AiGenerationPresets.FullFeature)
        {
            foreach (var type in CasePuzzleTypes.All)
            {
                if (gameCase.Puzzles.Count(puzzle => puzzle.Type.Equals(type, StringComparison.OrdinalIgnoreCase)) != 1)
                    result.Add("PresetContract", "puzzles", $"{preset} requires exactly one {type}.");
            }
            foreach (var type in new[] { CaseInteractionTypes.UseItemOnTarget, CaseInteractionTypes.CombineItems })
            {
                if (!gameCase.Interactions.Any(interaction => interaction.Type.Equals(type, StringComparison.OrdinalIgnoreCase)))
                    result.Add("PresetContract", "interactions", $"{preset} requires at least one {type}.");
            }
        }

        var conversationCharacters = gameCase.ConversationNodes.Select(node => node.CharacterId).Distinct().Count();
        if (conversationCharacters < MinConversationCharacters)
            result.Add("PresetContract", "conversationNodes", $"At least {MinConversationCharacters} characters need conversation trees.");

        ValidateVisualSafety(gameCase, result);
        if (CaseLanguages.Normalize(settings.Language) == CaseLanguages.Vietnamese)
            ValidateVietnamese(gameCase, result);
        result.Errors.AddRange(AiV3GenerationProfile.Validate(gameCase).Errors);

        return result;
    }

    private static void ValidateVisualSafety(GameCase gameCase, CaseValidationResult result)
    {
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
        {
            if (string.IsNullOrWhiteSpace(scene.VisualDescription))
                result.Add("MissingField", $"scene:{scene.SceneId}.visualDescription", "AI scenes require an English/ASCII visualDescription.", scene.SceneId);
            else
                ValidateSafeVisualText(scene.VisualDescription, $"scene:{scene.SceneId}.visualDescription", scene.SceneId, result);
        }

        var symbolPuzzleClues = gameCase.Puzzles
            .Where(puzzle => puzzle.Type.Equals(CasePuzzleTypes.SymbolMatchPuzzle, StringComparison.OrdinalIgnoreCase))
            .SelectMany(puzzle => puzzle.RequiredClueIds)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var clue in gameCase.Clues)
        {
            var isCameraClue = clue.DiscoverMethod.Equals("camera", StringComparison.OrdinalIgnoreCase)
                               || clue.SourceType.Equals("camera", StringComparison.OrdinalIgnoreCase);
            clue.VisualTextPolicy = ClueVisualTextPolicies.Normalize(clue.VisualTextPolicy);
            if (clue.VisualTextPolicy == ClueVisualTextPolicies.AbstractSymbols)
            {
                if (!isCameraClue || !symbolPuzzleClues.Contains(clue.ClueId))
                    result.Add("InvalidVisualTextPolicy", $"clue:{clue.ClueId}.visualTextPolicy",
                        "ABSTRACT_SYMBOLS is only allowed for a camera clue required by a SYMBOL_MATCH_PUZZLE.", clue.ClueId);
                if (Regex.IsMatch(clue.VisualDescription, @"[A-Za-z0-9]", RegexOptions.CultureInvariant)
                    && UnsafeVisualTerms.IsMatch(clue.VisualDescription))
                    result.Add("VisualSafety", $"clue:{clue.ClueId}.visualDescription",
                        "Abstract-symbol clues may describe shapes but may not request readable letters, numbers or text.", clue.ClueId);
            }
            else if (isCameraClue)
            {
                ValidateSafeVisualText(clue.VisualDescription, $"clue:{clue.ClueId}.visualDescription", clue.ClueId, result);
            }
            if (isCameraClue)
            {
                var compositionMatch = ProhibitedCameraCompositionTerms.Match(clue.VisualDescription);
                if (compositionMatch.Success)
                    result.Add("CameraComposition", $"clue:{clue.ClueId}.visualDescription",
                        $"Camera clue art direction must describe the scene-scale environmental detail itself, not '{compositionMatch.Value}' composition.", clue.ClueId);
            }
        }

        foreach (var item in gameCase.Items.Where(item =>
                     CaseItemRenderModes.Infer(item) == CaseItemRenderModes.Embedded
                     || item.RenderMode.Equals(CaseItemRenderModes.Embedded, StringComparison.OrdinalIgnoreCase)))
        {
            ValidateSafeVisualText(item.VisualDescription, $"item:{item.ItemId}.visualDescription", item.ItemId, result);
        }
    }

    private static void ValidateSafeVisualText(string value, string path, string refId, CaseValidationResult result)
    {
        if (value.Any(ch => ch > 127))
            result.Add("VisualSafety", path, "Image art direction must stay English/ASCII.", refId);
        var match = UnsafeVisualTerms.Match(value);
        if (match.Success)
            result.Add("VisualSafety", path, $"Text-bearing visual term '{match.Value}' is prohibited; express the clue with shape, material, color, damage or position instead.", refId);
    }

    private static void ValidateVietnamese(GameCase gameCase, CaseValidationResult result)
    {
        foreach (var (path, value) in PlayerFacingStrings(gameCase))
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length < 20 || value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length < 4)
                continue;
            if (!VietnameseDiacritics.IsMatch(value) && !VietnameseWords.IsMatch(value))
                result.Add("LanguageMismatch", path, "Player-facing prose appears not to be natural Vietnamese with diacritics.");
            if (result.Errors.Count(error => error.Code == "LanguageMismatch") >= 20) break;
        }
    }

    private static IEnumerable<(string Path, string Value)> PlayerFacingStrings(GameCase c)
    {
        yield return ("title", c.Title);
        yield return ("summary", c.Summary);
        foreach (var stage in c.Stages)
        {
            yield return ($"stage:{stage.StageId}.title", stage.Title);
            foreach (var scene in stage.Scenes)
            {
                yield return ($"scene:{scene.SceneId}.title", scene.Title);
                yield return ($"scene:{scene.SceneId}.description", scene.Description);
            }
        }
        foreach (var character in c.Characters)
        {
            yield return ($"character:{character.CharacterId}.role", character.Role);
            yield return ($"character:{character.CharacterId}.description", character.Description);
        }
        foreach (var item in c.Items)
        {
            yield return ($"item:{item.ItemId}.description", item.Description);
            yield return ($"item:{item.ItemId}.inspectText", item.InspectText);
        }
        foreach (var clue in c.Clues)
        {
            yield return ($"clue:{clue.ClueId}.title", clue.Title);
            yield return ($"clue:{clue.ClueId}.content", clue.Content);
            yield return ($"clue:{clue.ClueId}.inventoryDescription", clue.InventoryDescription);
            yield return ($"clue:{clue.ClueId}.narrativeMeaning", clue.NarrativeMeaning);
        }
        foreach (var dialogue in c.Dialogues)
        {
            yield return ($"dialogue:{dialogue.DialogueId}.question", dialogue.Question);
            yield return ($"dialogue:{dialogue.DialogueId}.answer", dialogue.Answer);
        }
        foreach (var hint in c.Hints) yield return ($"hint:{hint.HintId}.text", hint.Text);
        foreach (var puzzle in c.Puzzles)
        {
            yield return ($"puzzle:{puzzle.PuzzleId}.prompt", puzzle.Prompt);
            yield return ($"puzzle:{puzzle.PuzzleId}.successMessage", puzzle.SuccessMessage);
            yield return ($"puzzle:{puzzle.PuzzleId}.failureMessage", puzzle.FailureMessage);
        }
        yield return ("finalLogic.motive", c.FinalLogic.Motive);
        yield return ("finalLogic.method", c.FinalLogic.Method);
        yield return ("finalLogic.winEnding", c.FinalLogic.WinEnding);
        yield return ("finalLogic.failEnding", c.FinalLogic.FailEnding);
    }

    private static void AddRange(CaseValidationResult result, string path, int actual, int min, int max)
    {
        if (actual < min || actual > max)
            result.Add("PresetContract", path, $"Expected {min}-{max}, received {actual}.");
    }
}
