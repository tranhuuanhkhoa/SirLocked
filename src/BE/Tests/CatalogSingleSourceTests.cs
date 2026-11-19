using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// The static catalogs are seed data. A read of them in runtime code would quietly ignore what an admin saved, and
/// nothing else would notice until a player did. So this reads the source: only the seed may touch them.
/// </summary>
public class CatalogSingleSourceTests
{
    private static readonly Regex StaticRead = new(
        @"\bMarketCatalog\.(All|Find)\b"
        + @"|\bChestCatalog\.(Chests|Find|Roll|ExpectedValue|ItemDefs|DropRates)\b"
        + @"|\bCosmeticCatalog\.(ItemDefs|LevelRewards|ForChest)\b"
        + @"|\bAchievementRules\.Catalog\b"
        + @"|\bProgressRules\.(RareXp|EpicXp)\b"
        + @"|\bProgressRules\.XpValue\([^,)]*\)"
        + @"|\bAchievementRules\.Evaluate\([^,)]*\)"
        + @"|\.PriceOf\(",
        RegexOptions.Compiled);

    // The classes that hold the seed, and the code that turns it into documents or checks its configuration.
    private static readonly string[] Allowed =
    {
        "Services/Market/MarketCatalog.cs",
        "Services/Market/ChestCatalog.cs",
        "Services/Market/CosmeticCatalog.cs",
        "Services/Market/ProgressRules.cs",
        "Services/Market/SkinCatalog.cs",
        "Services/Catalog/CatalogSeedData.cs",
        "Services/Catalog/CatalogSnapshot.cs",
        "Configurations/ChestSettings.cs",
    };

    private static string BackendRoot([CallerFilePath] string testFile = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(testFile)!, ".."));

    [Fact]
    public void OnlyTheSeedReadsTheStaticCatalogs()
    {
        var root = BackendRoot();
        var offenders = new List<string>();
        foreach (var folder in new[] { "Services", "WebAPI", "DTOs", "Configurations", "Models", "DataAccess", "Repositories" })
        {
            var path = Path.Combine(root, folder);
            if (!Directory.Exists(path)) continue;
            foreach (var file in Directory.EnumerateFiles(path, "*.cs", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                if (Allowed.Contains(relative)) continue;
                var lines = File.ReadAllLines(file);
                for (var i = 0; i < lines.Length; i++)
                {
                    if (StaticRead.IsMatch(lines[i])) offenders.Add($"{relative}:{i + 1}: {lines[i].Trim()}");
                }
            }
        }

        Assert.True(offenders.Count == 0, "Read ICatalogProvider instead:\n" + string.Join("\n", offenders));
    }

    [Fact]
    public void TheCheckRecognisesARead() // Otherwise the test above would pass for the wrong reason.
    {
        Assert.Matches(StaticRead, "var def = MarketCatalog.Find(id);");
        Assert.Matches(StaticRead, "foreach (var chest in ChestCatalog.Chests)");
        Assert.Matches(StaticRead, "_settings.PriceOf(chest.Id).Key");
        Assert.Matches(StaticRead, "var xp = ProgressRules.XpValue(def);");
        Assert.Matches(StaticRead, "AchievementRules.Evaluate(stats)");
        Assert.DoesNotMatch(StaticRead, "ProgressRules.XpValue(def, rare, epic)");
        Assert.DoesNotMatch(StaticRead, "AchievementRules.Evaluate(await LoadAsync(id, ct), catalog)");
        Assert.DoesNotMatch(StaticRead, "MarketCatalog.StarterItemIds.Count");
        Assert.DoesNotMatch(StaticRead, "CosmeticCatalog.DefaultTitleDefId");
    }
}
