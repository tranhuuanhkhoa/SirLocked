using System.Globalization;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public sealed partial class GameplayProjectionPlanner
{
    // Approved truth contains evidence and its limits, not arbitrary safe combinations.
    // These dossier exercises therefore test only already-discovered evidence. Their
    // rewards are existing truth traces, never newly invented facts or duplicate clues.
    private static void CreateInvestigativeMechanics(
        GameCase skeleton,
        CaseTruthPackage truth,
        AiGenerationContract contract,
        IReadOnlyDictionary<string, CaseClue> clueByTrace)
    {
        if (contract.MinPuzzles == 0) return;
        var vietnamese = skeleton.Language == CaseLanguages.Vietnamese;
        string T(string english, string translated) => vietnamese ? translated : english;
        var scenes = skeleton.Stages.SelectMany(stage => stage.Scenes).ToList();
        var traceByClue = clueByTrace.ToDictionary(pair => pair.Value.ClueId,
            pair => truth.TraceLedger.Single(trace => trace.TraceId == pair.Key), StringComparer.Ordinal);
        var baseClues = clueByTrace.Values.ToList();
        var inputs = baseClues.Where(clue => clue.SourceType == "camera")
            .OrderBy(clue => scenes.FindIndex(scene => scene.SceneId == clue.SceneId))
            .ThenBy(clue => clue.ClueId, StringComparer.Ordinal).Take(2).ToList();
        var rewards = baseClues.Except(inputs)
            // Preserve the environmental source and keep the item budget bounded by
            // replacing existing evidence carriers before adding another target.
            .Where(clue => clue.SourceType != "interaction")
            .OrderBy(clue => clue.SourceType == EvidenceDiscoveryMethods.ItemInspect ? 0 : 1)
            .ThenBy(clue => scenes.FindIndex(scene => scene.SceneId == clue.SceneId))
            .ThenBy(clue => clue.ClueId, StringComparer.Ordinal)
            .Take(contract.MinPuzzles + 1).ToList();
        if (inputs.Count != 2 || rewards.Count != contract.MinPuzzles + 1)
            throw new ProjectionPlanningException(
                ["PROJECTABILITY mechanics: this preset needs two independently discoverable camera clues and a distinct trace for each puzzle plus the dossier comparison. Choose a smaller preset or provide more approved evidence."]);

        var cardIds = new List<string>();
        for (var index = 0; index < inputs.Count; index++)
        {
            var card = AddDossierItem(skeleton, $"item-projection-card-{index + 1:00}",
                inputs[index].SceneId, true,
                T($"Evidence note {index + 1}", $"Phiếu chứng cứ {index + 1}"),
                T("A copy of an evidence note already entered in the case file. Combine both notes into a comparison dossier.",
                    "Bản sao phiếu chứng cứ đã ghi nhận trong hồ sơ. Ghép hai phiếu thành hồ sơ đối chiếu."),
                [inputs[index].ClueId]);
            card.InteractionPurpose = CaseItemInteractionPurposes.CombineItem;
            cardIds.Add(card.ItemId);
        }

        var dossier = AddDossierItem(skeleton, "item-projection-comparison", null, true,
            T("Comparison dossier", "Hồ sơ đối chiếu"),
            T("Two evidence notes assembled for a focused comparison. Use this dossier at the comparison desk after completing the preliminary analysis.",
                "Hai phiếu chứng cứ được ghép để đối chiếu. Dùng hồ sơ tại bàn đối chiếu sau khi hoàn thành phân tích sơ bộ."), []);
        dossier.InteractionPurpose = CaseItemInteractionPurposes.CombineItem;
        var comparisonReward = rewards[^1];
        RemovePreviousCarrier(skeleton, comparisonReward);
        var comparisonTarget = AddDossierItem(skeleton, "item-projection-comparison-desk",
            comparisonReward.SceneId, false,
            T("Comparison desk", "Bàn đối chiếu"),
            T("Use the assembled comparison dossier here to document the remaining evidence at this location.",
                "Dùng hồ sơ đã ghép tại đây để ghi nhận chứng cứ còn lại ở địa điểm này."), []);
        var combine = new CaseInteraction
        {
            InteractionId = "interaction-projection-combine",
            Type = CaseInteractionTypes.CombineItems,
            RequiredItemIds = cardIds,
            RequiredClueIds = inputs.Select(clue => clue.ClueId).ToList(),
            UnlockItemIds = [dossier.ItemId],
            SingleUse = true,
            SuccessMessage = T("The two notes form a comparison dossier. Take it to the comparison desk.",
                "Hai phiếu đã thành hồ sơ đối chiếu. Mang hồ sơ tới bàn đối chiếu."),
            FailureMessage = T("Collect both evidence notes before assembling the dossier.",
                "Cần thu thập đủ hai phiếu chứng cứ trước khi ghép hồ sơ.")
        };
        var use = new CaseInteraction
        {
            InteractionId = "interaction-projection-compare",
            Type = CaseInteractionTypes.UseItemOnTarget,
            TargetId = comparisonTarget.ItemId,
            RequiredItemIds = [dossier.ItemId],
            RequiredClueIds = inputs.Select(clue => clue.ClueId).ToList(),
            UnlockClueIds = [comparisonReward.ClueId],
            SingleUse = true,
            SuccessMessage = T("The comparison is complete. The documented evidence has been added to the case file.",
                "Đã hoàn thành đối chiếu. Chứng cứ được ghi nhận đã bổ sung vào hồ sơ."),
            FailureMessage = T("Use the assembled dossier after completing the preliminary analysis.",
                "Dùng hồ sơ đã ghép sau khi hoàn thành phân tích sơ bộ.")
        };
        SetMechanicSource(comparisonReward, use.InteractionId, "interaction", EvidenceAcquisitionMethods.ItemUse);
        skeleton.Interactions.Add(combine);
        skeleton.Interactions.Add(use);

        for (var index = 0; index < contract.MinPuzzles; index++)
        {
            var reward = rewards[index];
            RemovePreviousCarrier(skeleton, reward);
            var target = AddDossierItem(skeleton, $"item-projection-analysis-{index + 1:00}", reward.SceneId, false,
                T($"Evidence analysis {index + 1}", $"Bàn phân tích chứng cứ {index + 1}"),
                T("Compare the evidence already in the case file before recording the next finding at this location.",
                    "Đối chiếu chứng cứ đã có trong hồ sơ trước khi ghi nhận phát hiện tiếp theo tại địa điểm này."), []);
            var basis = index == 0 ? inputs : new List<CaseClue> { inputs[0], rewards[index - 1] };
            if (index == contract.MinPuzzles - 1) basis = [inputs[0], comparisonReward];
            var puzzle = BuildDossierPuzzle(index, target.ItemId, reward, basis, traceByClue, vietnamese);
            if (index > 0) AddUnique(puzzle.RequiredClueIds, rewards[index - 1].ClueId);
            skeleton.Puzzles.Add(puzzle);
            SetMechanicSource(reward, puzzle.PuzzleId, "puzzle", EvidenceAcquisitionMethods.PuzzleResult);
        }
        // The assembled dossier opens a genuine truth source needed by the last
        // required exercise. Neither crafting step can be bypassed by inspection.
        if (contract.MinPuzzles > 1)
            use.RequiredClueIds.Add(rewards[contract.MinPuzzles - 2].ClueId);
        if (skeleton.Items.Count > 8)
            throw new ProjectionPlanningException(
                ["PROJECTABILITY mechanics: the approved evidence carriers exceed the eight-item preset budget."]);
    }

    private static CasePuzzle BuildDossierPuzzle(
        int index, string targetId, CaseClue reward, IReadOnlyList<CaseClue> basis,
        IReadOnlyDictionary<string, TraceLedgerEntry> traces, bool vietnamese)
    {
        string T(string english, string translated) => vietnamese ? translated : english;
        var facts = basis.Select(clue => traces[clue.ClueId]).ToList();
        var rows = facts.Select(fact => fact.Proves.Trim())
            .Concat(facts.Select(fact => fact.DoesNotProve.Trim()))
            .Where(text => !string.IsNullOrWhiteSpace(text)).Distinct(StringComparer.Ordinal)
            .OrderBy(text => text, StringComparer.Ordinal).ToList();
        if (rows.Count < 2 || facts.Any(fact => string.IsNullOrWhiteSpace(fact.Proves)
                || fact.Proves.Trim() == fact.DoesNotProve.Trim()))
            throw new ProjectionPlanningException(
                ["PROJECTABILITY mechanics: approved evidence needs distinct supported facts and explicit proof limits before a dossier exercise can be built."]);
        var labels = rows.Select((text, number) => $"{number + 1}. {text}").ToList();
        var answers = facts.Select(fact => rows.IndexOf(fact.Proves.Trim())).ToList();
        var excerpts = string.Join("\n", facts.Select((fact, number) =>
            T($"File {number + 1} — established: {fact.Proves} Limit: {fact.DoesNotProve}",
                $"Hồ sơ {number + 1} — đã chứng minh: {fact.Proves} Giới hạn: {fact.DoesNotProve}")));
        var code = index % 3 == 0;
        return new CasePuzzle
        {
            PuzzleId = $"puzzle-{index + 1:00}",
            Type = (index % 3) switch
            {
                0 => CasePuzzleTypes.CodePuzzle,
                1 => CasePuzzleTypes.SequencePuzzle,
                _ => CasePuzzleTypes.SymbolMatchPuzzle
            },
            TargetId = targetId,
            Prompt = T("Audit the evidence already discovered. Match only the established statement from each file, in file order; a stated limit is not an additional proven fact.\n",
                         "Đối chiếu chứng cứ đã tìm thấy. Ghép đúng nhận định đã chứng minh của từng hồ sơ, theo thứ tự hồ sơ; giới hạn không phải dữ kiện được chứng minh thêm.\n")
                     + excerpts + "\n"
                     + (code
                         ? T("Enter the matching row numbers consecutively, without spaces.\n", "Nhập liền các số dòng tương ứng, không có khoảng trắng.\n")
                           + string.Join("\n", labels)
                         : T("Select the matching rows in file order.", "Chọn các dòng tương ứng theo thứ tự hồ sơ.")),
            Options = code ? [] : labels,
            CorrectCode = code ? string.Concat(answers.Select(answer => (answer + 1).ToString(CultureInfo.InvariantCulture))) : string.Empty,
            CorrectSequence = code ? [] : answers.Select(answer => labels[answer]).ToList(),
            RequiredClueIds = basis.Select(clue => clue.ClueId).ToList(),
            UnlockClueIds = [reward.ClueId],
            BasedOnTruthIds = facts.Select(fact => fact.TraceId).Append(traces[reward.ClueId].TraceId)
                .Distinct(StringComparer.Ordinal).ToList(),
            RevealsConclusionIds = reward.SupportsConclusionIds.ToList(),
            ProgressionRole = PuzzleProgressionRoles.Required,
            InvestigationPurpose = T("Separate supported observations from their limits before adding the next evidence record.",
                "Phân biệt nhận định được hỗ trợ và giới hạn trước khi bổ sung chứng cứ tiếp theo."),
            SuccessMessage = T("The supported findings are correctly matched. The next evidence record is now available.",
                "Đã đối chiếu đúng các nhận định được hỗ trợ. Chứng cứ tiếp theo đã được ghi nhận."),
            FailureMessage = T("Check each file's established statement and keep its proof limits separate.",
                "Đọc lại nhận định đã chứng minh của từng hồ sơ và phân biệt với giới hạn chứng cứ.")
        };
    }

    private static CaseItem AddDossierItem(GameCase skeleton, string id, string? sceneId,
        bool collectible, string name, string description, List<string> requiredClues)
    {
        var item = new CaseItem
        {
            ItemId = id, Name = name, Description = description, InspectText = description,
            InteractionReason = description, IsCollectible = collectible, IsInteractivePuzzleObject = true,
            InteractionPurpose = CaseItemInteractionPurposes.OperateMechanism,
            RenderMode = collectible ? CaseItemRenderModes.Cutout : CaseItemRenderModes.Embedded
        };
        skeleton.Items.Add(item);
        if (sceneId is null) return item;
        var scene = skeleton.Stages.SelectMany(stage => stage.Scenes).Single(scene => scene.SceneId == sceneId);
        scene.ItemIds.Add(id);
        scene.Hotspots.Add(new SceneHotspot
        {
            HotspotId = $"hotspot-{sceneId}-{id}", Type = "ITEM", TargetId = id, Label = name,
            X = 16 + scene.ItemIds.Count * 10, Y = 65, Width = 7, Height = 9, ZIndex = 4,
            RequiredClueIds = requiredClues
        });
        return item;
    }

    private static void RemovePreviousCarrier(GameCase skeleton, CaseClue clue)
    {
        foreach (var item in skeleton.Items) item.UnlockClueIds.Remove(clue.ClueId);
        var retired = skeleton.Items.Where(item => item.ItemId == clue.Source
                && item.ItemId.StartsWith("item-evidence-", StringComparison.Ordinal)
                && item.UnlockClueIds.Count == 0).Select(item => item.ItemId).ToHashSet(StringComparer.Ordinal);
        skeleton.Items.RemoveAll(item => retired.Contains(item.ItemId));
        foreach (var scene in skeleton.Stages.SelectMany(stage => stage.Scenes))
        {
            scene.ItemIds.RemoveAll(retired.Contains);
            scene.Hotspots.RemoveAll(hotspot => retired.Contains(hotspot.TargetId));
        }
    }

    private static void SetMechanicSource(CaseClue clue, string id, string type, string method)
    {
        clue.Source = id;
        clue.SourceType = type;
        clue.DiscoverMethod = type;
        clue.AcquisitionMethod = method;
    }
}
