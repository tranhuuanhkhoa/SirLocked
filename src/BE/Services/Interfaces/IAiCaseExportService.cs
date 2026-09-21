using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface IAiCaseExportService
{
    string Export(AiCaseDraft draft, GameCase gameCase, string caseJson, int errorCount);
}
