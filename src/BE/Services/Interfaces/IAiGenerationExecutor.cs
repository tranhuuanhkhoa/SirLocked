using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface IAiGenerationExecutor
{
    Task ExecuteAsync(AiCaseDraft draft, CancellationToken cancellationToken);
}
