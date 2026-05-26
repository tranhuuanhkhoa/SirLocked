namespace SirLocked.API.Configurations;

public sealed class MongoDbSettings
{
    public const string SectionName = "MongoDb";

    public string ConnectionString { get; init; } = string.Empty;
    public string DatabaseName { get; init; } = string.Empty;
    public string UsersCollectionName { get; init; } = "users";
    public string CasesCollectionName { get; init; } = "cases";
    public string RoomsCollectionName { get; init; } = "rooms";
    public string GameActionLogsCollectionName { get; init; } = "gameActionLogs";
    public string GameResultsCollectionName { get; init; } = "gameResults";
    public string AiCaseDraftsCollectionName { get; init; } = "aiCaseDrafts";
    public string AiGenerationLogsCollectionName { get; init; } = "aiGenerationLogs";
    public string GeneratedAssetsCollectionName { get; init; } = "generatedAssets";
}
