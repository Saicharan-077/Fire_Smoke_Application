# FireGuard AI - Weakness Report

## Technical Debt & Issues Identified

1. **Legacy Terminology**: Persistent references to "PPE", "Hardhat", and "Vest" throughout the codebase and UI, violating the new product identity.
2. **Code Duplication**: The presence of an entire nested `fireguard-ai/` directory containing exact clones of the root frontend and backend applications.
3. **State Management**: Frontend components rely on prop drilling and local state, making cross-component communication (e.g., updating a dashboard widget when a WebSocket event fires) fragile.
4. **Model Management**: The YOLO inference logic is not optimally isolated as a resilient service, which could lead to multiple loads of the `best.pt` weights and out-of-memory (OOM) errors on scaling.
5. **Database Robustness**: Using SQLite (`fireguard.db`) limits concurrency and is inappropriate for a production-ready application capturing real-time high-throughput video analytics.
6. **Hardcoded Configurations**: Hardcoded CORS origins and paths throughout the backend application.
7. **UI Consistency**: The existing UI utilizes basic styling and lacks the cohesive, premium SaaS design tokens required for modern commercial viability.
