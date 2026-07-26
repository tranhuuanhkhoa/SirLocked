using System.Text.Json;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Services;

internal static class AiCaseMockFactory
{
    private static readonly JsonSerializerOptions PrettyJson = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    internal static string MockJsonResponse(string step, string schemaVersion)
    {
        if (step.Equals("CreateStoryPreview", StringComparison.OrdinalIgnoreCase))
        {
            return JsonSerializer.Serialize(new AiStoryPreview
            {
                Title = "Mock Clocktower Case",
                Summary = "A safe mock preview used to verify the AI pipeline without external API calls.",
                Setting = "A foggy Victorian clocktower.",
                OpeningIncident = "The clock stops at midnight and a missing ledger becomes the key mystery.",
                Tone = "Cozy, deductive, and test-friendly.",
                PlayerPromise = "Players will compare scene evidence and testimony before a final accusation.",
                EstimatedScenes = 4,
                KeyLocations = { "Clocktower Office", "Workshop", "Courtyard", "Archive" },
                SuspectTeasers = { "The watchmaker", "The archivist", "The courier" }
            }, PrettyJson);
        }

        if (schemaVersion == AiGenerationSchemaVersions.CaseLogicV3Crack)
            return SerializeGeneratedLogicForProvider(CreateMockV3GeneratedLogic());
        if (schemaVersion == AiGenerationSchemaVersions.CaseTruth)
            return BuildMockTruthPackageJson(new AiCaseDraft());
        if (schemaVersion is AiGenerationSchemaVersions.CaseSeed
            or AiGenerationSchemaVersions.CoreTruth
            or AiGenerationSchemaVersions.TrueTimeline
            or AiGenerationSchemaVersions.OpportunityMatrix
            or AiGenerationSchemaVersions.TraceLedger
            or AiGenerationSchemaVersions.StatementLedger
            or AiGenerationSchemaVersions.ProofGraph)
            return BuildMockTruthStageJson(new AiCaseDraft(), schemaVersion);
        if (schemaVersion == AiGenerationSchemaVersions.CaseTruthReview)
            return JsonSerializer.Serialize(BuildMockTruthReview(), PrettyJson);
        if (schemaVersion == AiGenerationSchemaVersions.BlindSolvabilityReview)
            return JsonSerializer.Serialize(new BlindSolvabilityReview
            {
                Status = CaseTruthReviewStatuses.Passed,
                SchemaVersion = CaseTruthSchemaVersions.BlindReviewV2,
                CulpritId = "char-culprit",
                Motive = "Protect a secret debt recorded in the stolen ledger.",
                Method = "Use a copied key during the stopped-clock window and conceal the ledger.",
                TimelineSummary = "The culprit stopped the clock, entered the archive, removed the ledger, and left physical traces.",
                EvidenceChainIds = { "clue-1", "clue-2", "clue-3", "clue-4", "clue-5" },
                UniqueSolution = true,
                Confidence = 0.95,
                Issues = new List<string>()
            }, PrettyJson);

        var mock = MockCaseFactory.Create("A safe mock AI case for dry-run validation", 4, "medium");
        mock.CaseId = "case-mock-ai-dry-run";
        mock.Title = "Mock AI Dry Run Case";
        mock.Summary = "Mock case generated locally without external AI calls.";
        ConvertMockCaseToCameraEmbedded(mock);
        return SerializeGeneratedLogicForProvider(GeneratedCaseLogic.FromGameCase(mock));
    }

    internal static string BuildMockFullCaseJson(AiCaseDraft draft)
    {
        GeneratedCaseLogic generated;
        if (AiV3GenerationProfile.IsV3Preset(draft.Settings.GenerationPreset))
            generated = CreateMockV3GeneratedLogic();
        else if (AiV3GenerationProfile.IsV3(draft))
            generated = CreateMockAdditiveV3GeneratedLogic(draft.Settings);
        else
        {
            var mock = MockCaseFactory.Create("A safe mock AI case for dry-run validation", 4, "medium");
            mock.CaseId = "case-mock-ai-dry-run";
            mock.Title = "Mock AI Dry Run Case";
            mock.Summary = "Mock case generated locally without external AI calls.";
            ConvertMockCaseToCameraEmbedded(mock);
            generated = GeneratedCaseLogic.FromGameCase(mock);
        }

        if (draft.LogicContractVersion >= CaseLogicContractVersions.CausalFiveClaim && draft.CaseTruth is not null)
            ApplyMockCausalProjection(draft.CaseTruth, generated);
        return SerializeGeneratedLogicForProvider(generated);
    }

    internal static string BuildMockTruthPackageJson(AiCaseDraft draft)
    {
        var settings = draft.Settings ?? new AiDraftSettings();
        var contract = AiGenerationContract.For(settings);
        var targetKind = CaseTargetAllocationPolicy.Resolve(draft);
        var usesProjectionContract = CaseTargetKinds.All.Contains(draft.PlannedTargetKind);
        var budget = usesProjectionContract
            ? AiTruthGenerationBudget.ForProjection(settings)
            : AiTruthGenerationBudget.For(settings);
        var mock = MockCaseFactory.Create("A safe mock AI case for dry-run validation", 4, "medium");
        ConvertMockCaseToCameraEmbedded(mock);
        var traceCount = Math.Min(budget.MaxTraces, mock.Clues.Count);
        var culpritId = mock.FinalLogic.CulpritId;
        var requiredSuspects = CaseTargetAllocationPolicy.RequiredSuspects(contract, targetKind);
        var suspects = mock.Characters
            .Select(item => item.CharacterId)
            .OrderBy(id => id == culpritId ? 0 : 1)
            .ThenBy(id => id, StringComparer.Ordinal)
            .Take(requiredSuspects)
            .ToList();
        while (usesProjectionContract && suspects.Count < requiredSuspects)
            suspects.Add($"char-mock-suspect-{suspects.Count + 1}");
        var requiredLocations = Math.Clamp(
            Math.Max(
                Math.Max(settings.StageCount, contract.MinScenes),
                (int)Math.Ceiling(traceCount / 2d)),
            contract.MinScenes,
            contract.MaxScenes);
        var locations = mock.Stages.SelectMany(stage => stage.Scenes)
            .Select(scene => scene.SceneId)
            .Take(requiredLocations)
            .ToList();
        while (usesProjectionContract && locations.Count < requiredLocations)
            locations.Add($"scene-mock-location-{locations.Count + 1}");
        var crimeLocation = locations.First();
        const string crimeActionId = "action-crime";
        var categories = ProofConclusionCategories.All.ToList();
        var actionByLocation = locations.Select((location, index) => new
        {
            Location = location,
            ActionId = index == 0 ? crimeActionId : $"action-crime-{index + 1}",
            Start = 30 + index * 15
        }).ToList();
        var truth = new CaseTruthPackage
        {
            SchemaVersion = CaseTruthSchemaVersions.V2,
            CaseSeed = new CaseSeed
            {
                CrimeType = "theft",
                Era = "Victorian",
                TechnologyConstraints = { "No electronic surveillance", "Travel and communication are local and physical" },
                Difficulty = string.IsNullOrWhiteSpace(settings.Difficulty) ? "medium" : settings.Difficulty,
                EstimatedMinutes = 35,
                SuspectIds = suspects,
                LocationIds = locations,
                LocationGraph = locations.SelectMany((from, fromIndex) => locations.Skip(fromIndex + 1).Select(to => new LocationTravelEdge
                {
                    FromLocationId = from, ToLocationId = to, TravelMinutes = 5
                })).ToList()
            },
            CoreTruth = new CoreCaseTruth
            {
                CulpritId = culpritId,
                TargetId = targetKind == CaseTargetKinds.Character ? "char-target" : "stolen-ledger",
                TargetKind = targetKind,
                Motive = "Protect a secret debt recorded in the stolen ledger.",
                Method = "Use a copied key during the stopped-clock window and conceal the ledger.",
                CrimeActionIds = actionByLocation.Select(item => item.ActionId).ToList(),
                CulpritMistakeActionIds = actionByLocation.Select(item => item.ActionId).ToList()
            }
        };
        truth.TrueTimeline = actionByLocation.Select((item, index) => new TrueTimelineEvent
        {
            EventId = item.ActionId, ActorId = culpritId, LocationId = item.Location,
            StartMinute = item.Start, EndMinute = item.Start + 10, TravelFromPreviousMinutes = index == 0 ? 0 : 5,
            Action = index == 0
                ? "Stops the clock, enters with a copied key, removes the ledger, and conceals it."
                : "Moves through the connected location while concealing the ledger and leaves a distinct trace.",
            RequiredAccessIds = { "archive-key" }, RequiredToolIds = { "copied-key" },
            RequiredKnowledgeIds = { "clock-window" }
        }).ToList();
        var statementEventBySpeaker = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [culpritId] = crimeActionId
        };
        var presenceStart = actionByLocation.Max(item => item.Start) + 30;
        foreach (var (speakerId, index) in suspects
                     .Distinct(StringComparer.Ordinal)
                     .Select((id, index) => (id, index)))
        {
            var eventId = $"event-statement-presence-{index + 1}";
            truth.TrueTimeline.Add(new TrueTimelineEvent
            {
                EventId = eventId,
                ActorId = speakerId,
                LocationId = crimeLocation,
                StartMinute = presenceStart + index * 15,
                EndMinute = presenceStart + 10 + index * 15,
                TravelFromPreviousMinutes = speakerId == culpritId
                    && actionByLocation[^1].Location != crimeLocation
                    ? 5
                    : 0,
                Action = "Visits the archive later and can provide a scene-grounded statement."
            });
            statementEventBySpeaker[speakerId] = eventId;
        }

        truth.OpportunityMatrix = suspects.Select(id => new CharacterOpportunity
        {
            CharacterId = id,
            HasMotive = id == culpritId,
            AccessIds = id == culpritId ? new List<string> { "archive-key" } : new List<string>(),
            ToolIds = id == culpritId ? new List<string> { "copied-key" } : new List<string>(),
            KnowledgeIds = id == culpritId ? new List<string> { "clock-window" } : new List<string>(),
            AvailableFromMinute = 0,
            AvailableToMinute = 180,
            AlibiVerified = false,
            IdentityLinkedToCrime = id == culpritId,
            EliminationReason = id == culpritId ? "Causal trace chain identifies this suspect." : "No identity trace connects this suspect to the crime action."
        }).ToList();

        var statementCount = Math.Clamp(
            Math.Max(categories.Count, contract.MinDialogues),
            1,
            budget.MaxStatements);
        var statementSpeakers = Enumerable.Range(0, statementCount)
            .Select(index => suspects[index % suspects.Count])
            .ToList();

        truth.ProofGraph.Conclusions = categories.Select((category, index) => new ProofConclusion
        {
            ConclusionId = ProofConclusionIds.ForCategory(category),
            Category = category,
            Proposition = category switch
            {
                ProofConclusionCategories.Motive => truth.CoreTruth.Motive,
                ProofConclusionCategories.Method => truth.CoreTruth.Method,
                ProofConclusionCategories.Opportunity => "The crime occurred during the culprit's unalibied access window.",
                ProofConclusionCategories.Identity => "Only the culprit is physically connected to the copied-key crime action.",
                _ => "The stopped-clock interval fixes the crime between minute 30 and minute 40."
            },
            SupportingTraceIds = Enumerable.Range(0, traceCount)
                .Where(traceIndex => categories[traceIndex % categories.Count] == category)
                .Select(traceIndex => $"trace-{traceIndex + 1}")
                .ToList(),
            SupportingStatementIds = Enumerable.Range(0, statementCount).Select(statementIndex => new
                {
                    Id = $"statement-{statementIndex + 1}",
                    Category = categories[statementIndex % categories.Count]
                })
                .Where(item => item.Category == category)
                .Select(item => item.Id)
                .ToList(),
            ExcludesSuspectIds = suspects.Where(id => id != culpritId).ToList()
        }).ToList();

        truth.TraceLedger = Enumerable.Range(0, traceCount).Select(traceIndex =>
        {
            var index = traceIndex + 1;
            var category = categories[traceIndex % categories.Count];
            var clueScene = locations[traceIndex % locations.Count];
            var sourceAction = actionByLocation.FirstOrDefault(item => item.Location == clueScene) ?? actionByLocation[0];
            return new TraceLedgerEntry
            {
                TraceId = $"trace-{index}", SourceActionId = sourceAction.ActionId,
                CreatedByCharacterId = culpritId, CreatedAtMinute = sourceAction.Start + 5, LocationId = sourceAction.Location,
                PhysicalCause = $"A distinct physical consequence {index} created while the copied key and ledger were handled.",
                PersistenceReason = "The small trace remained unnoticed in the locked scene.",
                Proves = $"Independent support for the {category} conclusion.",
                DoesNotProve = "This trace alone does not prove every other claim in the case.",
                IndependentSourceGroup = $"source-group-{index}",
                SupportsConclusionIds = { ProofConclusionIds.ForCategory(category) }
            };
        }).ToList();
        foreach (var timelineEvent in truth.TrueTimeline)
            timelineEvent.TraceIds = truth.TraceLedger.Where(trace => trace.SourceActionId == timelineEvent.EventId).Select(trace => trace.TraceId).ToList();

        truth.StatementLedger = statementSpeakers.Select((speakerId, index) => new StatementLedgerEntry
        {
            StatementId = $"statement-{index + 1}", SpeakerId = speakerId,
            TruthStatus = index == 0 ? StatementTruthStatuses.Misleading : StatementTruthStatuses.True,
            Content = index == 0
                ? "The speaker gives a misleading account of the archive visit."
                : "The speaker truthfully corroborates one part of the causal sequence.",
            EventIds = { statementEventBySpeaker[speakerId] }, KnowledgeSourceIds = { crimeActionId },
            ReasonForLie = index == 0 ? "The speaker hides an embarrassing but non-culpable private action." : string.Empty,
            ContradictedByTraceIds = index == 0 ? new List<string> { "trace-1" } : new List<string>(),
            IndependentSourceGroup = $"statement-source-{index + 1}",
            SupportsConclusionIds = { ProofConclusionIds.ForCategory(categories[index % categories.Count]) }
        }).ToList();

        var innocent = suspects.First(id => id != culpritId);
        truth.RedHerringLedger.Add(new RedHerringLedgerEntry
        {
            RedHerringId = "red-herring-1", SuspectId = innocent,
            SuspiciousReason = "The suspect concealed a private visit near the archive.",
            InnocentExplanation = "The visit concerned a personal debt and did not enter the crime scene.",
            ClearingTraceIds = { $"trace-{traceCount}" }
        });
        return JsonSerializer.Serialize(truth, PrettyJson);
    }

    internal static string BuildMockTruthStageJson(AiCaseDraft draft, string schemaVersion)
    {
        var truth = JsonSerializer.Deserialize<CaseTruthPackage>(BuildMockTruthPackageJson(draft), PrettyJson)!;
        object artifact = schemaVersion switch
        {
            AiGenerationSchemaVersions.CaseSeed => new GeneratedCaseSeedArtifact { CaseSeed = truth.CaseSeed },
            AiGenerationSchemaVersions.CoreTruth => new GeneratedCoreTruthArtifact { CoreTruth = truth.CoreTruth },
            AiGenerationSchemaVersions.TrueTimeline => new GeneratedTimelineArtifact { TrueTimeline = truth.TrueTimeline },
            AiGenerationSchemaVersions.OpportunityMatrix => new GeneratedOpportunityArtifact { OpportunityMatrix = truth.OpportunityMatrix },
            AiGenerationSchemaVersions.TraceLedger => new GeneratedTraceArtifact { TraceLedger = truth.TraceLedger },
            AiGenerationSchemaVersions.StatementLedger => new GeneratedStatementArtifact { StatementLedger = truth.StatementLedger },
            AiGenerationSchemaVersions.ProofGraph => new GeneratedProofArtifact
            {
                ProofGraph = truth.ProofGraph, RedHerringLedger = truth.RedHerringLedger
            },
            _ => truth
        };
        return JsonSerializer.Serialize(artifact, PrettyJson);
    }

    internal static CaseTruthFeasibilityReview BuildMockTruthReview() => new()
    {
        Status = CaseTruthReviewStatuses.Passed,
        SchemaVersion = CaseTruthSchemaVersions.FeasibilityReviewV2,
        Confidence = 0.95,
        TimelineFeasible = true,
        PhysicalCausalityFeasible = true,
        UniqueSolution = true,
        Issues = new List<string>()
    };

    internal static BlindSolvabilityReview BuildMockBlindReview(CaseTruthPackage truth, GameCase gameCase) => new()
    {
        Status = CaseTruthReviewStatuses.Passed,
        SchemaVersion = CaseTruthSchemaVersions.BlindReviewV2,
        CulpritId = truth.CoreTruth.CulpritId,
        Motive = truth.CoreTruth.Motive,
        Method = truth.CoreTruth.Method,
        TimelineSummary = "The player-visible evidence reconstructs the complete crime window.",
        EvidenceChainIds = gameCase.FinalLogic.RequiredEvidenceLinks.Select(item => item.EvidenceId).ToList(),
        UniqueSolution = true,
        Confidence = 0.95,
        Issues = new List<string>()
    };

    private static void ApplyMockCausalProjection(CaseTruthPackage truth, GeneratedCaseLogic generated)
    {
        var conclusions = truth.ProofGraph.Conclusions;
        var traces = truth.TraceLedger;
        var scenes = generated.Stages.SelectMany(stage => stage.Scenes).ToList();
        var traceOffsets = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var index = 0; index < generated.Clues.Count; index++)
        {
            var clue = generated.Clues[index];
            if (string.IsNullOrWhiteSpace(clue.SceneId)) clue.SceneId = scenes[0].SceneId;
            var locationTraces = traces.Where(item => item.LocationId == clue.SceneId).ToList();
            if (locationTraces.Count == 0) locationTraces = traces;
            var offset = traceOffsets.GetValueOrDefault(clue.SceneId);
            var trace = locationTraces[offset % locationTraces.Count];
            traceOffsets[clue.SceneId] = offset + 1;
            var conclusion = conclusions.First(item => item.ConclusionId == trace.SupportsConclusionIds[0]);
            clue.SourceActionId = trace.SourceActionId;
            clue.SupportsConclusionIds = new List<string> { conclusion.ConclusionId };
            clue.IndependentSourceGroup = trace.IndependentSourceGroup;
        }

        for (var index = 0; index < generated.Dialogues.Count; index++)
        {
            var dialogue = generated.Dialogues[index];
            var statement = truth.StatementLedger[index % truth.StatementLedger.Count];
            dialogue.CharacterId = statement.SpeakerId;
            dialogue.StatementIds = new List<string> { statement.StatementId };
            var scene = scenes.FirstOrDefault(item => item.CharacterIds.Contains(dialogue.CharacterId)) ?? scenes.First();
            if (!scene.CharacterIds.Contains(dialogue.CharacterId)) scene.CharacterIds.Add(dialogue.CharacterId);
            dialogue.AvailableSceneIds = new List<string> { scene.SceneId };
        }
        foreach (var node in generated.ConversationNodes)
        {
            var statement = truth.StatementLedger.FirstOrDefault(item => item.SpeakerId == node.CharacterId) ?? truth.StatementLedger[0];
            node.StatementIds = new List<string> { statement.StatementId };
            var scene = scenes.FirstOrDefault(item => item.CharacterIds.Contains(node.CharacterId)) ?? scenes.First();
            node.AvailableSceneIds = new List<string> { scene.SceneId };
        }
        foreach (var puzzle in generated.Puzzles)
        {
            puzzle.BasedOnTruthIds = new List<string> { truth.CoreTruth.CrimeActionIds[0] };
            puzzle.InvestigationPurpose = "Reveal one approved causal conclusion without inventing a new fact.";
            puzzle.RevealsConclusionIds = new List<string> { conclusions[0].ConclusionId };
            puzzle.ProgressionRole = "REQUIRED";
        }
        foreach (var deduction in generated.Deductions)
            deduction.ConclusionId = conclusions[0].ConclusionId;

        var evidenceByClaim = EvidenceClaimTypes.OrderedForContract(CaseLogicContractVersions.CausalFiveClaim)
            .ToDictionary(
                claim => claim,
                claim => generated.Clues.First(clue => clue.SupportsConclusionIds.Any(id => conclusions.Any(conclusion => conclusion.ConclusionId == id && conclusion.Category == claim))),
                StringComparer.Ordinal);
        foreach (var clue in evidenceByClaim.Values) clue.IsEvidence = true;
        generated.FinalLogic.CulpritId = truth.CoreTruth.CulpritId;
        generated.FinalLogic.Motive = truth.CoreTruth.Motive;
        generated.FinalLogic.Method = truth.CoreTruth.Method;
        generated.FinalLogic.RequiredEvidenceLinks = EvidenceClaimTypes.OrderedForContract(CaseLogicContractVersions.CausalFiveClaim)
            .Select((claim, index) =>
            {
                var conclusion = conclusions.First(item => item.Category == claim);
                var evidence = evidenceByClaim[claim];
                return new RequiredEvidenceLink
                {
                    ClaimType = claim,
                    ConclusionId = conclusion.ConclusionId,
                    EvidenceId = evidence.ClueId
                };
            }).ToList();
        generated.FinalLogic.RequiredEvidenceIds = generated.FinalLogic.RequiredEvidenceLinks.Select(item => item.EvidenceId).ToList();
    }

    internal static string BuildMockBlueprintJson(AiCaseDraft draft)
    {
        var generated = CreateMockAdditiveV3GeneratedLogic(draft.Settings);
        var gameCase = generated.ToGameCase(draft.Settings);
        var blueprint = new AiCaseBlueprint
        {
            CaseId = gameCase.CaseId,
            Title = gameCase.Title,
            Summary = gameCase.Summary,
            CulpritId = gameCase.FinalLogic.CulpritId,
            SolutionOutline = gameCase.FinalLogic.Method,
            Characters = gameCase.Characters.Select(character => new AiBlueprintCharacter
            {
                CharacterId = character.CharacterId,
                Name = character.Name,
                Role = character.Role,
                IsSuspect = character.CharacterId != "char-sirlocked"
            }).ToList(),
            Scenes = gameCase.Stages.SelectMany(stage => stage.Scenes.Select(scene => new AiBlueprintScene
            {
                StageId = stage.StageId, SceneId = scene.SceneId, StageOrder = stage.Order,
                Title = scene.Title, Purpose = scene.Description
            })).ToList(),
            ProgressionSceneIds = gameCase.Stages.OrderBy(stage => stage.Order)
                .SelectMany(stage => stage.Scenes.Select(scene => scene.SceneId)).ToList()
        };
        foreach (var challenge in gameCase.EvidenceChallenges)
        {
            var correctPredicate = $"state-{challenge.Order}-correct";
            var crack = new AiCrackBlueprint
            {
                ChallengeId = challenge.ChallengeId, Order = challenge.Order, IsSignature = challenge.IsSignature,
                DialogueId = challenge.DialogueId,
                DialogueAnswer = gameCase.Dialogues.Single(item => item.DialogueId == challenge.DialogueId).Answer,
                TestimonyFragmentId = challenge.TestimonyFragmentId, CorrectEvidenceId = challenge.CorrectEvidenceId,
                StartRequiredTestimonyFragmentIds = challenge.CandidateTestimonyFragmentIds.Take(2).Append(challenge.TestimonyFragmentId).Distinct().ToList(),
                StartRequiredEvidenceIds = challenge.CandidateEvidenceIds.Take(2).Append(challenge.CorrectEvidenceId).Distinct().ToList(),
                Prompt = challenge.Prompt, SuccessResponse = challenge.SuccessResponse,
                FailureResponse = challenge.FailureResponse, RevealTitle = challenge.RevealTitle,
                RevealClueId = challenge.UnlockClueIds.First(),
                RevealContent = gameCase.Clues.Single(item => item.ClueId == challenge.UnlockClueIds.First()).Content
            };
            crack.Testimonies = challenge.CandidateTestimonyFragmentIds.Select((id, index) => new AiBlueprintTestimony
            {
                Id = id,
                Text = gameCase.TestimonyFragments.Single(item => item.Id == id).Text,
                Semantics = MockSemantics(id == challenge.TestimonyFragmentId ? correctPredicate : $"testimony-{challenge.Order}-{index}",
                    id == challenge.TestimonyFragmentId ? "NEGATIVE" : "POSITIVE")
            }).ToList();
            crack.Evidences = challenge.CandidateEvidenceIds.Select((id, index) =>
            {
                var clue = gameCase.Clues.Single(item => item.ClueId == id);
                return new AiBlueprintEvidence
                {
                    ClueId = id, Title = clue.Title, Content = clue.Content, NarrativeMeaning = clue.NarrativeMeaning,
                    AcquisitionMethod = clue.AcquisitionMethod, SourceType = clue.SourceType,
                    SourceId = clue.Source, SceneId = clue.SceneId,
                    Semantics = MockSemantics(id == challenge.CorrectEvidenceId ? correctPredicate : $"evidence-{challenge.Order}-{index}", "POSITIVE")
                };
            }).ToList();
            blueprint.Cracks.Add(crack);
        }
        return JsonSerializer.Serialize(blueprint, PrettyJson);
    }

    private static AiSemanticProposition MockSemantics(string predicate, string polarity) => new()
    {
        SubjectKind = "OBJECT_STATE", SubjectRef = "mock-object", Predicate = predicate,
        ObjectRef = "mock-object", PlaceRef = "mock-scene", TimeScope = "mock-window", Polarity = polarity
    };

    internal static GeneratedCaseLogic CreateMockAdditiveV3GeneratedLogic(AiDraftSettings settings)
    {
        var contract = AiGenerationContract.For(settings);
        var mock = MockCaseFactory.Create(
            "A deterministic additive Crack the Lie case",
            contract.MinStages,
            settings.Difficulty,
            "case-mock-ai-additive-v3");
        mock.Title = "Mock Additive V3 Investigation";
        mock.Summary = "A complete V2 investigation with private contradiction matrices for offline pipeline verification.";
        ConvertMockCaseToCameraEmbedded(mock);
        foreach (var character in mock.Characters)
            character.VisualDescription = "Adult detective-story witness with a clear silhouette, expressive face, layered Victorian clothing, restrained teal and brass colors, and one role-specific accessory.";
        while (mock.Characters.Count < contract.MinCharacters)
        {
            var index = mock.Characters.Count + 1;
            var character = new CaseCharacter
            {
                CharacterId = $"char-mock-additive-{index}",
                Name = $"Witness {index}",
                Role = "Archive witness",
                Description = "A secondary witness whose account adds context to the investigation.",
                VisualDescription = "Adult archive witness with a distinct compact silhouette, warm complexion, dark hair, layered burgundy work clothes, and a brass archive badge."
            };
            mock.Characters.Add(character);
            var scene = mock.Stages.SelectMany(stage => stage.Scenes).First();
            scene.CharacterIds.Add(character.CharacterId);
            scene.Hotspots.Add(new SceneHotspot
            {
                HotspotId = $"hotspot-{character.CharacterId}", Type = "CHARACTER", TargetId = character.CharacterId,
                X = 74, Y = 46, Width = 10, Height = 30, Label = character.Name
            });
        }

        var crackCount = AiV3GenerationProfile.CrackRange(settings.GenerationPreset).Minimum;
        var retained = mock.EvidenceChallenges.Take(crackCount).ToList();
        var retainedIds = retained.Select(challenge => challenge.ChallengeId).ToHashSet(StringComparer.Ordinal);
        foreach (var removed in mock.EvidenceChallenges.Where(challenge => !retainedIds.Contains(challenge.ChallengeId)))
        {
            var dialogue = mock.Dialogues.First(item => item.DialogueId == removed.DialogueId);
            foreach (var revealId in removed.UnlockClueIds.Where(id => !dialogue.UnlockClueIds.Contains(id)))
                dialogue.UnlockClueIds.Add(revealId);
        }
        mock.EvidenceChallenges = retained;
        mock.Hints.RemoveAll(hint => hint.ContextType.Equals(HintContextTypes.Confrontation, StringComparison.OrdinalIgnoreCase)
            && !retainedIds.Contains(hint.TargetId));
        foreach (var scene in mock.Stages.SelectMany(stage => stage.Scenes))
        {
            var crackRevealIds = mock.EvidenceChallenges.SelectMany(challenge => challenge.UnlockClueIds).ToHashSet(StringComparer.Ordinal);
            scene.CompleteCondition.RequiredClueIds.RemoveAll(crackRevealIds.Contains);
        }

        var physicalEvidence = mock.Clues
            .Where(clue => clue.IsEvidence && !clue.SourceType.Equals("dialogue", StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (physicalEvidence.Count < 3)
        {
            foreach (var clue in mock.Clues.Where(clue => !clue.IsEvidence
                         && clue.SourceType.Equals("camera", StringComparison.OrdinalIgnoreCase)))
            {
                clue.IsEvidence = true;
                physicalEvidence.Add(clue);
                if (physicalEvidence.Count == 3) break;
            }
        }

        var removableClues = mock.Clues.Where(clue => !clue.IsEvidence
                && !mock.EvidenceChallenges.SelectMany(challenge => challenge.UnlockClueIds).Contains(clue.ClueId)
                && !mock.FinalLogic.RequiredEvidenceIds.Contains(clue.ClueId)
                && !mock.FinalLogic.RequiredEvidenceLinks.Any(link => link.EvidenceId == clue.ClueId)
                && !mock.Deductions.SelectMany(deduction => deduction.RequiredClueIds.Concat(deduction.UnlockClueIds)).Contains(clue.ClueId)
                && !mock.Stages.SelectMany(stage => stage.Scenes).SelectMany(scene => scene.CompleteCondition.RequiredClueIds).Contains(clue.ClueId)
                && !mock.Dialogues.SelectMany(dialogue => dialogue.RequiredClueIds.Concat(dialogue.UnlockClueIds)).Contains(clue.ClueId))
            .ToList();
        while (mock.Clues.Count > contract.MaxClues && removableClues.Count > 0)
        {
            var clue = removableClues[0];
            removableClues.RemoveAt(0);
            mock.Clues.Remove(clue);
        }

        while (mock.Dialogues.Count < contract.MinDialogues)
        {
            var index = mock.Dialogues.Count + 1;
            mock.Dialogues.Add(new CaseDialogue
            {
                DialogueId = $"dlg-mock-additive-context-{index}",
                CharacterId = mock.Characters[index % mock.Characters.Count].CharacterId,
                Question = $"What contextual detail did you notice before checkpoint {index}?",
                Answer = "I noticed ordinary movement, but nothing that directly resolves the central contradiction."
            });
        }

        physicalEvidence = physicalEvidence.Where(mock.Clues.Contains).ToList();
        var cameraCrackCount = AiV3GenerationProfile.CameraCrackRange(crackCount).Minimum;
        var cameraEvidenceCount = Math.Min(cameraCrackCount, physicalEvidence.Count - 2);
        var firstScene = mock.Stages.SelectMany(stage => stage.Scenes).First();
        var firstVisibleTarget = firstScene.CharacterIds.First();
        var puzzleEvidence = physicalEvidence.Skip(cameraEvidenceCount).Where((_, index) => index % 2 == 0).ToList();
        var environmentEvidence = physicalEvidence.Skip(cameraEvidenceCount).Except(puzzleEvidence).ToList();

        for (var index = 0; index < cameraEvidenceCount; index++)
        {
            var clue = physicalEvidence[index];
            clue.Source = clue.SceneId;
            clue.SourceType = "camera";
            clue.DiscoverMethod = "camera";
            clue.AcquisitionMethod = EvidenceAcquisitionMethods.CameraCapture;
        }

        var requiredPuzzleCount = settings.GenerationPreset is AiGenerationPresets.PuzzleHeavy or AiGenerationPresets.FullFeature
            ? 3
            : 1;
        mock.Puzzles.Clear();
        for (var index = 0; index < requiredPuzzleCount; index++)
        {
            var puzzle = new CasePuzzle
            {
                PuzzleId = $"puzzle-mock-additive-{index + 1}",
                Type = index switch
                {
                    0 => CasePuzzleTypes.CodePuzzle,
                    1 => CasePuzzleTypes.SequencePuzzle,
                    _ => CasePuzzleTypes.SymbolMatchPuzzle
                },
                TargetId = firstVisibleTarget,
                Prompt = "Resolve the bounded archive mechanism.",
                CorrectCode = index == 0 ? "314" : string.Empty,
                Options = index == 0 ? new List<string>() : new List<string> { "sun", "moon", "key" },
                CorrectSequence = index == 0 ? new List<string>() : new List<string> { "sun", "key" },
                SuccessMessage = "The mechanism reveals a physical trace.",
                FailureMessage = "The mechanism remains locked."
            };
            if (index == 0) puzzle.UnlockClueIds.AddRange(puzzleEvidence.Select(clue => clue.ClueId));
            mock.Puzzles.Add(puzzle);
        }
        foreach (var clue in puzzleEvidence)
        {
            clue.Source = mock.Puzzles[0].PuzzleId;
            clue.SourceType = "puzzle";
            clue.DiscoverMethod = "puzzle";
            clue.AcquisitionMethod = EvidenceAcquisitionMethods.PuzzleResult;
        }

        mock.Interactions.Clear();
        if (environmentEvidence.Count > 0)
        {
            const string environmentId = "interaction-mock-additive-environment";
            mock.Interactions.Add(new CaseInteraction
            {
                InteractionId = environmentId,
                Type = CaseInteractionTypes.InspectEnvironment,
                TargetId = environmentId,
                UnlockClueIds = environmentEvidence.Select(clue => clue.ClueId).ToList(),
                SuccessMessage = "The surface reveals a useful physical trace.",
                FailureMessage = "There is nothing else to inspect here."
            });
            firstScene.Hotspots.Add(new SceneHotspot
            {
                HotspotId = "hotspot-mock-additive-environment",
                Type = "ENVIRONMENT",
                TargetId = environmentId,
                X = 48,
                Y = 54,
                Width = 8,
                Height = 8,
                Label = "Worn floor surface"
            });
            foreach (var clue in environmentEvidence)
            {
                clue.Source = environmentId;
                clue.SourceType = "interaction";
                clue.DiscoverMethod = "interaction";
                clue.AcquisitionMethod = EvidenceAcquisitionMethods.EnvironmentInteraction;
            }
        }

        if (settings.GenerationPreset is AiGenerationPresets.PuzzleHeavy or AiGenerationPresets.FullFeature)
            AddMockInventoryInteractions(mock, firstScene);

        var cameraEvidence = physicalEvidence.Take(cameraEvidenceCount).ToList();
        var nonCameraEvidence = physicalEvidence.Skip(cameraEvidenceCount).ToList();
        for (var index = 0; index < mock.EvidenceChallenges.Count; index++)
        {
            var challenge = mock.EvidenceChallenges[index];
            var dialogue = mock.Dialogues.First(item => item.DialogueId == challenge.DialogueId);
            dialogue.Answer = "I remained beside the archive window throughout the final inspection. "
                + "I never carried a sealed package through the eastern passage. "
                + "The brass cabinet stayed untouched until the night guard arrived. "
                + "Before midnight I checked every latch twice and recorded nothing unusual near the storage desk. "
                + "No visitor spoke to me after the final bell rang in the empty corridor.";
            var fragments = new[]
            {
                new TestimonyFragment { Id = $"fragment-mock-{index + 1}-window", DialogueId = dialogue.DialogueId, Text = "I remained beside the archive window throughout the final inspection." },
                new TestimonyFragment { Id = $"fragment-mock-{index + 1}-package", DialogueId = dialogue.DialogueId, Text = "I never carried a sealed package through the eastern passage." },
                new TestimonyFragment { Id = $"fragment-mock-{index + 1}-cabinet", DialogueId = dialogue.DialogueId, Text = "The brass cabinet stayed untouched until the night guard arrived." }
            };
            mock.TestimonyFragments.AddRange(fragments);
            var candidates = index < cameraCrackCount
                ? new[] { cameraEvidence[index % cameraEvidence.Count], nonCameraEvidence[0], nonCameraEvidence[1] }
                : Enumerable.Range(0, 3).Select(offset => nonCameraEvidence[(index + offset) % nonCameraEvidence.Count]).ToArray();
            challenge.Order = index + 1;
            challenge.IsSignature = index == 0;
            challenge.TestimonyFragmentId = fragments[0].Id;
            challenge.CandidateTestimonyFragmentIds = fragments.Select(fragment => fragment.Id).ToList();
            challenge.CorrectEvidenceId = candidates[0].ClueId;
            challenge.CandidateEvidenceIds = candidates.Select(clue => clue.ClueId).ToList();
            challenge.StartRequiredTestimonyFragmentIds = challenge.CandidateTestimonyFragmentIds
                .Take(2).Append(challenge.TestimonyFragmentId).Distinct().ToList();
            challenge.StartRequiredEvidenceIds = challenge.CandidateEvidenceIds
                .Take(2).Append(challenge.CorrectEvidenceId).Distinct().ToList();
            challenge.Prompt = "Which physical trace directly disproves the selected claim?";
            challenge.SuccessResponse = "The selected physical trace directly disproves the witness claim.";
            challenge.FailureResponse = "This pair does not directly disprove the selected claim.";
            challenge.RevealTitle = $"Crack {index + 1}: contradiction established";
        }

        var activeChallengeIds = mock.EvidenceChallenges.Select(challenge => challenge.ChallengeId).ToList();
        foreach (var deduction in mock.Deductions)
            deduction.RequiredChallengeIds = activeChallengeIds.Take(Math.Min(2, activeChallengeIds.Count)).ToList();
        foreach (var chain in mock.RequiredTeamworkChains)
            chain.InterrogatorChallengeId = activeChallengeIds[0];
        EnsureMockReasoningBudgets(mock, contract);
        foreach (var deduction in mock.Deductions)
            deduction.RequiredChallengeIds = activeChallengeIds.Take(1).ToList();
        EnsureMockConversationCoverage(mock, contract.MinConversationCharacters);

        return GeneratedCaseLogic.FromGameCase(mock);
    }

    private static void AddMockInventoryInteractions(GameCase mock, CaseScene scene)
    {
        var items = new[]
        {
            new CaseItem { ItemId = "item-mock-key", Name = "Archive key", IsCollectible = true, InteractionPurpose = CaseItemInteractionPurposes.UnlockDoor },
            new CaseItem { ItemId = "item-mock-ring", Name = "Brass ring", IsCollectible = true, InteractionPurpose = CaseItemInteractionPurposes.CombineItem },
            new CaseItem { ItemId = "item-mock-lock", Name = "Archive lock", IsCollectible = true, InteractionPurpose = CaseItemInteractionPurposes.OperateMechanism }
        };
        foreach (var item in items)
        {
            item.Description = "A small physical mechanism component used by the investigation.";
            item.InspectText = "Its wear pattern shows that it belongs to this archive mechanism.";
            item.VisualDescription = "Small brass mechanism component with worn edges and a clear silhouette.";
            item.RenderMode = CaseItemRenderModes.Cutout;
            item.IsInteractivePuzzleObject = true;
            item.InteractionReason = "The investigator manipulates this physical component in a bounded mechanism.";
            mock.Items.Add(item);
            scene.ItemIds.Add(item.ItemId);
            scene.Hotspots.Add(new SceneHotspot
            {
                HotspotId = $"hotspot-{item.ItemId}", Type = "ITEM", TargetId = item.ItemId,
                X = 20 + (scene.ItemIds.Count * 8), Y = 60, Width = 7, Height = 8, Label = item.Name
            });
        }
        mock.Interactions.Add(new CaseInteraction
        {
            InteractionId = "interaction-mock-use-key",
            Type = CaseInteractionTypes.UseItemOnTarget,
            TargetId = "item-mock-lock",
            RequiredItemIds = { "item-mock-key" },
            SuccessMessage = "The key turns in the archive lock.",
            FailureMessage = "That component does not fit the lock."
        });
        mock.Interactions.Add(new CaseInteraction
        {
            InteractionId = "interaction-mock-combine-ring",
            Type = CaseInteractionTypes.CombineItems,
            RequiredItemIds = { "item-mock-key", "item-mock-ring" },
            SuccessMessage = "The two components form a usable archive tool.",
            FailureMessage = "Those components do not fit together."
        });
    }

    private static void EnsureMockReasoningBudgets(GameCase mock, AiGenerationContract contract)
    {
        while (mock.Deductions.Count < contract.Deductions)
        {
            var index = mock.Deductions.Count + 1;
            var source = mock.Deductions[0];
            var deduction = new DeductionChallenge
            {
                DeductionId = $"deduction-mock-additive-{index}",
                Prompt = "Which combined explanation fits the established contradictions?",
                RequiredClueIds = source.RequiredClueIds.ToList(),
                RequiredChallengeIds = mock.EvidenceChallenges.Skip(index - 1).Take(1).Select(challenge => challenge.ChallengeId).ToList(),
                Options =
                {
                    new AccusationOption { Id = $"deduction-{index}-correct", Label = "The physical trace and testimony form one coherent chain" },
                    new AccusationOption { Id = $"deduction-{index}-wrong-a", Label = "The unrelated context proves the entire case" },
                    new AccusationOption { Id = $"deduction-{index}-wrong-b", Label = "Every contradiction can be ignored" }
                },
                CorrectOptionId = $"deduction-{index}-correct",
                SuccessResponse = "The reasoning chain is internally consistent.",
                FailureResponse = "That explanation leaves a contradiction unresolved."
            };
            mock.Deductions.Add(deduction);
            mock.Hints.Add(new CaseHint
            {
                HintId = $"hint-{deduction.DeductionId}", ContextType = HintContextTypes.Deduction,
                TargetId = deduction.DeductionId, Order = 1, Text = "Connect a resolved contradiction to the physical evidence."
            });
            mock.FinalLogic.RequiredDeductionIds.Add(deduction.DeductionId);
        }
        while (mock.RequiredTeamworkChains.Count < contract.TeamworkChains)
        {
            var index = mock.RequiredTeamworkChains.Count + 1;
            var chain = new RequiredTeamworkChain
            {
                ChainId = $"chain-mock-additive-{index}",
                InvestigatorClueId = mock.EvidenceChallenges[index % mock.EvidenceChallenges.Count].CorrectEvidenceId,
                InterrogatorChallengeId = mock.EvidenceChallenges[index % mock.EvidenceChallenges.Count].ChallengeId,
                DeductionId = mock.Deductions[index % mock.Deductions.Count].DeductionId,
                Description = "Both roles contribute private information before completing a shared deduction."
            };
            mock.RequiredTeamworkChains.Add(chain);
            mock.FinalLogic.RequiredTeamworkChainIds.Add(chain.ChainId);
        }
    }

    private static void EnsureMockConversationCoverage(GameCase mock, int requiredCharacters)
    {
        var covered = mock.ConversationNodes.Select(node => node.CharacterId).ToHashSet(StringComparer.Ordinal);
        foreach (var character in mock.Characters.Where(character => !covered.Contains(character.CharacterId)))
        {
            if (covered.Count >= requiredCharacters) break;
            var slug = character.CharacterId.Replace("char-", string.Empty, StringComparison.Ordinal);
            mock.ConversationNodes.Add(new ConversationNode
            {
                NodeId = $"conv-{slug}-root", CharacterId = character.CharacterId, IsRoot = true,
                Lines = { new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "The witness waits for a precise question." } },
                Choices =
                {
                    new ConversationChoice { ChoiceId = $"conv-{slug}-topic", Label = "Describe what you noticed.", NextNodeId = $"conv-{slug}-detail" },
                    new ConversationChoice { ChoiceId = $"conv-{slug}-leave", Label = "That is all for now." }
                }
            });
            mock.ConversationNodes.Add(new ConversationNode
            {
                NodeId = $"conv-{slug}-detail", CharacterId = character.CharacterId,
                Lines = { new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "I remember a careful movement near the archive door." } },
                Choices = { new ConversationChoice { ChoiceId = $"conv-{slug}-back", Label = "Understood." } }
            });
            covered.Add(character.CharacterId);
        }
    }

    internal static GeneratedCaseLogic CreateMockV3GeneratedLogic()
    {
        const string sceneId = "scene-mock-v3-archive";
        const string dialogueId = "dlg-mock-v3-witness";
        const string cameraEvidenceId = "evidence-mock-v3-wax";
        var answer = "I locked the archive before the rain began and checked the cabinet twice. "
            + "The blue seal was smooth and completely intact when I left the room. "
            + "I carried no parcel through the east corridor after the final bell. "
            + "The night porter started his round while I remained beside the front desk. "
            + "Nothing unusual happened before I handed over the only key.";

        var items = new[]
        {
            ("item-mock-v3-ticket", "Tram ticket", "evidence-mock-v3-ticket"),
            ("item-mock-v3-thread", "Muddy thread", "evidence-mock-v3-thread")
        };
        var fragments = new[]
        {
            new TestimonyFragment { Id = "fragment-mock-v3-seal", DialogueId = dialogueId, Text = "The blue seal was smooth and completely intact when I left the room." },
            new TestimonyFragment { Id = "fragment-mock-v3-parcel", DialogueId = dialogueId, Text = "I carried no parcel through the east corridor after the final bell." },
            new TestimonyFragment { Id = "fragment-mock-v3-porter", DialogueId = dialogueId, Text = "The night porter started his round while I remained beside the front desk." }
        };

        return new GeneratedCaseLogic
        {
            CaseId = "case-mock-ai-v3-crack",
            Title = "The Resealed Archive",
            Summary = "A compact cooperative investigation into a packet that appears untouched after closing.",
            EstimatedMinutes = 10,
            Stages =
            {
                new CaseStage
                {
                    StageId = "stage-mock-v3-archive",
                    Title = "The Archive",
                    Order = 1,
                    Scenes =
                    {
                        new CaseScene
                        {
                            SceneId = sceneId,
                            Title = "Municipal Archive",
                            Description = "A sealed packet, one hidden seal detail, two portable traces, and one careful witness await comparison.",
                            VisualDescription = "Empty Victorian municipal archive with dark oak shelves, brass lamps, a broad evidence table, deep teal walls, a subtle overlapping blue wax layer around the fixed brass packet seal on the left cabinet, two clear prop surfaces, and open floor space for one witness.",
                            ItemIds = items.Select(item => item.Item1).ToList(),
                            CharacterIds = { "char-mock-v3-witness" },
                            Hotspots = items.Select((item, index) => new SceneHotspot
                            {
                                HotspotId = $"hotspot-{item.Item1}", Type = "ITEM", TargetId = item.Item1,
                                X = 24 + (index * 20), Y = 62, Width = 8, Height = 9, ZIndex = 5, Label = item.Item2
                            }).Append(new SceneHotspot
                            {
                                HotspotId = "hotspot-char-mock-v3-witness", Type = "CHARACTER", TargetId = "char-mock-v3-witness",
                                X = 78, Y = 38, Width = 12, Height = 36, ZIndex = 6, Label = "Mara Voss"
                            }).ToList(),
                            CompleteCondition = new CompleteCondition
                            {
                                Logic = "AND",
                                RequiredItemIds = items.Select(item => item.Item1).ToList(),
                                RequiredClueIds = { cameraEvidenceId },
                                RequiredDialogueIds = { dialogueId }
                            }
                        }
                    }
                }
            },
            Characters =
            {
                new CaseCharacter
                {
                    CharacterId = "char-mock-v3-witness", Name = "Mara Voss", Role = "Archive custodian",
                    Description = "The custodian responsible for the packet and the archive key.",
                    VisualDescription = "Middle-aged archive custodian with a compact silhouette, warm brown skin, silver-streaked dark hair, deep teal waistcoat, oxblood skirt, brass key ring, and alert amber eyes."
                }
            },
            Items = items.Select(item => new CaseItem
            {
                ItemId = item.Item1, Name = item.Item2,
                Description = $"A portable trace recovered from the archive: {item.Item2.ToLowerInvariant()}.",
                InspectText = "This trace narrows the context but does not directly establish that the packet was reopened.",
                VisualDescription = $"Small portable {item.Item2.ToLowerInvariant()} prop with crisp silhouette, dark outline, restrained brass and blue accents.",
                RenderMode = CaseItemRenderModes.Cutout,
                UnlockClueIds = { item.Item3 },
                IsCollectible = true,
                IsInteractivePuzzleObject = false,
                InteractionPurpose = CaseItemInteractionPurposes.LegacyEvidence,
                InteractionReason = "Investigator inspects this portable physical trace to record one private evidence clue."
            }).ToList(),
            Clues = new List<CaseClue>
            {
                new()
                {
                    ClueId = cameraEvidenceId, Title = "Overlapping blue wax",
                    Content = "A fractured lower seal is visible beneath a newly pressed blue wax layer on the fixed packet clasp.",
                    IsCritical = true, IsEvidence = true, IsRedHerring = false,
                    Source = sceneId, SourceType = EvidenceDiscoveryMethods.CameraCapture,
                    SceneId = sceneId, DiscoverMethod = EvidenceDiscoveryMethods.CameraCapture,
                    VisualDescription = "A thumb-sized fresh blue wax crescent overlapping a cracked older wax seal around the fixed brass packet clasp on the left cabinet.",
                    VisualTextPolicy = ClueVisualTextPolicies.NoText,
                    InventoryDescription = "The captured frame shows two wax layers: a cracked original beneath a fresh upper seal.",
                    NarrativeMeaning = "The visible overlap directly contradicts the claim that the original seal remained intact.",
                    HintLevel = 2, Tags = { "camera", "physical" }, RelatedCharacterIds = { "char-mock-v3-witness" }
                }
            }.Concat(items.Select(item => new CaseClue
            {
                ClueId = item.Item3, Title = item.Item2,
                Content = "A plausible contextual trace that does not prove the packet was reopened.",
                IsCritical = false, IsEvidence = true, IsRedHerring = true,
                Source = item.Item1, SourceType = EvidenceDiscoveryMethods.ItemInspect,
                SceneId = sceneId, DiscoverMethod = EvidenceDiscoveryMethods.ItemInspect,
                InventoryDescription = "A private physical observation for comparison with witness claims.",
                NarrativeMeaning = "Relevant context without a direct contradiction.",
                HintLevel = 1,
                Tags = { "physical" }, RelatedCharacterIds = { "char-mock-v3-witness" }
            })).Append(new CaseClue
            {
                ClueId = "reveal-mock-v3-resealed", Title = "The packet was resealed",
                Content = "Someone opened the packet after closing and pressed fresh blue wax over the broken original seal.",
                IsCritical = true, IsEvidence = false, Source = dialogueId, SourceType = "dialogue", SceneId = sceneId,
                DiscoverMethod = "dialogue", InventoryDescription = "Shared truth established by the paired contradiction.",
                NarrativeMeaning = "The Crack combines private testimony and private physical evidence into one shared conclusion.",
                HintLevel = 3, Tags = { "reveal" }, RelatedCharacterIds = { "char-mock-v3-witness" }
            }).ToList(),
            Dialogues =
            {
                new CaseDialogue
                {
                    DialogueId = dialogueId, CharacterId = "char-mock-v3-witness",
                    Question = "Describe exactly what happened when you closed the archive.", Answer = answer
                }
            },
            TestimonyFragments = fragments.ToList(),
            EvidenceChallenges =
            {
                new EvidenceChallenge
                {
                    ChallengeId = "challenge-mock-v3-resealed", DialogueId = dialogueId,
                    TestimonyFragmentId = fragments[0].Id,
                    CandidateTestimonyFragmentIds = fragments.Select(fragment => fragment.Id).ToList(),
                    Prompt = "Which physical trace directly contradicts the selected claim?",
                    CorrectEvidenceId = cameraEvidenceId,
                    CandidateEvidenceIds = new[] { cameraEvidenceId }.Concat(items.Select(item => item.Item3)).ToList(),
                    StartRequiredTestimonyFragmentIds = fragments.Take(2).Select(fragment => fragment.Id).ToList(),
                    StartRequiredEvidenceIds = new[] { cameraEvidenceId, items[0].Item3 }.ToList(),
                    SuccessResponse = "The captured overlapping wax layers prove the packet was opened and resealed after the witness claimed the original seal remained intact.",
                    FailureResponse = "That pairing does not establish a direct contradiction. Compare exactly what the physical trace proves with the selected claim.",
                    RevealTitle = "CRACKED: THE PACKET WAS RESEALED",
                    UnlockClueIds = { "reveal-mock-v3-resealed" }
                }
            },
            FinalLogic = new FinalLogic
            {
                CulpritId = "char-mock-v3-witness", Motive = "To alter a protected archive packet.",
                Method = "Break the original seal and press a fresh wax layer over it.",
                WinEnding = "The paired contradiction establishes that the packet was resealed.",
                FailEnding = "The archive remains closed around an unresolved contradiction."
            }
        };
    }

    private static string SerializeGeneratedLogicForProvider(GeneratedCaseLogic logic)
    {
        var root = JsonSerializer.SerializeToNode(logic, PrettyJson)!.AsObject();
        foreach (var stage in root["stages"]!.AsArray())
        foreach (var scene in stage!["scenes"]!.AsArray())
        {
            var obj = scene!.AsObject();
            obj.Remove("backgroundUrl");
            obj.Remove("placementPlan");
            obj.Remove("runtime");
        }
        foreach (var character in root["characters"]!.AsArray()) character!.AsObject().Remove("imageUrl");
        foreach (var item in root["items"]!.AsArray()) item!.AsObject().Remove("imageUrl");
        return root.ToJsonString(PrettyJson);
    }

    private static void ConvertMockCaseToCameraEmbedded(GameCase mock)
    {
        mock.GenerationMode = CaseGenerationModes.CameraEmbedded;
        var itemScene = mock.Stages
            .SelectMany(stage => stage.Scenes)
            .SelectMany(scene => scene.ItemIds.Select(itemId => new { itemId, scene }))
            .ToDictionary(x => x.itemId, x => x.scene, StringComparer.Ordinal);
        var itemById = mock.Items.ToDictionary(item => item.ItemId, StringComparer.Ordinal);

        foreach (var clue in mock.Clues.Where(clue => string.Equals(clue.SourceType, "item", StringComparison.OrdinalIgnoreCase)))
        {
            itemScene.TryGetValue(clue.Source, out var scene);
            itemById.TryGetValue(clue.Source, out var item);
            scene ??= mock.Stages.SelectMany(stage => stage.Scenes).First();
            clue.Source = scene.SceneId;
            clue.SourceType = "camera";
            clue.DiscoverMethod = "camera";
            clue.SceneId = scene.SceneId;
            clue.VisualDescription = FirstNonBlank(clue.VisualDescription, item?.Description ?? string.Empty, clue.Content);
            clue.InventoryDescription = FirstNonBlank(clue.InventoryDescription, item?.InspectText ?? string.Empty, clue.Content);
            clue.NarrativeMeaning = FirstNonBlank(clue.NarrativeMeaning, clue.Content, clue.Title);
            clue.HintLevel = clue.HintLevel <= 0 ? 1 : clue.HintLevel;
            if (!clue.Tags.Contains("camera", StringComparer.OrdinalIgnoreCase)) clue.Tags.Add("camera");
        }

        foreach (var scene in mock.Stages.SelectMany(stage => stage.Scenes))
        {
            scene.VisualDescription = $"Victorian detective environment for {scene.Title}, composed from physical props, material wear, color contrast and clear silhouettes.";
            scene.ItemIds.Clear();
            scene.Hotspots.RemoveAll(h => h.Type.Equals("ITEM", StringComparison.OrdinalIgnoreCase));
            scene.CompleteCondition.RequiredItemIds.Clear();
        }

        mock.Items.Clear();
        foreach (var clue in mock.Clues)
        {
            clue.VisualTextPolicy = ClueVisualTextPolicies.NoText;
        }
    }

    private static string FirstNonBlank(params string[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;
}
