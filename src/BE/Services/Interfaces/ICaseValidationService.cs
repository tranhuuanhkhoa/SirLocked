using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface ICaseValidationService
{
    /// <summary>Deterministically validates a case: required fields, duplicate IDs, references, flags, and playthrough reachability.</summary>
    CaseValidationResult Validate(GameCase gameCase);
    CaseValidationResult ValidateFullLogic(GameCase gameCase);
    CaseValidationResult ValidateSceneLayout(GameCase gameCase);
}
