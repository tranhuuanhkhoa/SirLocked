using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;

namespace SirLocked.Api.Services;

/// <summary>
/// The level check of an OPEN_COOP_1 case before layout: every size the level decides, plus the rules that keep the
/// optional puzzles optional. Each finding starts with its code (e.g. "LevelPuzzleSoleProof: ...") so a scoped repair
/// can tell what to fix. Drafts without the OPEN_COOP_1 flag are not checked.
/// </summary>
public static class AiDifficultyConformance
{
    public static IReadOnlyList<string> Check(GameCase gameCase, AiDraftSettings settings, CaseTruthPackage? truth)
    {
        var errors = new List<string>();
        if (!AiPipelineVersions.IsOpenCoop(settings)) return errors;
        var profile = AiDifficultyProfiles.For(settings.Difficulty);
        var level = profile.Difficulty;
        void Range(string code, string what, int count, IntRange range)
        {
            if (count < range.Min || count > range.Max)
                errors.Add($"{code}: {level} needs {range.Min}-{range.Max} {what}; the case has {count}.");
        }

        if (!CaseRuleSets.IsOpenCoop(gameCase))
            errors.Add($"LevelRuleSet: an OPEN_COOP_1 draft must build an OPEN_COOP case; ruleSet is \"{gameCase.RuleSet}\".");
        Range("LevelSceneCount", "scenes", gameCase.Stages.Sum(stage => stage.Scenes.Count), profile.Scenes);
        if (truth is not null && truth.CaseSeed.SuspectIds.Count != profile.Suspects)
            errors.Add($"LevelSuspectCount: {level} needs exactly {profile.Suspects} suspects; the truth has {truth.CaseSeed.SuspectIds.Count}.");
        if (gameCase.EvidenceChallenges.Count != profile.Cracks)
            errors.Add($"LevelCrackCount: {level} needs exactly {profile.Cracks} confrontations; the case has {gameCase.EvidenceChallenges.Count}.");
        var puzzles = AiDifficultyProfiles.PuzzleCount(profile, settings.Leaning);
        if (gameCase.Puzzles.Count != puzzles)
            errors.Add($"LevelPuzzleCount: {level} ({settings.Leaning}) needs exactly {puzzles} optional puzzles; the case has {gameCase.Puzzles.Count}.");
        foreach (var puzzle in gameCase.Puzzles.Where(puzzle => !PuzzleKindRegistry.IsInteractive(puzzle)
                     || puzzle.ProgressionRole != PuzzleProgressionRoles.Optional))
            errors.Add($"LevelPuzzleNotOptional: puzzle {puzzle.PuzzleId} must be an OPTIONAL interactive puzzle.");

        var puzzleOnly = gameCase.Clues.Where(clue => clue.SourceType == "puzzle").Select(clue => clue.ClueId)
            .Concat(gameCase.Puzzles.SelectMany(puzzle => puzzle.UnlockClueIds))
            .ToHashSet(StringComparer.Ordinal);
        var needed = gameCase.FinalLogic.RequiredEvidenceIds
            .Concat(gameCase.EvidenceChallenges.Select(challenge => challenge.CorrectEvidenceId))
            .Concat(gameCase.Deductions.SelectMany(deduction => deduction.RequiredClueIds))
            .Concat(gameCase.RequiredTeamworkChains.Select(chain => chain.InvestigatorClueId));
        foreach (var clueId in needed.Where(puzzleOnly.Contains).Distinct(StringComparer.Ordinal))
            errors.Add($"LevelPuzzleSoleProof: clue {clueId} only comes from an optional puzzle but the accusation needs it.");

        if (profile.Deductions > 0 && gameCase.FinalLogic.RequiredDeductionIds.Count == 0)
            errors.Add($"LevelDeductionMissing: {level} accusations must go through at least one deduction.");
        var timelineEvents = gameCase.Timeline?.Events.Count ?? 0;
        if (profile.TimelineEvents.Max == 0 ? timelineEvents > 0 : timelineEvents < profile.TimelineEvents.Min || timelineEvents > profile.TimelineEvents.Max)
            errors.Add($"LevelTimelineSize: {level} needs {profile.TimelineEvents.Min}-{profile.TimelineEvents.Max} timeline events; the case has {timelineEvents}.");
        Range("LevelRedHerringCount", "red herrings", gameCase.Clues.Count(clue => clue.IsRedHerring), profile.RedHerrings);
        return errors;
    }
}
