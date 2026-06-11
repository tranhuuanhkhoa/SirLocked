# Deployment And Operations

## Local Development

Required tools:

- .NET SDK compatible with the backend target framework.
- Node.js and npm for the Vite frontend and Phaser gameplay renderer.
- Docker Desktop or a local/cloud MongoDB instance.

Recommended local flow:

1. Start MongoDB with `docker compose up -d`.
2. Configure backend secrets with ASP.NET Core user secrets or environment variables.
3. Run backend from `src/BE`.
4. Run frontend from `src/FE`.
5. Seed/publish the sample case from admin tooling.
6. Test the two-player flow in two browsers or browser profiles.

## Configuration

Required:

- `MongoDb__ConnectionString`
- `MongoDb__DatabaseName`
- `Jwt__Secret`
- `Jwt__Issuer`
- `Jwt__Audience`

Optional:

- `AI__DeepseekApiKey`
- `AI__DeepseekModel`
- `AI__DeepseekTimeoutSeconds`
- `AI__GeminiApiKey`
- `AI__ChatGptApiKey`
- `Cloudinary__CloudName`
- `Cloudinary__ApiKey`
- `Cloudinary__ApiSecret`

If optional AI/image settings are missing, the app must still run and use mock/placeholder behavior.

## CI Checks

Minimum CI or pre-demo checks:

- Backend restore/build.
- Frontend install, TypeScript check, and build.
- Parse `ai-game-docs/samples/sample-case.json`.
- Backend case validator accepts the sample case.
- Backend case validator rejects duplicate IDs and missing references.
- No real secrets in committed config files.

Recommended later checks:

- Backend unit tests for case validation and gameplay state transitions.
- Integration tests for auth, room flow, gameplay APIs, and final accusation.
- Frontend lint/typecheck/build.
- Manual or Playwright two-browser smoke test for lobby/gameplay sync.

## Production Notes

MVP production can run as a single backend app plus static frontend hosting, backed by MongoDB.

Before public deployment:

- Enforce HTTPS.
- Rotate JWT secrets and provider keys.
- Lock CORS to known frontend origins.
- Move generated assets/files out of local repository folders.
- Add backups for MongoDB.
- Add structured logging and error monitoring.
- Add rate limits for auth and AI generation endpoints.
- Add SignalR backplane/Azure SignalR if multiple backend instances are used.

## Backup And Recovery

- Back up MongoDB collections: users, gameCases, gameRooms, gameResults, aiCaseDrafts.
- Treat published cases as important content; keep exported case JSON bundles for recovery.
- Invalid AI outputs can be kept for debugging but may be pruned after review.

## Demo Acceptance

A deployment/demo is acceptable when:

- Backend and frontend start from documented commands.
- Admin can seed and publish the sample case.
- Two players can join one room, select different roles, ready up, and start.
- Gameplay state survives browser refresh by refetching state.
- Final accusation produces a visible win/fail result.
