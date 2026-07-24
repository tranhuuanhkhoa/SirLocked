using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class AiCaseExportServiceTests
{
    [Theory]
    [InlineData("../outside", "outside")]
    [InlineData(@"..\..\outside", "outside")]
    [InlineData("case/child", "case-child")]
    [InlineData("case:windows*bad?", "case-windows-bad")]
    [InlineData("", "case")]
    public void ArtifactSegment_RemovesSeparatorsParentSegmentsAndInvalidCharacters(
        string input,
        string expected)
    {
        Assert.Equal(expected, AiCaseExportService.ToSafeArtifactSegment(input, "case"));
    }

    [Fact]
    public void ResolvedExportPath_AlwaysStaysUnderGeneratedRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "sirlocked-export-root");

        var safe = AiCaseExportService.ResolveContainedPath(root, "case-123");

        Assert.StartsWith(
            Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
            safe,
            StringComparison.OrdinalIgnoreCase);
        Assert.Throws<InvalidOperationException>(() =>
            AiCaseExportService.ResolveContainedPath(root, ".."));
    }
}
