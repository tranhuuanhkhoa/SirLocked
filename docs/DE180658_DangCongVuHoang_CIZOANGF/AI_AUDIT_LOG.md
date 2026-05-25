# AI Audit Log - Dang Cong Vu Hoang

## 2026-05-25 - Week 1 Setup Audit

### Checked

- Scanned repository root, `src/BE`, `src/FE`, `README.md`, solution placeholder, and member docs.
- Checked existing FE app under `src/FE/src/App.jsx` and `src/FE/package.json`.
- Checked existing BE folders under `src/BE`; they were mostly empty `.gitkeep` placeholders.
- Read project alignment docs:
  - `docs/AI_ALIGNMENT_RULES.md`
  - `docs/FULLSTACK_FEATURE_PLAN.md`
- Used ASP.NET Core guidance for Web API, Program.cs pipeline, JWT auth, CORS, and SignalR setup.

### Findings

- `SirLocked.sln` was empty, so .NET build was impossible before setup.
- There was no real backend project, `Program.cs`, controller, service, repository, MongoDB config, or JWT auth.
- FE was a Vite React app but was still a static prototype with local screen state, no API integration, no AuthContext, and no protected/admin route.
- Existing old BE folder shape had placeholders, so the backend project was placed at `src/BE` to reuse the existing folders rather than deleting them.

### Fixed

- Created ASP.NET Core backend project using .NET 9.
- Added MongoDB settings and `IMongoClient` DI.
- Added JWT auth and role policies.
- Added password hashing using PBKDF2 from .NET cryptography APIs.
- Added user repository/service/controller separation.
- Added `UserStatusMiddleware` for locked account blocking.
- Added SignalR `GameHub` placeholder for Week 1.
- Reworked FE into React structure with API clients, AuthContext, route guards, and Week 1 pages.

### Verification

- Backend build passed with zero warnings and zero errors.
- Frontend build passed.
- Health endpoint returned a healthy response.

### Remaining Risks

- MongoDB must be running locally or configured via environment/Atlas before auth APIs can be fully tested.
- Register currently allows selecting `ADMIN` from FE for Week 1 demo convenience; production should restrict admin creation.
- No automated tests yet.
- SignalR hub is only a Week 1 placeholder and does not contain room ownership logic yet.
