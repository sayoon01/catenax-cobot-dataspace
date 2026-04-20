"""edc.py
Catena-X EDC connector · AAS bridge · AI-agent pipeline for cobot telemetry.

Full pipeline
─────────────
  Raw telemetry JSON
       ↓  [1] Preprocessor   – rule-based cleaning & field normalisation
       ↓  [2] Mapper          – maps fields to AAS idShort / semanticId
       ↓  [3] AI Agent        – uses Ollama qwen3:27b for
                                 • code generation (AAS builder snippets)
                                 • meta-model inference
                                 • AAS submodel construction
       ↓  [4] Validator       – Standard & Integrity / Semantic Cross-Val /
                                 Reliability Assessment
       ↓  [5] AAS Repository  – PUT submodel to BaSyx / Eclipse AAS server
       ↓  [6] EDC Connector   – register asset, policies, contract definition

Environment variables expected
────────────────────────────────
  CATENAX_EDC_MANAGEMENT_URL   e.g. http://localhost:8181/management
  CATENAX_AAS_BASE_URL         e.g. http://localhost:4001
  CATENAX_AAS_SUBMODEL_ID      e.g. urn:aas:cobot:submodel:001
  CATENAX_EDC_API_KEY          (optional)
  CATENAX_AAS_API_KEY          (optional)
  OLLAMA_BASE_URL              default: http://localhost:11434
  OLLAMA_MODEL                 default: qwen3:27b
  OLLAMA_TIMEOUT               default: 120 (seconds)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Tuple
from urllib import error, request

try:
    from apps.aas_mapper import TelemetryMapper
    from apps.ai_agent import OllamaAASAgent, OllamaAgentError
    from apps.preprocessor import TelemetryPreprocessor
except ModuleNotFoundError:
    from aas_mapper import TelemetryMapper
    from ai_agent import OllamaAASAgent, OllamaAgentError
    from preprocessor import TelemetryPreprocessor


LOGGER = logging.getLogger("catenax.edc")

# ══════════════════════════════════════════════════════════════════════════════
# 0.  Shared HTTP client
# ══════════════════════════════════════════════════════════════════════════════

def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


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


# ══════════════════════════════════════════════════════════════════════════════
# 1.  Preprocessor  (rule-based cleaning)
# 2.  Mapper  → apps/aas_mapper.py  (SEMANTIC_MAP, MappedField, TelemetryMapper)
# 3.  AI Agent  (Ollama qwen3:27b)
#====================================================
# 4.  Validator  (three-layer validation)
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class ValidationReport:
    passed: bool
    standard_integrity: Dict[str, Any] = field(default_factory=dict)
    semantic_cross_val: Dict[str, Any] = field(default_factory=dict)
    reliability_assessment: Dict[str, Any] = field(default_factory=dict)
    overall_score: float = 0.0
    issues: List[str] = field(default_factory=list)


class AASValidator:
    """
    Three-layer validation engine.

    Layer 1  Standard & Integrity Validation
    Layer 2  Semantic Data Cross-Validation
    Layer 3  Reliability Assessment Engine
    """

    # Thresholds for reliability assessment
    TEMP_MAX_C        = 85.0
    VIBRATION_MAX     = 10.0
    POWER_MAX_W       = 2000.0
    CYCLE_TIME_MAX_MS = 60_000.0
    REJECT_RATIO_MAX  = 0.10   # 10 %

    def validate(
        self,
        elements: List[Dict[str, Any]],
        original: Dict[str, Any],
    ) -> ValidationReport:
        report = ValidationReport(passed=True)

        report.standard_integrity  = self._standard_integrity(elements)
        report.semantic_cross_val  = self._semantic_cross_validation(elements, original)
        report.reliability_assessment = self._reliability_assessment(original)

        issues = (
            report.standard_integrity.get("issues", [])
            + report.semantic_cross_val.get("issues", [])
            + report.reliability_assessment.get("issues", [])
        )
        report.issues = issues

        # Score: each layer 0-100
        s1 = report.standard_integrity.get("score", 100)
        s2 = report.semantic_cross_val.get("score", 100)
        s3 = report.reliability_assessment.get("score", 100)
        report.overall_score = round((s1 + s2 + s3) / 3, 1)
        report.passed = report.overall_score >= 60.0 and len(
            [i for i in issues if i.startswith("[CRITICAL]")]
        ) == 0

        return report

    # ── Layer 1: Standard & Integrity ────────────────────────────────────────

    def _standard_integrity(self, elements: List[Dict[str, Any]]) -> Dict[str, Any]:
        issues: List[str] = []
        required_id_shorts = {
            "RobotId", "LineId", "StationId",
            "CycleTimeMs", "PowerWatts", "OperationalStatus",
        }
        present = {e.get("idShort") for e in elements}
        missing = required_id_shorts - present
        for m in missing:
            issues.append(f"[CRITICAL] Missing mandatory AAS Property: {m}")

        for elem in elements:
            if "idShort" not in elem:
                issues.append("[ERROR] Element missing 'idShort'")
            if "valueType" not in elem:
                issues.append(f"[WARN] Element '{elem.get('idShort')}' missing valueType")
            if "semanticId" not in elem:
                issues.append(f"[INFO] Element '{elem.get('idShort')}' missing semanticId")

        score = max(0, 100 - len([i for i in issues if "[CRITICAL]" in i]) * 30
                       - len([i for i in issues if "[ERROR]" in i]) * 10
                       - len([i for i in issues if "[WARN]" in i]) * 5)
        return {"score": score, "issues": issues, "elements_checked": len(elements)}

    # ── Layer 2: Semantic Cross-Validation ───────────────────────────────────

    def _semantic_cross_validation(
        self,
        elements: List[Dict[str, Any]],
        original: Dict[str, Any],
    ) -> Dict[str, Any]:
        issues: List[str] = []
        elem_map = {e.get("idShort"): e for e in elements}

        # Check cycle_time in AAS matches original
        ct_elem = elem_map.get("CycleTimeMs")
        if ct_elem:
            try:
                if abs(float(ct_elem["value"]) - float(original.get("cycle_time_ms", 0))) > 1:
                    issues.append("[WARN] CycleTimeMs AAS value diverges from source")
            except (TypeError, ValueError):
                issues.append("[ERROR] CycleTimeMs value not numeric in AAS elements")

        # Good+reject consistency
        good   = int(original.get("good_parts", 0))
        reject = int(original.get("reject_parts", 0))
        total  = good + reject
        if total == 0 and original.get("status") == "RUNNING":
            issues.append("[INFO] Robot RUNNING but 0 parts produced")

        # Alarm vs status coherence
        alarms = original.get("alarms", [])
        status = original.get("status", "")
        if alarms and status not in ("ERROR", "MAINTENANCE"):
            issues.append(f"[WARN] Alarms present ({alarms}) but status is '{status}'")

        score = max(0, 100 - len([i for i in issues if "[ERROR]" in i]) * 15
                       - len([i for i in issues if "[WARN]" in i]) * 5)
        return {"score": score, "issues": issues}

    # ── Layer 3: Reliability Assessment ──────────────────────────────────────

    def _reliability_assessment(self, data: Dict[str, Any]) -> Dict[str, Any]:
        issues: List[str] = []
        deductions = 0

        temp = data.get("temperature_c")
        if temp is not None and temp > self.TEMP_MAX_C:
            issues.append(f"[CRITICAL] temperature_c={temp} exceeds max {self.TEMP_MAX_C}°C")
            deductions += 40

        vib = data.get("vibration_mm_s")
        if vib is not None and vib > self.VIBRATION_MAX:
            issues.append(f"[ERROR] vibration_mm_s={vib} exceeds max {self.VIBRATION_MAX}")
            deductions += 20

        pwr = data.get("power_watts", 0)
        if pwr > self.POWER_MAX_W:
            issues.append(f"[ERROR] power_watts={pwr} exceeds max {self.POWER_MAX_W} W")
            deductions += 20

        ct = data.get("cycle_time_ms", 0)
        if ct > self.CYCLE_TIME_MAX_MS:
            issues.append(f"[WARN] cycle_time_ms={ct} unusually high (>{self.CYCLE_TIME_MAX_MS})")
            deductions += 10

        good   = int(data.get("good_parts", 0))
        reject = int(data.get("reject_parts", 0))
        total  = good + reject
        if total > 0 and reject / total > self.REJECT_RATIO_MAX:
            ratio = round(reject / total * 100, 1)
            issues.append(f"[WARN] Reject ratio {ratio}% exceeds threshold "
                          f"{self.REJECT_RATIO_MAX*100}%")
            deductions += 10

        score = max(0, 100 - deductions)
        return {"score": score, "issues": issues, "deductions": deductions}


# ══════════════════════════════════════════════════════════════════════════════
# 5.  AAS Repository  (BaSyx / Eclipse AAS-compatible)
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(slots=True)
class FactoryCobotTelemetry:
    """Normalised collaborative-robot telemetry record."""

    robot_id: str
    line_id: str
    station_id: str
    cycle_time_ms: float
    power_watts: float
    program_name: str
    status: str
    good_parts: int
    reject_parts: int
    temperature_c: Optional[float] = None
    vibration_mm_s: Optional[float] = None
    pose: Dict[str, float] = field(default_factory=dict)
    joint_positions_deg: Dict[str, float] = field(default_factory=dict)
    alarms: List[str] = field(default_factory=list)
    produced_at: str = field(default_factory=_utc_now)

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "FactoryCobotTelemetry":
        return cls(
            robot_id=str(raw["robot_id"]),
            line_id=str(raw["line_id"]),
            station_id=str(raw["station_id"]),
            cycle_time_ms=float(raw["cycle_time_ms"]),
            power_watts=float(raw["power_watts"]),
            program_name=str(raw["program_name"]),
            status=str(raw["status"]),
            good_parts=int(raw.get("good_parts", 0)),
            reject_parts=int(raw.get("reject_parts", 0)),
            temperature_c=float(raw["temperature_c"]) if raw.get("temperature_c") is not None else None,
            vibration_mm_s=float(raw["vibration_mm_s"]) if raw.get("vibration_mm_s") is not None else None,
            pose={str(k): float(v) for k, v in raw.get("pose", {}).items()},
            joint_positions_deg={str(k): float(v) for k, v in raw.get("joint_positions_deg", {}).items()},
            alarms=[str(a) for a in raw.get("alarms", [])],
            produced_at=str(raw.get("produced_at", _utc_now())),
        )


class AASBridge:
    """Maps cobot telemetry to an AAS submodel and uploads it."""

    def __init__(
        self,
        aas_base_url: str,
        submodel_id: str,
        client: Optional[HttpJsonClient] = None,
        auth_key: Optional[str] = None,
    ):
        self.aas_base_url = aas_base_url.rstrip("/")
        self.submodel_id  = submodel_id
        self.client       = client or HttpJsonClient()
        self.auth_key     = auth_key

    @staticmethod
    def _value_type(value: Any) -> str:
        if isinstance(value, bool):   return "boolean"
        if isinstance(value, int):    return "integer"
        if isinstance(value, float):  return "double"
        if isinstance(value, list):   return "string"
        return "string"

    def telemetry_to_submodel(
        self,
        telemetry: FactoryCobotTelemetry,
        elements_override: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        if elements_override:
            submodel_elements = elements_override
        else:
            flat: MutableMapping[str, Any] = {
                "robotId":          telemetry.robot_id,
                "lineId":           telemetry.line_id,
                "stationId":        telemetry.station_id,
                "cycleTimeMs":      telemetry.cycle_time_ms,
                "powerWatts":       telemetry.power_watts,
                "programName":      telemetry.program_name,
                "status":           telemetry.status,
                "goodParts":        telemetry.good_parts,
                "rejectParts":      telemetry.reject_parts,
                "temperatureC":     telemetry.temperature_c,
                "vibrationMmPerSec":telemetry.vibration_mm_s,
                "alarms":           json.dumps(telemetry.alarms),
                "producedAt":       telemetry.produced_at,
            }
            for axis, val in telemetry.pose.items():
                flat[f"pose_{axis}"] = val
            for joint, val in telemetry.joint_positions_deg.items():
                flat[f"joint_{joint}_deg"] = val

            submodel_elements = [
                {
                    "modelType": "Property",
                    "idShort": key,
                    "valueType": self._value_type(value),
                    "value": value,
                }
                for key, value in flat.items()
                if value is not None
            ]

        return {
            "idShort": "CobotOperationalData",
            "modelType": "Submodel",
            "id": self.submodel_id,
            "submodelElements": submodel_elements,
        }

    def upsert_submodel(
        self,
        telemetry: FactoryCobotTelemetry,
        elements_override: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        payload = self.telemetry_to_submodel(telemetry, elements_override)
        hdrs = {}
        if self.auth_key:
            hdrs["X-Api-Key"] = self.auth_key
        url = f"{self.aas_base_url}/submodels/{self.submodel_id}"
        LOGGER.info("Upserting AAS submodel robot_id=%s", telemetry.robot_id)
        return self.client.request_json("PUT", url, payload=payload, headers=hdrs)

    # Legacy method alias kept for backwards compat
    def upsert_telemetry(self, telemetry: FactoryCobotTelemetry) -> Dict[str, Any]:
        return self.upsert_submodel(telemetry)


# ══════════════════════════════════════════════════════════════════════════════
# 6.  EDC Connector  (asset / policy / contract registration)
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(slots=True)
class EDCAsset:
    asset_id: str
    name: str
    base_url: str
    data_path: str
    description: str
    content_type: str = "application/json"
    properties: Dict[str, Any] = field(default_factory=dict)

    def to_management_payload(self) -> Dict[str, Any]:
        return {
            "asset": {
                "properties": {
                    "asset:prop:id":          self.asset_id,
                    "asset:prop:name":        self.name,
                    "asset:prop:contenttype": self.content_type,
                    "asset:prop:description": self.description,
                    **self.properties,
                }
            },
            "dataAddress": {
                "type":            "HttpData",
                "baseUrl":         self.base_url.rstrip("/"),
                "path":            self.data_path,
                "proxyMethod":     "true",
                "proxyPath":       "true",
                "proxyQueryParams":"true",
                "proxyBody":       "true",
            },
        }


@dataclass(slots=True)
class EDCPolicy:
    policy_id: str
    assignee: str
    target: str
    action: str = "USE"
    left_operand: str = "BusinessPartnerNumber"
    operator: str = "EQ"

    def to_management_payload(self) -> Dict[str, Any]:
        return {
            "@context": {
                "@vocab": "https://w3id.org/edc/v0.0.1/ns/",
                "odrl":   "http://www.w3.org/ns/odrl/2/",
            },
            "@id":   self.policy_id,
            "@type": "PolicyDefinition",
            "policy": {
                "@context": "http://www.w3.org/ns/odrl.jsonld",
                "@type":    "Set",
                "permission": [{
                    "action": self.action,
                    "constraint": {
                        "leftOperand":  self.left_operand,
                        "operator":     self.operator,
                        "rightOperand": self.assignee,
                    },
                    "target": self.target,
                }],
            },
        }


@dataclass(slots=True)
class ContractDefinition:
    contract_definition_id: str
    access_policy_id: str
    contract_policy_id: str
    asset_id: str

    def to_management_payload(self) -> Dict[str, Any]:
        return {
            "@id":   self.contract_definition_id,
            "@type": "ContractDefinition",
            "accessPolicyId":   self.access_policy_id,
            "contractPolicyId": self.contract_policy_id,
            "assetsSelector": [{
                "@type":       "Criterion",
                "operandLeft": "https://w3id.org/edc/v0.0.1/ns/id",
                "operator":    "=",
                "operandRight": self.asset_id,
            }],
        }


class EDCConnectorService:
    def __init__(
        self,
        management_url: str,
        client: Optional[HttpJsonClient] = None,
        api_key: Optional[str] = None,
    ):
        self.management_url = management_url.rstrip("/")
        self.client  = client or HttpJsonClient()
        self.api_key = api_key

    def _hdrs(self) -> Dict[str, str]:
        return {"X-Api-Key": self.api_key} if self.api_key else {}

    def register_asset(self, asset: EDCAsset) -> Dict[str, Any]:
        return self.client.request_json(
            "POST", f"{self.management_url}/v3/assets",
            payload=asset.to_management_payload(), headers=self._hdrs())

    def create_policy(self, policy: EDCPolicy) -> Dict[str, Any]:
        return self.client.request_json(
            "POST", f"{self.management_url}/v3/policydefinitions",
            payload=policy.to_management_payload(), headers=self._hdrs())

    def create_contract_definition(self, definition: ContractDefinition) -> Dict[str, Any]:
        return self.client.request_json(
            "POST", f"{self.management_url}/v3/contractdefinitions",
            payload=definition.to_management_payload(), headers=self._hdrs())

    def request_catalog(
        self,
        counter_party_protocol_url: str,
        asset_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "counterPartyAddress": counter_party_protocol_url,
            "protocol": "dataspace-protocol-http",
        }
        if asset_id:
            payload["querySpec"] = {"filterExpression": [{
                "operandLeft":  "https://w3id.org/edc/v0.0.1/ns/id",
                "operator":     "=",
                "operandRight": asset_id,
            }]}
        return self.client.request_json(
            "POST", f"{self.management_url}/v3/catalog/request",
            payload=payload, headers=self._hdrs())

    def negotiate_contract(
        self,
        counter_party_protocol_url: str,
        asset_id: str,
        offer_id: str,
        provider_participant_id: str,
        consumer_participant_id: str,
    ) -> Dict[str, Any]:
        payload = {
            "@type": "ContractRequest",
            "counterPartyAddress": counter_party_protocol_url,
            "protocol":  "dataspace-protocol-http",
            "providerId": provider_participant_id,
            "connectorId": consumer_participant_id,
            "offer": {
                "@id":        offer_id,
                "assetId":    asset_id,
                "providerId": provider_participant_id,
            },
        }
        return self.client.request_json(
            "POST", f"{self.management_url}/v3/contractnegotiations",
            payload=payload, headers=self._hdrs())


# ══════════════════════════════════════════════════════════════════════════════
# 7.  Full Pipeline  (orchestrator)
# ══════════════════════════════════════════════════════════════════════════════

class CobotEDCPipeline:
    """
    High-level orchestrator.

    run_full_pipeline()  →  pre-process → map → AI-build → validate → AAS push → EDC register
    """

    def __init__(
        self,
        connector:   Optional[EDCConnectorService] = None,
        aas_bridge:  Optional[AASBridge] = None,
        ai_agent:    Optional[OllamaAASAgent] = None,
        validator:   Optional[AASValidator]   = None,
    ):
        self.connector  = connector
        self.aas_bridge = aas_bridge
        self.ai_agent   = ai_agent
        self.validator  = validator or AASValidator()
        self.preprocessor = TelemetryPreprocessor()
        self.mapper       = TelemetryMapper()

    # ── main entry ────────────────────────────────────────────────────────────

    def run_full_pipeline(
        self,
        raw: Dict[str, Any],
        skip_aas_push: bool = False,
        run_edc:       bool = False,
        asset_id:      Optional[str] = None,
        provider_bpn:  Optional[str] = None,
        cobot_api_base_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Execute the full pipeline and return a structured result dict.
        """
        result: Dict[str, Any] = {
            "pipeline_start": _utc_now(),
            "stages": {},
        }

        # 1. Preprocess
        LOGGER.info("[Pipeline] Stage 1: Preprocessing")
        preprocessed = self.preprocessor.preprocess(raw)
        cleaned = preprocessed.cleaned
        result["stages"]["preprocessing"] = preprocessed.stage_summary()

        # 2. Map
        LOGGER.info("[Pipeline] Stage 2: Mapping")
        mapped_fields = self.mapper.map(cleaned)
        result["stages"]["mapping"] = {
            "status": "ok",
            "field_count": len(mapped_fields),
            "mapped": [{"key": f.source_key, "idShort": f.id_short} for f in mapped_fields],
        }

        # 3. AI Agent
        elements: List[Dict[str, Any]] = []
        if self.ai_agent:
            LOGGER.info("[Pipeline] Stage 3: AI Agent (Ollama)")
            try:
                metamodel = self.ai_agent.infer_metamodel(
                    cleaned.get("robot_id", ""),
                    cleaned.get("program_name", ""),
                    cleaned.get("alarms", []),
                )
                elements = self.ai_agent.build_submodel_elements(mapped_fields, metamodel)
                aas_code = self.ai_agent.generate_aas_code(mapped_fields)
                result["stages"]["ai_agent"] = {
                    "status": "ok",
                    "metamodel": metamodel,
                    "elements_count": len(elements),
                    "generated_code_lines": len(aas_code.splitlines()),
                    "generated_code": aas_code,
                }
            except OllamaAgentError as exc:
                LOGGER.warning("[Pipeline] AI Agent unavailable: %s — using rule-based fallback", exc)
                result["stages"]["ai_agent"] = {
                    "status": "fallback",
                    "reason": str(exc),
                }
        else:
            result["stages"]["ai_agent"] = {"status": "skipped", "reason": "no agent configured"}

        # 4. Validate
        LOGGER.info("[Pipeline] Stage 4: Validation")
        if not elements:
            # Use rule-based elements for validation
            elements = [
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

        report = self.validator.validate(elements, cleaned)
        result["stages"]["validation"] = {
            "passed":       report.passed,
            "overall_score": report.overall_score,
            "standard_integrity": report.standard_integrity,
            "semantic_cross_val": report.semantic_cross_val,
            "reliability_assessment": report.reliability_assessment,
            "issues": report.issues,
        }

        # 5. AAS push
        if not skip_aas_push:
            LOGGER.info("[Pipeline] Stage 5: AAS Repository push")
            if not self.aas_bridge:
                result["stages"]["aas_push"] = {"status": "skipped", "reason": "no AAS bridge configured"}
            else:
                try:
                    telemetry = FactoryCobotTelemetry.from_dict(cleaned)
                    aas_resp  = self.aas_bridge.upsert_submodel(telemetry, elements_override=elements)
                    result["stages"]["aas_push"] = {"status": "ok", "response": aas_resp}
                except RuntimeError as exc:
                    result["stages"]["aas_push"] = {"status": "error", "reason": str(exc)}
        else:
            result["stages"]["aas_push"] = {"status": "skipped"}

        # 6. EDC registration
        if run_edc and asset_id and provider_bpn and cobot_api_base_url:
            LOGGER.info("[Pipeline] Stage 6: EDC registration")
            if not self.connector or not self.aas_bridge:
                result["stages"]["edc_registration"] = {"status": "skipped", "reason": "EDC connector or AAS bridge not configured"}
            else:
                try:
                    edc_result = self.onboard_cobot_asset(asset_id, provider_bpn, cobot_api_base_url)
                    result["stages"]["edc_registration"] = {"status": "ok", **edc_result}
                except RuntimeError as exc:
                    result["stages"]["edc_registration"] = {"status": "error", "reason": str(exc)}
        else:
            result["stages"]["edc_registration"] = {"status": "skipped"}

        result["pipeline_end"] = _utc_now()
        result["final_elements"] = elements
        result["validation_passed"] = report.passed
        return result

    # ── EDC onboarding ────────────────────────────────────────────────────────

    def onboard_cobot_asset(
        self,
        asset_id: str,
        provider_bpn: str,
        cobot_api_base_url: str,
        cobot_data_path: str = "/api/v1/cobot/telemetry",
    ) -> Dict[str, Any]:
        if not self.connector:
            raise RuntimeError("EDC connector is not configured")
        if not self.aas_bridge:
            raise RuntimeError("AAS bridge is not configured")
        asset = EDCAsset(
            asset_id=asset_id,
            name=f"Cobot telemetry {asset_id}",
            base_url=cobot_api_base_url,
            data_path=cobot_data_path,
            description="Operational telemetry stream from a collaborative robot",
            properties={
                "catenax:providerBpn":  provider_bpn,
                "catenax:assetType":    "factory-cobot-telemetry",
                "catenax:semanticId":   self.aas_bridge.submodel_id,
            },
        )
        access_policy   = EDCPolicy(f"{asset_id}-access-policy",   provider_bpn, asset_id)
        contract_policy = EDCPolicy(f"{asset_id}-contract-policy", provider_bpn, asset_id)
        contract        = ContractDefinition(
            contract_definition_id=f"{asset_id}-contract",
            access_policy_id=access_policy.policy_id,
            contract_policy_id=contract_policy.policy_id,
            asset_id=asset_id,
        )
        LOGGER.info("Onboarding EDC asset asset_id=%s provider_bpn=%s", asset_id, provider_bpn)
        return {
            "asset":               self.connector.register_asset(asset),
            "access_policy":       self.connector.create_policy(access_policy),
            "contract_policy":     self.connector.create_policy(contract_policy),
            "contract_definition": self.connector.create_contract_definition(contract),
        }

    def publish_telemetry_to_aas(
        self,
        telemetry: Mapping[str, Any] | FactoryCobotTelemetry,
    ) -> Dict[str, Any]:
        if not self.aas_bridge:
            raise RuntimeError("AAS bridge is not configured")
        if not isinstance(telemetry, FactoryCobotTelemetry):
            telemetry = FactoryCobotTelemetry.from_dict(
                self.preprocessor.preprocess(telemetry).cleaned
            )
        return self.aas_bridge.upsert_telemetry(telemetry)


# ══════════════════════════════════════════════════════════════════════════════
# 8.  Factory helpers  (build from env)
# ══════════════════════════════════════════════════════════════════════════════

def build_aas_bridge_from_env() -> AASBridge:
    aas_base_url = os.environ["CATENAX_AAS_BASE_URL"]
    submodel_id  = os.environ["CATENAX_AAS_SUBMODEL_ID"]
    aas_api_key  = os.environ.get("CATENAX_AAS_API_KEY")
    return AASBridge(aas_base_url=aas_base_url, submodel_id=submodel_id, auth_key=aas_api_key)


def build_connector_from_env() -> EDCConnectorService:
    management_url = os.environ["CATENAX_EDC_MANAGEMENT_URL"]
    edc_api_key   = os.environ.get("CATENAX_EDC_API_KEY")
    return EDCConnectorService(management_url=management_url, api_key=edc_api_key)


def build_ai_agent_from_env() -> OllamaAASAgent:
    ollama_url   = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model = os.environ.get("OLLAMA_MODEL", "qwen3:27b")
    ollama_timeout_raw = os.environ.get("OLLAMA_TIMEOUT", "120")
    try:
        ollama_timeout = float(ollama_timeout_raw)
    except ValueError:
        LOGGER.warning("Invalid OLLAMA_TIMEOUT=%r; using default 120 seconds", ollama_timeout_raw)
        ollama_timeout = 120.0

    return OllamaAASAgent(
        base_url=ollama_url,
        model=ollama_model,
        timeout=ollama_timeout,
    )


def build_pipeline_from_env(include_ai: bool = True) -> CobotEDCPipeline:
    return CobotEDCPipeline(
        connector=build_connector_from_env(),
        aas_bridge=build_aas_bridge_from_env(),
        ai_agent=build_ai_agent_from_env() if include_ai else None,
    )


def _load_json(path: str, telemetry_index: int = 0) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)

    if isinstance(payload, dict):
        return payload

    if isinstance(payload, list):
        if not payload:
            raise ValueError(f"Telemetry list is empty: {path}")
        if telemetry_index < 0 or telemetry_index >= len(payload):
            raise ValueError(
                f"telemetry-index {telemetry_index} out of range (size={len(payload)})"
            )
        picked = payload[telemetry_index]
        if not isinstance(picked, dict):
            raise ValueError(
                f"Telemetry entry at index {telemetry_index} must be an object/dict"
            )
        LOGGER.info(
            "Loaded telemetry from list file=%s index=%s total=%s",
            path, telemetry_index, len(payload),
        )
        return picked

    raise ValueError(f"Unsupported telemetry JSON type: {type(payload).__name__}")


# ══════════════════════════════════════════════════════════════════════════════
# 9.  CLI  entry point
# ══════════════════════════════════════════════════════════════════════════════

def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Catena-X EDC + AAS + AI pipeline")
    sub    = parser.add_subparsers(dest="command", required=True)

    # onboard
    onboard = sub.add_parser("onboard", help="register cobot asset in EDC")
    onboard.add_argument("--asset-id",           required=True)
    onboard.add_argument("--provider-bpn",        required=True)
    onboard.add_argument("--cobot-api-base-url",  required=True)
    onboard.add_argument("--cobot-data-path",     default="/api/v1/cobot/telemetry")

    # sync-aas  (legacy, rule-based only)
    sync = sub.add_parser("sync-aas", help="push a telemetry JSON to AAS")
    sync.add_argument("--telemetry-json", required=True)
    sync.add_argument("--telemetry-index", default=0, type=int,
                      help="when telemetry JSON is a list, choose item index")

    # pipeline  (full AI pipeline)
    pipe = sub.add_parser("pipeline", help="run the full AI preprocessing pipeline")
    pipe.add_argument("--telemetry-json",  required=True)
    pipe.add_argument("--telemetry-index", default=0, type=int,
                      help="when telemetry JSON is a list, choose item index")
    pipe.add_argument("--skip-aas-push",   action="store_true")
    pipe.add_argument("--run-edc",         action="store_true")
    pipe.add_argument("--asset-id")
    pipe.add_argument("--provider-bpn")
    pipe.add_argument("--cobot-api-base-url")

    args = parser.parse_args(list(argv) if argv is not None else None)
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if args.command == "onboard":
        pipeline = CobotEDCPipeline(
            connector=build_connector_from_env(),
            aas_bridge=build_aas_bridge_from_env(),
        )
        result = pipeline.onboard_cobot_asset(
            asset_id=args.asset_id,
            provider_bpn=args.provider_bpn,
            cobot_api_base_url=args.cobot_api_base_url,
            cobot_data_path=args.cobot_data_path,
        )
    elif args.command == "sync-aas":
        pipeline = CobotEDCPipeline(aas_bridge=build_aas_bridge_from_env())
        result = pipeline.publish_telemetry_to_aas(
            _load_json(args.telemetry_json, args.telemetry_index)
        )
    else:  # pipeline
        pipeline = build_pipeline_from_env(include_ai=True)
        result = pipeline.run_full_pipeline(
            raw=_load_json(args.telemetry_json, args.telemetry_index),
            skip_aas_push=args.skip_aas_push,
            run_edc=args.run_edc,
            asset_id=getattr(args, "asset_id", None),
            provider_bpn=getattr(args, "provider_bpn", None),
            cobot_api_base_url=getattr(args, "cobot_api_base_url", None),
        )

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
