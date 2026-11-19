using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Cutscene;

/// <summary>
/// Builds the only case data the AI is shown when it writes an intro: what a player sees before touching anything.
/// An allow-list: nothing is copied except the fields below, so new secret fields added to the case later can never
/// leak into a prompt by accident.
/// </summary>
public static class CutsceneInputBuilder
{
    public const string CoverId = "cover";

    public static JsonObject Build(GameCase gameCase)
    {
        var scenes = new JsonArray();
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes).Where(scene => !string.IsNullOrWhiteSpace(scene.BackgroundUrl)))
            scenes.Add(new JsonObject { ["id"] = scene.SceneId, ["title"] = scene.Title, ["description"] = scene.Description });

        var characters = new JsonArray();
        foreach (var character in gameCase.Characters.Where(character => !string.IsNullOrWhiteSpace(character.ImageUrl)))
            characters.Add(new JsonObject { ["id"] = character.CharacterId, ["name"] = character.Name, ["role"] = character.Role, ["description"] = character.Description });

        var items = new JsonArray();
        foreach (var item in gameCase.Items.Where(item => !string.IsNullOrWhiteSpace(item.ImageUrl)))
            items.Add(new JsonObject { ["id"] = item.ItemId, ["name"] = item.Name, ["description"] = item.Description });

        var input = new JsonObject
        {
            ["caseId"] = gameCase.CaseId,
            ["title"] = gameCase.Title,
            ["summary"] = gameCase.Summary,
            ["language"] = gameCase.Language,
            ["scenes"] = scenes,
            ["characters"] = characters,
            ["itemsWithImages"] = items
        };
        if (!string.IsNullOrWhiteSpace(gameCase.CoverImageUrl)) input["coverId"] = CoverId;
        return input;
    }

    public static string BuildJson(GameCase gameCase) =>
        Build(gameCase).ToJsonString(new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
}
