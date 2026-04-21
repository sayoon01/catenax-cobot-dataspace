(function () {
  var stepData = {
    preprocess: {
      title: "전처리",
      body: "원본 텔레메트리를 파이프라인에서 다루기 쉬운 형태로 정리합니다.",
      input: "server/data/sample_telemetry.json",
      output: "정규화된 cobot telemetry payload",
      check: "JSON 경로와 telemetry-index가 실제 샘플 범위 안에 있는지 확인합니다.",
    },
    aas: {
      title: "AAS 매핑",
      body: "semantic_map.json 기준으로 텔레메트리 필드를 AAS Submodel 구조에 맞춥니다.",
      input: "apps/aas_mapper.py · semantic_map.json",
      output: "AAS Submodel 업데이트 payload",
      check: "필드명이 매핑 파일과 일치하지 않으면 누락 값이 생길 수 있습니다.",
    },
    ai: {
      title: "AI 보조",
      body: "파이프라인 실행 시 로컬 LLM을 사용해 매핑 설명이나 검증 보조 결과를 생성합니다.",
      input: "apps/ai_agent.py · OLLAMA_BASE_URL",
      output: "AI 보조 분석 결과",
      check: "Ollama가 연결되지 않으면 rule-based fallback으로 진행됩니다.",
    },
    validate: {
      title: "검증",
      body: "파이프라인 산출물이 등록 가능한 데이터인지 검사합니다.",
      input: "apps/edc.py pipeline",
      output: "검증 로그와 실패 원인",
      check: "처음 실행 시 검증만 먼저 통과시키는 흐름이 안정적입니다.",
    },
    push: {
      title: "AAS 푸시",
      body: "검증된 Submodel 데이터를 AAS Repository로 전송합니다.",
      input: "CATENAX_AAS_BASE_URL · Submodel ID",
      output: "AAS Repository 업데이트",
      check: "AAS URL/인증을 먼저 확인하고 실행합니다.",
    },
    register: {
      title: "EDC 등록",
      body: "Cobot API 조회 경로를 HttpData 자산으로 EDC Management API에 등록합니다.",
      input: "CATENAX_EDC_MANAGEMENT_URL · asset-id · provider-bpn",
      output: "EDC Asset, Policy, Contract Definition",
      check: "Asset ID 중복과 Provider BPN 값을 먼저 확정합니다.",
    },
  };

  var actionLabel = {
    validate: "검증",
    aas_push: "AAS 푸시",
    edc_register: "EDC 등록",
  };
  var stageOrder = [
    ["전처리", "preprocessing"],
    ["AAS 매핑", "mapping"],
    ["AI 보조", "ai_agent"],
    ["검증", "validation"],
    ["AAS 푸시", "aas_push"],
    ["EDC 등록", "edc_registration"],
  ];
  var THRESHOLD_TEMP_C = 75;
  var THRESHOLD_VIBE_MM_S = 5;
  var HISTORY_LIMIT = 12;
  var lastEdcStatus = null;

  function toNum(v, d) {
    var n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  function rejectRatio(r) {
    var good = toNum(r.good_parts, 0);
    var reject = toNum(r.reject_parts, 0);
    var total = good + reject;
    return total ? reject / total : 0;
  }

  function riskScore(r) {
    var st = String(r.status || "UNKNOWN").toUpperCase();
    var score = 0;
    if (st === "FAULT" || st === "ERROR") score += 100;
    else if (st === "WARNING") score += 60;
    var temp = toNum(r.temperature_c, NaN);
    if (Number.isFinite(temp) && temp > THRESHOLD_TEMP_C) score += (temp - THRESHOLD_TEMP_C) * 2.5;
    var vib = toNum(r.vibration_mm_s, NaN);
    if (Number.isFinite(vib) && vib > THRESHOLD_VIBE_MM_S) score += (vib - THRESHOLD_VIBE_MM_S) * 12;
    score += rejectRatio(r) * 80;
    if (Array.isArray(r.alarms) && r.alarms.length) score += Math.min(r.alarms.length * 8, 24);
    return Math.round(score * 10) / 10;
  }

  function latestByRobot(items) {
    var byRobot = new Map();
    items.forEach(function (row) {
      var id = row.robot_id || "unknown";
      var ts = Date.parse(row.stored_at || row.produced_at || "") || 0;
      var prev = byRobot.get(id);
      var prevTs = prev ? (Date.parse(prev.stored_at || prev.produced_at || "") || 0) : -1;
      if (!prev || ts >= prevTs) byRobot.set(id, row);
    });
    return Array.from(byRobot.values());
  }

  function fieldValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function currentApiBase() {
    var fromField = fieldValue("edc-api-base-url");
    if (fromField) return fromField.replace(/\/$/, "");
    return window.location.origin && window.location.origin.indexOf("http") === 0
      ? window.location.origin
      : "http://localhost:8080";
  }

  function renderStepDetail(key) {
    var detail = document.getElementById("edc-step-detail");
    var data = stepData[key];
    if (!detail || !data) return;
    detail.innerHTML = [
      '<div class="edc-step-detail-title">' + data.title + "</div>",
      "<p>" + data.body + "</p>",
      "<dl>",
      "<div><dt>입력</dt><dd>" + data.input + "</dd></div>",
      "<div><dt>출력</dt><dd>" + data.output + "</dd></div>",
      "<div><dt>확인</dt><dd>" + data.check + "</dd></div>",
      "</dl>",
    ].join("");
  }

  function setRunBusy(busy, action) {
    var status = document.getElementById("edc-run-status");
    if (status) status.textContent = busy ? actionLabel[action] + " 실행 중" : "대기 중";
    document.querySelectorAll("[data-edc-action]").forEach(function (btn) {
      btn.disabled = busy;
    });
  }

  function setProgress(percent, text) {
    var bar = document.getElementById("edc-progress-bar");
    var msg = document.getElementById("edc-progress-text");
    if (bar) bar.style.width = Math.max(0, Math.min(100, percent)) + "%";
    if (msg && text) msg.textContent = text;
  }

  function buildRunPayload(action) {
    return {
      action: action,
      telemetry_source: fieldValue("edc-telemetry-source") || "latest",
      telemetry_index: Number(fieldValue("edc-telemetry-index") || 0),
      asset_id: fieldValue("edc-asset-id"),
      provider_bpn: fieldValue("edc-provider-bpn"),
      cobot_api_base_url: currentApiBase(),
      include_ai: !!document.getElementById("edc-include-ai").checked,
    };
  }

  function stageStatusClass(stage) {
    if (!stage) return "is-muted";
    if (stage.status === "ok" || stage.passed === true) return "is-ok";
    if (stage.status === "error" || stage.passed === false) return "is-error";
    if (stage.status === "fallback") return "is-warn";
    return "is-muted";
  }

  function stageText(name, stage) {
    if (!stage) return name + ": 미실행";
    if (typeof stage.passed === "boolean") {
      return (
        name +
        ": " +
        (stage.passed ? "통과" : "실패") +
        (typeof stage.overall_score === "number" ? " · score " + stage.overall_score : "")
      );
    }
    return name + ": " + (stage.status || "완료");
  }

  function renderResult(payload, ok) {
    var empty = document.getElementById("edc-result-empty");
    var summary = document.getElementById("edc-result-summary");
    var stages = document.getElementById("edc-stage-list");
    var raw = document.getElementById("edc-result-json");
    if (empty) empty.classList.add("is-hidden");
    if (summary) {
      summary.classList.remove("is-hidden", "is-ok", "is-error");
      summary.classList.add(ok ? "is-ok" : "is-error");
      var result = payload.result || {};
      var validation = result.stages && result.stages.validation;
      var telemetry = payload.telemetry || {};
      summary.innerHTML = [
        "<strong>" + (actionLabel[payload.action] || "실행") + (ok ? " 완료" : " 실패") + "</strong>",
        "<span>robot: " + (telemetry.robot_id || "-") + "</span>",
        validation
          ? "<span>validation: " +
            (validation.passed ? "통과" : "실패") +
            (typeof validation.overall_score === "number" ? " · " + validation.overall_score : "") +
            "</span>"
          : "",
        payload.error ? "<span>" + payload.error + "</span>" : "",
      ].join("");
    }
    if (stages) {
      var stageMap = (payload.result && payload.result.stages) || {};
      stages.classList.remove("is-hidden");
      stages.innerHTML = stageOrder
        .map(function (row) {
          var stage = stageMap[row[1]];
          return '<div class="edc-stage-row ' + stageStatusClass(stage) + '">' + stageText(row[0], stage) + "</div>";
        })
        .join("");
    }
    if (raw) {
      raw.classList.remove("is-hidden");
      raw.textContent = JSON.stringify(payload, null, 2);
    }
  }

  function clearResult() {
    var empty = document.getElementById("edc-result-empty");
    var summary = document.getElementById("edc-result-summary");
    var stages = document.getElementById("edc-stage-list");
    var raw = document.getElementById("edc-result-json");
    if (empty) empty.classList.remove("is-hidden");
    if (summary) summary.className = "edc-result-summary is-hidden";
    if (stages) stages.className = "edc-stage-list is-hidden";
    if (raw) {
      raw.classList.add("is-hidden");
      raw.textContent = "";
    }
    setProgress(0, "실행 전");
  }

  function setHealth(id, state, text) {
    var el = document.getElementById(id);
    if (!el) return;
    var card = el.closest(".edc-health-card");
    if (card) {
      card.classList.remove("is-ok", "is-warn", "is-error");
      if (state) card.classList.add(state);
    }
    el.textContent = text;
  }

  function setEnvSummary(state, text) {
    var el = document.getElementById("edc-env-summary");
    if (!el) return;
    el.classList.remove("is-ok", "is-warn", "is-error");
    if (state) el.classList.add(state);
    el.textContent = text;
  }

  function renderEnvStatus(status) {
    lastEdcStatus = status;
    var grid = document.getElementById("edc-env-grid");
    if (!grid) return;
    var readiness = status.readiness || {};
    var aasReady = readiness.aas_push && readiness.aas_push.ready;
    var edcReady = readiness.edc_register && readiness.edc_register.ready;
    if (edcReady) setEnvSummary("is-ok", "검증, AAS 푸시, EDC 등록 준비 완료");
    else if (aasReady) setEnvSummary("is-warn", "AAS 푸시는 가능 · EDC 등록 환경 변수 확인 필요");
    else setEnvSummary("is-error", "AAS/EDC 실행에 필요한 환경 변수가 부족합니다");

    grid.innerHTML = (status.env || []).map(function (item) {
      var cls = item.configured ? "is-ok" : "is-error";
      var value = item.value || "미설정";
      return [
        '<div class="edc-env-card ' + cls + '">',
        '<div class="edc-env-name">' + item.name + "</div>",
        '<div class="edc-env-label">' + item.label + "</div>",
        '<div class="edc-env-value">' + value + "</div>",
        "</div>",
      ].join("");
    }).join("");

    document.querySelectorAll("[data-edc-action]").forEach(function (btn) {
      var action = btn.getAttribute("data-edc-action");
      var ready = !readiness[action] || readiness[action].ready;
      btn.classList.toggle("has-env-warning", !ready);
      btn.title = ready ? "" : "필요 환경 변수: " + readiness[action].missing_env.join(", ");
    });
  }

  async function refreshEnvStatus() {
    var grid = document.getElementById("edc-env-grid");
    if (grid) grid.innerHTML = "";
    setEnvSummary("", "확인 중...");
    try {
      var res = await fetch(currentApiBase() + "/api/v1/edc/status");
      if (!res.ok) throw new Error("HTTP " + res.status);
      var status = await res.json();
      renderEnvStatus(status);
      return status;
    } catch (err) {
      lastEdcStatus = null;
      setEnvSummary("is-error", "환경 변수 상태 API 연결 실패");
      if (grid) {
        grid.innerHTML = '<div class="edc-ops-empty" style="grid-column:1/-1;">/api/v1/edc/status 응답을 확인하세요.</div>';
      }
      return null;
    }
  }

  function renderHistory(history) {
    var el = document.getElementById("edc-history-list");
    if (!el) return;
    if (!history.length) {
      el.innerHTML = '<div class="edc-result-empty">저장된 실행 이력이 없습니다.</div>';
      return;
    }
    el.innerHTML = history.map(function (item) {
      var cls = item.ok ? "is-ok" : "is-error";
      var time = new Date(item.at).toLocaleString("ko-KR");
      var validation = item.validation_passed === null
        ? "validation -"
        : "validation " + (item.validation_passed ? "통과" : "실패") + (item.score === null ? "" : " · " + item.score);
      return [
        '<div class="edc-history-row ' + cls + '">',
        '<div>',
        '<div class="edc-history-main">' + (actionLabel[item.action] || item.action) + " · " + item.robot_id + "</div>",
        '<div class="edc-history-sub">' + time + " · " + validation + (item.error ? " · " + item.error : "") + "</div>",
        "</div>",
        '<button type="button" class="edc-history-action" data-history-id="' + item.id + '">다시 실행</button>',
        "</div>",
      ].join("");
    }).join("");
    el.querySelectorAll("[data-history-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var found = history.find(function (item) {
          return String(item.id) === btn.getAttribute("data-history-id");
        });
        if (!found) return;
        applyHistoryToForm(found);
        runEdcAction(found.action);
      });
    });
  }

  function applyHistoryToForm(item) {
    var pairs = [
      ["edc-telemetry-source", item.telemetry_source],
      ["edc-telemetry-index", item.telemetry_index],
      ["edc-asset-id", item.asset_id],
      ["edc-provider-bpn", item.provider_bpn],
      ["edc-api-base-url", item.cobot_api_base_url],
    ];
    pairs.forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el && pair[1] !== undefined && pair[1] !== null && String(pair[1]) !== "") el.value = pair[1];
    });
    var includeAi = document.getElementById("edc-include-ai");
    if (includeAi) includeAi.checked = !!item.include_ai;
    document.querySelectorAll("[data-edc-action]").forEach(function (btn) {
      btn.classList.toggle("is-strong", btn.getAttribute("data-edc-action") === item.action);
    });
  }

  async function refreshHistory() {
    var el = document.getElementById("edc-history-list");
    if (el) el.innerHTML = '<div class="edc-result-empty">이력 불러오는 중...</div>';
    try {
      var res = await fetch(currentApiBase() + "/api/v1/edc/history?limit=" + HISTORY_LIMIT);
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      renderHistory(Array.isArray(data.items) ? data.items : []);
    } catch (_) {
      if (el) {
        el.innerHTML = '<div class="edc-result-empty">서버 실행 이력을 불러오지 못했습니다.</div>';
      }
    }
  }

  async function clearServerHistory() {
    try {
      var res = await fetch(currentApiBase() + "/api/v1/edc/history", { method: "DELETE" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      renderHistory([]);
    } catch (_) {
      var el = document.getElementById("edc-history-list");
      if (el) el.innerHTML = '<div class="edc-result-empty">서버 실행 이력을 비우지 못했습니다.</div>';
    }
  }

  async function refreshHealth() {
    var base = currentApiBase();
    setHealth("edc-health-api", "", "확인 중...");
    setHealth("edc-health-ai", "", "확인 중...");
    setHealth("edc-health-pipe", "", "확인 중...");
    try {
      var healthRes = await fetch(base + "/health");
      setHealth("edc-health-api", healthRes.ok ? "is-ok" : "is-error", healthRes.ok ? "정상" : "오류");
    } catch (_) {
      setHealth("edc-health-api", "is-error", "오프라인");
    }
    try {
      var aiRes = await fetch(base + "/api/v1/ai/health");
      if (!aiRes.ok) throw new Error("bad status");
      var ai = await aiRes.json();
      setHealth("edc-health-ai", ai.ok ? "is-ok" : "is-warn", ai.ok ? "정상 · " + ai.model : "주의 · " + ai.model);
    } catch (_) {
      setHealth("edc-health-ai", "is-warn", "미연결");
    }
    try {
      var edcStatus = lastEdcStatus || await refreshEnvStatus();
      var readiness = (edcStatus && edcStatus.readiness) || {};
      var text = readiness.edc_register && readiness.edc_register.ready
        ? "EDC 준비 완료"
        : readiness.aas_push && readiness.aas_push.ready
          ? "AAS 준비 완료"
          : "환경 변수 확인";
      var state = readiness.edc_register && readiness.edc_register.ready
        ? "is-ok"
        : readiness.aas_push && readiness.aas_push.ready ? "is-warn" : "is-error";
      setHealth("edc-health-pipe", state, text);
    } catch (_) {
      setHealth("edc-health-pipe", "is-error", "상태 확인 실패");
    }
  }

  function renderOpsBadges(latest) {
    var el = document.getElementById("edc-ops-badges");
    if (!el) return;
    if (!latest.length) {
      el.innerHTML = '<div class="edc-ops-empty" style="grid-column:1/-1;">운영 데이터가 없습니다.</div>';
      return;
    }
    var total = latest.length;
    var running = latest.filter(function (r) { return String(r.status || "").toUpperCase() === "RUNNING"; }).length;
    var warning = latest.filter(function (r) {
      var s = String(r.status || "").toUpperCase();
      return s === "WARNING" || s === "ERROR" || s === "FAULT";
    }).length;
    var hot = latest.filter(function (r) { return toNum(r.temperature_c, 0) > THRESHOLD_TEMP_C; }).length;
    var rows = [
      ["로봇 수", total.toString()],
      ["RUNNING", running.toString()],
      ["주의/오류", warning.toString()],
      ["고온(" + THRESHOLD_TEMP_C + "°C+)", hot.toString()],
    ];
    el.innerHTML = rows.map(function (row) {
      return '<div class="edc-ops-badge"><div class="k">' + row[0] + '</div><div class="v">' + row[1] + "</div></div>";
    }).join("");
  }

  function renderOpsRiskList(latest) {
    var el = document.getElementById("edc-ops-risk-list");
    if (!el) return;
    if (!latest.length) {
      el.innerHTML = '<div class="edc-ops-empty">운영 데이터가 없어 위험도 목록을 표시할 수 없습니다.</div>';
      return;
    }
    var ranked = latest.slice().sort(function (a, b) { return riskScore(b) - riskScore(a); }).slice(0, 5);
    el.innerHTML = ranked.map(function (r) {
      var score = riskScore(r);
      return [
        '<div class="edc-ops-risk-row">',
        '<div>',
        '<div class="edc-ops-risk-main">' + (r.robot_id || "-") + " · " + (r.line_id || "-") + " / " + (r.station_id || "-") + "</div>",
        '<div class="edc-ops-risk-sub">status=' + (r.status || "UNKNOWN") +
          " · temp=" + toNum(r.temperature_c, 0).toFixed(1) + "°C · vib=" + toNum(r.vibration_mm_s, 0).toFixed(1) + " mm/s</div>",
        "</div>",
        '<div class="edc-ops-risk-score">risk ' + score.toFixed(1) + "</div>",
        "</div>",
      ].join("");
    }).join("");
  }

  async function refreshOpsContext() {
    var base = currentApiBase();
    try {
      var res = await fetch(base + "/api/v1/cobot/telemetry/all");
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      var items = Array.isArray(data.items) ? data.items : [];
      var latest = latestByRobot(items);
      renderOpsBadges(latest);
      renderOpsRiskList(latest);
    } catch (_) {
      var badge = document.getElementById("edc-ops-badges");
      var list = document.getElementById("edc-ops-risk-list");
      if (badge) badge.innerHTML = '<div class="edc-ops-empty" style="grid-column:1/-1;">운영 API 연결 실패</div>';
      if (list) list.innerHTML = '<div class="edc-ops-empty">/api/v1/cobot/telemetry/all 응답을 확인하세요.</div>';
    }
  }

  async function runEdcAction(action) {
    var payload = buildRunPayload(action);
    setRunBusy(true, action);
    setProgress(20, actionLabel[action] + " 요청 준비");
    try {
      var res = await fetch(currentApiBase() + "/api/v1/edc/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setProgress(62, actionLabel[action] + " 서버 응답 처리");
      var body = await res.json().catch(function () {
        return { error: "Invalid JSON response" };
      });
      if (!res.ok) {
        var errorPayload = { action: action, error: body.error || "HTTP " + res.status, details: body };
        renderResult(errorPayload, false);
        refreshHistory();
        setProgress(100, "실행 실패");
        return;
      }
      renderResult(body, true);
      refreshHistory();
      setProgress(100, actionLabel[action] + " 완료");
    } catch (err) {
      var catchPayload = { action: action, error: err.message || String(err) };
      renderResult(catchPayload, false);
      refreshHistory();
      setProgress(100, "네트워크 오류");
    } finally {
      setRunBusy(false, action);
    }
  }

  document.querySelectorAll(".edc-step[data-step]").forEach(function (step) {
    step.addEventListener("click", function () {
      document.querySelectorAll(".edc-step[data-step]").forEach(function (item) {
        item.classList.toggle("is-active", item === step);
      });
      renderStepDetail(step.getAttribute("data-step"));
    });
  });
  renderStepDetail("preprocess");

  document.querySelectorAll("[data-edc-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("[data-edc-action]").forEach(function (b) {
        b.classList.toggle("is-strong", b === btn);
      });
      runEdcAction(btn.getAttribute("data-edc-action"));
    });
  });

  ["edc-telemetry-source", "edc-telemetry-index", "edc-asset-id", "edc-provider-bpn", "edc-api-base-url", "edc-include-ai"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", function () {
      if (id === "edc-api-base-url") {
        refreshEnvStatus();
        refreshHealth();
      }
    });
  });

  var clear = document.getElementById("edc-result-clear");
  if (clear) clear.addEventListener("click", clearResult);
  var refreshOpsBtn = document.getElementById("edc-refresh-ops");
  if (refreshOpsBtn) refreshOpsBtn.addEventListener("click", refreshOpsContext);
  var refreshEnvBtn = document.getElementById("edc-refresh-env");
  if (refreshEnvBtn) refreshEnvBtn.addEventListener("click", function () {
    refreshEnvStatus();
    refreshHealth();
  });
  var clearHistory = document.getElementById("edc-history-clear");
  if (clearHistory) {
    clearHistory.addEventListener("click", clearServerHistory);
  }

  refreshEnvStatus().then(refreshHealth);
  refreshHistory();
  refreshOpsContext();
})();
