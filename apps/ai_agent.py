from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Mapping, Optional
from urllib import error, request


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

        return json.loads(raw) if raw else {}


class OllamaAASAgent:
    """AI agent backed by Ollama."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "qwen3:27b",
        timeout: float = 120.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.client = HttpJsonClient(timeout=timeout)

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
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw_inference": raw, "parse_error": True}

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
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
        try:
            elements = json.loads(raw)
            if isinstance(elements, list):
                return elements
        except json.JSONDecodeError:
            pass
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

