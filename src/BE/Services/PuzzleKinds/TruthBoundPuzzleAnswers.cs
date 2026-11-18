using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// Truth-bound puzzle kinds (fingerprint, doc_forgery, parallax_code) take their answer from the approved truth.
/// Until a kind can bind its answer it is not offered to the AI.
/// </summary>
public static class TruthBoundPuzzleAnswers
{
    public static bool CanOffer(string kind, CaseTruthPackage truth) => false;
}
