"""
Severity scoring.

    severity = base_confidence x zone_risk_weight x growth_rate_factor
               - controlled_activity_discount

No AI inference. Everything here is a lookup or arithmetic on values earlier
stages already produced, which is what keeps this stage essentially free.
"""

from __future__ import annotations

from ..config import ContextSettings, settings as global_settings
from ..contracts import Severity, ThreatClass


def growth_rate(area_series: list[tuple[float, int]], window_s: float) -> float:
    """Fractional area change per second over the recent window.

    ``0.0`` means stable, ``0.5`` means growing by 50% of its own area per
    second, negative means shrinking. Returns 0.0 when there is not enough
    history to say -- an unknown growth rate must never inflate severity.
    """
    if len(area_series) < 2:
        return 0.0

    latest_ts = area_series[-1][0]
    window = [(ts, a) for ts, a in area_series if latest_ts - ts <= window_s]
    if len(window) < 2:
        window = area_series[-2:]

    t0, a0 = window[0]
    t1, a1 = window[-1]
    dt = t1 - t0
    if dt <= 0 or a0 <= 0:
        return 0.0

    return ((a1 - a0) / a0) / dt


def growth_factor(rate: float) -> float:
    """Map a growth rate to a severity multiplier.

    Shrinking or stable fires do not get de-escalated below 1.0 -- a fire that
    briefly appears to shrink (wind, occlusion) is still a fire. Only growth
    escalates.
    """
    if rate <= 0.0:
        return 1.0
    # Saturating: a very fast growth rate should not produce an unbounded score.
    return min(2.0, 1.0 + rate * 4.0)


class SeverityScorer:
    def __init__(self, cfg: ContextSettings | None = None):
        self._cfg = cfg or global_settings.context

    def band(self, score: float) -> Severity:
        c = self._cfg
        if score >= c.severity_critical:
            return Severity.CRITICAL
        if score >= c.severity_high:
            return Severity.HIGH
        if score >= c.severity_medium:
            return Severity.MEDIUM
        if score >= c.severity_low:
            return Severity.LOW
        return Severity.INFO

    def score(
        self,
        *,
        confidence: float,
        threat_class: ThreatClass,
        zone_risk_weight: float | None,
        rate: float,
        containment_breached: bool,
        envelope_exceeded: bool,
        is_controlled_activity: bool,
        flammable_nearby: bool,
    ) -> tuple[float, dict]:
        cfg = self._cfg

        # An uncalibrated camera has no risk weight. Use a middling default
        # rather than 0 -- a zero would zero out severity entirely and silence
        # every alert on an uncalibrated camera, which is the opposite of safe.
        effective_risk = 0.6 if zone_risk_weight is None else zone_risk_weight

        gf = growth_factor(rate)
        base = confidence * effective_risk * gf

        discount = 0.0
        if is_controlled_activity and not containment_breached and not envelope_exceeded:
            discount = cfg.controlled_activity_discount

        score = base - discount

        # Containment breach and envelope excess are escalations that apply
        # regardless of zone risk level -- a fire spreading outside its
        # boundary matters even in a low-risk zone.
        if containment_breached:
            score += 0.25
        if envelope_exceeded:
            score += 0.20
        if flammable_nearby and (containment_breached or envelope_exceeded):
            score += 0.15

        score = max(0.0, min(1.0, score))

        return score, {
            "confidence": round(confidence, 4),
            "effective_risk_weight": round(effective_risk, 3),
            "risk_weight_was_default": zone_risk_weight is None,
            "growth_rate_per_s": round(rate, 4),
            "growth_factor": round(gf, 3),
            "controlled_activity_discount": round(discount, 3),
            "containment_breached": containment_breached,
            "envelope_exceeded": envelope_exceeded,
            "flammable_nearby": flammable_nearby,
            "threat_class": threat_class.value,
            "final_score": round(score, 4),
        }
