namespace SirLocked.Api.Configurations;

public class MongoDbSettings
{
    public string ConnectionString { get; set; } = "mongodb://localhost:27017";
    public string DatabaseName { get; set; } = "SirLockedDb";
    public string UsersCollectionName { get; set; } = "users";
    public string CasesCollectionName { get; set; } = "gameCases";
    public string RoomsCollectionName { get; set; } = "gameRooms";
    public string GameResultsCollectionName { get; set; } = "gameResults";
    public string ActionLogsCollectionName { get; set; } = "gameActionLogs";
    public string RoomChatMessagesCollectionName { get; set; } = "roomChatMessages";
    public string AiCaseDraftsCollectionName { get; set; } = "aiCaseDrafts";
    public string AiGenerationLogsCollectionName { get; set; } = "aiGenerationLogs";
    public string GeneratedAssetsCollectionName { get; set; } = "generatedAssets";
    public string EvidencePhotosCollectionName { get; set; } = "evidencePhotos";
    public string ReviewsCollectionName { get; set; } = "reviews";
    public string WeeklyFeaturesCollectionName { get; set; } = "weeklyFeatures";
    public string PlaytestEventsCollectionName { get; set; } = "playtestEvents";
}
