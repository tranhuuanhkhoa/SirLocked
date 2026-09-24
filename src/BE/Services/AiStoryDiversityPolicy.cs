using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

internal sealed class AiStoryHistoryEntry
{
    public AiStoryPreview Preview { get; set; } = new();
    public AiStoryDiversityProfile Diversity { get; set; } = new();
    public string StoryFingerprint { get; set; } = string.Empty;
}

internal static class AiStoryDiversityPolicy
{
    public const double StructuralDuplicateThreshold = 0.70;

    private static readonly string[] ConcreteCaseTypes =
    [
        AiCaseTypes.Murder,
        AiCaseTypes.MissingPerson,
        AiCaseTypes.Theft,
        AiCaseTypes.Sabotage,
        AiCaseTypes.Fraud,
        AiCaseTypes.Kidnapping
    ];

    private static readonly string[] Settings =
    [
        "an isolated manor and its service passages",
        "a rain-soaked railway terminus",
        "a riverside theatre during a gala",
        "a clockmakers' district preparing for a public exhibition",
        "a private museum during an inventory lockdown",
        "a grand hotel cut off by severe weather",
        "a harbor warehouse complex during a night shift",
        "a mountain observatory hosting a small scientific delegation"
    ];

    private static readonly string[] Eras =
    [
        "late Victorian gaslight society",
        "the early Edwardian period",
        "the interwar 1930s",
        "a restrained alternate gaslamp history with no digital technology"
    ];

    private static readonly string[] IncidentPatterns =
    [
        "a locked-room impossibility",
        "an interrupted public ceremony",
        "an impossible delivery or handoff",
        "a deliberately falsified time signal",
        "a switched container or identity",
        "a machine failure staged to look accidental",
        "a vanished ledger tied to a narrow time window",
        "an apparent accident whose physical sequence is impossible"
    ];

    private static readonly string[] EvidenceMotifs =
    [
        "mechanical timing and wear traces",
        "textile, dust, and soil transfer",
        "paper, seal, and ink anomalies",
        "bounded chemical residue and contamination",
        "access geometry involving keys, locks, and routes",
        "sound, light, and witness observability",
        "tickets, ledgers, and chronological records",
        "weather, moisture, and temperature traces"
    ];

    private static readonly string[] Relationships =
    [
        "a family member protecting an inheritance",
        "a trusted assistant with privileged access",
        "a business partner hiding an undisclosed conflict",
        "a professional rival with specialized knowledge",
        "a caretaker whose routine grants unusual opportunity",
        "a client whose public story conceals a private dependency"
    ];

    private static readonly string[] Motives =
    [
        "protecting an inheritance or disputed ownership",
        "concealing professional fraud or forged credentials",
        "retaliation for an old betrayal",
        "preventing exposure of a private dependency",
        "financial pressure involving debt or blackmail",
        "protecting another person at personal cost",
        "controlling a valuable discovery or contract",
        "silencing evidence of a previous offense"
    ];

    private static readonly string[] Methods =
    [
        "a physical substitution performed during a narrow access window",
        "a staged scene designed to reverse apparent cause and effect",
        "identity or role impersonation used to cross an access boundary",
        "a timing exploit based on a predictable routine",
        "an alternate route that defeats the obvious locked-path assumption",
        "manipulated paperwork that causes another person to move the target",
        "an unwitting intermediary used to complete a critical action",
        "a deliberately induced mechanical failure"
    ];

    private static readonly string[] Twists =
    [
        "the strongest alibi is true but covers the wrong time window",
        "the apparent target was a decoy for the real objective",
        "one suspicious clue was planted while another was accidental",
        "a witness tells the truth but misidentifies what the event means",
        "the incident has two causally separate stages",
        "an innocent suspect unknowingly enables the culprit",
        "the apparent crime scene is only the concealment scene",
        "a reliable record is authentic but was created earlier than assumed"
    ];

    private static readonly string[] InvestigationMechanics =
    [
        "reconcile mutually incompatible timelines",
        "test a testimony claim against a physical trace",
        "prove an object was switched by tracking state changes",
        "separate access, capability, and opportunity for each suspect",
        "reconstruct sight and sound observability between locations",
        "follow custody of a document or container",
        "distinguish planted evidence from naturally created traces",
        "use travel time to invalidate an otherwise plausible alibi"
    ];

    public static AiStoryDiversityProfile Create(string? requestedCaseType, string? seed = null)
    {
        var normalizedRequest = AiCaseTypes.Normalize(requestedCaseType);
        var effectiveSeed = string.IsNullOrWhiteSpace(seed) ? Guid.NewGuid().ToString("N") : seed.Trim();
        var concreteType = normalizedRequest == AiCaseTypes.Random
            ? Pick(ConcreteCaseTypes, effectiveSeed, "case-type")
            : normalizedRequest;

        var profile = new AiStoryDiversityProfile
        {
            Seed = effectiveSeed,
            RequestedCaseType = normalizedRequest,
            CaseType = concreteType,
            SettingArchetype = Pick(Settings, effectiveSeed, "setting"),
            EraFlavor = Pick(Eras, effectiveSeed, "era"),
            IncidentPattern = Pick(IncidentPatterns, effectiveSeed, "incident"),
            EvidenceMotif = Pick(EvidenceMotifs, effectiveSeed, "evidence"),
            CulpritRelationship = Pick(Relationships, effectiveSeed, "relationship"),
            MotiveArchetype = Pick(Motives, effectiveSeed, "motive"),
            MethodArchetype = Pick(Methods, effectiveSeed, "method"),
            TwistArchetype = Pick(Twists, effectiveSeed, "twist"),
            InvestigationMechanic = Pick(InvestigationMechanics, effectiveSeed, "investigation")
        };
        profile.CoreFingerprint = ComputeCoreFingerprint(profile);
        return profile;
    }

    public static AiStoryDiversityProfile CreateDistinct(
        string? requestedCaseType,
        string seed,
        IEnumerable<AiStoryDiversityProfile> recentProfiles)
    {
        var history = recentProfiles.Where(IsUsable).Take(50).ToList();
        AiStoryDiversityProfile? best = null;
        var bestMaximumSimilarity = double.MaxValue;

        for (var attempt = 0; attempt < 32; attempt++)
        {
            var candidateSeed = attempt == 0 ? seed : $"{seed}:{attempt}";
            var candidate = Create(requestedCaseType, candidateSeed);
            var maximumSimilarity = history.Count == 0
                ? 0
                : history.Max(previous => StructuralSimilarity(candidate, previous));
            if (maximumSimilarity < StructuralDuplicateThreshold) return candidate;
            if (maximumSimilarity < bestMaximumSimilarity)
            {
                best = candidate;
                bestMaximumSimilarity = maximumSimilarity;
            }
        }

        return best ?? Create(requestedCaseType, seed);
    }

    public static double StructuralSimilarity(AiStoryDiversityProfile left, AiStoryDiversityProfile right)
    {
        var leftAxes = CoreAxes(left);
        var rightAxes = CoreAxes(right);
        var matched = leftAxes.Zip(rightAxes).Count(pair =>
            string.Equals(pair.First, pair.Second, StringComparison.OrdinalIgnoreCase));
        return (double)matched / leftAxes.Length;
    }

    public static AiStoryDiversityProfile? FindStructuralDuplicate(
        AiStoryDiversityProfile candidate,
        IEnumerable<AiStoryDiversityProfile> recentProfiles) =>
        recentProfiles.FirstOrDefault(previous =>
            IsUsable(previous)
            && StructuralSimilarity(candidate, previous) >= StructuralDuplicateThreshold);

    public static string ComputeCoreFingerprint(AiStoryDiversityProfile profile)
    {
        var normalized = string.Join('|', CoreAxes(profile).Select(NormalizeText));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized))).ToLowerInvariant();
    }

    public static string ComputeFingerprint(AiStoryPreview preview)
    {
        var normalized = NormalizeText(PremiseText(preview));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized))).ToLowerInvariant();
    }

    public static AiStoryPreview? FindNearDuplicate(
        AiStoryPreview candidate,
        IEnumerable<AiStoryPreview> recentPreviews)
    {
        return recentPreviews.FirstOrDefault(recent => IsNearDuplicate(candidate, recent));
    }

    internal static bool IsNearDuplicate(AiStoryPreview left, AiStoryPreview right)
    {
        var leftTitle = NormalizeText(left.Title);
        var rightTitle = NormalizeText(right.Title);
        if (leftTitle.Length > 0 && leftTitle == rightTitle) return true;

        var premiseSimilarity = Jaccard(Tokens(PremiseText(left)), Tokens(PremiseText(right)));
        if (premiseSimilarity >= 0.82) return true;

        var titleSimilarity = Jaccard(Tokens(left.Title), Tokens(right.Title));
        return titleSimilarity >= 0.72 && premiseSimilarity >= 0.66;
    }

    private static string PremiseText(AiStoryPreview preview) =>
        $"{preview.Title} {preview.Setting} {preview.OpeningIncident} {preview.Summary}";

    private static string[] CoreAxes(AiStoryDiversityProfile profile) =>
    [
        profile.CaseType,
        profile.SettingArchetype,
        profile.CulpritRelationship,
        profile.MotiveArchetype,
        profile.MethodArchetype,
        profile.TwistArchetype,
        profile.EvidenceMotif,
        profile.InvestigationMechanic
    ];

    private static bool IsUsable(AiStoryDiversityProfile profile) =>
        !string.IsNullOrWhiteSpace(profile.CoreFingerprint)
        && !string.IsNullOrWhiteSpace(profile.CaseType);

    private static HashSet<string> Tokens(string value) => NormalizeText(value)
        .Split(' ', StringSplitOptions.RemoveEmptyEntries)
        .Where(token => token.Length >= 3)
        .ToHashSet(StringComparer.Ordinal);

    private static double Jaccard(HashSet<string> left, HashSet<string> right)
    {
        if (left.Count == 0 || right.Count == 0) return 0;
        var intersection = left.Count(right.Contains);
        var union = left.Count + right.Count - intersection;
        return union == 0 ? 0 : (double)intersection / union;
    }

    private static string NormalizeText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var decomposed = value.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        var lastWasSpace = false;
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(character);
                lastWasSpace = false;
            }
            else if (!lastWasSpace)
            {
                builder.Append(' ');
                lastWasSpace = true;
            }
        }
        return builder.ToString().Trim().Normalize(NormalizationForm.FormC);
    }

    private static string Pick(IReadOnlyList<string> values, string seed, string axis)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{seed}:{axis}"));
        var value = BitConverter.ToUInt32(hash, 0);
        return values[(int)(value % values.Count)];
    }
}
