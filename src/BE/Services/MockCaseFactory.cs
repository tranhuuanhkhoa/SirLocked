using System.Globalization;
using System.Text;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Deterministic offline case generator used for demo seeding. Produces a structurally valid,
/// fully playable GameCase: every scene can be
/// completed in linear order and all final evidence is discoverable.
/// </summary>
public static class MockCaseFactory
{
    private static readonly string[] SceneNames =
    {
        "Scene of the Crime", "Service Passage", "Private Quarters", "Hidden Workroom", "Records Office", "Final Confrontation"
    };

    private static readonly string[] SceneDescriptions =
    {
        "The investigation begins where the incident was discovered. Every object here saw what happened.",
        "A back route that staff and guests pretend not to use. Movements here decide alibis.",
        "Personal effects reveal motives that public faces hide.",
        "Someone prepared the crime here, away from watching eyes.",
        "Paper does not lie. The records contradict at least one confident statement.",
        "All suspects are gathered. The chain of evidence must now name the culprit."
    };

    private static readonly (string Name, string Role)[] Cast =
    {
        ("Inspector Hale", "Lead detective"),
        ("Victor Crane", "Trusted associate and true culprit"),
        ("Lena Marsh", "Devoted employee and red herring suspect"),
        ("Oliver Pike", "Nervous witness")
    };

    public static GameCase Create(string prompt, int stageCount, string difficulty, string? caseId = null)
    {
        stageCount = Math.Clamp(stageCount, 2, 6);
        var slug = Slugify(prompt, 3);
        var id = caseId ?? $"case-ai-{slug}-{DateTime.UtcNow:yyyyMMddHHmmss}";
        var theme = ThemeFromPrompt(prompt);

        var gameCase = new GameCase
        {
            CaseId = id,
            Title = $"The {theme} Affair",
            Summary = $"{Capitalize(prompt.Trim().TrimEnd('.'))}. Two detectives must trace the physical evidence and break the suspects' stories before the culprit slips away.",
            Status = CaseStatus.Draft,
            MechanicsVersion = CaseMechanicsVersions.InvestigationV2,
            EstimatedMinutes = 15 + stageCount * 7,
            CoverImageUrl = $"/assets/cases/{id}.jpg"
        };

        foreach (var (name, role) in Cast)
        {
            gameCase.Characters.Add(new CaseCharacter
            {
                CharacterId = $"char-{Slugify(name, 2)}",
                Name = name,
                Role = role,
                ImageUrl = $"/assets/characters/{Slugify(name, 2)}.png",
                Description = role switch
                {
                    "Lead detective" => "Keeps the investigation anchored to verifiable facts.",
                    "Trusted associate and true culprit" => $"Smooth and helpful, but the {theme.ToLowerInvariant()} ruined them long before tonight.",
                    "Devoted employee and red herring suspect" => "Hides an embarrassing secret that looks like guilt but is not.",
                    _ => "Saw more than they admit, and fears being blamed for it."
                }
            });
        }

        var detective = gameCase.Characters[0];
        var culprit = gameCase.Characters[1];
        var redHerring = gameCase.Characters[2];
        var witness = gameCase.Characters[3];
        gameCase.FinalLogic.CulpritId = culprit.CharacterId;

        var evidenceClueIds = new List<string>();
        string? previousSceneClueId = null;

        for (var s = 0; s < stageCount; s++)
        {
            var isFinal = s == stageCount - 1;
            var sceneName = SceneNames[Math.Min(s, SceneNames.Length - 1)];
            if (isFinal) sceneName = SceneNames[^1];
            var sceneSlug = Slugify(sceneName, 3);
            var sceneId = $"scene-{sceneSlug}-{s + 1}";

            var stage = new CaseStage
            {
                StageId = $"stage-{sceneSlug}-{s + 1}",
                Title = isFinal ? "Final Confrontation" : $"Lead {s + 1}: {sceneName}",
                Order = s + 1
            };

            var scene = new CaseScene
            {
                SceneId = sceneId,
                Title = sceneName,
                BackgroundUrl = $"/assets/scenes/{id}/{sceneSlug}.jpg",
                Description = SceneDescriptions[isFinal ? SceneDescriptions.Length - 1 : Math.Min(s, SceneDescriptions.Length - 2)],
                CharacterIds = isFinal
                    ? gameCase.Characters.Select(c => c.CharacterId).ToList()
                    : new List<string> { detective.CharacterId, s % 2 == 0 ? culprit.CharacterId : redHerring.CharacterId, witness.CharacterId }
            };

            // Two items per scene, each unlocking one clue.
            for (var i = 0; i < 2; i++)
            {
                var itemIndex = s * 2 + i + 1;
                var itemId = $"item-{slug}-{itemIndex}";
                var clueId = $"clue-{slug}-{itemIndex}";
                var isEvidence = i == 0; // each scene contributes one confrontation-grade evidence clue
                var isHerring = s == 0 && i == 1; // one early misleading clue

                gameCase.Items.Add(new CaseItem
                {
                    ItemId = itemId,
                    Name = $"{sceneName} Exhibit {(char)('A' + i)}",
                    Description = $"A physical trace left in the {sceneName.ToLowerInvariant()}.",
                    InspectText = isHerring
                        ? $"It points suspiciously at {redHerring.Name}, but proves embarrassment rather than guilt."
                        : $"This ties the {theme.ToLowerInvariant()} directly to whoever moved through the {sceneName.ToLowerInvariant()} that night.",
                    ImageUrl = $"/assets/items/{id}/{itemId}.png",
                    UnlockClueIds = new List<string> { clueId },
                    IsCollectible = true
                });

                gameCase.Clues.Add(new CaseClue
                {
                    ClueId = clueId,
                    Title = isHerring ? $"{redHerring.Name}'s Secret" : $"Trace {itemIndex}: {sceneName}",
                    Content = isHerring
                        ? $"{redHerring.Name} hid something here, but it does not connect to the {theme.ToLowerInvariant()} itself."
                        : $"Physical evidence from the {sceneName.ToLowerInvariant()} narrows down who had the opportunity.",
                    IsCritical = isEvidence,
                    IsEvidence = isEvidence,
                    IsRedHerring = isHerring,
                    Source = itemId,
                    SourceType = "item"
                });

                if (isEvidence) evidenceClueIds.Add(clueId);

                scene.ItemIds.Add(itemId);
                scene.Hotspots.Add(new SceneHotspot
                {
                    HotspotId = $"hotspot-{slug}-{itemIndex}",
                    Type = "ITEM",
                    TargetId = itemId,
                    X = 22 + i * 38 + s * 3,
                    Y = 52 + i * 14,
                    Width = 10,
                    Height = 12,
                    ZIndex = 1,
                    Label = $"{sceneName} Exhibit {(char)('A' + i)}",
                    // Gate the second item of later scenes behind the previous scene's first clue.
                    RequiredClueIds = i == 1 && previousSceneClueId is not null
                        ? new List<string> { previousSceneClueId }
                        : new List<string>()
                });
            }

            var firstItemClue = $"clue-{slug}-{s * 2 + 1}";
            var openDialogueId = $"dlg-{slug}-{s + 1}-open";
            var lockedDialogueId = $"dlg-{slug}-{s + 1}-press";
            var talkTo = isFinal ? culprit : (s % 2 == 0 ? culprit : redHerring);

            gameCase.Dialogues.Add(new CaseDialogue
            {
                DialogueId = openDialogueId,
                CharacterId = witness.CharacterId,
                Question = isFinal ? "Will you finally tell the whole truth?" : $"What did you notice near the {sceneName.ToLowerInvariant()}?",
                Answer = isFinal
                    ? $"Yes. I saw {culprit.Name} where they claimed they never went."
                    : $"I heard movement when everyone was supposed to be elsewhere. I did not dare to speak before.",
                RequiredClueIds = new List<string>(),
                UnlockClueIds = new List<string>()
            });

            var dialogueClueId = $"clue-{slug}-dlg-{s + 1}";
            gameCase.Clues.Add(new CaseClue
            {
                ClueId = dialogueClueId,
                Title = $"Statement {s + 1}: {talkTo.Name}",
                Content = isFinal
                    ? $"Confronted with the evidence chain, {culprit.Name}'s account of the night collapses."
                    : $"{talkTo.Name}'s story does not fit the physical trace found in the {sceneName.ToLowerInvariant()}.",
                IsCritical = isFinal,
                IsEvidence = isFinal,
                IsRedHerring = false,
                Source = lockedDialogueId,
                SourceType = "dialogue"
            });
            if (isFinal) evidenceClueIds.Add(dialogueClueId);

            gameCase.Dialogues.Add(new CaseDialogue
            {
                DialogueId = lockedDialogueId,
                CharacterId = talkTo.CharacterId,
                Question = isFinal
                    ? "Your alibi contradicts every piece of evidence. What really happened?"
                    : $"How do you explain what we found in the {sceneName.ToLowerInvariant()}?",
                Answer = isFinal
                    ? "...You cannot prove— no. No, it was the only way out. The debt would have destroyed everything."
                    : "That... that must belong to someone else. I was never there that long.",
                RequiredClueIds = isFinal && evidenceClueIds.Count > 1
                    ? evidenceClueIds.Where(idd => idd != dialogueClueId).Take(3).ToList()
                    : new List<string> { firstItemClue },
                UnlockClueIds = new List<string>()
            });

            var challengeId = $"challenge-{slug}-{s + 1}";
            gameCase.EvidenceChallenges.Add(new EvidenceChallenge
            {
                ChallengeId = challengeId,
                DialogueId = lockedDialogueId,
                Prompt = $"Which evidence contradicts {talkTo.Name}'s account?",
                CorrectEvidenceId = firstItemClue,
                SuccessResponse = $"The physical trace from {sceneName.ToLowerInvariant()} proves the testimony cannot be true.",
                FailureResponse = "That evidence does not contradict this part of the testimony.",
                UnlockClueIds = new List<string> { dialogueClueId }
            });
            gameCase.Hints.Add(new CaseHint
            {
                HintId = $"hint-scene-{slug}-{s + 1}",
                ContextType = HintContextTypes.Scene,
                TargetId = sceneId,
                Order = 1,
                Text = $"Compare the first physical trace in {sceneName.ToLowerInvariant()} with the suspect's statement."
            });
            gameCase.Hints.Add(new CaseHint
            {
                HintId = $"hint-challenge-{slug}-{s + 1}",
                ContextType = HintContextTypes.Confrontation,
                TargetId = challengeId,
                Order = 1,
                Text = "Use evidence found in this location that directly conflicts with the testimony."
            });

            scene.CompleteCondition = new CompleteCondition
            {
                Logic = "AND",
                RequiredItemIds = scene.ItemIds.ToList(),
                RequiredClueIds = new List<string> { firstItemClue, dialogueClueId },
                RequiredDialogueIds = new List<string> { lockedDialogueId }
            };

            previousSceneClueId = firstItemClue;
            stage.Scenes.Add(scene);
            gameCase.Stages.Add(stage);
        }

        gameCase.FinalLogic.Motive = $"The {theme.ToLowerInvariant()} concealed a debt that would have destroyed {culprit.Name}.";
        gameCase.FinalLogic.Method = $"{culprit.Name} used trusted access to stage the scene and let suspicion fall on {redHerring.Name}.";
        gameCase.FinalLogic.RequiredEvidenceIds = evidenceClueIds.Distinct().ToList();
        var distinctEvidence = evidenceClueIds.Distinct().Take(3).ToList();
        gameCase.FinalLogic.MotiveOptions = new List<AccusationOption>
        {
            new() { Id = "motive-debt", Label = $"A hidden debt tied to the {theme.ToLowerInvariant()}" },
            new() { Id = "motive-jealousy", Label = "Professional jealousy" },
            new() { Id = "motive-revenge", Label = "Revenge for an old betrayal" }
        };
        gameCase.FinalLogic.MethodOptions = new List<AccusationOption>
        {
            new() { Id = "method-trusted-access", Label = "Trusted access followed by a staged scene" },
            new() { Id = "method-forced-entry", Label = "Forced entry after the incident" },
            new() { Id = "method-accomplice", Label = "An accomplice created a false alibi" }
        };
        gameCase.FinalLogic.CorrectMotiveId = "motive-debt";
        gameCase.FinalLogic.CorrectMethodId = "method-trusted-access";
        gameCase.FinalLogic.RequiredEvidenceLinks = new List<RequiredEvidenceLink>
        {
            new() { ClaimType = EvidenceClaimTypes.Motive, EvidenceId = distinctEvidence[0] },
            new() { ClaimType = EvidenceClaimTypes.Method, EvidenceId = distinctEvidence[1] },
            new() { ClaimType = EvidenceClaimTypes.Opportunity, EvidenceId = distinctEvidence[2] }
        };
        var requiredChallengeIds = gameCase.EvidenceChallenges.Take(2).Select(challenge => challenge.ChallengeId).ToList();
        var deductionId = "deduction-final-chain";
        gameCase.Deductions.Add(new DeductionChallenge
        {
            DeductionId = deductionId,
            Prompt = $"Which reasoning chain proves {culprit.Name}'s guilt?",
            RequiredClueIds = distinctEvidence.ToList(),
            RequiredChallengeIds = requiredChallengeIds,
            Options = new List<AccusationOption>
            {
                new() { Id = "deduce-culprit-chain", Label = $"The physical evidence and contradictions point to {culprit.Name}" },
                new() { Id = "deduce-red-herring", Label = $"{redHerring.Name}'s suspicious behavior proves guilt" },
                new() { Id = "deduce-accident", Label = "The death was accidental and the clues are unrelated" }
            },
            CorrectOptionId = "deduce-culprit-chain",
            SuccessResponse = "The motive, method, and opportunity now form one defensible chain.",
            FailureResponse = "That theory leaves a major contradiction unresolved."
        });
        gameCase.Hints.Add(new CaseHint
        {
            HintId = "hint-deduction-final-chain",
            ContextType = HintContextTypes.Deduction,
            TargetId = deductionId,
            Order = 1,
            Text = "Use the evidence that supports motive, method, and opportunity together."
        });
        var chainId = "chain-final-teamwork";
        gameCase.RequiredTeamworkChains.Add(new RequiredTeamworkChain
        {
            ChainId = chainId,
            InvestigatorClueId = distinctEvidence[1],
            InterrogatorChallengeId = requiredChallengeIds[0],
            DeductionId = deductionId,
            Description = "The investigator finds the core physical proof, the interrogator resolves a contradiction, and the team completes the final deduction."
        });
        gameCase.FinalLogic.RequiredDeductionIds = new List<string> { deductionId };
        gameCase.FinalLogic.RequiredTeamworkChainIds = new List<string> { chainId };
        gameCase.FinalLogic.WinEnding =
            $"The evidence chain closes around {culprit.Name}. The staged scene, the traces, and the broken alibi leave no escape, and {redHerring.Name} is cleared.";
        gameCase.FinalLogic.FailEnding =
            $"The accusation does not hold. Without the full chain of evidence, {culprit.Name} walks free and an innocent reputation is ruined.";

        // A small reference conversation tree (root -> topic -> one follow-up -> back).
        gameCase.ConversationNodes.Add(new ConversationNode
        {
            NodeId = "conv-witness-root",
            CharacterId = witness.CharacterId,
            IsRoot = true,
            Lines = { new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = $"{witness.Name} watches you warily." } },
            Choices =
            {
                new ConversationChoice { ChoiceId = "conv-witness-topic", Label = "What did you see that night?", NextNodeId = "conv-witness-saw" },
                new ConversationChoice { ChoiceId = "conv-witness-leave", Label = "That is all for now." }
            }
        });
        gameCase.ConversationNodes.Add(new ConversationNode
        {
            NodeId = "conv-witness-saw",
            CharacterId = witness.CharacterId,
            Lines =
            {
                new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "Shadows by the door, and a sound like breaking glass." },
                new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "I kept my distance, you understand." }
            },
            Choices =
            {
                new ConversationChoice { ChoiceId = "conv-witness-follow", Label = "Press for detail.", NextNodeId = "conv-witness-detail" },
                new ConversationChoice { ChoiceId = "conv-witness-back", Label = "Understood." }
            }
        });
        gameCase.ConversationNodes.Add(new ConversationNode
        {
            NodeId = "conv-witness-detail",
            CharacterId = witness.CharacterId,
            Lines = { new ConversationLine { Speaker = ConversationSpeakers.Npc, Text = "A figure too careful to be innocent." } },
            Choices = { new ConversationChoice { ChoiceId = "conv-witness-return", Label = "Thank you." } }
        });

        return gameCase;
    }

    private static string ThemeFromPrompt(string prompt)
    {
        var words = prompt.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(w => w.Length > 3)
            .Take(2)
            .Select(Capitalize)
            .ToList();
        return words.Count > 0 ? string.Join(" ", words) : "Midnight";
    }

    private static string Capitalize(string value) =>
        value.Length == 0 ? value : char.ToUpper(value[0], CultureInfo.InvariantCulture) + value[1..];

    private static string Slugify(string value, int maxWords)
    {
        var sb = new StringBuilder();
        var words = 0;
        var lastDash = true;
        foreach (var ch in value.ToLowerInvariant())
        {
            if (char.IsAsciiLetterOrDigit(ch))
            {
                sb.Append(ch);
                lastDash = false;
            }
            else if (!lastDash)
            {
                words++;
                if (words >= maxWords) break;
                sb.Append('-');
                lastDash = true;
            }
        }
        var slug = sb.ToString().Trim('-');
        return slug.Length == 0 ? "mystery" : slug;
    }
}
