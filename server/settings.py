from __future__ import annotations

import logging
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
LATEST_FILE = DATA_DIR / "latest.json"

REQUIRED_FIELDS = {
    "robot_id",
    "line_id",
    "station_id",
    "cycle_time_ms",
    "power_watts",
    "program_name",
    "status",
}

LOGGER = logging.getLogger("catenax.server")

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:27b")
try:
    OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "120"))
except ValueError:
    OLLAMA_TIMEOUT = 120.0
