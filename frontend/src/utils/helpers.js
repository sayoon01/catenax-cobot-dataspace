const { SAMPLES, SEMANTIC_MAP } = window.CX_CONSTANTS;

const toCamel = (value) =>
  value
    .split("_")
    .map((part, index) =>
      index ? part[0].toUpperCase() + part.slice(1) : part
    )
    .join("");

const inferType = (value) => {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "double";
  return "string";
};

function buildAASElements(telemetry) {
  const skip = new Set(["_preprocessed_at", "_warnings", "stored_at"]);
  const flat = {};

  Object.entries(telemetry).forEach(([key, value]) => {
    if (skip.has(key)) return;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.entries(value).forEach(([subKey, subValue]) => {
        flat[`${key}_${subKey}`] = subValue;
      });
      return;
    }
    flat[key] = Array.isArray(value) ? JSON.stringify(value) : value;
  });

  return Object.entries(flat)
    .filter(([, value]) => value != null)
    .map(([key, value]) => ({
      modelType: "Property",
      idShort: toCamel(key),
      valueType: inferType(value),
      value,
      semanticId: SEMANTIC_MAP[key] || `custom:catenax:${key}`,
    }));
}

function preprocess(raw) {
  const cleaned = { ...raw };
  const warnings = [];
  const defaults = {
    good_parts: 0,
    reject_parts: 0,
    alarms: [],
    pose: {},
    joint_positions_deg: {},
    temperature_c: null,
    vibration_mm_s: null,
  };

  Object.entries(defaults).forEach(([key, value]) => {
    if (key in cleaned) return;
    cleaned[key] = value;
    warnings.push(`기본값 추가: '${key}'`);
  });

  ["cycle_time_ms", "power_watts"].forEach((field) => {
    cleaned[field] = parseFloat(cleaned[field]) || 0;
    if (cleaned[field] < 0) {
      cleaned[field] = 0;
      warnings.push(`음수 클램핑: ${field}`);
    }
  });

  const validStatus = ["RUNNING", "IDLE", "ERROR", "MAINTENANCE", "STARTING", "STOPPING"];
  if (!validStatus.includes((cleaned.status || "").toUpperCase())) {
    warnings.push(`알 수 없는 status '${cleaned.status}' → IDLE`);
    cleaned.status = "IDLE";
  } else {
    cleaned.status = cleaned.status.toUpperCase();
  }

  if (!Array.isArray(cleaned.alarms)) {
    cleaned.alarms = [String(cleaned.alarms)];
  }

  if (!cleaned.produced_at) {
    cleaned.produced_at = new Date().toISOString();
    warnings.push("produced_at 추가");
  }

  cleaned._preprocessed_at = new Date().toISOString();
  return { cleaned, warnings };
}

function mapFields(data) {
  const skip = new Set(["_preprocessed_at", "_warnings"]);

  return Object.entries(data)
    .flatMap(([key, value]) => {
      if (skip.has(key)) return [];

      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.entries(value).map(([subKey, subValue]) => {
          const compositeKey = `${key}_${subKey}`;
          return {
            sourceKey: compositeKey,
            idShort: toCamel(compositeKey),
            valueType: inferType(subValue),
            value: subValue,
            semanticId: SEMANTIC_MAP[compositeKey] || `custom:catenax:${compositeKey}`,
          };
        });
      }

      return [{
        sourceKey: key,
        idShort: toCamel(key),
        valueType: inferType(value),
        value: Array.isArray(value) ? JSON.stringify(value) : value,
        semanticId: SEMANTIC_MAP[key] || `custom:catenax:${key}`,
      }];
    })
    .filter((field) => field.value != null);
}

function runValidation(elements, data) {
  const issues = [];
  const required = ["RobotId", "LineId", "StationId", "CycleTimeMs", "PowerWatts", "Status"];
  const present = new Set(elements.map((element) => element.idShort));
  let l1 = 100;

  required.forEach((name) => {
    if (present.has(name)) return;
    issues.push({ layer: 1, level: "CRITICAL", msg: `필수 AAS Property 누락: ${name}` });
    l1 -= 25;
  });

  elements.forEach((element) => {
    if (element.semanticId) return;
    issues.push({ layer: 1, level: "WARN", msg: `semanticId 없음: ${element.idShort}` });
    l1 -= 3;
  });

  let l2 = 100;
  const alarms = data.alarms || [];
  const status = data.status || "";
  if (alarms.length > 0 && !["ERROR", "MAINTENANCE"].includes(status)) {
    issues.push({ layer: 2, level: "WARN", msg: `알람(${alarms.join(",")}) 발생 중이나 status='${status}'` });
    l2 -= 15;
  }

  const goodParts = data.good_parts || 0;
  const rejectParts = data.reject_parts || 0;
  if (goodParts + rejectParts === 0 && status === "RUNNING") {
    issues.push({ layer: 2, level: "INFO", msg: "RUNNING이나 생산 부품 0개" });
    l2 -= 5;
  }

  let l3 = 100;
  if (data.temperature_c > 85) {
    issues.push({ layer: 3, level: "CRITICAL", msg: `온도 ${data.temperature_c}°C > 85°C` });
    l3 -= 40;
  }
  if ((data.alarms || []).some((alarm) => /FAULT|ESTOP|TRIGGERED/i.test(String(alarm)))) {
    issues.push({ layer: 3, level: "CRITICAL", msg: `알람(${(data.alarms || []).join(", ")}) 발생 - 신뢰성 임계값 초과` });
    l3 -= 35;
  }
  if (data.vibration_mm_s > 10) {
    issues.push({ layer: 3, level: "ERROR", msg: `진동 ${data.vibration_mm_s}mm/s > 10mm/s` });
    l3 -= 20;
  }
  if (data.power_watts > 2000) {
    issues.push({ layer: 3, level: "ERROR", msg: `전력 ${data.power_watts}W > 2000W` });
    l3 -= 20;
  }
  if (goodParts + rejectParts > 0 && rejectParts / (goodParts + rejectParts) > 0.1) {
    issues.push({ layer: 3, level: "WARN", msg: `불량률 ${((rejectParts / (goodParts + rejectParts)) * 100).toFixed(1)}% > 10%` });
    l3 -= 10;
  }

  const scores = {
    l1: Math.max(0, l1),
    l2: Math.max(0, l2),
    l3: Math.max(0, l3),
  };
  const overall = Math.round((scores.l1 + scores.l2 + scores.l3) / 3);

  return {
    passed: overall >= 60 && !issues.some((issue) => issue.level === "CRITICAL"),
    overall_score: overall,
    issues,
    ...scores,
  };
}

function fallbackMetamodel(data) {
  const program = data.program_name || "";
  const domain =
    program.includes("weld") ? "welding" :
    program.includes("paint") ? "painting" :
    program.includes("assembly") ? "assembly" :
    program.includes("inspect") ? "inspection" :
    "general-manufacturing";
  const alarms = data.alarms || [];

  return {
    domain,
    risk_level: alarms.length > 1 ? "high" : alarms.length === 1 ? "medium" : "low",
    idta_template: `IDTA-02003-1-2_${domain}`,
    recommended_submodel_id: `urn:idta:cobot:${domain}:${data.robot_id}`,
    semantic_version: "1.0",
    analysis: `${data.robot_id}은 ${domain} 도메인, status=${data.status}`,
    suggested_optimizations: ["AAS 자동 동기화 설정", "데이터 수집 주기 최적화"],
  };
}

function fallbackCode(fields, cleaned) {
  const props = fields
    .slice(0, 10)
    .map((field) => `    model.Property(
        id_short="${field.idShort}",
        value_type=model.datatypes.${field.valueType === "double" ? "Double" : field.valueType === "integer" ? "Int" : "String"},
        value=${JSON.stringify(field.value)}
    )`)
    .join(",\n");

  return `"""AAS Submodel Builder - generated by Catena-X AI Agent"""
import basyx.aas.model as model

def build_cobot_submodel(robot_id: str) -> model.Submodel:
    """Build AAS Submodel for cobot: ${cleaned.robot_id}"""
    return model.Submodel(
        id_short="CobotOperationalData",
        id=f"urn:aas:cobot:{robot_id}:submodel",
        submodel_element={
${props}
        }
    )`;
}

async function callAI(systemPrompt, userPrompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

function extractJSON(text) {
  const clean = text.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

window.CX_HELPERS = {
  SAMPLES,
  buildAASElements,
  preprocess,
  mapFields,
  runValidation,
  fallbackMetamodel,
  fallbackCode,
  callAI,
  extractJSON,
  sleep,
};
