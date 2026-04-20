"""
HTTP 요청 핸들러
- OPTIONS: CORS 헤더 설정
- GET: 텔레메트리 조회
- POST: 텔레메트리 저장

HTTP 요청 핸들러 클래스
- TelemetryHandler
- _cors_headers: CORS 헤더 설정
- _send_json: JSON 응답 전송

server/http_handler.py
HTTP 라우팅/요청응답 처리 (TelemetryHandler)
"""
from __future__ import annotations

import json
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from apps.ai_agent import OllamaAASAgent, OllamaAgentError
from settings import LOGGER, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT
from telemetry_store import (
    kpi_summary,
    parse_iso_datetime,
    read_all,
    read_latest,
    read_recent,
    store_telemetry,
    timeseries_buckets,
    utc_now,
    validate_telemetry,
)


def build_ai_agent() -> OllamaAASAgent:
    return OllamaAASAgent(
        base_url=OLLAMA_BASE_URL,
        model=OLLAMA_MODEL,
        timeout=OLLAMA_TIMEOUT,
    )


class TelemetryHandler(BaseHTTPRequestHandler):
    server_version = "CatenaXCobotTelemetry/1.0"

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status: HTTPStatus, payload: Any) -> None:
        body = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length > 0 else b""
        if not raw:
            raise ValueError("Request body is empty")
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            self._send_json(HTTPStatus.OK, {
                "status": "ok",
                "service": "catenax-cobot-telemetry",
                "timestamp": utc_now(),
            })
            return

        if parsed.path == "/api/v1/cobot/telemetry/latest":
            latest = read_latest()
            if latest is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "No telemetry stored yet"})
                return
            self._send_json(HTTPStatus.OK, latest)
            return

        if parsed.path == "/api/v1/cobot/telemetry/all":
            items = read_all()
            self._send_json(HTTPStatus.OK, {"items": items, "count": len(items)})
            return

        if parsed.path == "/api/v1/cobot/telemetry":
            query = parse_qs(parsed.query)
            try:
                limit = max(1, min(int(query.get("limit", ["20"])[0]), 500))
            except ValueError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "'limit' must be an integer"})
                return
            items = read_recent(limit)
            self._send_json(HTTPStatus.OK, {"items": items, "count": len(items)})
            return

        if parsed.path == "/api/v1/cobot/telemetry/kpi/summary":
            query = parse_qs(parsed.query)
            window = (query.get("window", ["1h"]) or ["1h"])[0].strip()
            compare_raw = (query.get("compare", ["previous"]) or ["previous"])[0].strip().lower()
            compare_previous = compare_raw not in ("none", "false", "0", "no")
            try:
                payload = kpi_summary(window, compare_previous)
            except ValueError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, payload)
            return

        if parsed.path == "/api/v1/cobot/telemetry/timeseries":
            query = parse_qs(parsed.query)
            from_raw = (query.get("from", [""]) or [""])[0].strip()
            to_raw = (query.get("to", [""]) or [""])[0].strip()
            bucket = (query.get("bucket", ["5m"]) or ["5m"])[0].strip()
            robot_raw = (query.get("robot_id", [""]) or [""])[0].strip()
            robot_id = robot_raw or None
            from_dt = parse_iso_datetime(from_raw)
            to_dt = parse_iso_datetime(to_raw)
            if from_dt is None or to_dt is None:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Invalid or missing 'from' / 'to' (ISO8601, e.g. 2026-04-20T00:00:00Z)"},
                )
                return
            try:
                points = timeseries_buckets(from_dt, to_dt, bucket, robot_id)
            except ValueError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "bucket": bucket.lower(),
                    "from": from_raw,
                    "to": to_raw,
                    "robot_id": robot_id,
                    "count": len(points),
                    "points": points,
                },
            )
            return

        if parsed.path == "/api/v1/ai/health":
            self._send_json(HTTPStatus.OK, build_ai_agent().health_check())
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/v1/ai/chat":
            self._handle_ai_chat()
            return

        if parsed.path != "/api/v1/cobot/telemetry":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            payload = self._read_json()
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except json.JSONDecodeError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Invalid JSON: {exc.msg}"})
            return

        errors = validate_telemetry(payload)
        if errors:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Validation failed", "details": errors})
            return

        result = store_telemetry(payload)
        self._send_json(HTTPStatus.CREATED, result)

    def _handle_ai_chat(self) -> None:
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except json.JSONDecodeError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Invalid JSON: {exc.msg}"})
            return

        message = str(payload.get("message", "")).strip()
        mode = str(payload.get("mode", "chat")).strip().lower()
        if not message and mode == "chat":
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "'message' is required"})
            return

        telemetry = payload.get("telemetry")
        if telemetry is None and payload.get("include_latest"):
            telemetry = read_latest()
        if telemetry is not None and not isinstance(telemetry, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "'telemetry' must be an object when provided"})
            return

        validation_report = payload.get("validation_report")
        if validation_report is not None and not isinstance(validation_report, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "'validation_report' must be an object when provided"})
            return

        agent = build_ai_agent()
        try:
            if mode == "explain_validation":
                if validation_report is None:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "'validation_report' is required"})
                    return
                answer = agent.explain_validation_report(validation_report, telemetry)
            elif mode == "chat":
                answer = agent.chat(message, telemetry, validation_report)
            else:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Unsupported mode; use 'chat' or 'explain_validation'"})
                return
        except OllamaAgentError as exc:
            self._send_json(HTTPStatus.BAD_GATEWAY, {"error": str(exc)})
            return

        self._send_json(
            HTTPStatus.OK,
            {
                "mode": mode,
                "model": OLLAMA_MODEL,
                "answer": answer,
            },
        )

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)
