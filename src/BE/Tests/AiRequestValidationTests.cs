using System.ComponentModel.DataAnnotations;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using Xunit;

namespace SirLocked.Tests;

public class AiRequestValidationTests
{
    [Fact]
    public void EmptyPrompt_IsAllowed()
    {
        var request = new GenerateAiCaseRequest
        {
            Prompt = string.Empty,
            StageCount = 4,
            Difficulty = "medium"
        };
        var results = new List<ValidationResult>();

        var valid = Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true);

        Assert.True(valid, string.Join(Environment.NewLine, results.Select(result => result.ErrorMessage)));
    }

    [Fact]
    public void VisualStyle_DefaultsToFixedSirLockedTheme()
    {
        var request = new GenerateAiCaseRequest();
        var settings = new AiDraftSettings();

        Assert.Equal(AiVisualStyleDefaults.PixelDetectiveTheme, request.VisualStyle);
        Assert.Equal(AiVisualStyleDefaults.PixelDetectiveTheme, settings.VisualStyle);
        Assert.Contains("pixel-art", AiVisualStyleDefaults.PixelArtContract, StringComparison.OrdinalIgnoreCase);
    }
}
