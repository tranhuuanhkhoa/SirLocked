# SirLocked Project Brief

Last synced with code: 2026-06-14.

## Product Goal

SirLocked is a runnable two-player cooperative detective game MVP. A structured case JSON document drives the playable investigation: rooms, roles, scenes, hotspots, dialogue locks, clue discovery, progression, and final accusation are enforced by the backend.

The project is intentionally demo-oriented. The priority is a reliable end-to-end loop rather than a large content-management platform.

## Current Stack

| Area | Current implementation |
| --- | --- |
| Backend | ASP.NET Core Web API on .NET 9, controllers, JWT auth, SignalR |
| Database | MongoDB via `MongoDB.Driver` |
| Frontend | Vite SPA, JavaScript hash routes, TypeScript/Phaser gameplay renderer |
| Realtime | SignalR hub at `/hubs/game` |
| AI case generation | OpenAI-only story preview approval, then full case generation and automatic publish |
| Tests | xUnit backend tests and Python API smoke test |

## User Roles

- `PLAYER`: public registration role. Can browse published cases, create/join rooms, play games.
- `VIP`: can create AI story previews, approve them, and publish the generated case from the AI flow.
- `ADMIN`: seeded on startup when no admin exists. Can manage users, validate/import/publish cases, seed demo data, and manage AI drafts.

Default admin:

- Email: `admin@sirlocked.local`
- Password: `Admin123!`

## MVP Scope Implemented

- JWT register/login/me/logout.
- User locking/unlocking and role change by admin.
- Published case list and public case detail.
- Admin case list/detail/validate/import/publish/unpublish.
- Seed sample and demo cases.
- Two-player rooms with six-character room codes.
- Required unique player roles: `INVESTIGATOR` and `INTERROGATOR`.
- Host-only start after both players choose roles and ready up.
- Gameplay state embedded in `gameRooms.gameplayState`.
- Investigator-only item inspection.
- Interrogator-only dialogue asking.
- Clue unlocks from items and dialogues.
- Hotspot/dialogue locks by required clue IDs.
- Scene/stage progression by case stage order and scene array order.
- Revisit previously visited scenes through `go-to-scene`.
- Final accusation with win/fail result.
- SignalR lobby/gameplay events plus player pose broadcast.
- OpenAI story preview approval, full case generation, image/runtime generation, validation, export bundle, import, and publish.

## Out Of Scope For Current Code

- Payments, leaderboards, ratings, replay history.
- More than two active players.
- A full browser case editor.
- Room chat persistence.
- Cloudinary upload.
- Separate gameplay-state collection.
- Server-side asset upload pipeline.

## Core Gameplay Loop

1. User logs in.
2. User opens published cases.
3. Host creates a room from a published case.
4. Second player joins by room code.
5. Players select different roles and ready up.
6. Host starts the game.
7. Backend initializes the first stage and first scene.
8. Investigator inspects item hotspots.
9. Interrogator asks unlocked dialogue.
10. Backend unlocks clues and broadcasts state changes.
11. Players complete scenes until the final scene.
12. Final accusation opens only when all required evidence clues are unlocked.
13. Backend saves a win/fail `gameResult`.

## Architectural Principle

The frontend renders and sends commands. The backend is authoritative for room membership, roles, unlocks, progression, and accusation results.
