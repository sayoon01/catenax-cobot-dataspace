"""
텔레메트리 저장
- utc_now: 현재 시간 반환
- ensure_data_dir: 데이터 디렉토리 생성
- validate_telemetry: 텔레메트리 유효성 검사
- _sanitize_timestamp: 타임스탬프 정리
- store_telemetry: 텔레메트리 저장
- read_latest: 최신 텔레메트리 읽기
- _collect_json_files: JSON 파일 수집
- read_recent: 최근 텔레메트리 읽기
- read_all: 모든 텔레메트리 읽기

server/telemetry_store.py
검증/저장/조회 로직 (validate_telemetry, store_telemetry, read_*)
"""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

from settings import APP_DIR, DATA_DIR, LATEST_FILE, LOGGER, REQUIRED_FIELDS

STORE_LOCK = Lock()


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def validate_telemetry(payload: Dict[str, Any]) -> List[str]:
    missing = sorted(f for f in REQUIRED_FIELDS if f not in payload)
    if missing:
        return [f"Missing required fields: {', '.join(missing)}"]

    errors: List[str] = []
    for field in ("cycle_time_ms", "power_watts"):
        try:
            float(payload[field])
        except (TypeError, ValueError):
            errors.append(f"Field '{field}' must be numeric")

    for field in ("robot_id", "line_id", "station_id", "program_name", "status"):
        if not str(payload.get(field, "")).strip():
            errors.append(f"Field '{field}' must not be empty")

    return errors


def _sanitize_timestamp(value: str) -> str:
    return value.replace(":", "-").replace(".", "-")


def store_telemetry(payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_data_dir()
    stored_at = utc_now()
    event = dict(payload)
    event["stored_at"] = stored_at

    day_dir = DATA_DIR / datetime.now(UTC).strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    filename = (
        f"{_sanitize_timestamp(stored_at)}"
        f"_{str(event['robot_id']).replace('/', '_')}.json"
    )
    file_path = day_dir / filename

    with STORE_LOCK:
        file_path.write_text(
            json.dumps(event, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        LATEST_FILE.write_text(
            json.dumps(event, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    LOGGER.info("Stored telemetry robot_id=%s file=%s", event["robot_id"], file_path.name)
    return {
        "status": "stored",
        "stored_at": stored_at,
        "file": str(file_path.relative_to(APP_DIR)),
        "telemetry": event,
    }


def read_latest() -> Dict[str, Any] | None:
    if not LATEST_FILE.exists():
        return None
    return json.loads(LATEST_FILE.read_text(encoding="utf-8"))


def _collect_json_files() -> List[Path]:
    return sorted(
        list(DATA_DIR.glob("*/*.json")) + [
            p for p in DATA_DIR.glob("*.json") if p.name != "latest.json"
        ],
        reverse=True,
    )


def read_recent(limit: int) -> List[Dict[str, Any]]:
    ensure_data_dir()
    results: List[Dict[str, Any]] = []
    for path in _collect_json_files()[:limit]:
        try:
            parsed = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict):
                        results.append(item)
            elif isinstance(parsed, dict):
                results.append(parsed)
        except (json.JSONDecodeError, OSError):
            continue
    return results


def read_all() -> List[Dict[str, Any]]:
    return read_recent(limit=10000)


# --- KPI / timeseries (file-backed scan; cap files for safety) ---
MAX_FILES_FOR_QUERY = 30000
THRESHOLD_TEMP_C = 75.0
THRESHOLD_VIBE_MM_S = 5.0
THRESHOLD_REJECT_RATIO = 0.02

WINDOW_SPECS: Dict[str, timedelta] = {
    "15m": timedelta(minutes=15),
    "1h": timedelta(hours=1),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
}

BUCKET_SPECS: Dict[str, timedelta] = {
    "1m": timedelta(minutes=1),
    "5m": timedelta(minutes=5),
    "15m": timedelta(minutes=15),
    "1h": timedelta(hours=1),
}


def parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except (ValueError, TypeError):
        return None


def event_time_utc(ev: Dict[str, Any]) -> Optional[datetime]:
    return parse_iso_datetime(ev.get("stored_at")) or parse_iso_datetime(ev.get("produced_at"))


def parse_window_spec(spec: str) -> timedelta:
    key = (spec or "").strip().lower()
    if key not in WINDOW_SPECS:
        raise ValueError(f"unknown window '{spec}'; allowed: {', '.join(sorted(WINDOW_SPECS))}")
    return WINDOW_SPECS[key]


def parse_bucket_spec(spec: str) -> timedelta:
    key = (spec or "").strip().lower()
    if key not in BUCKET_SPECS:
        raise ValueError(f"unknown bucket '{spec}'; allowed: {', '.join(sorted(BUCKET_SPECS))}")
    return BUCKET_SPECS[key]


def _load_events_from_files(max_files: int) -> List[Dict[str, Any]]:
    ensure_data_dir()
    out: List[Dict[str, Any]] = []
    for path in _collect_json_files()[:max_files]:
        try:
            parsed = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict):
                        out.append(item)
            elif isinstance(parsed, dict):
                out.append(parsed)
        except (json.JSONDecodeError, OSError):
            continue
    return out


def events_in_range(since: datetime, until: datetime, max_files: int = MAX_FILES_FOR_QUERY) -> List[Dict[str, Any]]:
    if since.tzinfo is None:
        since = since.replace(tzinfo=UTC)
    if until.tzinfo is None:
        until = until.replace(tzinfo=UTC)
    since = since.astimezone(UTC)
    until = until.astimezone(UTC)
    if until < since:
        return []

    loaded = _load_events_from_files(max_files)
    matched: List[Dict[str, Any]] = []
    for ev in loaded:
        ts = event_time_utc(ev)
        if ts is None:
            continue
        if since <= ts <= until:
            matched.append(ev)
    return matched


def latest_by_robot(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    best: Dict[str, Tuple[datetime, Dict[str, Any]]] = {}
    for ev in events:
        ts = event_time_utc(ev)
        if ts is None:
            continue
        rid = str(ev.get("robot_id") or "unknown").strip() or "unknown"
        prev = best.get(rid)
        if prev is None or ts >= prev[0]:
            best[rid] = (ts, ev)
    return [pair[1] for pair in best.values()]


def _to_float(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _reject_ratio(ev: Dict[str, Any]) -> float:
    good = _to_float(ev.get("good_parts"), 0.0)
    reject = _to_float(ev.get("reject_parts"), 0.0)
    total = good + reject
    return (reject / total) if total > 0 else 0.0


def robot_has_alert(ev: Dict[str, Any]) -> bool:
    st = str(ev.get("status") or "").upper()
    if st in ("ERROR", "FAULT", "WARNING"):
        return True
    t = _to_float(ev.get("temperature_c"), float("nan"))
    if t == t and t > THRESHOLD_TEMP_C:
        return True
    v = _to_float(ev.get("vibration_mm_s"), float("nan"))
    if v == v and v > THRESHOLD_VIBE_MM_S:
        return True
    if _reject_ratio(ev) > THRESHOLD_REJECT_RATIO:
        return True
    alarms = ev.get("alarms")
    if isinstance(alarms, list) and len(alarms) > 0:
        return True
    return False


def aggregate_kpi_for_window(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    latest = latest_by_robot(events)
    event_count = len(events)
    robot_count = len(latest)

    sum_temp = 0.0
    n_temp = 0
    sum_power = 0.0
    n_power = 0
    good_sum = 0.0
    reject_sum = 0.0
    running = 0
    alerts = 0

    for ev in latest:
        tc = _to_float(ev.get("temperature_c"), float("nan"))
        if tc == tc:
            sum_temp += tc
            n_temp += 1
        pw = _to_float(ev.get("power_watts"), float("nan"))
        if pw == pw:
            sum_power += pw
            n_power += 1
        good_sum += _to_float(ev.get("good_parts"), 0.0)
        reject_sum += _to_float(ev.get("reject_parts"), 0.0)
        if str(ev.get("status") or "").upper() == "RUNNING":
            running += 1
        if robot_has_alert(ev):
            alerts += 1

    return {
        "event_count": event_count,
        "robot_count": robot_count,
        "avg_temperature_c": round(sum_temp / n_temp, 3) if n_temp else 0.0,
        "avg_power_watts": round(sum_power / n_power, 3) if n_power else 0.0,
        "good_parts_sum": int(good_sum),
        "reject_parts_sum": int(reject_sum),
        "running_count": running,
        "alerts_count": alerts,
    }


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def kpi_summary(window_spec: str, compare_previous: bool) -> Dict[str, Any]:
    window_td = parse_window_spec(window_spec)
    now = datetime.now(UTC)
    cur_from = now - window_td
    cur_until = now

    events_cur = events_in_range(cur_from, cur_until)
    current = aggregate_kpi_for_window(events_cur)

    out: Dict[str, Any] = {
        "window": {
            "label": window_spec.strip().lower(),
            "from": _iso(cur_from),
            "to": _iso(cur_until),
        },
        "current": current,
    }

    if compare_previous:
        prev_until = cur_from
        prev_from = cur_from - window_td
        events_prev = events_in_range(prev_from, prev_until)
        previous = aggregate_kpi_for_window(events_prev)
        out["previous"] = previous
        out["previous_window"] = {
            "from": _iso(prev_from),
            "to": _iso(prev_until),
        }
        delta: Dict[str, Any] = {}
        for key in (
            "event_count",
            "robot_count",
            "avg_temperature_c",
            "avg_power_watts",
            "good_parts_sum",
            "reject_parts_sum",
            "running_count",
            "alerts_count",
        ):
            delta[key] = round(float(current[key]) - float(previous[key]), 3)
        out["delta"] = delta

    return out


def timeseries_buckets(
    from_dt: datetime,
    to_dt: datetime,
    bucket_spec: str,
    robot_id: Optional[str] = None,
    max_files: int = MAX_FILES_FOR_QUERY,
) -> List[Dict[str, Any]]:
    bucket_td = parse_bucket_spec(bucket_spec)
    if from_dt.tzinfo is None:
        from_dt = from_dt.replace(tzinfo=UTC)
    if to_dt.tzinfo is None:
        to_dt = to_dt.replace(tzinfo=UTC)
    from_dt = from_dt.astimezone(UTC)
    to_dt = to_dt.astimezone(UTC)
    if to_dt <= from_dt:
        return []

    max_span = timedelta(days=14)
    if to_dt - from_dt > max_span:
        raise ValueError(f"range too large (max {max_span.days} days)")

    events = _load_events_from_files(max_files)
    if robot_id:
        rid = str(robot_id).strip()
        events = [e for e in events if str(e.get("robot_id") or "") == rid]

    in_range: List[Tuple[datetime, Dict[str, Any]]] = []
    for ev in events:
        ts = event_time_utc(ev)
        if ts is None:
            continue
        if from_dt <= ts <= to_dt:
            in_range.append((ts, ev))

    points: List[Dict[str, Any]] = []
    t = from_dt
    while t < to_dt:
        t_end = min(t + bucket_td, to_dt)
        bucket_events = [ev for ts, ev in in_range if t <= ts < t_end]
        n = len(bucket_events)
        if n == 0:
            points.append(
                {
                    "t": _iso(t),
                    "t_end": _iso(t_end),
                    "sample_count": 0,
                    "avg_temperature_c": None,
                    "avg_power_watts": None,
                    "avg_cycle_time_ms": None,
                }
            )
        else:
            temps = [_to_float(e.get("temperature_c"), float("nan")) for e in bucket_events]
            temps_f = [x for x in temps if x == x]
            powers = [_to_float(e.get("power_watts"), float("nan")) for e in bucket_events]
            powers_f = [x for x in powers if x == x]
            cycles = [_to_float(e.get("cycle_time_ms"), float("nan")) for e in bucket_events]
            cycles_f = [x for x in cycles if x == x]
            points.append(
                {
                    "t": _iso(t),
                    "t_end": _iso(t_end),
                    "sample_count": n,
                    "avg_temperature_c": round(sum(temps_f) / len(temps_f), 3) if temps_f else None,
                    "avg_power_watts": round(sum(powers_f) / len(powers_f), 3) if powers_f else None,
                    "avg_cycle_time_ms": round(sum(cycles_f) / len(cycles_f), 3) if cycles_f else None,
                }
            )
        t = t_end

    return points
