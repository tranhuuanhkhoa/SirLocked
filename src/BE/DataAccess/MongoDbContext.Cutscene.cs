using MongoDB.Driver;
using SirLocked.Api.Models;

namespace SirLocked.Api.DataAccess;

/// <summary>Collection for case cutscenes (kept apart from the case documents).</summary>
public partial class MongoDbContext
{
    public const string CaseCutscenesCollectionName = "caseCutscenes";

    public IMongoCollection<CaseCutscene> CaseCutscenes => Database.GetCollection<CaseCutscene>(CaseCutscenesCollectionName);
}
