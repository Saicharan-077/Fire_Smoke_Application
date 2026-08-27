# FireGuard AI - Migration Plan

## Objectives
Successfully migrate the entire codebase from a PPE Detection proof-of-concept to a production-ready Fire & Smoke Detection platform without losing functional integrity.

## Steps

### 1. Structural Consolidation
- Purge duplicate folders and unify the repository structure.
- Move React frontend to `/frontend`.
- Ensure FastAPI backend resides solely in `/backend`.

### 2. Product Identity Shift
- Execute global search-and-replace for "PPE", "hardhat", and "vest" terminology.
- Update routes, filenames, database schemas, and API documentation to reflect the new "FireGuard AI" identity.

### 3. Database Migration
- Introduce Alembic for SQLAlchemy.
- Create initial migration scripts to generate the `cameras`, `alerts`, and `detection_events` tables in PostgreSQL.
- Retire SQLite usage.

### 4. Infrastructure Orchestration
- Implement Docker Compose to unify the build and run processes for frontend, backend, and database components.
