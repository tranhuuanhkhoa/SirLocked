using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Cutscene;

/// <summary>A deterministic, valid script built from a case. Used when AI calls are mocked (tests, local dev).</summary>
public static class CutsceneMockScriptFactory
{
    private static readonly string[] Mood = { "rain-night" };
    private static readonly string[] Lines =
    {
        "Một buổi sáng nặng nề đè lên cả con phố này.",
        "Mọi thứ trông bình thường, trừ một chi tiết lạ.",
        "Có người đã nhìn thấy điều không nên thấy.",
        "Tôi chưa biết ai nói thật, và ai đang giấu.",
        "Càng nhìn gần, mọi chuyện càng khó hiểu.",
        "Còn một việc cuối cùng: bước vào và điều tra."
    };

    public static MotionComicScript Create(GameCase gameCase)
    {
        var scenes = gameCase.Stages.SelectMany(stage => stage.Scenes).Where(scene => !string.IsNullOrWhiteSpace(scene.BackgroundUrl)).ToList();
        var layouts = new[] { "wide-top-two-bottom", "three-strips" };
        var script = new MotionComicScript
        {
            CaseId = gameCase.CaseId,
            Mood = Mood[0],
            Title = new ComicTitle { Eyebrow = "Hồ sơ 01", Title = gameCase.Title, Subtitle = "Hai thám tử, một buổi sáng, và những điều chưa ai nói ra." }
        };
        var index = 0;
        foreach (var layout in layouts)
        {
            var page = new ComicPage { Layout = layout };
            for (var q = 0; q < 3; q++, index++)
            {
                var scene = scenes[index % scenes.Count];
                page.Panels.Add(new ComicPanel
                {
                    Art = new ComicArt { Kind = "scene", Id = scene.SceneId, Focus = new List<double> { 0.1, 0.1, 0.8, 0.8 } },
                    Weather = index % 2 == 0 ? "rain" : "fog",
                    Enter = new[] { "top", "left", "right", "bottom" }[index % 4],
                    Beats =
                    {
                        new ComicBeat { Type = "caption", Text = $"{scene.Title}. {Lines[index % Lines.Length]}" },
                        new ComicBeat { Type = "sfx", Text = index % 2 == 0 ? "CẠCH." : "ẦM!!", Style = index % 2 == 0 ? "soft" : "impact" }
                    },
                    Audio = { index % 2 == 0 ? "ticking" : "thump" }
                });
            }
            script.Pages.Add(page);
        }
        return script;
    }
}
