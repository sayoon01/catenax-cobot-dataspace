"""AAS field mapping: telemetry keys → idShort / semanticId (Catena-X / IDTA style)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

DEFAULT_SEMANTIC_MAP_PATH = Path(__file__).with_name("semantic_map.json")


def load_semantic_map(path: str | Path = DEFAULT_SEMANTIC_MAP_PATH) -> Dict[str, Dict[str, str]]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Semantic map must be a JSON object: {path}")
    return {
        str(key): {
            "idShort": str(value["idShort"]),
            "semanticId": str(value["semanticId"]),
        }
        for key, value in raw.items()
        if isinstance(value, dict) and "idShort" in value and "semanticId" in value
    }


SEMANTIC_MAP = load_semantic_map()


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

    def __init__(self, semantic_map: Dict[str, Dict[str, str]] | None = None):
        self.semantic_map = semantic_map or SEMANTIC_MAP

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

    def _iter_source_items(self, data: Dict[str, Any]) -> Iterable[Tuple[str, Any]]:
        for key, value in data.items():
            if key.startswith("_"):
                continue
            if isinstance(value, dict):
                yield from ((f"{key}_{sub_key}", sub_val) for sub_key, sub_val in value.items())
            else:
                yield key, value

    def _mapped_field(self, source_key: str, value: Any) -> MappedField:
        sem = self.semantic_map.get(source_key, {})
        return MappedField(
            source_key=source_key,
            id_short=sem.get("idShort", _to_camel(source_key)),
            semantic_id=sem.get("semanticId", f"custom:catenax:{source_key}"),
            value=json.dumps(value) if isinstance(value, list) else value,
            value_type=self._infer_type(value),
        )

    def map(self, data: Dict[str, Any]) -> List[MappedField]:
        return [self._mapped_field(key, value) for key, value in self._iter_source_items(data)]


__all__ = [
    "DEFAULT_SEMANTIC_MAP_PATH",
    "SEMANTIC_MAP",
    "MappedField",
    "TelemetryMapper",
    "load_semantic_map",
]
