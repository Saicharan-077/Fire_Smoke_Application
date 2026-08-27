# Test fixtures

Real fire/smoke frames used by the pipeline tests. These exist because several
tests need the ACTUAL model to produce candidates — a synthetic orange
rectangle is not detected, so a test built on one silently exercises nothing.

Source: `black smoke.yolov8` (Roboflow, CC BY 4.0). A 14-image subset of the
`test/` split, kept in-repo so test runs are reproducible without external
paths.

These are used as detector INPUT only. They are not a labelled benchmark —
the source dataset's `data.yaml` class names are malformed, and overlap with
`best.pt`'s training data cannot be ruled out.
