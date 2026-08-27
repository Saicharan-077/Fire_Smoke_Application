# FireGuard AI — Setup Guide

Step-by-step instructions to run FireGuard AI locally or in production.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Python | 3.10 or higher |
| Node.js | 18 or higher |
| npm | 9+ |
| Git | Latest |
| (Optional) Docker | 24+ |
| (Optional) PostgreSQL | 14+ |

---

## 1. Clone the Repository

```bash
git clone <repository-url>
cd Fire_Smoke_Application
```

---

## 2. Backend Installation

### Create Virtual Environment

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Place YOLO Model Weights

Copy your trained `best.pt` weights to:

```
backend/models/best.pt
```

See `backend/models/README.md` for model requirements.

### Environment Variables

Copy the example env file:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SEED_DATABASE` | `true` | Seed demo users, cameras, alerts on startup |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed frontend origins |
| `SESSION_DURATION_MINUTES` | `1440` | Session token lifetime |
| `POSTGRES_URL` | _(empty)_ | PostgreSQL connection string (optional) |
| `ALLOW_PUBLIC_REGISTRATION` | `true` | Allow self-registration (creates viewer accounts) |

### Database Initialization

Tables are created automatically on first startup via SQLAlchemy. Schema migrations for new columns run automatically.

To reset with fresh seed data, delete `backend/fireguard.db` and restart with `SEED_DATABASE=true`.

### Run Backend

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs: http://localhost:8000/docs

---

## 3. Frontend Installation

```bash
cd frontend
npm install
cp src/config/.env.example .env
```

Set `VITE_API_BASE_URL=http://localhost:8000` in `.env`.

### Run Frontend (Development)

```bash
npm run dev
```

Open http://localhost:5173

### Production Build

```bash
npm run build
npm run preview
```

---

## 4. Docker Setup

From project root:

```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

---

## 5. Verify Installation

1. Visit http://localhost:8000/api/v1/health — should return `"status": "ok"`
2. Login at http://localhost:5173/login with demo credentials (see DEMO.md)
3. Upload a test image on the Detection page
4. Check Dashboard KPIs update

---

## 6. Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for nginx, SSL, and environment configuration.

Recommended production changes:
- Set `POSTGRES_URL` for PostgreSQL
- Set `SEED_DATABASE=false`
- Set `ALLOW_PUBLIC_REGISTRATION=false`
- Configure `CORS_ORIGINS` to your domain
- Use HTTPS reverse proxy (nginx)
