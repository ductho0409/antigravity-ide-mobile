# SERVER (BACKEND) KNOWLEDGE BASE

**Generated:** 2026-03-10
**Commit:** 9a1efd5
**Branch:** main

## OVERVIEW
Active TypeScript Express backend handling API routes, WebSockets, and JSON-based local persistence.

## STRUCTURE
```
server/
├── src/routes/     # Modular API endpoints (factory pattern)
├── src/services/   # Business logic (CDP, Tunnel, AI Supervisor)
├── src/middleware/ # Express middleware (Auth, Localhost guard)
├── src/cdp/        # Chrome DevTools Protocol logic
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Route Definitions | `server/src/routes/` | Routes use a factory pattern for modularity |
| Business Logic | `server/src/services/` | Core operations and data handling |
| Data Storage | `server/src/config.ts` | Managed via flat JSON files (no ORM) |
| Security | `server/src/middleware/auth.ts` | Localhost-only middleware guard and auth |

## CONVENTIONS
- **Language**: Write all new code in TypeScript.
- **Routing**: Build routes using the established factory pattern (`createXRoutes(deps)`) in the `routes/` directory.
- **Persistence**: Read and write directly to JSON files for data persistence.
- **Security**: Apply the localhost middleware guard to all new admin/sensitive API endpoints.
- **Real-time**: Keep WebSocket event handlers close to their related service logic.

## ANTI-PATTERNS
- **Database**: Do not introduce an ORM or external database dependencies like Postgres or Mongo.
- **Language**: Avoid writing raw `.mjs` files. The project has moved fully to TypeScript.
- **Security**: Never expose sensitive endpoints publicly. They must remain locked to localhost or require PIN auth.
- **Routing**: Do not bypass the route factories when adding new API endpoints. Avoid global state.
