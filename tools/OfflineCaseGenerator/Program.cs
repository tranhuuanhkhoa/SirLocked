using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services;

if (args.Length is < 3 or > 4)
{
    Console.Error.WriteLine("Usage: OfflineCaseGenerator <case-id> <output-json> <prompt> [stage-count]");
    return 2;
}

var caseId = args[0];
var outputPath = Path.GetFullPath(args[1]);
var prompt = args[2];
var stageCount = args.Length == 4 && int.TryParse(args[3], out var parsedStageCount)
    ? parsedStageCount
    : 4;

var gameCase = MockCaseFactory.Create(prompt, stageCount, "medium", caseId);
ApplyExistingAssets(gameCase);

var validation = new CaseValidationService().Validate(gameCase);
if (!validation.IsValid)
{
    foreach (var error in validation.Errors)
    {
        Console.Error.WriteLine($"{error.Code} {error.Path}: {error.Message}");
    }

    return 1;
}

var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
{
    WriteIndented = true
};

Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(gameCase, options));
Console.WriteLine($"Valid case written to {outputPath}");
Console.WriteLine($"caseId={gameCase.CaseId}; stages={gameCase.Stages.Count}; conversations={gameCase.ConversationNodes.Count}");
return 0;

static void ApplyExistingAssets(GameCase gameCase)
{
    string[] sceneAssets =
    [
        "/assets/scenes/lobby.png",
        "/assets/scenes/backstage-hallway.png",
        "/assets/scenes/owners-office.png",
        "/assets/scenes/dressing-room.png",
        "/assets/scenes/props-room.png"
    ];
    string[] characterAssets =
    [
        "/assets/characters/samuel-portrait.png",
        "/assets/characters/victor-portrait.png",
        "/assets/characters/eleanor-portrait.png",
        "/assets/characters/mona-portrait.png"
    ];
    string[] itemAssets =
    [
        "/assets/items/ledger.png",
        "/assets/items/key.png",
        "/assets/items/letter.png",
        "/assets/items/pawn-ticket.png",
        "/assets/items/scratched-photo.png",
        "/assets/items/love-letter.png"
    ];

    gameCase.CoverImageUrl = "/assets/cases/lumiere-murder.png";
    var scenes = gameCase.Stages.SelectMany(stage => stage.Scenes).ToList();
    for (var i = 0; i < scenes.Count; i++)
    {
        scenes[i].BackgroundUrl = sceneAssets[i % sceneAssets.Length];
    }

    for (var i = 0; i < gameCase.Characters.Count; i++)
    {
        gameCase.Characters[i].ImageUrl = characterAssets[i % characterAssets.Length];
    }

    for (var i = 0; i < gameCase.Items.Count; i++)
    {
        gameCase.Items[i].ImageUrl = itemAssets[i % itemAssets.Length];
    }
}
