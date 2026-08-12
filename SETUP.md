# SentinelOS — Setup Guide

Complete step-by-step instructions to run SentinelOS locally from a cold fork.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.10+ | |
| Node.js | 18+ | |
| npm | 9+ | |
| Git | Latest | |
| Docker | 24+ | Optional — for containerised setup |
| PostgreSQL | 14+ | Optional — SQLite used by default |

---

## 1. Clone the Repository

```bash
git clone https://github.com/Saicharan-077/Fire_Smoke_Application.git
cd Fire_Smoke_Application
```

---

## 2. YOLO Model Weights

The trained model file (`best.pt`, ~85 MB) is included directly in the repository
root. Copy it into the backend models directory:

```bash
# From the repo root
cp best.pt backend/models/best.pt
```

> **Windows:**
> ```powershell
> Copy-Item best.pt backend\models\best.pt
> ```

The model path is configurable via `YOLO_MODEL_PATH` in `.env` if you place it
elsewhere.

---

## 3. Backend Setup

### 3a. Create a Virtual Environment

```bash
cd backend
python -m venv .venv
```

**Activate it:**

```bash
# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

### 3b. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 3c. Configure Environment Variables

```bash
# In the backend/ directory
cp .env.example .env
```

Now open `backend/.env` and set the following. **Do not skip this step — the
defaults in `.env.example` are placeholders only.**

#### Optional (but important for first run)

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_INITIAL_PASSWORD` | _(auto-generated)_ | Password for the initial `admin@sentinelos.ai` account. If left empty, a secure random password is generated and printed **once** to the server log on first startup — read the log and change it immediately. |
| `POSTGRES_URL` | _(empty — uses SQLite)_ | PostgreSQL connection string. Leave empty to use the built-in SQLite database. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated list of allowed frontend origins. |
| `ENV` | `development` | Set to `production` to enable stricter security headers. |
| `SEED_DATABASE` | `true` | Seeds demo cameras and sample alert data on first startup. |
| `SEED_RESET_PASSWORDS` | `false` | Set to `true` to force-reset the admin password to `ADMIN_INITIAL_PASSWORD` on next startup. |
| `SESSION_DURATION_MINUTES` | `1440` | Session token lifetime (default: 24 hours). |
| `ALLOW_PUBLIC_REGISTRATION` | `true` | Allow unauthenticated users to self-register as viewers. Set to `false` in production. |
| `YOLO_MODEL_PATH` | `models/best.pt` | Path to the YOLO weights file, relative to `backend/`. |

> **No external API keys or third-party service credentials are required.**
> The application runs entirely locally.

### 3d. Database Initialisation

No manual migration step is needed. On first startup, SQLAlchemy automatically
creates all tables and the seeder populates demo data.

To start fresh (wipe all data):
```bash
# Delete the database file and restart the server
rm backend/sentinelos.db   # macOS / Linux
del backend\sentinelos.db  # Windows
```

### 3e. Run the Backend (Development)

```bash
# From backend/ with .venv activated
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`--reload` is correct for development — the server auto-restarts on Python file
changes. **Do not use `--reload` in production.**

**On first startup, check the logs.** If you did not set `ADMIN_INITIAL_PASSWORD`,
look for a block like this and save the password:

```
============================================================
  ADMIN INITIAL PASSWORD (one-time, change immediately):
  Email   : admin@sentinelos.ai
  Password: <generated-password>
============================================================
```

API docs will be available at: http://localhost:8000/docs

---

## 4. Frontend Setup

```bash
cd frontend     # from repo root
npm install
```

No `.env` file is required for the frontend in the default local configuration —
the API base URL defaults to `http://localhost:8000`.

### Run the Frontend (Development)

```bash
npm run dev
```

Open: http://localhost:5173

### Production Build

```bash
npm run build
npm run preview   # serves the built output locally for verification
```

---

## 5. First Login & Mandatory Security Steps

> [!CAUTION]
> **Do this before sharing access with anyone.**

1. Open http://localhost:5173/login
2. Log in with `admin@sentinelos.ai` and the password from Step 3e
3. **Immediately change the admin password:**
   - Go to **Settings → Account** (or Profile)
   - Set a strong, unique password that you haven't used elsewhere
4. If `ALLOW_PUBLIC_REGISTRATION=true`, consider setting it to `false` once your
   team accounts are created, to prevent unauthorised signups.

---

## 6. Verify the Installation

1. `GET http://localhost:8000/api/v1/health` → should return `{"status": "ok"}`
2. Log in at http://localhost:5173/login
3. Go to **Detection** → upload a test image → confirm bounding boxes render
4. Go to **Dashboard** → confirm KPI widgets populate

---

## 7. Docker Setup (Alternative)

> [!WARNING]
> **Experimental / Untested**
> This `docker-compose.yml` configuration is provided as a starting point but has not been fully verified for production use in this refactored architecture. Use at your own risk.

From the project root:

```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

---

## 8. Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for nginx, SSL, and full environment hardening.

**Minimum production checklist:**

- [ ] `SECRET_KEY` set to a unique random value (not the example)
- [ ] `ADMIN_INITIAL_PASSWORD` set (or password changed after first login)
- [ ] `ENV=production`
- [ ] `SEED_DATABASE=false` (after initial setup)
- [ ] `ALLOW_PUBLIC_REGISTRATION=false`
- [ ] `POSTGRES_URL` set (SQLite is not suitable for concurrent production load)
- [ ] `CORS_ORIGINS` set to your actual domain
- [ ] HTTPS via reverse proxy (nginx recommended)
