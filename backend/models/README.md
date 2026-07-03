# YOLO Model Weights

Place your custom-trained fire/smoke YOLOv8 weights here:

```
backend/models/best.pt
```

## Requirements

The model must detect **fire** and/or **smoke** classes. Generic COCO models (person, car, etc.) are rejected at startup.

## Configuration

Set the path via environment variable:

```
YOLO_MODEL_PATH=models/best.pt
```

## Without a Model

The API starts successfully without weights. Detection endpoints return HTTP 503 until `best.pt` is available. All other features (dashboard, alerts, auth, incidents) work normally.
