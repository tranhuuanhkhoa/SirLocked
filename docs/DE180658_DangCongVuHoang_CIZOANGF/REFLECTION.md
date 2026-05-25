# Reflection - Dang Cong Vu Hoang

## 2026-05-25 - Week 1

### What Was Completed

- Set up a real .NET Web API backend for SirLocked.
- Added MongoDB configuration, JWT authentication, role authorization, password hashing, user model, repositories, services, controllers, and locked-user middleware.
- Added a Week 1 SignalR hub placeholder.
- Converted the React frontend from a static prototype into a routed app with AuthContext, API clients, ProtectedRoute, RoleRoute, login, register, dashboard, and admin user page.
- Verified backend build, frontend build, and health endpoint.

### Difficulties

- The repository had an empty solution file and mostly placeholder backend folders, so the backend project had to be created from scratch while preserving existing folders.
- Running ASP.NET Core inside the sandbox initially failed because Windows EventLog/DataProtection logging tried to write outside allowed paths. This was fixed by switching logging to console providers.
- Auth endpoints could not be fully exercised without MongoDB running.

### Recommended Week 2 Work

- Start MongoDB locally or configure MongoDB Atlas.
- Seed at least one admin user safely.
- Test register/login/me/admin users end-to-end against MongoDB.
- Tighten admin creation so normal public registration cannot create `ADMIN` users.
- Begin Case System base work from the full-stack feature plan.
