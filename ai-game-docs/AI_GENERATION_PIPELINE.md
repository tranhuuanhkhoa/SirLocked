# AI Generation Pipeline

## Current MVP Scope

The current MVP intentionally uses single-step AI case generation.

Current flow:

```txt
Admin prompt
-> Backend calls Deepseek, or mock fallback if unavailable
-> AI returns one complete GameCase JSON
-> Backend strips markdown fences
-> Backend parses JSON
-> Backend forces status = DRAFT
-> Backend validates JSON
-> Backend saves draft to MongoDB
-> Backend exports the JSON bundle to src/BE/GeneratedCaseJson
-> Admin can import/publish the generated case
```

This keeps the first playable demo small enough to finish and test end to end.

## MVP Input

```json
{
  "prompt": "A locked-room manor mystery with poisoned drink",
  "stageCount": 4,
  "difficulty": "medium",
  "visualStyle": "cinematic detective visual novel"
}
```

## MVP AI Must Generate

- case overview
- title and summary
- stages
- scenes
- hotspots
- characters
- items
- clues
- clue flags: `isCritical`, `isEvidence`, `isRedHerring`
- clue `source` and `sourceType`
- dialogues
- unlock logic
- final culprit
- motive
- method
- required evidence
- win/fail ending
- visual prompts or placeholder image URLs

## MVP Deepseek Prompt Rules

Ask the model for JSON only:

- no markdown fence
- no explanation
- one valid `GameCase` object
- IDs must use:
  - `caseId`
  - `stageId`
  - `sceneId`
  - `characterId`
  - `itemId`
  - `clueId`
  - `dialogueId`
- no generic `id` fields for core entities
- all references must exist
- final evidence must be discoverable clue IDs only
- culprit must be a character
- at least one red herring
- red herrings must use `isRedHerring: true`
- every final evidence clue must use `isEvidence: true`
- contradiction chain in dialogue
- delayed strongest culprit evidence

## MVP Validation Rules

- Required fields exist.
- No duplicate IDs.
- Scene item IDs exist.
- Scene character IDs exist.
- Hotspot target IDs exist.
- Item unlock clues exist.
- Dialogue required/unlocked clues exist.
- Final culprit exists.
- Final evidence exists as clue IDs only.
- Final evidence clues set `isEvidence: true`.
- Red herring clues set `isRedHerring: true`.
- Final evidence is discoverable.
- Each stage has at least one scene.
- Stage order is valid.
- Scene complete conditions reference existing IDs.
- Unlock graph is reachable and has no cycles that can block required scene or final evidence.
- `completeCondition.logic` is either `AND` or `OR`; `OR` must have at least one non-empty requirement group.

## Generated Bundle

Export at least:

```txt
manifest.json
case.json
stages.json
scenes.json
characters.json
items.json
clues.json
dialogues.json
final-logic.json
asset-prompts.json
validation-report.json
```

Optional detailed pipeline files:

```txt
01-case-overview.json
02-case-outline.json
visual-style-profile.json
story.json
stage-XX/03-stage-detail.json
stage-XX/04.1-scene-gameplay-data.json
stage-XX/04.1-scene-summary.json
stage-XX/04.2-scene-characters.json
stage-XX/04.3-scene-items.json
stage-XX/04.4-scene-clues-evidence.json
stage-XX/04.5-scene-dialogues.json
stage-XX/04.6-scene-unlock-logic.json
stage-XX/05-scene-layout.json
stage-XX/06-background-visual.json
stage-XX/07-character-visual.json
stage-XX/08-item-visual.json
stage-XX/09-stage-validation.json
11-final-case-logic.json
```

Visual style templates for image generation live in:

```txt
ai-game-docs/visual-style-templates/style-profile.json
ai-game-docs/visual-style-templates/character-style-template.json
ai-game-docs/visual-style-templates/background-style-template.json
ai-game-docs/visual-style-templates/item-evidence-style-template.json
ai-game-docs/visual-style-templates/scene-prompt-template.json
```

## Advanced AI Case Generation Pipeline

After the playable MVP is stable, upgrade from single-step generation to this multi-step pipeline. The goal is to reduce forgotten fields, make each stage easier to validate, and let later steps depend on already locked data.

### 1. Case Overview

Purpose:

- Create the high-level case overview.
- Determine the number of stages.
- Determine culprit, victim, twist, and ending direction.

Output:

```txt
01-case-overview.json
```

### 2. Stage Outline

Purpose:

- Split the story into stages.
- Give each stage a clear gameplay objective.

Output:

```txt
02-case-outline.json
```

### 3. Stage Detail

Purpose:

- Expand one stage's story details.
- Decide how many scenes/backgrounds the stage needs.
- Define what each scene is used for.

Output per stage:

```txt
stage-XX/03-stage-detail.json
```

### 4. Scene Gameplay Data

This group locks gameplay data before any visual generation.

#### 4.1. Scene Summary JSON

Purpose:

- Summarize each scene.
- Define `sceneId`, `backgroundId`, `objective`, and `purpose`.

Output per stage:

```txt
stage-XX/04.1-scene-summary.json
```

#### 4.2. Scene Characters JSON

Purpose:

- List characters present in the scene.
- Define gameplay data for those characters.
- Do not generate appearance or images yet.

Output per stage:

```txt
stage-XX/04.2-scene-characters.json
```

#### 4.3. Scene Items JSON

Purpose:

- List items in the scene.
- Define `clickDescription`, `inspectDescription`, and `hiddenMeaning`.
- Do not generate item image prompts yet.

Output per stage:

```txt
stage-XX/04.3-scene-items.json
```

#### 4.4. Scene Clues/Evidence JSON

Purpose:

- Generate clues/evidence from items and dialogue.
- Define what each clue proves.
- Define which character or contradiction each clue relates to.

Output per stage:

```txt
stage-XX/04.4-scene-clues-evidence.json
```

#### 4.5. Scene Dialogues JSON

Purpose:

- Generate character dialogue.
- Support contradiction checks using item/clue context.
- Unlock new clues or dialogue branches.

Output per stage:

```txt
stage-XX/04.5-scene-dialogues.json
```

#### 4.6. Scene Unlock Logic JSON

Purpose:

- Define scene completion conditions.
- Define conditions to unlock the next scene/stage.

Output per stage:

```txt
stage-XX/04.6-scene-unlock-logic.json
```

### 5. Scene Layout JSON

Purpose:

- Generate background layout JSON.
- Attach item coordinates.
- Attach character coordinates.
- Attach hotspots/click zones.

Output per stage:

```txt
stage-XX/05-scene-layout.json
```

### 6. Background Visual JSON

Purpose:

- Use the locked scene/background data from step 5.
- Generate background visual JSON and background image prompt data.
- Use `visual-style-templates/style-profile.json` and `visual-style-templates/background-style-template.json` as the style contract.

Output per stage:

```txt
stage-XX/06-background-visual.json
```

### 7. Character Visual JSON

Purpose:

- Use the locked character list.
- Generate character appearance JSON.
- Generate character image prompt data.
- Use `visual-style-templates/style-profile.json` and `visual-style-templates/character-style-template.json` as the style contract.

Output per stage:

```txt
stage-XX/07-character-visual.json
```

### 8. Item Visual JSON

Purpose:

- Use the locked item list.
- Generate item visual JSON.
- Generate item image prompt data.
- Use `visual-style-templates/style-profile.json` and `visual-style-templates/item-evidence-style-template.json` as the style contract.

Output per stage:

```txt
stage-XX/08-item-visual.json
```

### 9. Validate Stage

Purpose:

- Check IDs.
- Check item/dialogue/character references.
- Check unlock conditions.
- Check that the stage contributes enough evidence to solve the case.

Output per stage:

```txt
stage-XX/09-stage-validation.json
```

### 10. Repeat Next Stage

Repeat steps 3 through 9 for each stage until all stages are complete.

### 11. Final Case Logic

Purpose:

- Merge all stage results.
- Create win/loss conditions.
- Create the accusation system.
- Create endings.

Output:

```txt
11-final-case-logic.json
```

## Advanced Pipeline Order

```txt
1 -> 2 -> 3 -> 4.1 -> 4.2 -> 4.3 -> 4.4 -> 4.5 -> 4.6
                                      |
                    +-----------------+-----------------+
                    |                 |                 |
              5 + 6 background   7 character        8 item
                    |                 |                 |
                    +-----------------+-----------------+
                                      |
                              9 validate stage
                                      |
                              10 next stage
                                      |
                              11 final logic
```

## Recommended Roadmap

MVP:

```txt
Generate one complete GameCase JSON
-> Validate
-> Save draft
-> Import/publish
```

Phase 2:

```txt
Case overview
-> Stage outline
-> Stage detail
-> Scene gameplay JSON
-> Layout JSON
-> Visual JSON
-> Validate each stage
-> Repeat
-> Final logic
```
