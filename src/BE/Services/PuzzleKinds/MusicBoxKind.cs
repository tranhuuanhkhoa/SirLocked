using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P5 · Hộp nhạc lên dây. The brass drum has one column per beat and five holes per column (one per
/// comb tooth). One pin per column; turning the crank plays the tune and stops at the first wrong beat.
/// A postcard shows the tune with a few notes smudged by water; a witness hums the smudged part.
///
/// Rows are numbered top → bottom like the comb: 1 LA · 2 SON · 3 MI · 4 RÊ · 5 ĐỒ (high → low).
///
/// params (public): { beats, notes:["LA","SON","MI","RÊ","ĐỒ"], known:[row|0…] (0 = smudged on the
///                    postcard), quote:"‘…rồi …’", beatMs, … authored card texts }
/// solution (secret): { melody:[row…], hints:[…] }
/// probe:  { pins:[row|0…] } → { firstWrong:n } (1-based, 0 = the whole tune is right). The box is
///         "played" on the server so the client never needs the melody.
/// answer: { pins:[row…] } — must equal the melody.
/// </summary>
public sealed class MusicBoxKind : IPuzzleKind
{
    public string Kind => "music_box";
    public const int Rows = 5;
    public const int MinBeats = 4;
    public const int MaxBeats = 8;
    public static readonly string[] Names = { "", "LA", "SON", "MI", "RÊ", "ĐỒ" };

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        var s = definition.Solution;
        var hard = definition.Difficulty == PuzzleDifficulties.Hard;
        var normal = definition.Difficulty == PuzzleDifficulties.Normal;
        var beats = PuzzleJson.Int(p, "beats", 0);
        if (beats == 0)
        {
            var authored = PuzzleJson.Ints(s, "melody").Count;
            beats = authored > 0 ? authored : (hard || normal ? 8 : 6);
            p["beats"] = beats;
        }
        if (!PuzzleJson.Has(s, "melody")) s["melody"] = PuzzleJson.IntArray(RandomMelody(rng, beats));
        var melody = PuzzleJson.Ints(s, "melody");
        if (!PuzzleJson.Has(p, "known") && melody.Count == beats)
        {
            var smudged = Math.Clamp(hard ? 3 : normal ? 3 : 2, 1, Math.Max(1, beats - 2));
            p["known"] = PuzzleJson.IntArray(melody.Select((row, index) => index < beats - smudged ? row : 0));
        }
        var known = PuzzleJson.Ints(p, "known");
        if (!PuzzleJson.Has(p, "notes")) p["notes"] = new JsonArray(Names.Skip(1).Select(name => (JsonNode?)JsonValue.Create(name)).ToArray());
        if (!PuzzleJson.Has(p, "beatMs")) p["beatMs"] = 520;
        if (!PuzzleJson.Has(p, "quote") && melody.Count == beats && known.Count == beats) p["quote"] = Describe(melody, known);
        if (!PuzzleJson.Has(s, "hints") && melody.Count == beats && known.Count == beats)
        {
            var hidden = Enumerable.Range(0, beats).Where(index => known[index] == 0).ToList();
            var leading = known.TakeWhile(row => row != 0).Count();
            var first = leading == beats - hidden.Count
                ? $"Mỗi cột trên trục là một nhịp. Bưu thiếp cho {leading} nốt đầu — cắm đúng thứ tự từ nhịp 1."
                : "Mỗi cột trên trục là một nhịp. Cắm các nốt còn đọc được trên bưu thiếp trước.";
            var second = hidden.Count == 1
                ? $"Nốt bị nhòe ở nhịp {hidden[0] + 1} là {Names[melody[hidden[0]]]}."
                : $"Các nốt bị nhòe (nhịp {hidden[0] + 1}–{hidden[^1] + 1}) là: {string.Join(" – ", hidden.Select(index => Names[melody[index]]))}.";
            s["hints"] = new JsonArray(first, second);
        }
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        var beats = PuzzleJson.Int(definition.Params, "beats", 0);
        if (beats is < MinBeats or > MaxBeats) error("params.beats", $"beats must be {MinBeats}–{MaxBeats}.");
        var melody = PuzzleJson.Ints(definition.Solution, "melody");
        if (melody.Count != beats) error("solution.melody", "The melody needs exactly one note per beat.");
        if (melody.Any(row => row is < 1 or > Rows)) error("solution.melody", "Melody notes are rows 1 (LA) – 5 (ĐỒ).");
        var known = PuzzleJson.Ints(definition.Params, "known");
        if (known.Count != beats) error("params.known", "known needs one entry per beat (0 = smudged).");
        // With beats missing every list is empty; the beats error above already explains the problem.
        else if (melody.Count == beats && beats > 0)
        {
            if (known.Where((row, index) => row != 0 && row != melody[index]).Any())
                error("params.known", "The postcard shows a note that is not in the melody.");
            var hidden = known.Count(row => row == 0);
            if (hidden == 0) error("params.known", "At least one note must be smudged, or the postcard gives the whole tune away.");
            if (beats - hidden < 2) error("params.known", "The postcard must show at least two notes.");
            if (known[0] == 0) error("params.known", "The first note must be readable (the smudged notes are described from it).");
        }
        if (!PuzzleJson.Has(definition.Params, "quote")) error("params.quote", "The witness quote describing the smudged notes is missing.");
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        var melody = PuzzleJson.Ints(definition.Solution, "melody");
        var pins = ReadPins(answer, melody.Count);
        if (pins is null)
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Chốt trên trục không hợp lệ.");
        var firstWrong = FirstWrong(melody, pins);
        return firstWrong == 0
            ? new PuzzleVerdict(true, new JsonObject { ["firstWrong"] = 0 })
            : new PuzzleVerdict(false, new JsonObject { ["firstWrong"] = firstWrong }, $"Giai điệu lệch ở nhịp {firstWrong}.");
    }

    /// <summary>One turn of the crank: where does the tune go wrong? Not a mistake — it is how the box is tested.</summary>
    public PuzzleVerdict? Probe(PuzzleKindContext definition, JsonElement input, PuzzleRunState run)
    {
        var melody = PuzzleJson.Ints(definition.Solution, "melody");
        var pins = ReadPins(input, melody.Count);
        if (pins is null)
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Chốt trên trục không hợp lệ.", false);
        var firstWrong = FirstWrong(melody, pins);
        return new PuzzleVerdict(false, new JsonObject { ["firstWrong"] = firstWrong },
            firstWrong == 0 ? "Hộp nhạc chơi trọn bài." : $"Giai điệu lệch ở nhịp {firstWrong}.", false);
    }

    public static int FirstWrong(IReadOnlyList<int> melody, IReadOnlyList<int> pins)
    {
        for (var index = 0; index < melody.Count; index++)
            if (index >= pins.Count || pins[index] != melody[index]) return index + 1;
        return 0;
    }

    private static List<int>? ReadPins(JsonElement element, int beats)
    {
        var pins = PuzzleJson.Ints(element, "pins");
        if (pins is null || beats == 0 || pins.Count != beats || pins.Any(row => row is < 0 or > Rows)) return null;
        return pins;
    }

    /// <summary>A short singable tune: a walk over the five teeth with small steps.</summary>
    public static List<int> RandomMelody(Random rng, int beats)
    {
        // pitch 1 = ĐỒ (low) … 5 = LA (high); row = 6 − pitch
        int[] steps = { -2, -1, -1, 1, 1, 2, -1, 1 };
        for (var attempt = 0; ; attempt++)
        {
            var pitch = rng.Next(2, 5);
            var tune = new List<int> { pitch };
            while (tune.Count < beats)
            {
                var next = pitch + steps[rng.Next(steps.Length)];
                if (next is < 1 or > 5) continue;
                pitch = next;
                tune.Add(pitch);
            }
            // keep a recognisable shape: at least three different notes, not a plain scale run
            if (tune.Distinct().Count() < 3 && attempt < 50) continue;
            return tune.Select(value => 6 - value).ToList();
        }
    }

    /// <summary>How a witness hums the smudged notes, each relative to the note before it.</summary>
    public static string Describe(IReadOnlyList<int> melody, IReadOnlyList<int> known)
    {
        var hidden = Enumerable.Range(0, melody.Count).Where(index => index > 0 && known[index] == 0).ToList();
        if (hidden.Count == 0) return string.Empty;
        var clauses = new List<string>();
        foreach (var index in hidden)
        {
            int Pitch(int row) => 6 - row;
            var now = Pitch(melody[index]);
            var before = Pitch(melody[index - 1]);
            var step = now - before;
            string clause;
            if (index == melody.Count - 1 && melody[index] == melody[0] && step != 0) clause = "quay về đúng nốt mở đầu";
            else if (now == 1 && step < 0) clause = step == -1 ? "xuống một bậc tới nốt thấp nhất" : "đi xuống tới nốt thấp nhất";
            else if (now == 5 && step > 0) clause = step == 1 ? "lên một bậc tới nốt cao nhất" : "vọt lên nốt cao nhất";
            else clause = step switch
            {
                0 => "ngân lại đúng nốt ấy",
                1 => "lên một bậc",
                -1 => "xuống một bậc",
                2 => "lên hai bậc",
                -2 => "xuống hai bậc",
                > 0 => $"lên {step} bậc",
                _ => $"xuống {-step} bậc"
            };
            clauses.Add(clause);
        }
        var text = clauses.Count == 1
            ? clauses[0]
            : string.Join(", rồi ", clauses.Take(clauses.Count - 1)) + ", và " + clauses[^1];
        return $"‘…rồi {text}.’";
    }
}
