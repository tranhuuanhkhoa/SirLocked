using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// Rules for the optional voice and atmosphere fields (docs/case-audio-weather.md). Every field is optional: a case
/// without them is valid and plays as before.
/// </summary>
public static class CaseAtmosphere
{
    public const double MinPitch = 80;
    public const double MaxPitch = 1200;
    public const double MinSpeed = 10;
    public const double MaxSpeed = 40;

    /// <summary>A runtime reduced to the writer's atmosphere, or null when it has none.</summary>
    public static SceneRuntime? KeepOnlyAtmosphere(SceneRuntime? runtime)
    {
        if (runtime is null) return null;
        var music = runtime.Audio?.Music;
        if (music is null && runtime.Weather is null && runtime.Indoor is null && runtime.TimeOfDay is null) return null;
        return new SceneRuntime
        {
            Audio = music is null ? null : new SceneAudioConfig { Music = music },
            Weather = runtime.Weather,
            Indoor = runtime.Indoor,
            TimeOfDay = runtime.TimeOfDay
        };
    }

    public static void Validate(GameCase gameCase, CaseValidationResult result)
    {
        for (var index = 0; index < gameCase.Characters.Count; index++)
        {
            var character = gameCase.Characters[index];
            if (character.Voice?.Blip is not { } blip) continue;
            var path = $"characters[{index}].voice.blip";
            if (!InRange(blip.Pitch, MinPitch, MaxPitch))
                result.Add("InvalidValue", $"{path}.pitch", "Voice pitch must be between 80 and 1200 Hz.", character.CharacterId);
            if (!InRange(blip.Speed, MinSpeed, MaxSpeed))
                result.Add("InvalidValue", $"{path}.speed", "Voice speed must be between 10 and 40 letters per second.", character.CharacterId);
            if (!VoiceBlipWaves.All.Contains(blip.Wave ?? string.Empty))
                result.Add("InvalidValue", $"{path}.wave", "Voice wave must be square, triangle, sine or sawtooth.", character.CharacterId);
            if (!InRange(blip.Variance, 0, 1))
                result.Add("InvalidValue", $"{path}.variance", "Voice variance must be between 0 and 1.", character.CharacterId);
        }

        for (var stageIndex = 0; stageIndex < gameCase.Stages.Count; stageIndex++)
        {
            var stage = gameCase.Stages[stageIndex];
            for (var sceneIndex = 0; sceneIndex < stage.Scenes.Count; sceneIndex++)
            {
                var scene = stage.Scenes[sceneIndex];
                if (scene.Runtime is not { } runtime) continue;
                var path = $"stages[{stageIndex}].scenes[{sceneIndex}].runtime";
                if (runtime.Weather is { } weather)
                {
                    if (!SceneWeatherTypes.All.Contains(weather.Type ?? string.Empty))
                        result.Add("InvalidValue", $"{path}.weather.type", "Weather must be NONE, RAIN, WIND, SNOW or STORM.", scene.SceneId);
                    if (!InRange(weather.Intensity, 0, 1))
                        result.Add("InvalidValue", $"{path}.weather.intensity", "Weather intensity must be between 0 and 1.", scene.SceneId);
                    if (runtime.Indoor == true && weather.Type != SceneWeatherTypes.None)
                        result.Add("IndoorWeather", $"{path}.weather", "An indoor scene has no weather: use NONE or leave weather out.", scene.SceneId);
                }
                if (runtime.TimeOfDay is { } timeOfDay && !SceneTimesOfDay.All.Contains(timeOfDay))
                    result.Add("InvalidValue", $"{path}.timeOfDay", "Time of day must be DAY, DUSK or NIGHT.", scene.SceneId);
                if (runtime.Audio?.Music is { } music)
                {
                    var musicPath = $"{path}.audio.music";
                    if (string.IsNullOrWhiteSpace(music.Url) || !IsMediaUrl(music.Url))
                        result.Add("InvalidValue", $"{musicPath}.url", "Music must use an https:// URL or an /assets/ path.", scene.SceneId);
                    if (music.FallbackUrl is { } fallback && !IsMediaUrl(fallback))
                        result.Add("InvalidValue", $"{musicPath}.fallbackUrl", "Music fallback must use an https:// URL or an /assets/ path.", scene.SceneId);
                    if (!InRange(music.Volume, 0, 1))
                        result.Add("InvalidValue", $"{musicPath}.volume", "Music volume must be between 0 and 1.", scene.SceneId);
                    if (music.LoopStartSec is { } start && (!double.IsFinite(start) || start < 0))
                        result.Add("InvalidValue", $"{musicPath}.loopStartSec", "Loop start must be zero or more seconds.", scene.SceneId);
                    if (music.LoopEndSec is { } end && (!double.IsFinite(end) || end <= (music.LoopStartSec ?? 0)))
                        result.Add("InvalidValue", $"{musicPath}.loopEndSec", "Loop end must come after the loop start.", scene.SceneId);
                }
            }
        }
    }

    private static bool InRange(double value, double minimum, double maximum) =>
        double.IsFinite(value) && value >= minimum && value <= maximum;

    /// <summary>https:// anywhere, or a clean /assets/... path served by the game.</summary>
    public static bool IsMediaUrl(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 2048 || value.Contains('\\') || value.Any(char.IsControl)) return false;
        if (value.StartsWith("/assets/", StringComparison.Ordinal))
        {
            var path = Uri.UnescapeDataString(value.Split('?', '#')[0]);
            return !path.Split('/').Any(segment => segment is "." or "..");
        }
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps
            && string.IsNullOrEmpty(uri.UserInfo);
    }
}
