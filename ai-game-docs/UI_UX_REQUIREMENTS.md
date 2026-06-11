# UI/UX Requirements

## Main Principle

The gameplay page must feel like an actual point-and-click detective game, not a CRUD dashboard or a sequence of disconnected stages.

Internally, the backend can still use stages, scenes, completion conditions, and ordered progression. Player-facing UI should present the case as one continuous investigation: new places, questions, evidence, contradictions, and final confrontation unlock naturally as the players discover clues.

Do not show labels such as `Stage 1`, `Stage 2`, or `Stage Complete` as primary player-facing language. Use natural investigation copy instead, such as:

- Find the cause of death.
- Clarify the housekeeper's timeline.
- Check the locked study.
- Compare the testimony with the evidence.
- Confront the person who staged the scene.

## Core Gameplay Experience

The player-facing loop is:

```txt
Explore -> Click -> Inspect -> Collect Clue -> Talk -> Deduce -> Unlock
```

The UI should make players feel that they are living inside the case: observing the scene, inspecting objects, questioning witnesses, returning to old locations, noticing contradictions, and slowly opening the truth.

Recommended flow:

```txt
Case intro
-> Enter first scene
-> Freely inspect unlocked scenes
-> Click items or characters
-> Collect clues and evidence
-> Unlock dialogue, scenes, items, or events
-> Revisit earlier locations
-> Discover contradictions
-> Open final confrontation
-> Submit accusation
-> Reveal ending
```

## Case Intro

When a room starts the case, show a short intro before the first playable scene.

Intro content:

- Case title.
- Case summary or opening situation.
- Known facts before the investigation begins.
- Player roles and room players.
- Primary button: start investigation.

The intro should use `case.title`, `case.summary`, and the first scene/stage context. It should not require extra schema fields for MVP.

## Gameplay Screen Layout

Required layout elements:

- Large scene background area.
- Hotspots overlaid on the background using percent coordinates.
- Character area or character cards for people present in the scene.
- Bottom or side investigation/dialogue panel.
- Evidence board / investigation notebook.
- Current objective and hint panel.
- Room/player status and each player's role.
- Investigation map for unlocked/visited scenes.
- Action log for persistent unlock/progress messages.
- Final deduction or accusation button/modal.

Recommended desktop wireframe:

```txt
+--------------------------------------------------------------------------------+
| Top Bar: Case title | Current objective | Room code | Players/Roles | Menu      |
+---------------------------------------------------------------+----------------+
|                                                               | Notebook       |
|                                                               | - Clues        |
|                Scene Background                               | - Evidence     |
|        clickable hotspot overlay + character entry points      | - Characters   |
|                                                               | - Timeline     |
|                                                               | - Contradict.  |
+---------------------------------------------------------------+----------------+
| Investigation Panel: item inspect / dialogue / choices / log / hints            |
+--------------------------------------------------------------------------------+
```

Recommended proportions:

- Top bar: 48-64px height.
- Scene area: 70-75% page width on desktop.
- Right notebook/action area: 25-30% page width on desktop.
- Bottom investigation panel: 160-240px height.
- On mobile, stack scene first, then objective/dialogue, then notebook/map.

## Player-Facing Progress

Backend stages remain useful for implementation, but UI progress should be framed as investigation progress.

Use:

- Current objective.
- Open locations.
- Newly discovered evidence.
- Unresolved contradictions.
- Case readiness for final confrontation.

Avoid:

- Prominent `Stage 1/4` labels.
- `Next Stage` as the main call to action.
- Checklist-heavy language that makes the game feel like a task manager.

If a compact progress indicator is needed, use neutral copy such as `Investigation progress` or `Case thread`, with scene names and objectives instead of raw stage numbers.

## Investigation Map

Use an investigation map instead of a stage select screen.

The map shows unlocked or visited case locations as connected areas. Players can move to scenes that the backend says are unlocked or already visited. Locked scenes should feel diegetic: a locked door, no reason to enter yet, a character blocking access, or missing information.

MVP behavior:

- Show current scene.
- Show visited scenes.
- Show unlocked scenes if `go-to-scene` is implemented.
- If free navigation is not implemented yet, show the map as a read-only case overview and use normal scene progression.
- Never let the client bypass backend progression rules.

## Hotspots

Hotspots should be visible enough to play but subtle enough to preserve the detective mood.

Hotspot rules:

- Render hotspots as real keyboard-focusable controls.
- Use accessible labels from `hotspot.label`.
- Use percent coordinates from the case JSON.
- Keep hit areas aligned with the visible image after resize.
- Prefer a fixed scene aspect ratio, such as 16:9, for predictable placement.
- If the background uses `object-fit: contain`, account for letterboxing before mapping hotspot coordinates.
- Touch targets should be usable on mobile, ideally at least 36-44px.
- Overlapping hotspots should respect `zIndex` when available.

Hotspot states:

- `available`: warm outline, small marker, or subtle glow.
- `inspected`: dimmer marker with a check state.
- `locked`: hidden or shown with lock icon and short missing-category hint.
- `blockedByRole`: visible but disabled with a role hint.
- `loading`: temporary busy state while the action request is in flight.
- `error`: brief inline message or panel notice if the backend rejects the action.

Disabled/locked hotspots must not break layout or block other scene interactions.

## Item Inspect UI

Clicking an item hotspot opens a compact item panel or modal.

Item UI should include:

- Item name.
- Initial description.
- Inspect action.
- Detailed inspect text after successful backend action.
- Newly unlocked clue notice, if any.
- Source marker so the clue board can show where the clue came from.

Only `INVESTIGATOR` can perform item inspection actions in normal co-op rooms. Other players can view the item description and previously discovered result, but their inspect button should be disabled with a clear role hint.

If the item was already inspected, show the discovered information without duplicating clue notifications.

## Characters And Dialogue

For MVP, character cards or a character panel are preferred over placing full sprites in the scene, because the current schema has `characterIds` but no character placement coordinates.

Dialogue UI should include:

- Character avatar/image when available.
- Character name and role.
- Character description or current context.
- Question list.
- Answer area.
- Asked state for previously used questions.
- Locked question state when required clues are missing.
- New clue notice when dialogue unlocks a clue.

Dialogue options do not need to show all questions from the start. Questions that require clues may be hidden or disabled, but the behavior should be consistent within the app.

Only `INTERROGATOR` can ask dialogue questions in normal co-op rooms. Other players can view characters, available topics, and already answered dialogue, but their ask action should be disabled with a clear role hint.

## Role-Based UI Matrix

| UI action | Investigator | Interrogator | Both players |
| --- | --- | --- | --- |
| Inspect item hotspot | Enabled | View-only or disabled | See discovered item result |
| Ask dialogue question | View-only or disabled | Enabled | See answered dialogue |
| View clue board/notebook | Enabled | Enabled | Shared state |
| View objective/hints | Enabled | Enabled | Shared state |
| Open investigation map | Enabled | Enabled | Backend controls travel |
| Select final evidence draft | Enabled | Enabled | Shared final review |
| Submit final accusation | Allowed by backend policy | Allowed by backend policy | Confirm before submit |

Role-disabled UI should explain the reason without feeling like an error. Examples:

- Investigator action.
- Interrogator action.
- Waiting for your partner to inspect this.
- This question needs another clue first.

## Evidence Board / Investigation Notebook

The evidence board should feel like a detective notebook, not a database table.

Recommended tabs:

- `Clues`
- `Evidence`
- `Characters`
- `Timeline`
- `Contradictions`
- `Log`

MVP can implement only `Clues`, `Evidence`, `Characters`, and `Log` first. `Timeline` and `Contradictions` can be derived from clues/dialogue when data is available, or added later without blocking the playable loop.

### Clues

Show all unlocked clues.

Each clue should show:

- Title.
- Short content.
- Source, mapped to item/dialogue title when possible.
- Related character when derivable.
- Tag for critical clue if `isCritical` is true.

### Evidence

Show clues where `isEvidence: true`. Evidence means selectable in final accusation, not guaranteed correct final proof.

Do not reveal `finalLogic.requiredEvidenceIds` before the result. Avoid labels such as `Required Evidence` during gameplay.

### Red Herrings

Show red herrings as suspicious or uncertain findings. Do not hide them, because they are part of the mystery, but label them differently from strong evidence.

Suggested copy:

- Suspicious lead
- Weak proof
- Unconfirmed

Avoid copy that directly says "wrong clue" before the case is solved.

### Characters

Show known character profiles:

- Name.
- Role.
- Description.
- Key testimony already heard.
- Suspicious points or contradictions when available.

### Timeline And Contradictions

If timeline/contradiction data is not explicit in schema, derive lightweight entries from discovered clues and answered dialogue. Keep this informational for MVP; backend validation remains the authority.

## Objective And Hints

The objective/hint area should always be visible on desktop and should sit above the investigation panel on mobile.

Hint escalation:

1. Before failed progress attempt: show natural objective text and broad guidance.
2. After one failed attempt: show missing categories, such as item, clue, or dialogue.
3. After repeated failed attempts: show player-facing names of missing items/dialogues/clues when available.
4. Never expose technical IDs such as `clue-poison-source` directly to players.

Avoid exposing exact final evidence too early. Exact final evidence should only be explained after the result or when the backend intentionally returns missing requirements for a failed progress action.

Hints are guidance only. Backend validation remains authoritative.

## Unlock Feedback

Content should unlock through investigation logic, not through a visible `Next Stage` button.

Possible unlock types:

- New dialogue question.
- New scene/location.
- Previously hidden item.
- New event or contradiction.
- Final confrontation.

Every meaningful unlock should appear in at least two places:

- A short toast or notice.
- Persistent action log / notebook log entry.

This prevents players from missing important progress.

## Deduction Board

The deduction board is optional for MVP, but the UI should leave room for it.

The deduction board lets players connect clues/evidence to reasoning questions, such as:

- What proves the timeline is false?
- What shows the scene was staged?
- Who had access to the poisoned drink?
- Which evidence contradicts this testimony?

For MVP, final accusation can serve as the primary deduction moment. A richer drag-and-drop deduction board should be treated as a later enhancement unless already easy to implement.

## Final Confrontation And Accusation

Final confrontation is the case climax. It should feel different from normal scene interaction but still use the same evidence/clue system.

MVP accusation flow:

1. Open final accusation when backend rules allow it.
2. Select culprit.
3. Select evidence clues only.
4. Review selected culprit and evidence.
5. Confirm submission.
6. Backend decides win/fail.
7. Show result/reveal page.

The confirm step is required because a wrong accusation can end the room with a fail result.

The final modal should not allow item IDs as evidence. It should submit clue IDs only.

## Result / Reveal Truth

The result page should clearly show:

- Win or fail state.
- Selected culprit.
- Selected evidence.
- Correct ending text from backend result.
- Case truth summary when available.
- Actions to return to case list, replay, or leave room.

Optional later result details:

- Clues found count.
- Evidence used correctly.
- Contradictions discovered.
- Investigation rating.
- Full truth timeline.

## Frontend UI States

Every gameplay component should handle:

- Loading initial state.
- Missing or broken image with fallback.
- Empty clue board.
- Empty dialogue list.
- Locked dialogue/hotspot.
- Wrong role action.
- Already inspected item.
- Already asked dialogue.
- API validation error.
- Forbidden/non-room-player action.
- Duplicate realtime event.
- SignalR reconnecting.
- Reconnected and refetching state.
- Partner disconnected or not ready, where room data supports it.
- Completed room/result state.

## Responsive Requirements

- Desktop layout is the priority.
- Mobile/tablet must remain usable.
- Text must not overflow buttons/cards.
- Hotspots must scale with the scene.
- Main actions must be reachable without horizontal scrolling.
- The notebook can collapse into tabs/drawer on mobile.
- The investigation map can be modal/drawer on mobile.

## Visual Style

Use a detective mystery style:

- Dark but readable.
- Vintage investigation feel.
- Restrained colors.
- Clear action states.
- Semi-realistic visual novel / point-and-click mood.

Do not introduce a heavy new design system. Use a small set of reusable tokens and extend existing styles.

Recommended MVP visual tokens:

| Token | Suggested value/use |
| --- | --- |
| Page background | near-black navy or charcoal |
| Panel background | dark desaturated blue/gray |
| Surface background | slightly lighter charcoal |
| Primary text | warm off-white |
| Secondary text | muted gray-beige |
| Accent | warm gold/amber |
| Danger/fail | muted crimson |
| Success/unlock | muted green or teal |
| Evidence tag | amber/gold |
| Critical tag | pale blue or ivory |
| Red herring tag | muted purple or rose |
| Border radius | 6-8px |
| Panel border | subtle low-opacity warm line |
| Focus ring | high-contrast amber or white |

Avoid making the UI too monochrome. Dark vintage colors should remain readable and interactive states must be obvious.

## Accessibility

- Maintain readable contrast even with dark vintage colors.
- Body text should remain legible on 1366px desktop and common laptop screens.
- Do not put low-contrast gold text on bright backgrounds.
- Every interactive hotspot must have an accessible label/title.
- Icon-only buttons need labels or tooltips.
- Keyboard users should be able to tab to major actions: hotspots, dialogue, clue board, map, final accusation, leave/back.
- Role-disabled controls should explain why they are disabled.
- Toasts or unlock messages should also appear in the action log so they are not missed.
- Important modals should trap focus and close safely.

## Localization-Ready Text

MVP can hard-code English/Vietnamese text, but new UI copy should be easy to move later:

- Keep repeated labels centralized where practical.
- Avoid embedding large UI strings inside deeply nested components.
- Case content stays inside `case.json`.
- Future locale files can map app UI labels, while case JSON stores story-specific content.
