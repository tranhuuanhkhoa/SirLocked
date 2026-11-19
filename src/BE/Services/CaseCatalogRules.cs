using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>Pure rules for the player-facing case catalogue.</summary>
public static class CaseCatalogRules
{
    /// <summary>
    /// A pixel case has at least one scene with runtime data and every such scene renders in pixel mode.
    /// A case that mixes pixel and classic scenes is not a pixel case.
    /// </summary>
    public static bool IsPixel(GameCase? gameCase)
    {
        if (gameCase is null) return false;
        var runtimes = gameCase.Stages
            .SelectMany(stage => stage.Scenes)
            .Select(scene => scene.Runtime)
            .Where(runtime => runtime is not null)
            .ToList();
        return runtimes.Count > 0
            && runtimes.All(runtime => string.Equals(runtime!.Render?.Mode, SceneRenderModes.Pixel, StringComparison.OrdinalIgnoreCase));
    }
}

/// <summary>
/// Applies <see cref="CaseCatalogSettings"/>. Services take it as an optional constructor argument:
/// without one, every published case is playable (the behaviour before the pixel catalogue).
/// </summary>
public sealed class CaseCatalogPolicy
{
    public static readonly CaseCatalogPolicy Open = new(new CaseCatalogSettings());

    private readonly CaseCatalogSettings _settings;

    public CaseCatalogPolicy(IOptions<CaseCatalogSettings> settings) : this(settings.Value) { }

    public CaseCatalogPolicy(CaseCatalogSettings settings) => _settings = settings;

    public bool PixelOnly => _settings.PixelOnly;

    /// <summary>
    /// A catalogue limited to pixel cases is small and Vietnamese-only for now, so matchmaking widens a
    /// search (any length, then any language) instead of finding nothing.
    /// </summary>
    public bool RelaxCaseFit => _settings.PixelOnly;

    public bool IsPlayable(GameCase gameCase) =>
        gameCase.Status == CaseStatus.Published && (!PixelOnly || CaseCatalogRules.IsPixel(gameCase));

    public bool IsPlayable(CaseSummaryResponse summary) =>
        summary.Status == CaseStatus.Published && (!PixelOnly || summary.IsPixel);
}
