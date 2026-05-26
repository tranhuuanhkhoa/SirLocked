using SirLocked.API.DTOs.Case;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class CaseService : ICaseService
{
    private const string Draft = "DRAFT";
    private const string Published = "PUBLISHED";

    private readonly ICaseRepository _cases;

    public CaseService(ICaseRepository cases)
    {
        _cases = cases;
    }

    public async Task<IReadOnlyList<CaseListResponse>> GetPublishedAsync(CancellationToken cancellationToken = default)
    {
        var cases = await _cases.GetPublishedAsync(cancellationToken);
        return cases.Select(MapToListResponse).ToList();
    }

    public async Task<IReadOnlyList<CaseListResponse>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var cases = await _cases.GetAllAsync(cancellationToken);
        return cases.Select(MapToListResponse).ToList();
    }

    public async Task<CaseDetailResponse?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        var gameCase = await _cases.GetByIdAsync(id, cancellationToken);
        return gameCase is null ? null : new CaseDetailResponse { Case = gameCase };
    }

    public Task<CaseValidationResult> ValidateAsync(ImportCaseRequest request, CancellationToken cancellationToken = default)
    {
        var errors = new List<string>();
        var gameCase = request.Case;

        if (string.IsNullOrWhiteSpace(gameCase.Title)) errors.Add("Case title is required.");
        if (string.IsNullOrWhiteSpace(gameCase.Summary)) errors.Add("Case summary is required.");
        if (gameCase.EstimatedMinutes <= 0) errors.Add("Estimated minutes must be greater than zero.");
        if (gameCase.Stages.Count == 0) errors.Add("At least one stage is required.");
        if (gameCase.Characters.Count == 0) errors.Add("At least one character is required.");
        if (gameCase.Items.Count == 0) errors.Add("At least one item is required.");
        if (gameCase.Clues.Count == 0) errors.Add("At least one clue is required.");
        if (string.IsNullOrWhiteSpace(gameCase.FinalLogic.CulpritId)) errors.Add("Final culprit is required.");
        if (string.IsNullOrWhiteSpace(gameCase.FinalLogic.Motive)) errors.Add("Final motive is required.");
        if (string.IsNullOrWhiteSpace(gameCase.FinalLogic.Method)) errors.Add("Final method is required.");
        if (gameCase.FinalLogic.RequiredEvidenceIds.Count == 0) errors.Add("At least one required evidence id is required.");

        var itemIds = gameCase.Items.Select(item => item.ItemId).Where(id => !string.IsNullOrWhiteSpace(id)).ToHashSet();
        var clueIds = gameCase.Clues.Select(clue => clue.ClueId).Where(id => !string.IsNullOrWhiteSpace(id)).ToHashSet();
        var characterIds = gameCase.Characters.Select(character => character.CharacterId).Where(id => !string.IsNullOrWhiteSpace(id)).ToHashSet();
        var stageIds = gameCase.Stages.Select(stage => stage.StageId).Where(id => !string.IsNullOrWhiteSpace(id)).ToList();
        var sceneIds = gameCase.Stages.SelectMany(stage => stage.Scenes).Select(scene => scene.SceneId).Where(id => !string.IsNullOrWhiteSpace(id)).ToList();
        AddDuplicateErrors("stage", stageIds, errors);
        AddDuplicateErrors("scene", sceneIds, errors);
        AddDuplicateErrors("character", gameCase.Characters.Select(character => character.CharacterId), errors);
        AddDuplicateErrors("item", gameCase.Items.Select(item => item.ItemId), errors);
        AddDuplicateErrors("clue", gameCase.Clues.Select(clue => clue.ClueId), errors);
        AddDuplicateErrors("dialogue", gameCase.Dialogues.Select(dialogue => dialogue.DialogueId), errors);

        foreach (var stage in gameCase.Stages)
        {
            if (string.IsNullOrWhiteSpace(stage.StageId)) errors.Add("Every stage needs a stage id.");
            if (stage.Scenes.Count == 0) errors.Add($"Stage '{stage.StageId}' needs at least one scene.");

            foreach (var scene in stage.Scenes)
            {
                if (string.IsNullOrWhiteSpace(scene.SceneId)) errors.Add($"Stage '{stage.StageId}' has a scene without id.");
                foreach (var itemId in scene.ItemIds.Where(itemId => !itemIds.Contains(itemId)))
                {
                    errors.Add($"Scene '{scene.SceneId}' references unknown item '{itemId}'.");
                }

                foreach (var characterId in scene.CharacterIds.Where(characterId => !characterIds.Contains(characterId)))
                {
                    errors.Add($"Scene '{scene.SceneId}' references unknown character '{characterId}'.");
                }
            }
        }

        foreach (var item in gameCase.Items)
        {
            foreach (var clueId in item.UnlockClueIds.Where(clueId => !clueIds.Contains(clueId)))
            {
                errors.Add($"Item '{item.ItemId}' unlocks unknown clue '{clueId}'.");
            }
        }

        foreach (var dialogue in gameCase.Dialogues)
        {
            if (!characterIds.Contains(dialogue.CharacterId))
            {
                errors.Add($"Dialogue '{dialogue.DialogueId}' references unknown character '{dialogue.CharacterId}'.");
            }

            foreach (var clueId in dialogue.RequiredClueIds.Where(clueId => !clueIds.Contains(clueId)))
            {
                errors.Add($"Dialogue '{dialogue.DialogueId}' requires unknown clue '{clueId}'.");
            }

            foreach (var clueId in dialogue.UnlockClueIds.Where(clueId => !clueIds.Contains(clueId)))
            {
                errors.Add($"Dialogue '{dialogue.DialogueId}' unlocks unknown clue '{clueId}'.");
            }
        }

        foreach (var evidenceId in gameCase.FinalLogic.RequiredEvidenceIds.Where(evidenceId => !itemIds.Contains(evidenceId) && !clueIds.Contains(evidenceId)))
        {
            errors.Add($"Final logic requires unknown evidence '{evidenceId}'.");
        }

        if (!string.IsNullOrWhiteSpace(gameCase.FinalLogic.CulpritId) && !characterIds.Contains(gameCase.FinalLogic.CulpritId))
        {
            errors.Add($"Final culprit '{gameCase.FinalLogic.CulpritId}' is not a character.");
        }

        return Task.FromResult(new CaseValidationResult { Errors = errors });
    }

    private static void AddDuplicateErrors(string label, IEnumerable<string> ids, List<string> errors)
    {
        foreach (var duplicate in ids
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .GroupBy(id => id.Trim(), StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key))
        {
            errors.Add($"Duplicate {label} id '{duplicate}'.");
        }
    }

    public async Task<CaseDetailResponse> ImportAsync(ImportCaseRequest request, CancellationToken cancellationToken = default)
    {
        var gameCase = request.Case;
        gameCase.CaseId = string.IsNullOrWhiteSpace(gameCase.CaseId) ? $"case-{Guid.NewGuid():N}" : gameCase.CaseId;
        if (await _cases.ExistsByCaseIdAsync(gameCase.CaseId, cancellationToken))
        {
            throw new InvalidOperationException($"Case id '{gameCase.CaseId}' already exists.");
        }

        gameCase.Status = string.IsNullOrWhiteSpace(gameCase.Status) ? Draft : gameCase.Status.Trim().ToUpperInvariant();
        gameCase.CreatedAt = DateTime.UtcNow;
        gameCase.UpdatedAt = DateTime.UtcNow;
        await _cases.CreateAsync(gameCase, cancellationToken);
        return new CaseDetailResponse { Case = gameCase };
    }

    public async Task<CaseStatusResponse?> PublishAsync(string id, CancellationToken cancellationToken = default)
    {
        var gameCase = await _cases.GetByIdAsync(id, cancellationToken);
        if (gameCase is null)
        {
            return null;
        }

        var validation = await ValidateAsync(new ImportCaseRequest { Case = gameCase }, cancellationToken);
        if (!validation.IsValid)
        {
            throw new InvalidOperationException(string.Join("; ", validation.Errors));
        }

        gameCase.Status = Published;
        await _cases.UpdateAsync(gameCase, cancellationToken);
        return new CaseStatusResponse { CaseId = gameCase.CaseId, Status = gameCase.Status };
    }

    public async Task<CaseStatusResponse?> UnpublishAsync(string id, CancellationToken cancellationToken = default)
    {
        var gameCase = await _cases.GetByIdAsync(id, cancellationToken);
        if (gameCase is null)
        {
            return null;
        }

        gameCase.Status = Draft;
        await _cases.UpdateAsync(gameCase, cancellationToken);
        return new CaseStatusResponse { CaseId = gameCase.CaseId, Status = gameCase.Status };
    }

    public async Task<CaseDetailResponse> SeedSampleAsync(CancellationToken cancellationToken = default)
    {
        const string caseId = "case-week2-manor";
        var existing = await _cases.GetByIdAsync(caseId, cancellationToken);
        if (existing is not null)
        {
            existing.Status = Published;
            await _cases.UpdateAsync(existing, cancellationToken);
            return new CaseDetailResponse { Case = existing };
        }

        var sample = CreateSampleCase(caseId);
        if (!await _cases.ExistsByCaseIdAsync(sample.CaseId, cancellationToken))
        {
            await _cases.CreateAsync(sample, cancellationToken);
        }

        return new CaseDetailResponse { Case = sample };
    }

    public async Task<IReadOnlyList<CaseDetailResponse>> SeedDemoCasesAsync(CancellationToken cancellationToken = default)
    {
        var demoCases = new[]
        {
            CreateSampleCase("case-week2-manor"),
            CreateGalleryCase()
        };
        var results = new List<CaseDetailResponse>();

        foreach (var demoCase in demoCases)
        {
            var existing = await _cases.GetByIdAsync(demoCase.CaseId, cancellationToken);
            if (existing is not null)
            {
                existing.Status = Published;
                await _cases.UpdateAsync(existing, cancellationToken);
                results.Add(new CaseDetailResponse { Case = existing });
                continue;
            }

            await _cases.CreateAsync(demoCase, cancellationToken);
            results.Add(new CaseDetailResponse { Case = demoCase });
        }

        return results;
    }

    private static CaseListResponse MapToListResponse(GameCase gameCase)
    {
        return new CaseListResponse
        {
            Id = gameCase.Id ?? string.Empty,
            CaseId = gameCase.CaseId,
            Title = gameCase.Title,
            Summary = gameCase.Summary,
            Status = gameCase.Status,
            EstimatedMinutes = gameCase.EstimatedMinutes
        };
    }

    public static GameCase CreateSampleCase(string caseId = "case-week2-manor")
    {
        return new GameCase
        {
            CaseId = caseId,
            Title = "The Locked Manor Ledger",
            Summary = "A financier is found dead after a private dinner. The room was locked, but the missing ledger reveals who had motive and access.",
            Status = Published,
            EstimatedMinutes = 35,
            Characters =
            [
                new Character { CharacterId = "char-ada", Name = "Ada Blackwood", Role = "Housekeeper", ImageUrl = "/assets/characters/ada-blackwood.png" },
                new Character { CharacterId = "char-edgar", Name = "Edgar Voss", Role = "Business Partner", ImageUrl = "/assets/characters/edgar-voss.png" },
                new Character { CharacterId = "char-mira", Name = "Mira Lane", Role = "Niece", ImageUrl = "/assets/characters/mira-lane.png" }
            ],
            Items =
            [
                new Item
                {
                    ItemId = "item-ledger",
                    Name = "Burned Ledger Page",
                    Description = "A half-burned accounting page listing a hidden debt under Edgar Voss.",
                    ImageUrl = "/assets/items/burned-ledger.png",
                    UnlockClueIds = ["clue-debt"]
                },
                new Item
                {
                    ItemId = "item-key",
                    Name = "Brass Balcony Key",
                    Description = "A polished key found behind a loose brick near the balcony door.",
                    ImageUrl = "/assets/items/brass-key.png",
                    UnlockClueIds = ["clue-balcony"]
                },
                new Item
                {
                    ItemId = "item-glass",
                    Name = "Bitter Crystal Glass",
                    Description = "A glass with a bitter almond scent and a faint thumbprint.",
                    ImageUrl = "/assets/items/crystal-glass.png",
                    UnlockClueIds = ["clue-poison"]
                }
            ],
            Clues =
            [
                new Clue { ClueId = "clue-debt", Title = "Hidden Debt", Content = "Edgar owed the victim enough money to lose his firm.", IsCritical = true },
                new Clue { ClueId = "clue-balcony", Title = "Balcony Exit", Content = "The locked room could be entered from the balcony with the brass key.", IsCritical = true },
                new Clue { ClueId = "clue-poison", Title = "Poisoned Toast", Content = "The victim's drink was prepared before the study door was locked.", IsCritical = true }
            ],
            Dialogues =
            [
                new Dialogue
                {
                    DialogueId = "dlg-edgar-ledger",
                    CharacterId = "char-edgar",
                    Question = "Why was your name in the burned ledger?",
                    Answer = "Edgar admits the debt but claims the victim promised more time.",
                    RequiredClueIds = ["clue-debt"]
                }
            ],
            Stages =
            [
                new Stage
                {
                    StageId = "stage-study",
                    Title = "The Locked Study",
                    Order = 1,
                    Scenes =
                    [
                        new Scene
                        {
                            SceneId = "scene-study",
                            Title = "Victim's Study",
                            BackgroundUrl = "/assets/scenes/study.png",
                            ItemIds = ["item-ledger", "item-glass", "item-key"],
                            CharacterIds = ["char-ada", "char-edgar", "char-mira"]
                        }
                    ]
                },
                new Stage
                {
                    StageId = "stage-balcony",
                    Title = "Balcony Route",
                    Order = 2,
                    Scenes =
                    [
                        new Scene
                        {
                            SceneId = "scene-balcony",
                            Title = "South Balcony",
                            BackgroundUrl = "/assets/scenes/balcony.png",
                            ItemIds = ["item-key"],
                            CharacterIds = ["char-mira"]
                        }
                    ]
                }
            ],
            FinalLogic = new FinalCaseLogic
            {
                CulpritId = "char-edgar",
                Motive = "Hidden debt",
                Method = "Poisoned drink",
                RequiredEvidenceIds = ["clue-debt", "clue-balcony", "clue-poison"]
            }
        };
    }

    private static GameCase CreateGalleryCase()
    {
        return new GameCase
        {
            CaseId = "case-week3-gallery",
            Title = "The Crimson Gallery Theft",
            Summary = "A gallery owner reports a stolen ruby pendant during a charity preview. The suspect list is short, but every clue points to a staged theft.",
            Status = Published,
            EstimatedMinutes = 28,
            Characters =
            [
                new Character { CharacterId = "char-lena", Name = "Lena Hart", Role = "Gallery Owner", ImageUrl = "/assets/characters/lena-hart.png" },
                new Character { CharacterId = "char-omar", Name = "Omar Vale", Role = "Security Lead", ImageUrl = "/assets/characters/omar-vale.png" },
                new Character { CharacterId = "char-iris", Name = "Iris Shaw", Role = "Restorer", ImageUrl = "/assets/characters/iris-shaw.png" }
            ],
            Items =
            [
                new Item
                {
                    ItemId = "item-camera",
                    Name = "Paused Security Camera",
                    Description = "The hallway camera stopped for exactly seven minutes before the alarm.",
                    ImageUrl = "/assets/items/security-camera.png",
                    UnlockClueIds = ["clue-camera-gap"]
                },
                new Item
                {
                    ItemId = "item-glove",
                    Name = "Paint-Stained Glove",
                    Description = "A glove marked with restoration pigment, hidden behind a display plinth.",
                    ImageUrl = "/assets/items/paint-glove.png",
                    UnlockClueIds = ["clue-restorer-access"]
                },
                new Item
                {
                    ItemId = "item-safe",
                    Name = "Open Display Safe",
                    Description = "The safe shows no forced entry, only a clean keypad trace.",
                    ImageUrl = "/assets/items/display-safe.png",
                    UnlockClueIds = ["clue-keypad-code"]
                }
            ],
            Clues =
            [
                new Clue { ClueId = "clue-camera-gap", Title = "Seven-Minute Gap", Content = "Only the security lead could pause the hallway camera without triggering backup alerts.", IsCritical = true },
                new Clue { ClueId = "clue-restorer-access", Title = "Restoration Access", Content = "Iris had legitimate access to the gallery floor after closing, but not the safe code.", IsCritical = false },
                new Clue { ClueId = "clue-keypad-code", Title = "Clean Keypad Trace", Content = "The safe was opened with the correct code shortly after Omar's scheduled patrol.", IsCritical = true }
            ],
            Dialogues =
            [
                new Dialogue
                {
                    DialogueId = "dlg-omar-camera",
                    CharacterId = "char-omar",
                    Question = "Why was the hallway camera paused?",
                    Answer = "Omar claims he paused it for maintenance, but no maintenance ticket exists.",
                    RequiredClueIds = ["clue-camera-gap"]
                }
            ],
            Stages =
            [
                new Stage
                {
                    StageId = "stage-gallery-floor",
                    Title = "Gallery Floor",
                    Order = 1,
                    Scenes =
                    [
                        new Scene
                        {
                            SceneId = "scene-main-gallery",
                            Title = "Main Gallery",
                            BackgroundUrl = "/assets/scenes/gallery.png",
                            ItemIds = ["item-camera", "item-glove", "item-safe"],
                            CharacterIds = ["char-lena", "char-omar", "char-iris"]
                        }
                    ]
                }
            ],
            FinalLogic = new FinalCaseLogic
            {
                CulpritId = "char-omar",
                Motive = "Insurance payout",
                Method = "Paused the camera and opened the safe with the code",
                RequiredEvidenceIds = ["clue-camera-gap", "clue-keypad-code"]
            }
        };
    }
}
