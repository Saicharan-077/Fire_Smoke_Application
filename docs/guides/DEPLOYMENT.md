# Deployment Guide — SentinelOS

This guide details how to deploy the SentinelOS platform in production environments using **Docker**, **Docker Compose**, and **Nginx**.

---

## Production Architecture

In a production deployment, the application is divided into three main service containers:
1. **Frontend**: The React bundle served via Nginx.
2. **Backend**: The FastAPI server running behind Uvicorn.
3. **Database**: SQLite (default for demo/standalone) or PostgreSQL (recommended for clustered operations).

```
   ┌─────────────────────────────────────────────────────────┐
   │                       Nginx (Port 80)                   │
   └────────────────────────────┬────────────────────────────┘
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
   ┌───────────────────────┐         ┌───────────────────────┐
   │  React Static Bundle  │         │  FastAPI Backend App  │
   │   (Vite Production)   │         │      (Port 8000)      │
   └───────────────────────┘         └───────────┬───────────┘
                                                 │
                                                 ▼
                                     ┌───────────────────────┐
                                     │    SQLite / Postgres  │
                                     └───────────────────────┘
```

---

## Docker Deployment (Compose)

The easiest way to launch the entire stack is using **Docker Compose**.

### 1. Configure Environment Variables
Create a `.env` file in the root directory:
```env
SECRET_KEY=production-secret-key-change-me
DATABASE_URL=sqlite:///./sentinelos.db
YOLO_MODEL_PATH=models/best.pt
CORS_ORIGINS=http://localhost
```

### 2. Build and Start Containers
Run the following command to build the Docker images and start the services in the background:
```bash
docker-compose up -d --build
```

### 3. Verify Container Status
Verify that all services are running:
```bash
docker-compose ps
```

---

## Nginx Configuration

Nginx acts as a reverse proxy, routing incoming client traffic to the React frontend or the FastAPI backend depending on the path.

Here is a sample `nginx.conf` file:
```nginx
server {
    listen 80;
    server_name localhost;

    # Static Frontend Assets
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API Reverse Proxy
    location /api/v1/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket Ingest
    location /ws/ {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
*Note: This configuration is already embedded in the default `Dockerfile` and `docker-compose.yml` configs.*
