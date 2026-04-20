"""
설정 파일
- APP_DIR: 애플리케이션 디렉토리
- DATA_DIR: 데이터 디렉토리
- LATEST_FILE: 최신 텔레메트리 파일
- REQUIRED_FIELDS: 필수 필드
- LOGGER: 로거

server/settings.py
경로/상수/로거 설정 (DATA_DIR, LATEST_FILE, REQUIRED_FIELDS 등)
"""
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
