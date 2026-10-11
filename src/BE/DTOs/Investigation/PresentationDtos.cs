namespace SirLocked.Api.DTOs.Investigation;

public class GamePresentationDto
{
    public string Version { get; set; } = "1";
    public List<CutsceneDto> Cutscenes { get; set; } = new();
}

public class CutsceneDto
{
    public string Id { get; set; } = string.Empty;
    public string Trigger { get; set; } = string.Empty;
    public string? TriggerId { get; set; }
    public List<CutscenePanelDto> Panels { get; set; } = new();
}

public class CutscenePanelDto
{
    public string Id { get; set; } = string.Empty;
    public string? ImageUrl { get; set; }
    public string? VideoUrl { get; set; }
    public string Caption { get; set; } = string.Empty;
    public string Speaker { get; set; } = string.Empty;
    public int DurationMs { get; set; }
}

public class CharacterPresentationDto
{
    public string? PortraitUrl { get; set; }
    public string? PortraitVideoUrl { get; set; }
    public SpriteSheetDto? SpriteSheet { get; set; }
}

public class SpriteSheetDto
{
    public string Url { get; set; } = string.Empty;
    public int FrameWidth { get; set; }
    public int FrameHeight { get; set; }
    public int FrameCount { get; set; }
    public int Fps { get; set; } = 4;
    public List<int> IdleFrames { get; set; } = new();
    public double AnchorX { get; set; } = .5;
    public double AnchorY { get; set; } = 1;
}
