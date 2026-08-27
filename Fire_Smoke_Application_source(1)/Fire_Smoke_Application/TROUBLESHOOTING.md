# FireGuard AI — Troubleshooting

Common issues and solutions.

---

## Login Issues

### "Invalid username/email or password"
- Verify demo credentials from [DEMO.md](DEMO.md)
- Ensure backend is running and database is seeded (`SEED_DATABASE=true`)
- Delete `backend/fireguard.db` and restart to re-seed

### "Account is deactivated"
- Admin must reactivate the user via Admin Panel → Users → Activate

### Session expires immediately
- Check `SESSION_DURATION_MINUTES` in backend `.env`
- Clear browser localStorage and login again

### 401 on all API calls
- Token may be expired — logout and re-login
- Verify `VITE_API_BASE_URL` matches backend URL

---

## Camera Issues

### RTSP stream won't connect
- Verify stream URL format: `rtsp://user:pass@ip:554/stream`
- Test with VLC media player first
- Backend uses OpenCV `VideoCapture` — some codecs may not be supported
- Check firewall allows outbound RTSP from backend server

### Camera shows offline
- Update status via Settings → Cameras → Edit
- Check `last_seen` timestamp in database

### No camera preview in Live Monitoring
- RTSP live preview requires stream connectivity; placeholder shown if unavailable
- Webcam requires browser camera permission

---

## YOLO / Detection Issues

### "Model not ready" / inference fails
- Ensure `backend/models/best.pt` exists
- Check backend logs on startup for model loading errors
- Model must contain `fire` and/or `smoke` classes — COCO models are rejected

### No detections on valid fire/smoke images
- Lower confidence thresholds in Settings → AI
- Verify image format (JPG, PNG, BMP, WebP supported)
- Check backend logs for inference errors

### Slow video processing
- Large videos take time — frame-by-frame inference is CPU/GPU intensive
- Consider shorter clips for demo purposes
- Set `YOLO_DEVICE=cuda` if GPU available

---

## Database Issues

### "no such column" errors
- Restart backend — automatic schema migration adds new columns
- Or delete `fireguard.db` and re-seed

### Data not appearing
- Confirm `SEED_DATABASE=true` on first run
- Check API responses in browser DevTools Network tab

### PostgreSQL connection fails
- Verify `POSTGRES_URL` format: `postgresql://user:pass@host:5432/dbname`
- Ensure PostgreSQL is running and accessible

---

## Frontend Issues

### Blank page / white screen
- Check browser console for errors
- Run `npm run build` to verify TypeScript compilation
- Clear browser cache

### WebSocket not connecting
- Verify backend is running on correct port
- Check token is valid (re-login)
- CORS must allow frontend origin

### Forbidden page when accessing route
- Your role lacks permission — see RBAC in [MODULES.md](MODULES.md)
- Login with appropriate role (admin/operator/viewer)

---

## Deployment Issues

### CORS errors in production
- Set `CORS_ORIGINS` to your frontend domain
- Include both http and https if needed

### Static files 404
- Run `npm run build` before deploying frontend
- Configure nginx to serve `dist/` directory

### Docker container won't start
- Check `docker-compose logs backend` and `docker-compose logs frontend`
- Ensure port 8000 and 3000 are not in use

---

## Getting Help

1. Check backend logs: uvicorn console output
2. Check frontend: browser DevTools → Console + Network
3. Hit health endpoint: `GET /api/v1/health`
4. Review [API.md](API.md) for endpoint details
5. Review [SETUP.md](SETUP.md) for installation steps
