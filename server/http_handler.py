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
import os
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Iterable
from urllib.parse import parse_qs, urlparse

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from apps.ai_agent import OllamaAgentError, build_ai_agent_from_env
from apps.edc import CobotEDCPipeline, build_aas_bridge_from_env, build_connector_from_env
from settings import DATA_DIR, LOGGER
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

EDC_HISTORY_FILE = DATA_DIR / "edc_history.json"
EDC_HISTORY_LOCK = Lock()
EDC_HISTORY_LIMIT = 100


class TelemetryHandler(BaseHTTPRequestHandler):
    server_version = "CatenaXCobotTelemetry/1.0"

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status: HTTPStatus, payload: Any) -> None:
        body = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_html_file(self, path: Path) -> None:
        try:
            body = path.read_bytes()
        except OSError:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _try_send_frontend_static(self, rel: str) -> bool:
        """`frontend/` 이하 정적 파일 (다중 HTML·css·js). 경로 탈출 방지."""
        base = (ROOT_DIR / "frontend").resolve()
        target = (base / rel).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            return False
        if not target.is_file():
            return False
        ext = target.suffix.lower()
        allowed = {".html", ".css", ".js"}
        if ext not in allowed:
            return False
        try:
            body = target.read_bytes()
        except OSError:
            return False
        ct = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
        }[ext]
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)
        return True

    def _send_ndjson_stream(self, status: HTTPStatus, events: Iterable[Dict[str, Any]]) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self._cors_headers()
        self.end_headers()
        for event in events:
            line = json.dumps(event, ensure_ascii=False) + "\n"
            self.wfile.write(line.encode("utf-8"))
            self.wfile.flush()

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

        if parsed.path in ("/", "/index.html"):
            self._send_html_file(ROOT_DIR / "frontend" / "index.html")
            return

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
            self._send_json(HTTPStatus.OK, build_ai_agent_from_env(LOGGER).health_check())
            return

        if parsed.path == "/api/v1/edc/status":
            self._send_json(HTTPStatus.OK, self._edc_status_payload())
            return

        if parsed.path == "/api/v1/edc/history":
            query = parse_qs(parsed.query)
            try:
                limit = max(1, min(int(query.get("limit", ["12"])[0]), EDC_HISTORY_LIMIT))
            except ValueError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "'limit' must be an integer"})
                return
            items = self._read_edc_history(limit)
            self._send_json(HTTPStatus.OK, {"items": items, "count": len(items)})
            return

        rel = parsed.path.lstrip("/")
        if rel and ".." not in parsed.path and self._try_send_frontend_static(rel):
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/v1/ai/chat":
            self._handle_ai_chat()
            return

        if parsed.path == "/api/v1/edc/pipeline":
            self._handle_edc_pipeline()
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

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/v1/edc/history":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        self._write_edc_history([])
        self._send_json(HTTPStatus.OK, {"status": "cleared", "items": [], "count": 0})

    def _handle_edc_pipeline(self) -> None:
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except json.JSONDecodeError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Invalid JSON: {exc.msg}"})
            return

        action = str(payload.get("action", "validate")).strip().lower()
        if action not in ("validate", "aas_push", "edc_register"):
            self._send_edc_pipeline_error(
                HTTPStatus.BAD_REQUEST,
                {"error": "Unsupported action; use 'validate', 'aas_push', or 'edc_register'"},
                action=action,
                request_payload=payload,
            )
            return

        try:
            telemetry = self._resolve_edc_telemetry(payload)
        except ValueError as exc:
            self._send_edc_pipeline_error(
                HTTPStatus.BAD_REQUEST,
                {"error": str(exc), "action": action},
                action=action,
                request_payload=payload,
            )
            return

        missing_env = self._missing_edc_env(action)
        if missing_env:
            self._send_edc_pipeline_error(
                HTTPStatus.BAD_REQUEST,
                {
                    "error": "Missing required environment variables",
                    "missing_env": missing_env,
                    "action": action,
                },
                action=action,
                request_payload=payload,
            )
            return

        include_ai = bool(payload.get("include_ai"))
        try:
            pipeline = CobotEDCPipeline(
                connector=build_connector_from_env() if action == "edc_register" else None,
                aas_bridge=build_aas_bridge_from_env() if action in ("aas_push", "edc_register") else None,
                ai_agent=build_ai_agent_from_env(LOGGER) if include_ai else None,
            )
        except KeyError as exc:
            self._send_edc_pipeline_error(
                HTTPStatus.BAD_REQUEST,
                {"error": "Missing required environment variable", "missing_env": [str(exc).strip("'")], "action": action},
                action=action,
                request_payload=payload,
            )
            return

        asset_id = str(payload.get("asset_id", "")).strip()
        provider_bpn = str(payload.get("provider_bpn", "")).strip()
        cobot_api_base_url = str(payload.get("cobot_api_base_url", "")).strip()
        if action == "edc_register":
            missing_args = [
                name for name, value in (
                    ("asset_id", asset_id),
                    ("provider_bpn", provider_bpn),
                    ("cobot_api_base_url", cobot_api_base_url),
                )
                if not value
            ]
            if missing_args:
                self._send_edc_pipeline_error(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Missing required EDC registration fields", "missing_fields": missing_args, "action": action},
                    action=action,
                    request_payload=payload,
                )
                return

        try:
            result = pipeline.run_full_pipeline(
                raw=telemetry,
                skip_aas_push=action == "validate",
                run_edc=action == "edc_register",
                asset_id=asset_id or None,
                provider_bpn=provider_bpn or None,
                cobot_api_base_url=cobot_api_base_url or None,
            )
        except Exception as exc:  # noqa: BLE001 - return operational failures to the UI
            LOGGER.exception("EDC pipeline failed action=%s", action)
            self._send_edc_pipeline_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": str(exc), "action": action},
                action=action,
                request_payload=payload,
            )
            return

        response = {
            "action": action,
            "telemetry": {
                "robot_id": telemetry.get("robot_id"),
                "status": telemetry.get("status"),
                "produced_at": telemetry.get("produced_at"),
                "stored_at": telemetry.get("stored_at"),
            },
            "result": result,
        }
        self._append_edc_history(self._edc_history_record(response, True, payload))
        self._send_json(HTTPStatus.OK, response)

    def _send_edc_pipeline_error(
        self,
        status: HTTPStatus,
        payload: Dict[str, Any],
        *,
        action: str,
        request_payload: Dict[str, Any],
    ) -> None:
        payload.setdefault("action", action)
        self._append_edc_history(self._edc_history_record(payload, False, request_payload))
        self._send_json(status, payload)

    def _resolve_edc_telemetry(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        telemetry = payload.get("telemetry")
        if telemetry is not None:
            if not isinstance(telemetry, dict):
                raise ValueError("'telemetry' must be an object when provided")
            return telemetry

        source = str(payload.get("telemetry_source", "latest")).strip().lower()
        if source == "latest":
            latest = read_latest()
            if latest is None:
                raise ValueError("No latest telemetry stored yet")
            return latest

        if source == "sample":
            sample_path = ROOT_DIR / "server" / "data" / "sample_telemetry.json"
            try:
                parsed = json.loads(sample_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise ValueError(f"Cannot read sample telemetry: {exc}") from exc
            try:
                index = int(payload.get("telemetry_index", 0))
            except (TypeError, ValueError) as exc:
                raise ValueError("'telemetry_index' must be an integer") from exc
            if isinstance(parsed, list):
                if index < 0 or index >= len(parsed):
                    raise ValueError(f"'telemetry_index' out of range: 0..{len(parsed) - 1}")
                item = parsed[index]
                if not isinstance(item, dict):
                    raise ValueError("Selected sample telemetry is not an object")
                return item
            if isinstance(parsed, dict):
                return parsed
            raise ValueError("Sample telemetry must be an object or array")

        raise ValueError("Unsupported telemetry_source; use 'latest' or 'sample'")

    def _missing_edc_env(self, action: str) -> list[str]:
        required: list[str] = []
        if action in ("aas_push", "edc_register"):
            required.extend(["CATENAX_AAS_BASE_URL", "CATENAX_AAS_SUBMODEL_ID"])
        if action == "edc_register":
            required.append("CATENAX_EDC_MANAGEMENT_URL")
        return [name for name in required if not os.environ.get(name)]

    def _edc_status_payload(self) -> Dict[str, Any]:
        env_specs = [
            ("CATENAX_AAS_BASE_URL", "AAS Repository URL", False),
            ("CATENAX_AAS_SUBMODEL_ID", "AAS Submodel ID", False),
            ("CATENAX_EDC_MANAGEMENT_URL", "EDC Management URL", False),
            ("CATENAX_AAS_API_KEY", "AAS API Key", True),
            ("CATENAX_EDC_API_KEY", "EDC API Key", True),
            ("OLLAMA_BASE_URL", "Ollama URL", False),
            ("OLLAMA_MODEL", "Ollama Model", False),
        ]
        env = []
        for name, label, secret in env_specs:
            value = os.environ.get(name, "")
            env.append({
                "name": name,
                "label": label,
                "configured": bool(value),
                "value": "configured" if secret and value else (value if value else None),
                "secret": secret,
            })
        readiness = {
            "validate": {"ready": True, "missing_env": []},
            "aas_push": {
                "ready": not self._missing_edc_env("aas_push"),
                "missing_env": self._missing_edc_env("aas_push"),
            },
            "edc_register": {
                "ready": not self._missing_edc_env("edc_register"),
                "missing_env": self._missing_edc_env("edc_register"),
            },
        }
        return {
            "status": "ok",
            "timestamp": utc_now(),
            "env": env,
            "readiness": readiness,
        }

    def _read_edc_history(self, limit: int = EDC_HISTORY_LIMIT) -> list[Dict[str, Any]]:
        if not EDC_HISTORY_FILE.exists():
            return []
        try:
            parsed = json.loads(EDC_HISTORY_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(parsed, list):
            return []
        return [item for item in parsed if isinstance(item, dict)][:limit]

    def _write_edc_history(self, items: list[Dict[str, Any]]) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with EDC_HISTORY_LOCK:
            EDC_HISTORY_FILE.write_text(
                json.dumps(items[:EDC_HISTORY_LIMIT], indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

    def _append_edc_history(self, record: Dict[str, Any]) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with EDC_HISTORY_LOCK:
            try:
                parsed = json.loads(EDC_HISTORY_FILE.read_text(encoding="utf-8")) if EDC_HISTORY_FILE.exists() else []
            except (OSError, json.JSONDecodeError):
                parsed = []
            if not isinstance(parsed, list):
                parsed = []
            parsed.insert(0, record)
            EDC_HISTORY_FILE.write_text(
                json.dumps(parsed[:EDC_HISTORY_LIMIT], indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

    def _edc_history_record(
        self,
        response_payload: Dict[str, Any],
        ok: bool,
        request_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        result = response_payload.get("result") if isinstance(response_payload.get("result"), dict) else {}
        stages = result.get("stages") if isinstance(result.get("stages"), dict) else {}
        validation = stages.get("validation") if isinstance(stages.get("validation"), dict) else {}
        telemetry = response_payload.get("telemetry") if isinstance(response_payload.get("telemetry"), dict) else {}
        timestamp = utc_now()
        return {
            "id": timestamp,
            "at": timestamp,
            "ok": ok,
            "action": response_payload.get("action") or request_payload.get("action") or "unknown",
            "robot_id": telemetry.get("robot_id") or "-",
            "validation_passed": validation.get("passed") if isinstance(validation.get("passed"), bool) else None,
            "score": validation.get("overall_score") if isinstance(validation.get("overall_score"), (int, float)) else None,
            "error": response_payload.get("error", ""),
            "telemetry_source": request_payload.get("telemetry_source", "latest"),
            "telemetry_index": request_payload.get("telemetry_index", 0),
            "asset_id": request_payload.get("asset_id", ""),
            "provider_bpn": request_payload.get("provider_bpn", ""),
            "cobot_api_base_url": request_payload.get("cobot_api_base_url", ""),
            "include_ai": bool(request_payload.get("include_ai")),
        }

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
        stream = bool(payload.get("stream"))
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

        agent = build_ai_agent_from_env(LOGGER)
        try:
            if mode == "explain_validation":
                if validation_report is None:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "'validation_report' is required"})
                    return
                if stream:
                    self._stream_ai_response(
                        mode=mode,
                        model=agent.model,
                        chunks=agent.explain_validation_report_stream(validation_report, telemetry),
                    )
                    return
                answer = agent.explain_validation_report(validation_report, telemetry)
            elif mode == "chat":
                if stream:
                    self._stream_ai_response(
                        mode=mode,
                        model=agent.model,
                        chunks=agent.chat_stream(message, telemetry, validation_report),
                    )
                    return
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
                "model": agent.model,
                "answer": answer,
            },
        )

    def _stream_ai_response(self, mode: str, model: str, chunks: Iterable[str]) -> None:
        def events() -> Iterable[Dict[str, Any]]:
            yield {"type": "meta", "mode": mode, "model": model}
            full: list[str] = []
            for chunk in chunks:
                text = str(chunk)
                if not text:
                    continue
                full.append(text)
                yield {"type": "chunk", "delta": text}
            yield {"type": "done", "answer": "".join(full), "mode": mode, "model": model}

        try:
            self._send_ndjson_stream(HTTPStatus.OK, events())
        except OllamaAgentError as exc:
            self._send_ndjson_stream(
                HTTPStatus.BAD_GATEWAY,
                [{"type": "error", "error": str(exc), "mode": mode, "model": model}],
            )

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)
