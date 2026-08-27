"""
Gate Step 3 — IDLE/ACTIVE state machine with hysteresis.

Higher bar to enter ACTIVE than to leave it, plus a consecutive-frame
confirmation on each transition. Both mechanisms exist to stop a score sitting
right on the threshold from flapping the state every frame.

Pure logic, no OpenCV, no I/O — unit testable against synthetic score sequences.
"""

from __future__ import annotations

from enum import Enum


class GateState(str, Enum):
    IDLE = "IDLE"
    ACTIVE = "ACTIVE"


class HysteresisStateMachine:
    """Consumes a stream of change scores, produces a stable IDLE/ACTIVE state."""

    __slots__ = (
        "_enter_threshold",
        "_exit_threshold",
        "_enter_confirm",
        "_exit_confirm",
        "_state",
        "_above_streak",
        "_below_streak",
        "_transitions",
    )

    def __init__(
        self,
        enter_threshold: float,
        exit_threshold: float,
        enter_confirm_frames: int = 2,
        exit_confirm_frames: int = 5,
    ):
        if exit_threshold > enter_threshold:
            raise ValueError(
                f"exit_threshold ({exit_threshold}) must be <= enter_threshold "
                f"({enter_threshold}) or the hysteresis gap is inverted"
            )
        self._enter_threshold = enter_threshold
        self._exit_threshold = exit_threshold
        self._enter_confirm = max(1, enter_confirm_frames)
        self._exit_confirm = max(1, exit_confirm_frames)

        self._state = GateState.IDLE
        self._above_streak = 0
        self._below_streak = 0
        self._transitions = 0

    @property
    def state(self) -> GateState:
        return self._state

    @property
    def is_active(self) -> bool:
        return self._state is GateState.ACTIVE

    @property
    def transition_count(self) -> int:
        """How many times state has flipped. A flapping gate shows here."""
        return self._transitions

    def update(self, score: float, enter_threshold: float | None = None) -> GateState:
        """Feed one change score, return the resulting state.

        ``enter_threshold`` may be overridden per call so the adaptive
        per-camera threshold can be applied without rebuilding the machine.
        The exit threshold is scaled to preserve the configured hysteresis gap.
        """
        enter = self._enter_threshold if enter_threshold is None else enter_threshold
        if enter_threshold is None:
            exit_t = self._exit_threshold
        else:
            ratio = (
                self._exit_threshold / self._enter_threshold
                if self._enter_threshold > 0
                else 0.5
            )
            exit_t = enter_threshold * ratio

        if self._state is GateState.IDLE:
            if score >= enter:
                self._above_streak += 1
                self._below_streak = 0
                if self._above_streak >= self._enter_confirm:
                    self._state = GateState.ACTIVE
                    self._transitions += 1
                    self._above_streak = 0
            else:
                self._above_streak = 0
        else:  # ACTIVE
            if score < exit_t:
                self._below_streak += 1
                self._above_streak = 0
                if self._below_streak >= self._exit_confirm:
                    self._state = GateState.IDLE
                    self._transitions += 1
                    self._below_streak = 0
            else:
                self._below_streak = 0

        return self._state

    def reset(self) -> None:
        self._state = GateState.IDLE
        self._above_streak = 0
        self._below_streak = 0
