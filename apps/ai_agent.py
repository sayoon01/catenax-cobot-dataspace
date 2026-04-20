"""
AI Agent 기능
- OLLAMA_* 환경변수로 Ollama 기반 AI Agent를 구성합니다.
- health/chat/streaming chat과 검증 결과 설명을 담당합니다.
- AAS metamodel 추론, submodel element 생성, AAS 코드 생성을 보조합니다.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Iterator, List, Mapping, Optional, Protocol
from urllib import error, request


DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "qwen3:14b"
DEFAULT_OLLAMA_TIMEOUT = 120.0


class LoggerLike(Protocol):
    def warning(self, msg: str, *args: Any) -> None:
        ...


class OllamaAgentError(RuntimeError):
    pass


class HttpJsonClient:
    """Minimal JSON-over-HTTP client (stdlib only)."""

    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout

    def request_json(
        self,
        method: str,
        url: str,
        payload: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> Dict[str, Any]:
        body: Optional[bytes] = None
        hdrs: Dict[str, str] = {"Content-Type": "application/json"}
        if headers:
            hdrs.update(headers)
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")

        req = request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8").strip()
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code} → {url}: {detail}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Cannot reach {url}: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError(f"Timed out after {self.timeout:g}s → {url}") from exc
        except OSError as exc:
            raise RuntimeError(f"Connection error → {url}: {exc}") from exc

        return json.loads(raw) if raw else {}

    def request_json_stream_lines(
        self,
        method: str,
        url: str,
        payload: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> Iterator[Dict[str, Any]]:
        body: Optional[bytes] = None
        hdrs: Dict[str, str] = {"Content-Type": "application/json"}
        if headers:
            hdrs.update(headers)
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")

        req = request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with request.urlopen(req, timeout=self.timeout) as resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    try:
                        parsed = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(parsed, dict):
                        yield parsed
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code} → {url}: {detail}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Cannot reach {url}: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError(f"Timed out after {self.timeout:g}s → {url}") from exc
        except OSError as exc:
            raise RuntimeError(f"Connection error → {url}: {exc}") from exc


class OllamaAASAgent:
    """AI agent backed by Ollama."""

    REQUIRED_ELEMENT_KEYS = {"modelType", "idShort", "valueType", "value", "semanticId"}

    def __init__(
        self,
        base_url: str = DEFAULT_OLLAMA_BASE_URL,
        model: str = DEFAULT_OLLAMA_MODEL,
        timeout: float = DEFAULT_OLLAMA_TIMEOUT,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.client = HttpJsonClient(timeout=timeout)

    def health_check(self) -> Dict[str, Any]:
        url = f"{self.base_url}/api/tags"
        try:
            resp = self.client.request_json("GET", url)
        except RuntimeError as exc:
            return {"ok": False, "reason": str(exc), "base_url": self.base_url, "model": self.model}

        models = resp.get("models", [])
        names = {
            str(item.get("name") or item.get("model"))
            for item in models
            if isinstance(item, dict)
        }
        return {
            "ok": self.model in names,
            "base_url": self.base_url,
            "model": self.model,
            "available_models": sorted(names),
        }

    def _chat(self, system: str, user: str) -> str:
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        try:
            resp = self.client.request_json("POST", url, payload=payload)
        except RuntimeError as exc:
            raise OllamaAgentError(f"Ollama unreachable: {exc}") from exc
        return resp.get("message", {}).get("content", "")

    def _chat_stream(self, system: str, user: str) -> Iterator[str]:
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "stream": True,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        try:
            for chunk in self.client.request_json_stream_lines("POST", url, payload=payload):
                message = chunk.get("message")
                if isinstance(message, dict):
                    text = message.get("content")
                    if text:
                        yield str(text)
                if chunk.get("done"):
                    break
        except RuntimeError as exc:
            raise OllamaAgentError(f"Ollama unreachable: {exc}") from exc

    @staticmethod
    def _json_from_response(raw: str) -> Any:
        cleaned = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
        return json.loads(cleaned)

    def chat(
        self,
        message: str,
        telemetry: Optional[Mapping[str, Any]] = None,
        validation_report: Optional[Mapping[str, Any]] = None,
    ) -> str:
        system = (
            "You are a practical Catena-X, AAS, EDC, and cobot telemetry assistant. "
            "Answer the user's question directly. If telemetry or validation context is provided, "
            "ground the answer in that data. Do not invent values that are not present."
        )
        context = {
            "telemetry": telemetry or {},
            "validation_report": validation_report or {},
        }
        user = (
            f"Question:\n{message}\n\n"
            f"Context JSON:\n{json.dumps(context, ensure_ascii=False, indent=2)}"
        )
        return self._chat(system, user)

    def chat_stream(
        self,
        message: str,
        telemetry: Optional[Mapping[str, Any]] = None,
        validation_report: Optional[Mapping[str, Any]] = None,
    ) -> Iterator[str]:
        system = (
            "You are a practical Catena-X, AAS, EDC, and cobot telemetry assistant. "
            "Answer the user's question directly. If telemetry or validation context is provided, "
            "ground the answer in that data. Do not invent values that are not present."
        )
        context = {
            "telemetry": telemetry or {},
            "validation_report": validation_report or {},
        }
        user = (
            f"Question:\n{message}\n\n"
            f"Context JSON:\n{json.dumps(context, ensure_ascii=False, indent=2)}"
        )
        yield from self._chat_stream(system, user)

    def explain_validation_report(
        self,
        validation_report: Mapping[str, Any],
        telemetry: Optional[Mapping[str, Any]] = None,
    ) -> str:
        system = (
            "You explain AAS validation reports for engineers. "
            "Be concise, concrete, and action-oriented. "
            "Summarize pass/fail, main risks, likely causes, and next fixes."
        )
        user = json.dumps(
            {
                "validation_report": validation_report,
                "telemetry": telemetry or {},
            },
            ensure_ascii=False,
            indent=2,
        )
        return self._chat(system, user)

    def explain_validation_report_stream(
        self,
        validation_report: Mapping[str, Any],
        telemetry: Optional[Mapping[str, Any]] = None,
    ) -> Iterator[str]:
        system = (
            "You explain AAS validation reports for engineers. "
            "Be concise, concrete, and action-oriented. "
            "Summarize pass/fail, main risks, likely causes, and next fixes."
        )
        user = json.dumps(
            {
                "validation_report": validation_report,
                "telemetry": telemetry or {},
            },
            ensure_ascii=False,
            indent=2,
        )
        yield from self._chat_stream(system, user)

    def generate_aas_code(self, mapped_fields: List[Any]) -> str:
        fields_json = json.dumps(
            [{"idShort": f.id_short, "valueType": f.value_type, "semanticId": f.semantic_id} for f in mapped_fields],
            indent=2,
        )
        system = (
            "You are an AAS (Asset Administration Shell) expert following IDTA and Catena-X standards. "
            "Generate clean, runnable Python 3 code using the basyx-python-sdk library. "
            "Return ONLY the Python code block, no explanation."
        )
        user = (
            "Generate Python code to build an AAS Submodel with idShort='CobotOperationalData' "
            f"using the following fields:\n{fields_json}\n"
            "Use basyx.aas.model. Include imports. "
            "Name the submodel variable 'cobot_submodel'."
        )
        return self._chat(system, user)

    def infer_metamodel(self, robot_id: str, program_name: str, alarms: List[str]) -> Dict[str, Any]:
        system = (
            "You are a Catena-X manufacturing data space expert. "
            "Respond ONLY with a valid JSON object, no markdown fences."
        )
        user = (
            "Given a collaborative robot:\n"
            f"  robot_id={robot_id}\n"
            f"  program_name={program_name}\n"
            f"  active_alarms={alarms}\n"
            "Return JSON with keys: "
            "'domain' (string), 'idta_template' (string), "
            "'risk_level' (low|medium|high), 'recommended_submodel_id' (urn string), "
            "'notes' (string)."
        )
        raw = self._chat(system, user)
        try:
            parsed = self._json_from_response(raw)
        except json.JSONDecodeError:
            return {"raw_inference": raw, "parse_error": True}
        if not isinstance(parsed, dict):
            return {"raw_inference": raw, "parse_error": True}
        return parsed

    def build_submodel_elements(self, mapped_fields: List[Any], metamodel: Dict[str, Any]) -> List[Dict[str, Any]]:
        fields_summary = [
            {"idShort": f.id_short, "value": str(f.value)[:80], "valueType": f.value_type}
            for f in mapped_fields
        ]
        system = (
            "You are an AAS submodel builder. "
            "Respond ONLY with a valid JSON array of AAS Property objects. "
            "No markdown, no prose."
        )
        user = (
            f"Build AAS submodelElements for domain='{metamodel.get('domain', 'manufacturing')}'. "
            f"Fields:\n{json.dumps(fields_summary, indent=2)}\n"
            "Each element: {modelType, idShort, valueType, value, semanticId}. "
            "Use the exact idShort and valueType given. "
            "Add reasonable semanticId if not already present."
        )
        raw = self._chat(system, user)
        try:
            elements = self._json_from_response(raw)
            return self._validate_submodel_elements(elements, mapped_fields)
        except json.JSONDecodeError:
            pass
        except ValueError:
            pass
        return self._fallback_submodel_elements(mapped_fields)

    def _validate_submodel_elements(self, elements: Any, mapped_fields: List[Any]) -> List[Dict[str, Any]]:
        if not isinstance(elements, list):
            raise ValueError("AAS elements response must be a JSON array")

        by_id_short = {f.id_short: f for f in mapped_fields}
        validated: List[Dict[str, Any]] = []
        for index, element in enumerate(elements):
            if not isinstance(element, dict):
                raise ValueError(f"AAS element at index {index} is not an object")
            missing = self.REQUIRED_ELEMENT_KEYS - set(element)
            if missing:
                raise ValueError(f"AAS element '{element.get('idShort', index)}' missing keys: {sorted(missing)}")
            if element["modelType"] != "Property":
                raise ValueError(f"AAS element '{element.get('idShort')}' must have modelType='Property'")
            source = by_id_short.get(str(element["idShort"]))
            if source and str(element["valueType"]) != source.value_type:
                raise ValueError(f"AAS element '{element['idShort']}' valueType does not match mapper output")
            validated.append(
                {
                    "modelType": "Property",
                    "idShort": str(element["idShort"]),
                    "valueType": str(element["valueType"]),
                    "value": element["value"],
                    "semanticId": str(element["semanticId"]),
                }
            )
        return validated

    @staticmethod
    def _fallback_submodel_elements(mapped_fields: List[Any]) -> List[Dict[str, Any]]:
        return [
            {
                "modelType": "Property",
                "idShort": f.id_short,
                "valueType": f.value_type,
                "value": f.value,
                "semanticId": f.semantic_id,
            }
            for f in mapped_fields
            if f.value is not None
        ]


def build_ai_agent_from_env(
    logger: Optional[LoggerLike] = None,
    default_base_url: str = DEFAULT_OLLAMA_BASE_URL,
    default_model: str = DEFAULT_OLLAMA_MODEL,
    default_timeout: float = DEFAULT_OLLAMA_TIMEOUT,
) -> OllamaAASAgent:
    ollama_url = os.environ.get("OLLAMA_BASE_URL", default_base_url)
    ollama_model = os.environ.get("OLLAMA_MODEL", default_model)
    ollama_timeout_raw = os.environ.get("OLLAMA_TIMEOUT", str(default_timeout))
    try:
        ollama_timeout = float(ollama_timeout_raw)
    except ValueError:
        if logger:
            logger.warning(
                "Invalid OLLAMA_TIMEOUT=%r; using default %s seconds",
                ollama_timeout_raw,
                default_timeout,
            )
        ollama_timeout = default_timeout

    return OllamaAASAgent(
        base_url=ollama_url,
        model=ollama_model,
        timeout=ollama_timeout,
    )
