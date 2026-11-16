using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// JSON Schema of the optional voice and atmosphere fields (docs/case-audio-weather.md). They are optional in every
/// AI contract: a case without them stays valid and plays as before.
/// </summary>
public static class CaseAtmosphereSchemas
{
    public static JsonObject Voice() => new()
    {
        ["type"] = new JsonArray("object", "null"),
        ["description"] = "Optional speech blip of this character.",
        ["properties"] = new JsonObject
        {
            ["blip"] = new JsonObject
            {
                ["type"] = new JsonArray("object", "null"),
                ["properties"] = new JsonObject
                {
                    ["pitch"] = Number(80, 1200, "Hz"),
                    ["speed"] = Number(10, 40, "letters per second"),
                    ["wave"] = new JsonObject
                    {
                        ["type"] = "string",
                        ["enum"] = new JsonArray("square", "triangle", "sine", "sawtooth")
                    },
                    ["variance"] = Number(0, 1, "pitch variance")
                },
                ["required"] = new JsonArray("pitch", "speed", "wave", "variance"),
                ["additionalProperties"] = false
            }
        },
        ["required"] = new JsonArray("blip"),
        ["additionalProperties"] = false
    };

    /// <summary>
    /// The scene atmosphere the writer owns: music, weather, indoor and time of day. The server stores it in the
    /// scene's runtime (runtime.audio.music, runtime.weather, runtime.indoor, runtime.timeOfDay).
    /// </summary>
    public static JsonObject SceneAtmosphere() => new()
    {
        ["type"] = new JsonArray("object", "null"),
        ["description"] = "Optional scene atmosphere (music, weather, indoor, time of day); the server stores it with the scene layout. Indoor scenes have weather NONE or none at all.",
        ["properties"] = new JsonObject
        {
            ["audio"] = new JsonObject
            {
                ["type"] = new JsonArray("object", "null"),
                ["properties"] = new JsonObject { ["music"] = Music() },
                ["required"] = new JsonArray("music"),
                ["additionalProperties"] = false
            },
            ["weather"] = new JsonObject
            {
                ["type"] = new JsonArray("object", "null"),
                ["properties"] = new JsonObject
                {
                    ["type"] = new JsonObject
                    {
                        ["type"] = "string",
                        ["enum"] = new JsonArray("NONE", "RAIN", "WIND", "SNOW", "STORM")
                    },
                    ["intensity"] = Number(0, 1, "0 to 1")
                },
                ["required"] = new JsonArray("type", "intensity"),
                ["additionalProperties"] = false
            },
            ["indoor"] = new JsonObject { ["type"] = new JsonArray("boolean", "null") },
            ["timeOfDay"] = new JsonObject
            {
                ["type"] = new JsonArray("string", "null"),
                ["enum"] = new JsonArray("DAY", "DUSK", "NIGHT", null)
            }
        },
        ["required"] = new JsonArray("audio", "weather", "indoor", "timeOfDay"),
        ["additionalProperties"] = false
    };

    private static JsonObject Music() => new()
    {
        ["type"] = new JsonArray("object", "null"),
        ["properties"] = new JsonObject
        {
            ["url"] = new JsonObject { ["type"] = "string", ["description"] = ".ogg file, https:// or /assets/..." },
            ["fallbackUrl"] = new JsonObject { ["type"] = new JsonArray("string", "null"), ["description"] = ".mp3 fallback" },
            ["title"] = new JsonObject { ["type"] = "string" },
            ["source"] = new JsonObject { ["type"] = "string" },
            ["license"] = new JsonObject { ["type"] = "string" },
            ["loopStartSec"] = new JsonObject { ["type"] = new JsonArray("number", "null"), ["minimum"] = 0 },
            ["loopEndSec"] = new JsonObject { ["type"] = new JsonArray("number", "null"), ["minimum"] = 0 },
            ["volume"] = Number(0, 1, "0 to 1")
        },
        ["required"] = new JsonArray("url", "fallbackUrl", "title", "source", "license", "loopStartSec", "loopEndSec", "volume"),
        ["additionalProperties"] = false
    };

    private static JsonObject Number(double minimum, double maximum, string description) => new()
    {
        ["type"] = "number",
        ["minimum"] = minimum,
        ["maximum"] = maximum,
        ["description"] = description
    };
}

/// <summary>Scene atmosphere carried by the projection content (the writer's part of the runtime).</summary>
public sealed class SceneAtmosphereContent
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public SceneAtmosphereAudioContent? Audio { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public SceneWeather? Weather { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Indoor { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? TimeOfDay { get; set; }

    /// <summary>Writes the atmosphere into the scene runtime without touching layout fields.</summary>
    public void ApplyTo(CaseScene scene)
    {
        if (Audio?.Music is null && Weather is null && Indoor is null && TimeOfDay is null) return;
        scene.Runtime ??= new SceneRuntime();
        if (Audio?.Music is { } music)
        {
            scene.Runtime.Audio ??= new SceneAudioConfig();
            scene.Runtime.Audio.Music = music;
        }
        if (Weather is not null) scene.Runtime.Weather = Weather;
        if (Indoor is not null) scene.Runtime.Indoor = Indoor;
        if (TimeOfDay is not null) scene.Runtime.TimeOfDay = TimeOfDay;
    }
}

public sealed class SceneAtmosphereAudioContent
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public SceneMusic? Music { get; set; }
}
