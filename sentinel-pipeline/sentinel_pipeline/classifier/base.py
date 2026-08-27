"""
The Classifier plugin interface.

This is the seam the Classifier team builds against. The pipeline loads an
implementation in-process and calls ``classify_batch`` with numpy arrays passed
by reference -- no serialisation, no HTTP, no copying on the hot path.

To supply a real Classifier, implement this ABC and register it:

    from sentinel_pipeline.classifier.base import Classifier
    from sentinel_pipeline.pipeline import Pipeline

    class Tier1Tier2Classifier(Classifier):
        name = "tier1-tier2"
        def classify_batch(self, inputs): ...

    pipeline = Pipeline(classifier=Tier1Tier2Classifier())

The pipeline never inspects the implementation beyond this interface, so the
stub and the real classifier are interchangeable with no pipeline changes.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..contracts import ClassifierInput, ClassifierVerdict


class Classifier(ABC):
    """Stage 3. Turns raw Model candidates into confirmed, typed detections."""

    #: Human-readable identifier, surfaced by ``GET /v1/health``.
    name: str = "unnamed"

    #: Implementations that are not production classifiers must set this True.
    #: The pipeline logs a loud warning at startup and reports it on the health
    #: endpoint, so a stub can never be mistaken for the real thing in a
    #: deployed system.
    is_stub: bool = False

    @abstractmethod
    def classify_batch(
        self, inputs: list[ClassifierInput]
    ) -> list[ClassifierVerdict]:
        """Classify a batch of candidates from one frame.

        Contract:
          * Return one verdict per input, in ANY order -- verdicts are matched
            back by ``track_id``.
          * Returning fewer verdicts than inputs is allowed; omitted candidates
            are treated as a confident ``FALSE_POSITIVE`` and dropped.
          * A candidate is DROPPED only on a confident rejection:
            ``FALSE_POSITIVE`` **with** ``evidence_sufficient=True``.
          * If the phases that would decide a candidate lacked the data to do
            so -- too few frames for Flicker, no tracker match for Motion, a
            crop under the minimum pixel count for Colour/Texture -- set
            ``evidence_sufficient=False``. The pipeline then ESCALATES the
            candidate instead of rejecting it, honouring the Phase Reference's
            rule that "insufficient history/data" is distinct from "reject" and
            defaults to escalation. Supply a best-guess positive
            ``threat_class`` alongside it rather than ``FALSE_POSITIVE``.
          * List any phases that ran in log-only/advisory mode in
            ``advisory_phases``; they are recorded on the alert for audit and
            excluded from control flow.
          * Input arrays are shared and must be treated as read-only. Copy
            before modifying.
          * Must not raise on malformed input -- return a FALSE_POSITIVE verdict
            instead. An exception here fails the whole frame.
        """
        raise NotImplementedError

    def warmup(self) -> None:
        """Optional. Called once at pipeline startup."""
        return None

    def close(self) -> None:
        """Optional. Called at pipeline shutdown."""
        return None
