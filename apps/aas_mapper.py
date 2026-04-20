"""AAS field mapping: telemetry keys → idShort / semanticId (Catena-X / IDTA style)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List

# Catena-X / IDTA semantic IDs (representative examples)
SEMANTIC_MAP: Dict[str, Dict[str, str]] = {
    "robot_id": {"idShort": "RobotId", "semanticId": "0173-1#02-AAR196#001"},
    "line_id": {"idShort": "LineId", "semanticId": "0173-1#02-ABG568#001"},
    "station_id": {"idShort": "StationId", "semanticId": "0173-1#02-AAR501#003"},
    "cycle_time_ms": {"idShort": "CycleTimeMs", "semanticId": "0173-1#02-ABH990#001"},
    "power_watts": {"idShort": "PowerWatts", "semanticId": "0173-1#02-AAV232#002"},
    "program_name": {"idShort": "ProgramName", "semanticId": "0173-1#02-AAR503#001"},
    "status": {"idShort": "OperationalStatus", "semanticId": "0173-1#02-AAR504#001"},
    "good_parts": {"idShort": "GoodParts", "semanticId": "0173-1#02-AAV233#001"},
    "reject_parts": {"idShort": "RejectParts", "semanticId": "0173-1#02-AAV234#001"},
    "temperature_c": {"idShort": "TemperatureC", "semanticId": "0173-1#02-AAN457#002"},
    "vibration_mm_s": {"idShort": "VibrationMmPerSec", "semanticId": "0173-1#02-AAQ326#001"},
    "produced_at": {"idShort": "ProducedAt", "semanticId": "0173-1#02-AAQ564#001"},
    "stored_at": {"idShort": "StoredAt", "semanticId": "0173-1#02-AAQ565#001"},
}


def _to_camel(snake: str) -> str:
    parts = snake.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


@dataclass
class MappedField:
    source_key: str
    id_short: str
    semantic_id: str
    value: Any
    value_type: str


class TelemetryMapper:
    """Maps preprocessed telemetry dict into a list of AAS-ready MappedField objects."""

    @staticmethod
    def _infer_type(value: Any) -> str:
        if isinstance(value, bool):
            return "boolean"
        if isinstance(value, int):
            return "integer"
        if isinstance(value, float):
            return "double"
        if isinstance(value, list):
            return "string"  # serialise lists as JSON string
        return "string"

    def map(self, data: Dict[str, Any]) -> List[MappedField]:
        fields: List[MappedField] = []
        for key, value in data.items():
            if key.startswith("_"):
                continue  # skip internal metadata
            if isinstance(value, dict):
                for sub_key, sub_val in value.items():
                    composite_key = f"{key}_{sub_key}"
                    sem = SEMANTIC_MAP.get(composite_key, {})
                    fields.append(
                        MappedField(
                            source_key=composite_key,
                            id_short=sem.get("idShort", _to_camel(composite_key)),
                            semantic_id=sem.get("semanticId", f"custom:catenax:{composite_key}"),
                            value=sub_val,
                            value_type=self._infer_type(sub_val),
                        )
                    )
            else:
                sem = SEMANTIC_MAP.get(key, {})
                val = json.dumps(value) if isinstance(value, list) else value
                fields.append(
                    MappedField(
                        source_key=key,
                        id_short=sem.get("idShort", _to_camel(key)),
                        semantic_id=sem.get("semanticId", f"custom:catenax:{key}"),
                        value=val,
                        value_type=self._infer_type(value),
                    )
                )
        return fields


__all__ = ["SEMANTIC_MAP", "MappedField", "TelemetryMapper"]
