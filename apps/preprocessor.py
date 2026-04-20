from __future__ import annotations

# Raw telemetry JSON을 AAS/EDC 파이프라인에서 바로 사용할 수 있는 표준 dict로 정리한다.
# 주요 처리:
# - camelCase 입력 필드를 snake_case 표준 필드명으로 변환한다.
# - 초/킬로와트/화씨/미터 단위 입력을 ms/W/섭씨/mm 단위로 변환한다.
# - 필수 필드가 없을 때 기본값을 채우거나, strict 모드에서는 즉시 실패시킨다.
# - 문자열, 숫자, status, alarms, pose, joint position, produced_at timestamp를 정규화한다.
# - 전처리 warning, _preprocessed_at, pipeline stage summary를 생성한다.

import copy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable, Dict, List, Mapping, Tuple


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

    REQUIRED_FIELDS = (
        "robot_id",
        "line_id",
        "station_id",
        "program_name",
        "cycle_time_ms",
        "power_watts",
        "status",
    )

    FIELD_DEFAULTS: Dict[str, Any] = {
        "robot_id": "UNKNOWN_ROBOT",
        "line_id": "UNKNOWN_LINE",
        "station_id": "UNKNOWN_STATION",
        "program_name": "UNKNOWN_PROGRAM",
        "cycle_time_ms": 0.0,
        "power_watts": 0.0,
        "status": "IDLE",
        "good_parts": 0,
        "reject_parts": 0,
        "alarms": [],
        "pose": {},
        "joint_positions_deg": {},
        "temperature_c": None,
        "vibration_mm_s": None,
    }

    VALID_STATUS = {"RUNNING", "IDLE", "ERROR", "MAINTENANCE", "STARTING", "STOPPING"}
    STRING_FIELDS = ("robot_id", "line_id", "station_id", "program_name")
    FLOAT_FIELDS = ("cycle_time_ms", "power_watts", "temperature_c", "vibration_mm_s")
    INT_FIELDS = ("good_parts", "reject_parts")
    NON_NEGATIVE_FLOAT_FIELDS = ("cycle_time_ms", "power_watts")
    NUMERIC_MAP_FIELDS = ("pose", "joint_positions_deg")

    FIELD_ALIASES = {
        "robotId": "robot_id",
        "lineId": "line_id",
        "stationId": "station_id",
        "programName": "program_name",
        "cycleTimeMs": "cycle_time_ms",
        "powerWatts": "power_watts",
        "goodParts": "good_parts",
        "rejectParts": "reject_parts",
        "temperatureC": "temperature_c",
        "vibrationMmPerSec": "vibration_mm_s",
        "producedAt": "produced_at",
    }

    UNIT_ALIASES: Dict[str, Tuple[str, Callable[[Any], float]]] = {
        "cycle_time_s": ("cycle_time_ms", lambda value: float(value) * 1000.0),
        "power_kw": ("power_watts", lambda value: float(value) * 1000.0),
        "temperature_f": ("temperature_c", lambda value: (float(value) - 32.0) * 5.0 / 9.0),
        "vibration_m_s": ("vibration_mm_s", lambda value: float(value) * 1000.0),
    }

    def __init__(self, strict: bool = False):
        self.strict = strict

    def preprocess(self, raw: Mapping[str, Any]) -> PreprocessingResult:
        data = dict(raw)
        warnings: List[str] = []

        self._normalise_aliases(data, warnings)
        self._normalise_units(data, warnings)
        self._validate_required(data)
        self._apply_defaults(data, warnings)
        self._normalise_strings(data)
        self._normalise_numbers(data, warnings)
        self._normalise_status(data, warnings)
        self._normalise_alarms(data)
        self._normalise_numeric_maps(data, warnings)
        self._normalise_timestamp(data, warnings)

        data["_preprocessed_at"] = _utc_now()
        data["_warnings"] = warnings
        return PreprocessingResult(cleaned=data, warnings=warnings)

    def process(self, raw: Mapping[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
        result = self.preprocess(raw)
        return result.cleaned, result.warnings

    def _normalise_aliases(self, data: Dict[str, Any], warnings: List[str]) -> None:
        for source, target in self.FIELD_ALIASES.items():
            if source not in data:
                continue
            value = data.pop(source)
            if target not in data:
                data[target] = value
                warnings.append(f"Mapped alias '{source}' to '{target}'")
            else:
                warnings.append(f"Ignored alias '{source}' because '{target}' is already present")

    def _normalise_units(self, data: Dict[str, Any], warnings: List[str]) -> None:
        for source, (target, converter) in self.UNIT_ALIASES.items():
            if source not in data:
                continue
            value = data.pop(source)
            if target in data:
                warnings.append(f"Ignored unit alias '{source}' because '{target}' is already present")
                continue
            try:
                data[target] = converter(value)
                warnings.append(f"Converted '{source}' to '{target}'")
            except (TypeError, ValueError) as exc:
                warnings.append(f"Could not convert '{source}' to '{target}': {exc}")

    def _validate_required(self, data: Mapping[str, Any]) -> None:
        if not self.strict:
            return
        missing = [
            field_name
            for field_name in self.REQUIRED_FIELDS
            if field_name not in data or data[field_name] in (None, "")
        ]
        if missing:
            raise ValueError(f"Missing required telemetry fields: {', '.join(missing)}")

    def _apply_defaults(self, data: Dict[str, Any], warnings: List[str]) -> None:
        for field_name, default in self.FIELD_DEFAULTS.items():
            if field_name not in data or data[field_name] is None:
                data[field_name] = copy.deepcopy(default)
                warnings.append(f"Added default for missing field '{field_name}'")

    def _normalise_strings(self, data: Dict[str, Any]) -> None:
        for field_name in self.STRING_FIELDS:
            data[field_name] = str(data[field_name]).strip() or self.FIELD_DEFAULTS[field_name]

    def _normalise_numbers(self, data: Dict[str, Any], warnings: List[str]) -> None:
        for field_name in self.FLOAT_FIELDS:
            data[field_name] = self._coerce_float(field_name, data[field_name], warnings)
        for field_name in self.INT_FIELDS:
            data[field_name] = self._coerce_int(field_name, data[field_name], warnings)
        for field_name in self.NON_NEGATIVE_FLOAT_FIELDS:
            if data[field_name] < 0:
                warnings.append(f"{field_name} was negative; clamped to 0")
                data[field_name] = 0.0

    def _normalise_status(self, data: Dict[str, Any], warnings: List[str]) -> None:
        status = str(data["status"]).upper().strip()
        if status not in self.VALID_STATUS:
            warnings.append(f"Unknown status '{status}'; normalised to 'IDLE'")
            status = "IDLE"
        data["status"] = status

    def _normalise_alarms(self, data: Dict[str, Any]) -> None:
        alarms = data["alarms"]
        data["alarms"] = [str(a) for a in alarms] if isinstance(alarms, list) else [str(alarms)]

    def _normalise_numeric_maps(self, data: Dict[str, Any], warnings: List[str]) -> None:
        for field_name in self.NUMERIC_MAP_FIELDS:
            values = data[field_name]
            if not isinstance(values, Mapping):
                data[field_name] = {}
                warnings.append(f"'{field_name}' was not an object; normalised to empty object")
                continue
            data[field_name] = {
                str(key): converted
                for key, value in values.items()
                if (converted := self._try_float(f"{field_name}.{key}", value, warnings)) is not None
            }

    def _normalise_timestamp(self, data: Dict[str, Any], warnings: List[str]) -> None:
        if "produced_at" not in data or not str(data["produced_at"]).strip():
            data["produced_at"] = _utc_now()
            warnings.append("Added 'produced_at' timestamp")
            return
        raw_timestamp = str(data["produced_at"]).strip()
        try:
            parsed = datetime.fromisoformat(raw_timestamp.replace("Z", "+00:00"))
        except ValueError:
            data["produced_at"] = _utc_now()
            warnings.append("Invalid 'produced_at' timestamp; replaced with current UTC timestamp")
            return
        data["produced_at"] = parsed.isoformat()

    def _coerce_float(self, field_name: str, value: Any, warnings: List[str]) -> float | None:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            fallback = self.FIELD_DEFAULTS[field_name]
            warnings.append(f"Could not coerce '{field_name}' to float: {exc}; using {fallback!r}")
            return fallback

    def _coerce_int(self, field_name: str, value: Any, warnings: List[str]) -> int:
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            fallback = self.FIELD_DEFAULTS[field_name]
            warnings.append(f"Could not coerce '{field_name}' to int: {exc}; using {fallback!r}")
            return fallback

    def _try_float(self, field_name: str, value: Any, warnings: List[str]) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            warnings.append(f"Skipped '{field_name}' because it is not numeric: {exc}")
            return None


def preprocess_telemetry(raw: Mapping[str, Any]) -> PreprocessingResult:
    return TelemetryPreprocessor().preprocess(raw)
