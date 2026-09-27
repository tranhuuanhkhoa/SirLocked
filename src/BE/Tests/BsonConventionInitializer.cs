using System.Runtime.CompilerServices;
using SirLocked.Api.DataAccess;

namespace SirLocked.Tests;

/// <summary>
/// The camelCase/ignore-extra-elements convention pack is registered by <see cref="MongoDbContext"/>'s
/// static constructor. Only one test class touches that type, so under xUnit's parallel collections a
/// BSON round-trip could freeze a class map first and silently read PascalCase element names — the
/// persistence-contract assertions then failed depending on scheduling. Registering once, before any
/// test runs, makes the serialization contract deterministic.
/// </summary>
internal static class BsonConventionInitializer
{
    [ModuleInitializer]
    internal static void Initialize() =>
        RuntimeHelpers.RunClassConstructor(typeof(MongoDbContext).TypeHandle);
}
