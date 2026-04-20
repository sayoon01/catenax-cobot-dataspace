from __future__ import annotations

import copy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Dict, List, Mapping, Tuple

# Preprocessing responsibilities:
# - fill optional telemetry defaults used by later pipeline stages
# - normalise numeric counters, measurements, status, alarms, and timestamps
# - attach preprocessing metadata and expose the pipeline stage summary


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class PreprocessingResult:
    cleaned: Dict[str, Any]
    warnings: List[str]

    def stage_summary(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "warnings": self.warnings,
            "cleaned_fields": list(self.cleaned.keys()),
        }


class TelemetryPreprocessor:
    """Rule-based cleaning and normalisation of raw telemetry dicts."""

    REQUIRED_DEFAULTS: Dict[str, Any] = {
        "good_parts": 0,
        "reject_parts": 0,
        "alarms": [],
        "pose": {},
        "joint_positions_deg": {},
        "temperature_c": None,
        "vibration_mm_s": None,
    }

    VALID_STATUS = {"RUNNING", "IDLE", "ERROR", "MAINTENANCE", "STARTING", "STOPPING"}

    def preprocess(self, raw: Mapping[str, Any]) -> PreprocessingResult:
        data = dict(raw)
        warnings: List[str] = []

        for k, v in self.REQUIRED_DEFAULTS.items():
            if k not in data:
                data[k] = copy.deepcopy(v)
                warnings.append(f"Added default for missing field '{k}'")

        for field_name in ("cycle_time_ms", "power_watts"):
            try:
                data[field_name] = float(data[field_name])
            except (KeyError, TypeError, ValueError) as exc:
                warnings.append(f"Could not coerce '{field_name}' to float: {exc}")

        for field_name in ("temperature_c", "vibration_mm_s"):
            if data.get(field_name) is None:
                continue
            try:
                data[field_name] = float(data[field_name])
            except (TypeError, ValueError) as exc:
                data[field_name] = None
                warnings.append(f"Could not coerce '{field_name}' to float: {exc}")

        for field_name in ("good_parts", "reject_parts"):
            try:
                data[field_name] = int(data[field_name])
            except (TypeError, ValueError):
                data[field_name] = 0

        status = str(data.get("status", "")).upper().strip()
        if status not in self.VALID_STATUS:
            warnings.append(f"Unknown status '{status}' — normalised to 'IDLE'")
            status = "IDLE"
        data["status"] = status

        if data.get("cycle_time_ms", 0) < 0:
            warnings.append("cycle_time_ms was negative — clamped to 0")
            data["cycle_time_ms"] = 0.0

        if data.get("power_watts", 0) < 0:
            warnings.append("power_watts was negative — clamped to 0")
            data["power_watts"] = 0.0

        alarms = data.get("alarms", [])
        if not isinstance(alarms, list):
            data["alarms"] = [str(alarms)]
        else:
            data["alarms"] = [str(a) for a in alarms]

        for field_name in ("pose", "joint_positions_deg"):
            values = data.get(field_name, {})
            if not isinstance(values, Mapping):
                data[field_name] = {}
                warnings.append(f"'{field_name}' was not an object; normalised to empty object")
                continue
            normalised_values: Dict[str, float] = {}
            for key, value in values.items():
                try:
                    normalised_values[str(key)] = float(value)
                except (TypeError, ValueError) as exc:
                    warnings.append(f"Skipped '{field_name}.{key}' because it is not numeric: {exc}")
            data[field_name] = normalised_values

        if "produced_at" not in data:
            data["produced_at"] = _utc_now()
            warnings.append("Added 'produced_at' timestamp")

        data["_preprocessed_at"] = _utc_now()
        data["_warnings"] = warnings
        return PreprocessingResult(cleaned=data, warnings=warnings)

    def process(self, raw: Mapping[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
        result = self.preprocess(raw)
        return result.cleaned, result.warnings


def preprocess_telemetry(raw: Mapping[str, Any]) -> PreprocessingResult:
    return TelemetryPreprocessor().preprocess(raw)
