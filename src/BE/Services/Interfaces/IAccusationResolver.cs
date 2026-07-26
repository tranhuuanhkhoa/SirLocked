using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

/// <summary>
/// The shared tail of the final accusation, exposed so the consensus coordinator can end a case
/// through exactly the same code path as the unilateral route.
/// Callers must have established that the accusation is allowed before calling this.
/// </summary>
public interface IAccusationResolver
{
    Task<GameResultResponse> ResolveAccusationAsync(
        GameRoom room,
        GameCase gameCase,
        CurrentUser actor,
        AccuseRequest request);
}
