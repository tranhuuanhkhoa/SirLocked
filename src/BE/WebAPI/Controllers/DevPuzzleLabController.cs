using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.Models;
using SirLocked.Api.Services.PuzzleKinds;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// Development-only lab for interactive puzzle kinds: generate a fresh instance and run the real
/// server checks without a room. Used by src/FE/puzzle-lab.html. Returns 404 outside Development.
/// </summary>
[ApiController]
[Route("api/dev/puzzle-lab")]
[AllowAnonymous]
public class DevPuzzleLabController : ControllerBase
{
    private readonly IWebHostEnvironment _environment;

    public DevPuzzleLabController(IWebHostEnvironment environment) => _environment = environment;

    public sealed class LabRequest
    {
        public string Kind { get; set; } = string.Empty;
        public JsonObject? Params { get; set; }
        public JsonObject? Solution { get; set; }
        public JsonObject? Reveal { get; set; }
        public string Difficulty { get; set; } = PuzzleDifficulties.Easy;
        public int Seed { get; set; }
        public JsonObject? Answer { get; set; }
        public JsonObject? Payload { get; set; }
        public PuzzleRunState? Run { get; set; }
    }

    [HttpGet("kinds")]
    public IActionResult Kinds() => !_environment.IsDevelopment() ? NotFound()
        : Ok(PuzzleKindRegistry.KnownKinds.OrderBy(kind => kind).ToList());

    [HttpPost("generate")]
    public IActionResult Generate([FromBody] LabRequest request)
    {
        if (!_environment.IsDevelopment()) return NotFound();
        var (kind, context, error) = Resolve(request);
        if (kind is null) return BadRequest(error);
        kind.Generate(context!, new Random(request.Seed));
        var problems = new List<string>();
        kind.Validate(context!, (field, message) => problems.Add($"{field}: {message}"));
        return Ok(new { @params = context!.Params, solution = context.Solution, reveal = context.Reveal, problems });
    }

    [HttpPost("check")]
    public IActionResult Check([FromBody] LabRequest request)
    {
        if (!_environment.IsDevelopment()) return NotFound();
        var (kind, context, error) = Resolve(request);
        if (kind is null) return BadRequest(error);
        var run = request.Run ?? new PuzzleRunState();
        using var answer = JsonDocument.Parse((request.Answer ?? new JsonObject()).ToJsonString());
        var verdict = kind.Check(context!, answer.RootElement, run);
        if (!verdict.Solved) run.Attempts++;
        return Ok(new { solved = verdict.Solved, feedback = verdict.Feedback, message = verdict.Message, run, view = kind.RunView(context!, run), reveal = verdict.Solved ? context!.Reveal : null });
    }

    [HttpPost("probe")]
    public IActionResult Probe([FromBody] LabRequest request)
    {
        if (!_environment.IsDevelopment()) return NotFound();
        var (kind, context, error) = Resolve(request);
        if (kind is null) return BadRequest(error);
        var run = request.Run ?? new PuzzleRunState();
        using var payload = JsonDocument.Parse((request.Payload ?? new JsonObject()).ToJsonString());
        if (payload.RootElement.TryGetProperty("$hint", out var flag) && flag.ValueKind == JsonValueKind.True)
        {
            var hints = InteractivePuzzles.Hints(context!);
            var used = InteractivePuzzles.HintsUsed(run);
            if (hints.Count == 0) return Ok(new { feedback = new { hint = (string?)null, left = 0 }, run });
            var index = Math.Min(used, hints.Count - 1);
            run.Data[InteractivePuzzles.HintCounterKey] = Math.Min(used + 1, hints.Count).ToString();
            return Ok(new { feedback = new { hint = hints[index], level = index + 1, left = hints.Count - index - 1 }, run });
        }
        var verdict = kind.Probe(context!, payload.RootElement, run);
        if (verdict is null) return BadRequest("This kind has no probe.");
        run.ProbesUsed++;
        return Ok(new { solved = verdict.Solved, feedback = verdict.Feedback, message = verdict.Message, run, view = kind.RunView(context!, run) });
    }

    private static (IPuzzleKind? Kind, PuzzleKindContext? Context, string Error) Resolve(LabRequest request)
    {
        var kind = PuzzleKindRegistry.Find(request.Kind);
        if (kind is null) return (null, null, $"Unknown kind '{request.Kind}'.");
        var context = new PuzzleKindContext
        {
            PuzzleId = "lab",
            Params = request.Params ?? new JsonObject(),
            Solution = request.Solution ?? new JsonObject(),
            Reveal = request.Reveal ?? new JsonObject(),
            Difficulty = PuzzleDifficulties.Normalize(request.Difficulty)
        };
        return (kind, context, string.Empty);
    }
}
