---
name: sirlocked-project
description: Work on the Sir Locked PRN232 project. Use when an AI agent needs to inspect, run, modify, audit, or explain this repository, especially the React/Vite frontend under src/FE and the per-member AI audit documentation under docs.
---

# Sir Locked Project

## Repository Shape

- Treat `src/FE` as the React/Vite frontend app currently present in the repository.
- Treat `SirLocked.sln`, `README.md`, and `docker-compose.yml` as placeholders until they contain real project content.
- Treat `docs/<student-id>_<name>_<github>/` as per-member audit evidence folders. Preserve each member's `AI_AUDIT_LOG.md`, `CHANGELOG.md`, `PROMPTS.md`, and `REFLECTION.md` unless the task explicitly targets them.
- Before implementing roadmap, architecture, API, realtime, admin, AI generation, or gameplay work, read and follow `docs/AI_ALIGNMENT_RULES.md`. For team planning and ownership, also read `docs/FULLSTACK_FEATURE_PLAN.md`; it is the source of truth for assigning each member a full-stack feature instead of a BE-only or FE-only role.

## Run The Frontend

The frontend is a React app built with Vite. Do not open `src/FE/main.html` directly with `file://`.

From the repository root:

```powershell
Set-Location src\FE
npm install
npm run dev
```

Open the localhost URL printed by Vite, usually `http://127.0.0.1:5173/`.

## Frontend Editing Notes

- `src/FE/index.html` and `src/FE/main.html` are Vite entry HTML files that mount React at `#root`.
- `src/FE/src/main.jsx` imports the existing numbered CSS files in order and renders `App`.
- `src/FE/src/App.jsx` owns screen navigation, auth tabs, room settings, join code input, and options state.
- Keep screen IDs aligned with the `screens` array in `App.jsx` and section IDs like `s-auth`, `s-play`, `s-create`, `s-join`, and `s-options`.
- When changing styles, prefer editing the closest numbered CSS file for that feature instead of adding unrelated global rules.

## Validation

Before reporting completion after frontend changes:

1. Run `npm run dev` from `src/FE`.
2. Visit the Vite dev URL.
3. Check that React renders without console errors.
4. Exercise desktop tabs and the mobile menu if navigation behavior changed.

For repository-wide checks, first inspect whether real .NET, Docker, or test configuration files have been added. Do not claim `dotnet build`, Docker, or automated tests are supported while the current placeholder files remain empty.
