using System.Text.Json;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Projection;

public sealed class GameCaseProjectionCompiler : IGameCaseProjectionCompiler
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public GameCase Compile(
        GameplayProjectionPlan plan,
        GameplayProjectionContent content,
        AiDraftSettings settings)
    {
        var errors = ValidateEnvelope(plan, content);
        if (errors.Count > 0) throw new ProjectionCompilationException(errors);

        var gameCase = JsonSerializer.Deserialize<GameCase>(
            JsonSerializer.Serialize(plan.Skeleton, JsonOptions), JsonOptions)
            ?? throw new InvalidOperationException("Projection skeleton clone failed.");
        gameCase.Id = string.Empty;
        gameCase.Title = content.Case.Title;
        gameCase.Summary = content.Case.Summary;
        gameCase.Language = CaseLanguages.Normalize(settings.Language);
        gameCase.ProjectionSchemaVersion = plan.SchemaVersion;
        gameCase.ProjectionPlanHash = plan.PlanHash;
        gameCase.ProjectionCompilerVersion = plan.CompilerVersion;
        gameCase.ProjectionBuildMode = ProjectionBuildModes.AiCompiled;
        gameCase.CreatedAt = DateTime.UtcNow;
        gameCase.UpdatedAt = gameCase.CreatedAt;

        foreach (var stage in gameCase.Stages)
            stage.Title = content.Stages[stage.StageId].Title;
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes))
        {
            var value = content.Scenes[scene.SceneId];
            scene.Title = value.Title;
            scene.Description = value.Description;
            scene.VisualDescription = value.VisualDescription;
        }
        foreach (var character in gameCase.Characters)
        {
            var value = content.Characters[character.CharacterId];
            character.Name = value.Name;
            character.Role = value.Role;
            character.Description = value.Description;
            character.VisualDescription = value.VisualDescription;
        }
        foreach (var item in gameCase.Items)
        {
            var value = content.Items[item.ItemId];
            item.Name = value.Name;
            item.Description = value.Description;
            item.InspectText = value.InspectText;
            item.VisualDescription = value.VisualDescription;
            item.InteractionReason = value.InteractionReason;
            foreach (var hotspot in gameCase.Stages.SelectMany(stage => stage.Scenes)
                         .SelectMany(scene => scene.Hotspots)
                         .Where(hotspot => hotspot.TargetId == item.ItemId))
                hotspot.Label = item.Name;
        }
        foreach (var clue in gameCase.Clues)
        {
            var value = content.Clues[clue.ClueId];
            clue.Title = value.Title;
            clue.Content = value.Content;
            clue.VisualDescription = value.VisualDescription;
            clue.InventoryDescription = value.InventoryDescription;
            clue.NarrativeMeaning = value.NarrativeMeaning;
            clue.Tags = clue.SupportsConclusionIds
                .Select(id => id.Replace("conclusion-", string.Empty, StringComparison.Ordinal))
                .Append(clue.SourceType)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        foreach (var dialogue in gameCase.Dialogues)
        {
            var value = content.Dialogues[dialogue.DialogueId];
            dialogue.Question = value.Question;
            dialogue.Answer = value.Answer;
            foreach (var hotspot in gameCase.Stages.SelectMany(stage => stage.Scenes)
                         .SelectMany(scene => scene.Hotspots)
                         .Where(hotspot => hotspot.TargetId == dialogue.CharacterId
                                           && string.IsNullOrWhiteSpace(hotspot.Label)))
                hotspot.Label = gameCase.Characters.First(item => item.CharacterId == dialogue.CharacterId).Name;
        }
        foreach (var fragment in gameCase.TestimonyFragments)
        {
            fragment.Text = content.TestimonyFragments[fragment.Id].Text;
            var dialogue = gameCase.Dialogues.First(item => item.DialogueId == fragment.DialogueId);
            if (!dialogue.Answer.Contains(fragment.Text, StringComparison.Ordinal))
                dialogue.Answer = $"{dialogue.Answer.Trim()} {fragment.Text}".Trim();
        }
        foreach (var challenge in gameCase.EvidenceChallenges)
        {
            var value = content.EvidenceChallenges[challenge.ChallengeId];
            challenge.Prompt = value.Prompt;
            challenge.SuccessResponse = value.SuccessResponse;
            challenge.FailureResponse = value.FailureResponse;
            challenge.RevealTitle = value.RevealTitle;
        }
        foreach (var node in gameCase.ConversationNodes)
        {
            var value = content.ConversationNodes[node.NodeId];
            for (var index = 0; index < node.Lines.Count; index++)
                node.Lines[index].Text = value.Lines[index];
            foreach (var choice in node.Choices)
                choice.Label = value.ChoiceLabels[choice.ChoiceId];
        }
        foreach (var puzzle in gameCase.Puzzles)
        {
            var value = content.Puzzles[puzzle.PuzzleId];
            puzzle.Prompt = value.Prompt;
            puzzle.InvestigationPurpose = value.InvestigationPurpose;
            puzzle.SuccessMessage = value.SuccessMessage;
            puzzle.FailureMessage = value.FailureMessage;
        }
        foreach (var interaction in gameCase.Interactions)
        {
            var value = content.Interactions[interaction.InteractionId];
            interaction.SuccessMessage = value.SuccessMessage;
            interaction.FailureMessage = value.FailureMessage;
        }
        foreach (var deduction in gameCase.Deductions)
        {
            var value = content.Deductions[deduction.DeductionId];
            deduction.Prompt = value.Prompt;
            foreach (var option in deduction.Options)
                option.Label = value.OptionLabels[option.Id];
            deduction.SuccessResponse = value.SuccessResponse;
            deduction.FailureResponse = value.FailureResponse;
        }
        foreach (var chain in gameCase.RequiredTeamworkChains)
            chain.Description = content.RequiredTeamworkChains[chain.ChainId].Description;
        foreach (var hint in gameCase.Hints)
            hint.Text = content.Hints[hint.HintId].Text;

        foreach (var option in gameCase.FinalLogic.MotiveOptions)
        {
            if (option.Id != gameCase.FinalLogic.CorrectMotiveId)
                option.Label = content.FinalLogic.MotiveOptionLabels[option.Id];
        }
        foreach (var option in gameCase.FinalLogic.MethodOptions)
        {
            if (option.Id != gameCase.FinalLogic.CorrectMethodId)
                option.Label = content.FinalLogic.MethodOptionLabels[option.Id];
        }
        gameCase.FinalLogic.WinEnding = content.FinalLogic.WinEnding;
        gameCase.FinalLogic.FailEnding = content.FinalLogic.FailEnding;
        return gameCase;
    }

    private static List<string> ValidateEnvelope(
        GameplayProjectionPlan plan,
        GameplayProjectionContent content)
    {
        var errors = new List<string>();
        if (content.SchemaVersion != GameplayProjectionVersions.Content)
            errors.Add($"PROJECTION_CONTENT_SCHEMA expected {GameplayProjectionVersions.Content}.");
        if (content.PlanHash != plan.PlanHash)
            errors.Add("PROJECTION_PLAN_HASH content does not reference the persisted plan.");
        if (ProjectionCanonicalizer.ComputePlanHash(plan) != plan.PlanHash)
            errors.Add("PROJECTION_PLAN_HASH persisted plan was modified after hashing.");

        Exact(errors, "stages", plan.Skeleton.Stages.Select(item => item.StageId), content.Stages.Keys);
        Exact(errors, "scenes", plan.Scenes.Keys, content.Scenes.Keys);
        Exact(errors, "characters", plan.Skeleton.Characters.Select(item => item.CharacterId), content.Characters.Keys);
        Exact(errors, "items", plan.Skeleton.Items.Select(item => item.ItemId), content.Items.Keys);
        Exact(errors, "clues", plan.Clues.Keys, content.Clues.Keys);
        Exact(errors, "dialogues", plan.Dialogues.Keys, content.Dialogues.Keys);
        Exact(errors, "testimonyFragments", plan.Skeleton.TestimonyFragments.Select(item => item.Id), content.TestimonyFragments.Keys);
        Exact(errors, "evidenceChallenges", plan.Challenges.Keys, content.EvidenceChallenges.Keys);
        Exact(errors, "conversationNodes", plan.Skeleton.ConversationNodes.Select(item => item.NodeId), content.ConversationNodes.Keys);
        Exact(errors, "puzzles", plan.Puzzles.Keys, content.Puzzles.Keys);
        Exact(errors, "interactions", plan.Skeleton.Interactions.Select(item => item.InteractionId), content.Interactions.Keys);
        Exact(errors, "deductions", plan.Deductions.Keys, content.Deductions.Keys);
        Exact(errors, "requiredTeamworkChains", plan.Skeleton.RequiredTeamworkChains.Select(item => item.ChainId), content.RequiredTeamworkChains.Keys);
        Exact(errors, "hints", plan.Skeleton.Hints.Select(item => item.HintId), content.Hints.Keys);

        foreach (var (id, value) in content.Stages)
            if (value.StageId != id)
                errors.Add($"PROJECTION_LOCKED_FIELD stages.{id}.stageId changed identity.");
        foreach (var (id, value) in content.Scenes)
        {
            if (!plan.Scenes.TryGetValue(id, out var slot)) continue;
            if (value.SceneId != id || value.TruthLocationId != slot.TruthLocationId)
                errors.Add($"PROJECTION_LOCKED_FIELD scenes.{id} changed scene/location identity.");
        }
        foreach (var (id, value) in content.Characters)
            if (value.CharacterId != id)
                errors.Add($"PROJECTION_LOCKED_FIELD characters.{id}.characterId changed identity.");
        foreach (var (id, value) in content.Items)
            if (value.ItemId != id)
                errors.Add($"PROJECTION_LOCKED_FIELD items.{id}.itemId changed identity.");
        foreach (var (id, value) in content.Clues)
        {
            if (!plan.Clues.TryGetValue(id, out var slot)) continue;
            if (value.ClueId != id || value.TraceId != slot.TraceId
                || value.SceneId != slot.SceneId || value.SourceActionId != slot.SourceActionId
                || !Same(value.SupportsConclusionIds, slot.SupportsConclusionIds))
                errors.Add($"PROJECTION_LOCKED_FIELD clues.{id} changed causal provenance.");
        }
        foreach (var (id, value) in content.Dialogues)
        {
            if (!plan.Dialogues.TryGetValue(id, out var slot)) continue;
            if (value.DialogueId != id || value.CharacterId != slot.CharacterId
                || !Same(value.StatementIds, slot.StatementIds))
                errors.Add($"PROJECTION_LOCKED_FIELD dialogues.{id} changed statement provenance.");
        }
        foreach (var (id, value) in content.TestimonyFragments)
            if (value.FragmentId != id)
                errors.Add($"PROJECTION_LOCKED_FIELD testimonyFragments.{id}.fragmentId changed identity.");
        foreach (var (id, value) in content.EvidenceChallenges)
            if (value.ChallengeId != id)
                errors.Add($"PROJECTION_LOCKED_FIELD evidenceChallenges.{id}.challengeId changed identity.");
        foreach (var (id, value) in content.ConversationNodes)
        {
            var node = plan.Skeleton.ConversationNodes.FirstOrDefault(item => item.NodeId == id);
            if (node is null) continue;
            if (value.NodeId != id || value.Lines.Count != node.Lines.Count)
                errors.Add($"PROJECTION_LOCKED_FIELD conversationNodes.{id} changed identity or line topology.");
            Exact(errors, $"conversationNodes.{id}.choiceLabels",
                node.Choices.Select(item => item.ChoiceId), value.ChoiceLabels.Keys);
        }
        foreach (var (id, value) in content.Puzzles)
        {
            if (!plan.Puzzles.TryGetValue(id, out var slot)) continue;
            var puzzle = plan.Skeleton.Puzzles.Single(item => item.PuzzleId == id);
            if (value.PuzzleId != id
                || !Same(value.BasedOnTruthIds, slot.BasedOnTruthIds)
                || !Same(value.RevealsConclusionIds, slot.RevealsConclusionIds)
                || !Same(value.Options, puzzle.Options)
                || value.CorrectCode != puzzle.CorrectCode
                || !Same(value.CorrectSequence, puzzle.CorrectSequence))
                errors.Add($"PROJECTION_LOCKED_FIELD puzzles.{id} changed truth basis.");
        }
        foreach (var (id, value) in content.Interactions)
            if (value.InteractionId != id)
                errors.Add($"PROJECTION_LOCKED_FIELD interactions.{id}.interactionId changed identity.");
        foreach (var (id, value) in content.Deductions)
        {
            if (!plan.Deductions.TryGetValue(id, out var slot)) continue;
            if (value.DeductionId != id || value.ConclusionId != slot.ConclusionId)
                errors.Add($"PROJECTION_LOCKED_FIELD deductions.{id} changed conclusion.");
            var deduction = plan.Skeleton.Deductions.Single(item => item.DeductionId == id);
            Exact(errors, $"deductions.{id}.optionLabels",
                deduction.Options.Select(item => item.Id), value.OptionLabels.Keys);
        }
        foreach (var (id, value) in content.RequiredTeamworkChains)
            if (value.ChainId != id)
                errors.Add($"PROJECTION_LOCKED_FIELD requiredTeamworkChains.{id}.chainId changed identity.");
        foreach (var (id, value) in content.Hints)
            if (value.HintId != id)
                errors.Add($"PROJECTION_LOCKED_FIELD hints.{id}.hintId changed identity.");
        Exact(errors, "finalLogic.motiveOptionLabels",
            plan.Skeleton.FinalLogic.MotiveOptions.Select(item => item.Id),
            content.FinalLogic.MotiveOptionLabels.Keys);
        Exact(errors, "finalLogic.methodOptionLabels",
            plan.Skeleton.FinalLogic.MethodOptions.Select(item => item.Id),
            content.FinalLogic.MethodOptionLabels.Keys);
        return errors;
    }

    private static void Exact(
        ICollection<string> errors,
        string path,
        IEnumerable<string> expected,
        IEnumerable<string> actual)
    {
        var expectedSet = expected.ToHashSet(StringComparer.Ordinal);
        var actualSet = actual.ToHashSet(StringComparer.Ordinal);
        if (!expectedSet.SetEquals(actualSet))
            errors.Add($"PROJECTION_SLOT_SET {path} missing=[{string.Join(',', expectedSet.Except(actualSet))}] extra=[{string.Join(',', actualSet.Except(expectedSet))}].");
    }

    private static bool Same(IEnumerable<string> first, IEnumerable<string> second) =>
        first.SequenceEqual(second, StringComparer.Ordinal);
}

public static class ProjectionContentMockFactory
{
    public static GameplayProjectionContent Build(GameplayProjectionPlan plan)
    {
        var vi = plan.Skeleton.Language == CaseLanguages.Vietnamese;
        string T(string english, string vietnamese) => vi ? vietnamese : english;
        var content = new GameplayProjectionContent
        {
            PlanHash = plan.PlanHash,
            Case = new CaseProjectionContent
            {
                Title = T("The Backend Projection", "Phép Chiếu Từ Backend"),
                Summary = T(
                    "A deterministic investigation compiled from approved truth.",
                    "Một cuộc điều tra được backend biên dịch trực tiếp từ sự thật đã phê duyệt.")
            },
            FinalLogic = new FinalProjectionContent
            {
                WinEnding = T(
                    "Every causal link aligns and the case is solved.",
                    "Mọi mắt xích nhân quả đều khớp và vụ án được phá giải."),
                FailEnding = T(
                    "The proposed chain leaves an essential fact unexplained.",
                    "Chuỗi suy luận được chọn vẫn bỏ ngỏ một sự thật thiết yếu.")
            }
        };
        foreach (var stage in plan.Skeleton.Stages)
            content.Stages[stage.StageId] = new StageProjectionContent
            {
                StageId = stage.StageId,
                Title = T($"Investigation {stage.Order}", $"Chặng điều tra {stage.Order}")
            };
        foreach (var (id, slot) in plan.Scenes)
            content.Scenes[id] = new SceneProjectionContent
            {
                SceneId = id,
                TruthLocationId = slot.TruthLocationId,
                Title = T($"Location {slot.Order}", $"Hiện trường {slot.Order}"),
                Description = T(
                    "A controlled crime scene where physical traces and witness accounts can be compared.",
                    "Một hiện trường được kiểm soát, nơi dấu vết vật lý và lời khai nhân chứng có thể được đối chiếu."),
                VisualDescription = "Victorian investigation room with dark wood, brass fixtures, deep teal walls, clear floor surfaces, restrained warm lighting, and visible physical wear."
            };
        foreach (var (character, index) in plan.Skeleton.Characters.Select((value, index) => (value, index)))
            content.Characters[character.CharacterId] = new CharacterProjectionContent
            {
                CharacterId = character.CharacterId,
                Name = T($"Witness {index + 1}", $"Nhân chứng {index + 1}"),
                Role = T("Case witness", "Nhân chứng vụ án"),
                Description = T(
                    "A person connected to the approved timeline and available for careful questioning.",
                    "Một người liên quan đến dòng thời gian đã phê duyệt và sẵn sàng trả lời thẩm vấn."),
                VisualDescription = "Adult Victorian witness with a distinct silhouette, expressive face, natural skin tone, dark styled hair, layered teal and oxblood clothing, and one brass role accessory."
            };
        foreach (var (item, index) in plan.Skeleton.Items.Select((value, index) => (value, index)))
            content.Items[item.ItemId] = new ItemProjectionContent
            {
                ItemId = item.ItemId,
                Name = T($"Investigation object {index + 1}", $"Vật điều tra {index + 1}"),
                Description = T("A bounded physical object used by the investigation.", "Một vật thể hữu hạn được dùng trong quá trình điều tra."),
                InspectText = T("Its construction suggests one deliberate mechanical use.", "Cấu tạo của nó cho thấy một công dụng cơ học có chủ ý."),
                VisualDescription = "Small Victorian investigation object with a clear silhouette, dark outline, worn brass surface, and restrained teal accents.",
                InteractionReason = T("The player uses this object in one server-defined interaction.", "Người chơi dùng vật này trong một tương tác do máy chủ quy định.")
            };
        foreach (var (id, slot) in plan.Clues)
            content.Clues[id] = new ClueProjectionContent
            {
                ClueId = id,
                TraceId = slot.TraceId,
                SceneId = slot.SceneId,
                SourceActionId = slot.SourceActionId,
                SupportsConclusionIds = slot.SupportsConclusionIds.ToList(),
                Title = T("Causal physical trace", "Dấu vết vật lý nhân quả"),
                Content = T(
                    "A persistent physical consequence links the approved action to this location.",
                    "Một hệ quả vật lý còn lưu lại nối hành động đã phê duyệt với địa điểm này."),
                VisualDescription = "A small irregular crescent of fresh wear along the lower edge of a fixed brass fitting near the floor.",
                InventoryDescription = T(
                    "The captured detail preserves the trace location and physical cause.",
                    "Chi tiết được ghi lại bảo toàn vị trí và nguyên nhân vật lý của dấu vết."),
                NarrativeMeaning = T(
                    "This observation supports only the conclusions assigned by the approved proof graph.",
                    "Quan sát này chỉ hỗ trợ các kết luận đã được đồ thị chứng minh phê duyệt chỉ định.")
            };
        foreach (var (id, slot) in plan.Dialogues)
            content.Dialogues[id] = new DialogueProjectionContent
            {
                DialogueId = id,
                CharacterId = slot.CharacterId,
                StatementIds = slot.StatementIds.ToList(),
                Question = T("What exactly did you observe during the relevant interval?", "Bạn đã quan sát chính xác điều gì trong khoảng thời gian liên quan?"),
                Answer = T(
                    "I remember the sequence carefully and can describe only what I directly observed during the relevant interval.",
                    "Tôi nhớ kỹ trình tự sự việc và chỉ có thể mô tả những gì mình trực tiếp quan sát trong khoảng thời gian liên quan.")
            };
        var fragmentTextById = new Dictionary<string, string>(StringComparer.Ordinal);
        if (plan.Skeleton.MechanicsVersion >= CaseMechanicsVersions.InvestigationV3PairedConfrontation)
        {
            foreach (var group in plan.Skeleton.TestimonyFragments
                         .GroupBy(fragment => fragment.DialogueId, StringComparer.Ordinal))
            {
                var claims = group.Select((fragment, index) =>
                {
                    var claim = T(
                        $"The object shifted during observation segment {index + 1}.",
                        $"Vật thể dịch chuyển trong đoạn quan sát {index + 1}.");
                    fragmentTextById[fragment.Id] = claim;
                    return claim;
                }).ToList();
                content.Dialogues[group.Key].Answer = T(
                    $"{string.Join(' ', claims)} I remained beside the western arch, recorded each change immediately, and did not leave my position until the final sound faded beyond the closed service passage that night.",
                    $"{string.Join(' ', claims)} Tôi ở cạnh vòm phía tây, ghi lại từng thay đổi ngay lập tức và không rời vị trí cho đến khi âm thanh cuối cùng tắt sau lối đi đã đóng.");
            }
        }
        foreach (var fragment in plan.Skeleton.TestimonyFragments)
            content.TestimonyFragments[fragment.Id] = new TestimonyProjectionContent
            {
                FragmentId = fragment.Id,
                Text = fragmentTextById.GetValueOrDefault(fragment.Id)
                       ?? T(
                           "The fixed object remained unchanged throughout the interval I personally observed.",
                           "Vật thể cố định không thay đổi trong suốt khoảng thời gian mà tôi trực tiếp quan sát.")
            };
        foreach (var challenge in plan.Skeleton.EvidenceChallenges)
            content.EvidenceChallenges[challenge.ChallengeId] = new ChallengeProjectionContent
            {
                ChallengeId = challenge.ChallengeId,
                Prompt = T("Which physical trace directly contradicts the selected statement?", "Dấu vết vật lý nào trực tiếp mâu thuẫn với lời khai đã chọn?"),
                SuccessResponse = T("The statement and physical trace cannot both be true.", "Lời khai và dấu vết vật lý không thể đồng thời đúng."),
                FailureResponse = T("That pairing does not establish a direct contradiction.", "Cặp này chưa chứng minh được mâu thuẫn trực tiếp."),
                RevealTitle = T("Contradiction established", "Đã xác lập mâu thuẫn")
            };
        foreach (var node in plan.Skeleton.ConversationNodes)
            content.ConversationNodes[node.NodeId] = new ConversationProjectionContent
            {
                NodeId = node.NodeId,
                Lines = node.Lines.Select(_ => T("The witness answers carefully.", "Nhân chứng trả lời thận trọng.")).ToList(),
                ChoiceLabels = node.Choices.ToDictionary(
                    choice => choice.ChoiceId,
                    _ => T("Continue questioning", "Tiếp tục thẩm vấn"),
                    StringComparer.Ordinal)
            };
        foreach (var (id, slot) in plan.Puzzles)
        {
            var puzzle = plan.Skeleton.Puzzles.First(item => item.PuzzleId == id);
            content.Puzzles[id] = new PuzzleProjectionContent
            {
                PuzzleId = id,
                BasedOnTruthIds = slot.BasedOnTruthIds.ToList(),
                RevealsConclusionIds = slot.RevealsConclusionIds.ToList(),
                Prompt = T("Resolve the bounded mechanism using the established pattern.", "Giải cơ chế hữu hạn bằng mẫu quy luật đã được xác lập."),
                Options = puzzle.Options.ToList(),
                CorrectCode = puzzle.CorrectCode,
                CorrectSequence = puzzle.CorrectSequence.ToList(),
                InvestigationPurpose = T("Present an approved fact without creating a new one.", "Trình bày một sự thật đã phê duyệt mà không tạo thêm dữ kiện."),
                SuccessMessage = T("The mechanism confirms the expected pattern.", "Cơ chế xác nhận đúng quy luật dự kiến."),
                FailureMessage = T("The mechanism remains unchanged.", "Cơ chế vẫn không thay đổi.")
            };
        }
        foreach (var interaction in plan.Skeleton.Interactions)
            content.Interactions[interaction.InteractionId] = new InteractionProjectionContent
            {
                InteractionId = interaction.InteractionId,
                SuccessMessage = T("The physical action succeeds.", "Thao tác vật lý đã thành công."),
                FailureMessage = T("Those parts do not work together.", "Những bộ phận này không hoạt động cùng nhau.")
            };
        foreach (var (id, slot) in plan.Deductions)
        {
            var deduction = plan.Skeleton.Deductions.First(item => item.DeductionId == id);
            content.Deductions[id] = new DeductionProjectionContent
            {
                DeductionId = id,
                ConclusionId = slot.ConclusionId,
                Prompt = T("Which explanation follows from the established evidence?", "Lời giải thích nào suy ra từ các bằng chứng đã xác lập?"),
                OptionLabels = deduction.Options.ToDictionary(
                    option => option.Id,
                    option => option.Id == deduction.CorrectOptionId
                        ? T("The causal evidence supports this conclusion.", "Bằng chứng nhân quả hỗ trợ kết luận này.")
                        : T("This interpretation exceeds what the evidence proves.", "Cách hiểu này vượt quá điều bằng chứng chứng minh."),
                    StringComparer.Ordinal),
                SuccessResponse = T("The deduction follows the approved proof path.", "Suy luận đi đúng theo đường chứng minh đã phê duyệt."),
                FailureResponse = T("That deduction overreaches the available evidence.", "Suy luận đó vượt quá bằng chứng hiện có.")
            };
        }
        foreach (var chain in plan.Skeleton.RequiredTeamworkChains)
            content.RequiredTeamworkChains[chain.ChainId] = new TeamworkProjectionContent
            {
                ChainId = chain.ChainId,
                Description = T("Both roles combine physical evidence and testimony.", "Hai vai trò kết hợp bằng chứng vật lý với lời khai.")
            };
        foreach (var hint in plan.Skeleton.Hints)
            content.Hints[hint.HintId] = new HintProjectionContent
            {
                HintId = hint.HintId,
                Text = T("Follow the causal source assigned to this objective.", "Hãy lần theo nguồn nhân quả được gán cho mục tiêu này.")
            };
        foreach (var option in plan.Skeleton.FinalLogic.MotiveOptions)
            content.FinalLogic.MotiveOptionLabels[option.Id] = option.Id == plan.Skeleton.FinalLogic.CorrectMotiveId
                ? plan.FinalLogic.Motive
                : T("An unsupported alternative motive", "Một động cơ thay thế không được chứng minh");
        foreach (var option in plan.Skeleton.FinalLogic.MethodOptions)
            content.FinalLogic.MethodOptionLabels[option.Id] = option.Id == plan.Skeleton.FinalLogic.CorrectMethodId
                ? plan.FinalLogic.Method
                : T("An unsupported alternative method", "Một phương thức thay thế không được chứng minh");
        return content;
    }
}
