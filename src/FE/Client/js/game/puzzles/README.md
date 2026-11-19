# Interactive puzzle kinds

A case puzzle with `"type": "INTERACTIVE_PUZZLE"` and a `"kind"` is drawn by a frontend module and
checked by a backend kind. Each case carries its own parameters, so the same kind has different
answers in different cases.

```jsonc
{
  "puzzleId": "puzzle-hop-me-cung",
  "type": "INTERACTIVE_PUZZLE",
  "kind": "tilt_maze",
  "difficulty": "EASY",
  "targetId": "item-hop-me-cung",          // scene object that opens it
  "prompt": "Nghiêng hộp cho viên bi lăn vào ổ.",
  "params":   { /* public, may be partly authored; the rest is generated per case */ },
  "solution": { /* server only — usually generated; may hold "hints": ["…", "…"] */ },
  "reveal":   { "title": "…", "text": "…" },   // shown after solving
  "unlockClueIds": ["evidence-…"],
  "successMessage": "…", "failureMessage": "…"
}
```

## Backend — `src/BE/Services/PuzzleKinds/<Name>Kind.cs`

Implement `IPuzzleKind` (see `PuzzleKindContracts.cs`; `TiltMazeKind.cs` is the reference):

- `Kind` — the lowercase id, identical to the frontend module's `kind`.
- `Generate(ctx, rng)` — fill everything the author left out using **only** `rng` (deterministic per
  case + puzzle). Never overwrite authored values. Put the secret answer in `ctx.Solution`, two short
  Vietnamese hints in `ctx.Solution["hints"]`, and anything the player must see in `ctx.Params`.
  `ctx.Difficulty` is EASY / NORMAL / HARD — the first test case uses EASY.
- `Validate(ctx, error)` — authoring checks (ranges, solvability).
- `Check(ctx, answer, run)` — judge the submitted JSON answer. Return `PuzzleVerdict(solved, feedback,
  message)`. `feedback` is sent to the client (e.g. `{"firstWrong":6}`), never the solution.
- `Probe(ctx, input, run)` — only for kinds that need a mid-puzzle server query (balance-scale
  weighings, lockpick binding checks). `run.ProbesUsed` is incremented for you; keep your own counters
  in `run.Data`. Hints are handled generically (`{"$hint":true}`), do not implement them here.
- `RunView(ctx, run)` — optional public run values (e.g. weighings left) merged into the client run.

Kinds are discovered by reflection: no registry file to edit. Unit tests go in
`src/BE/Tests/PuzzleKind<Name>Tests.cs` (xunit style; run with the shim, see AGENT-ENV.md).

## Frontend — `src/FE/Client/js/game/puzzles/kinds/<kind>.ts`

Default-export a `PuzzleKindModule` (see `types.ts`). Files in `kinds/*.ts` are registered
automatically. Import your own CSS file next to it (`import './<kind>.css'`) and prefix every class,
keyframe and SVG id with a short unique prefix (e.g. `lp-` for the lockpick). Prefixes in use:
`pz-`, `s-`, `g-` (shared sheet, `css/42-puzzle-sheet.css`) and `tm-` (tilt maze).

`mount(body, ctx)` draws the puzzle body inside the shared sheet (header, hint note, footer status and
success stamp are drawn by `host.ts`). Rules:
- Read only `ctx.params` (public) and `ctx.run`; call `ctx.submit(answer)` for the final answer and
  `ctx.probe(payload)` for server queries. Show feedback with `ctx.setStatus(text, tone)`.
- Keep all state inside the module; the host never re-renders your body. `update(ctx)` is called when
  the shared run changes or the partner solved it (`ctx.solved`).
- `unmount()` must clear every timer, rAF and listener.
- Pointer + keyboard + touch (`touch-action: none` on drag surfaces), visible focus, `prefers-reduced-motion`
  (`ctx.reducedMotion`), and a layout that works at 390×844 as well as 1440×900.
- Vietnamese UI text with correct diacritics (use `ctx.tr(en, vi)` for bilingual strings).

## Lab

Run the API (Development) and Vite, then open `/puzzle-lab.html?kind=<kind>`: it generates a new
instance on the server (change the seed to see different answers), mounts your module in the real host
and sends answers/probes to the real server checks. Authored content for the lab (and later the case)
goes in `fixtures/<kind>.json` as `{ "title", "prompt", "params", "solution", "reveal" }`.
