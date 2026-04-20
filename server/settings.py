from __future__ import annotations

import logging
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
