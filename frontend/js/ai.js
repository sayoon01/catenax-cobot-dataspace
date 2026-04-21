(function () {
  const API_BASE = "http://localhost:8080";
    let aiBusy = false;
    const AI_HISTORY_STORAGE_KEY = "catenax.ai.chatHistory.v1";
    const aiMessages = loadAiMessages();

    function setAiBusy(busy) {
      aiBusy = busy;
      const sendBtn = document.getElementById("ai-send-btn");
      const healthBtn = document.getElementById("ai-health-btn");
      if (sendBtn) {
        sendBtn.disabled = busy;
        sendBtn.textContent = busy ? "응답 대기 중..." : "보내기";
      }
      if (healthBtn) healthBtn.disabled = busy;
      const clearBtn = document.getElementById("ai-history-clear");
      if (clearBtn) clearBtn.disabled = busy || aiMessages.length === 0;
    }

    function syncAiMode() {
      const mode = document.getElementById("ai-mode")?.value || "chat";
      const input = document.getElementById("ai-chat-input");
      const validationInput = document.getElementById("ai-validation-input");
      const help = document.querySelector(".ai-chat-help");
      if (input) {
        input.placeholder = mode === "explain_validation"
          ? "예) 이 검증 결과에서 가장 먼저 조치할 항목을 알려줘"
          : "예) 지금 가장 먼저 확인해야 할 로봇과 이유를 알려줘";
      }
      if (validationInput) {
        validationInput.classList.toggle("is-hidden", mode !== "explain_validation");
      }
      if (help) {
        help.textContent = mode === "explain_validation"
          ? "검증 결과를 아래 칸에 붙여넣고 Enter 전송"
          : "Enter 전송 · Shift+Enter 줄바꿈";
      }
    }

    function loadAiMessages() {
      try {
        const raw = localStorage.getItem(AI_HISTORY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((msg) => msg && typeof msg === "object" && typeof msg.text === "string")
          .map((msg) => ({
            role: ["user", "assistant", "meta"].includes(msg.role) ? msg.role : "meta",
            text: msg.text,
            at: Number.isFinite(Number(msg.at)) ? Number(msg.at) : Date.now(),
          }))
          .slice(-100);
      } catch (_) {
        return [];
      }
    }

    function persistAiMessages() {
      try {
        if (aiMessages.length > 100) aiMessages.splice(0, aiMessages.length - 100);
        localStorage.setItem(AI_HISTORY_STORAGE_KEY, JSON.stringify(aiMessages));
      } catch (_) {}
    }

    function appendAiMessage(role, text) {
      aiMessages.push({ role, text, at: Date.now() });
      persistAiMessages();
      renderAiMessages();
    }

    function upsertAiMessage(index, role, text) {
      if (index >= 0 && index < aiMessages.length) {
        aiMessages[index] = { ...aiMessages[index], role, text };
      } else {
        aiMessages.push({ role, text, at: Date.now() });
      }
      persistAiMessages();
      renderAiMessages();
    }

    function clearAiHistory() {
      if (aiBusy) return;
      aiMessages.splice(0, aiMessages.length);
      persistAiMessages();
      renderAiMessages();
    }

    function renderAiMessages() {
      const log = document.getElementById("ai-chat-log");
      const count = document.getElementById("ai-history-count");
      const clearBtn = document.getElementById("ai-history-clear");
      if (count) count.textContent = `${aiMessages.length}개`;
      if (clearBtn) clearBtn.disabled = aiBusy || aiMessages.length === 0;
      if (!log) return;
      log.innerHTML = "";
      if (!aiMessages.length) {
        const empty = document.createElement("div");
        empty.className = "ai-msg meta";
        empty.textContent = "저장된 대화 히스토리가 없습니다.";
        log.appendChild(empty);
      } else {
        for (const msg of aiMessages) {
          const row = document.createElement("div");
          row.className = `ai-msg ${msg.role}`;
          row.textContent = msg.text;
          log.appendChild(row);
        }
      }
      log.scrollTop = log.scrollHeight;
    }

    function setAiHealthText(ok, text) {
      const el = document.getElementById("ai-health-text");
      if (!el) return;
      el.textContent = text;
      el.classList.remove("ai-status-ok", "ai-status-fail");
      el.classList.add(ok ? "ai-status-ok" : "ai-status-fail");
    }

    async function checkAiHealth() {
      if (aiBusy) return;
      setAiHealthText(false, "확인 중...");
      try {
        const res = await fetch(API_BASE + "/api/v1/ai/health");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (data.ok) setAiHealthText(true, `정상 · 모델 ${data.model}`);
        else setAiHealthText(false, `주의 · 모델 미탐지 (${data.model})`);
      } catch (err) {
        setAiHealthText(false, "오프라인 · " + err.message);
      }
    }

    async function onSubmitAiChat(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if (aiBusy) return;
      const input = document.getElementById("ai-chat-input");
      const mode = document.getElementById("ai-mode")?.value || "chat";
      const includeLatest = !!document.getElementById("ai-include-latest")?.checked;
      const message = (input?.value || "").trim();
      const validationRaw = (document.getElementById("ai-validation-input")?.value || "").trim();
      let validationReport = null;
      if (mode === "chat" && !message) return;
      if (mode === "explain_validation") {
        if (!validationRaw) {
          appendAiMessage("meta", "검증 결과 해석에는 검증 결과 입력이 필요합니다.");
          return;
        }
        try {
          validationReport = JSON.parse(validationRaw);
        } catch (err) {
          appendAiMessage("meta", "검증 결과 형식을 확인해 주세요: " + err.message);
          return;
        }
      }

      appendAiMessage("user", mode === "explain_validation" ? (message || "검증 리포트 설명") : message);
      const draftIndex = aiMessages.push({ role: "assistant", text: "응답 생성 중...", at: Date.now() }) - 1;
      persistAiMessages();
      renderAiMessages();
      if (input) input.value = "";
      setAiBusy(true);
      try {
        const body = {
          mode,
          message,
          include_latest: includeLatest,
          stream: true,
        };
        if (validationReport) body.validation_report = validationReport;
        const res = await fetch(API_BASE + "/api/v1/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || ("HTTP " + res.status));
        }
        const reader = res.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        if (!reader) {
          throw new Error("스트리밍 리더를 열 수 없습니다.");
        }
        let buffer = "";
        let answer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let eventData;
            try {
              eventData = JSON.parse(trimmed);
            } catch (_) {
              continue
            }
            if (eventData.type === "chunk") {
              answer += String(eventData.delta || "");
              upsertAiMessage(draftIndex, "assistant", answer || "응답 생성 중...");
            } else if (eventData.type === "done" && !answer) {
              answer = String(eventData.answer || "");
              upsertAiMessage(draftIndex, "assistant", answer || "(응답 없음)");
            } else if (eventData.type === "error") {
              throw new Error(String(eventData.error || "AI 스트리밍 오류"));
            }
          }
        }
        if (!answer) {
          upsertAiMessage(draftIndex, "assistant", "(응답 없음)");
        }
      } catch (err) {
        upsertAiMessage(draftIndex, "meta", "요청 실패: " + err.message);
      } finally {
        setAiBusy(false);
      }
    }

    document.getElementById("ai-health-btn").addEventListener("click", checkAiHealth);
    document.getElementById("ai-chat-form").addEventListener("submit", onSubmitAiChat);
    document.getElementById("ai-history-clear").addEventListener("click", clearAiHistory);
    document.getElementById("ai-mode").addEventListener("change", syncAiMode);
    document.getElementById("ai-chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmitAiChat(e);
      }
    });

  // --- 운영 분석 차트 (AI 화면으로 이동) ---
  const REFRESH_MS = 15000;
  const charts = {};
  let trendRequestId = 0;
  const CHART_SERIES = ["#5b6ee8", "#0d9f9f", "#8b6ae6", "#3b9eff", "#d977c4", "#47b881", "#6b8cff", "#14a3a8"];
  const CHART_THRESH = { temp: "rgba(124, 58, 237, 0.92)", reject: "rgba(217, 119, 6, 0.92)" };
  const CHART_SCATTER = { ok: "rgba(91, 110, 232, 0.55)", warn: "rgba(232, 93, 117, 0.85)", lineH: "rgba(232, 93, 117, 0.88)", lineV: "rgba(124, 58, 237, 0.88)" };
  const CHART_REJECT_BAR = { high: "#e85d75", mid: "#e8a23d", low: "#3db88c" };
  const THRESHOLD_TEMP_C = 75;
  const THRESHOLD_VIBE_MM_S = 5;
  const THRESHOLD_REJECT_PCT = 2;
  const TREND_CANVAS_ID = "c-trend-cycle";
  const TREND_SPECS = [
    { windowMs: 60 * 60 * 1000, bucket: "5m", subtitle: "최근 1시간 · 5분 버킷 · 저장된 텔레메트리 샘플 집계" },
    { windowMs: 24 * 60 * 60 * 1000, bucket: "15m", subtitle: "최근 24시간 · 15분 버킷 · 저장된 텔레메트리 샘플 집계" },
    { windowMs: 7 * 24 * 60 * 60 * 1000, bucket: "1h", subtitle: "최근 7일 · 1시간 버킷 · 저장된 텔레메트리 샘플 집계" },
  ];

  function toNum(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function rejectRatio(r) {
    const good = toNum(r.good_parts, 0);
    const reject = toNum(r.reject_parts, 0);
    const total = good + reject;
    return total ? reject / total : 0;
  }
  function sortRobotsByIdNatural(robots) {
    return [...robots].sort((a, b) =>
      String(a.robot_id || "").localeCompare(String(b.robot_id || ""), undefined, { numeric: true, sensitivity: "base" })
    );
  }
  function latestByRobot(items) {
    const byRobot = new Map();
    for (const row of items) {
      const id = row.robot_id || "unknown";
      const ts = Date.parse(row.stored_at || row.produced_at || "") || 0;
      const prev = byRobot.get(id);
      const prevTs = prev ? (Date.parse(prev.stored_at || prev.produced_at || "") || 0) : -1;
      if (!prev || ts >= prevTs) byRobot.set(id, row);
    }
    return Array.from(byRobot.values());
  }
  function baseChartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#5c6c82", font: { family: "DM Mono", size: 10 } }, grid: { color: "#e4eaf4" } },
        y: { ticks: { color: "#5c6c82", font: { family: "DM Mono", size: 10 } }, grid: { color: "#e4eaf4" } }
      }
    };
  }
  function thresholdLineDataset(labels, yValue, labelText, borderColor) {
    return {
      type: "line", label: labelText, data: labels.map(() => yValue), borderColor,
      borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false, order: 1, tension: 0
    };
  }
  function upsertBarChart(id, labels, values, colors, unit, thresholdY) {
    const el = document.getElementById(id);
    if (!el) return;
    const ctx = el.getContext("2d");
    if (charts[id]) charts[id].destroy();
    const datasets = [{ type: "bar", label: "값", data: values, backgroundColor: colors, borderRadius: 8, borderSkipped: false, order: 2 }];
    if (thresholdY != null && labels.length) {
      const thrLabel = unit === "°C" ? `온도 기준 ${thresholdY}°C` : `기준 ${thresholdY}${unit}`;
      const thrColor = unit === "°C" ? CHART_THRESH.temp : CHART_THRESH.reject;
      datasets.push(thresholdLineDataset(labels, thresholdY, thrLabel, thrColor));
    }
    charts[id] = new Chart(ctx, {
      data: { labels, datasets },
      options: {
        ...baseChartOptions(),
        plugins: { ...baseChartOptions().plugins, legend: { display: !!thresholdY, position: "top", labels: { boxWidth: 24, font: { size: 9 }, color: "#5c6c82" } } },
        scales: { ...baseChartOptions().scales, y: { ...baseChartOptions().scales.y, title: { display: true, text: unit, color: "#5c6c82", font: { size: 9 } }, beginAtZero: true } },
      },
    });
  }
  function upsertHorizontalBarChart(id, labels, values, colors, unit) {
    const el = document.getElementById(id);
    if (!el) return;
    const ctx = el.getContext("2d");
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 8 }] },
      options: { ...baseChartOptions(), indexAxis: "y", scales: { ...baseChartOptions().scales, x: { ...baseChartOptions().scales.x, title: { display: true, text: unit, color: "#5c6c82", font: { size: 9 } } } } }
    });
  }
  function trendHasRenderableCycle(points) {
    return points.some((p) => {
      const v = p.avg_cycle_time_ms;
      return v != null && Number.isFinite(Number(v));
    });
  }
  function formatTrendAxisLabel(iso, windowMs) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || "").slice(11, 16);
    if (windowMs <= 36 * 60 * 60 * 1000) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  async function renderTrendCycleChart() {
    const myId = (trendRequestId += 1);
    const el = document.getElementById(TREND_CANVAS_ID);
    const subEl = document.getElementById("trend-cycle-subtitle");
    if (!el) return;
    const to = new Date();
    let points = [];
    let chosen = TREND_SPECS[TREND_SPECS.length - 1];
    for (const spec of TREND_SPECS) {
      const from = new Date(to.getTime() - spec.windowMs);
      const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), bucket: spec.bucket });
      const res = await fetch(API_BASE + "/api/v1/cobot/telemetry/timeseries?" + qs.toString());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = await res.json();
      if (myId !== trendRequestId) return;
      const pts = Array.isArray(body.points) ? body.points : [];
      chosen = spec;
      points = pts;
      if (trendHasRenderableCycle(pts)) break;
    }
    if (subEl) subEl.textContent = trendHasRenderableCycle(points) ? chosen.subtitle : chosen.subtitle + " · 이 구간에 사이클(ms) 값이 없습니다";
    const labels = points.map((p) => formatTrendAxisLabel(p.t, chosen.windowMs));
    const cycleData = points.map((p) => p.avg_cycle_time_ms == null ? null : Number(p.avg_cycle_time_ms));
    const ctx = el.getContext("2d");
    if (charts[TREND_CANVAS_ID]) charts[TREND_CANVAS_ID].destroy();
    charts[TREND_CANVAS_ID] = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ label: "평균 사이클 (ms)", data: cycleData, borderColor: "#5b6ee8", backgroundColor: "rgba(91, 110, 232, 0.12)", fill: true, tension: 0.25, pointRadius: 2, spanGaps: false }] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: true, position: "top", labels: { boxWidth: 18, font: { size: 9 }, color: "#5c6c82" } } },
        scales: {
          x: { ticks: { color: "#5c6c82", font: { family: "DM Mono", size: 10 }, maxRotation: 45, minRotation: 0 }, grid: { color: "#e4eaf4" } },
          y: { ticks: { color: "#5c6c82", font: { family: "DM Mono", size: 10 } }, grid: { color: "#e4eaf4" }, title: { display: true, text: "ms", color: "#5c6c82", font: { size: 9 } }, beginAtZero: false },
        },
      },
    });
  }
  function renderCharts(robots) {
    const chartOrder = sortRobotsByIdNatural(robots);
    const labels = chartOrder.map((r) => r.robot_id || "-");
    const powerValues = chartOrder.map((r) => toNum(r.power_watts, 0));
    const tempValues = chartOrder.map((r) => toNum(r.temperature_c, 0));
    const barColors = labels.map((_, i) => CHART_SERIES[i % CHART_SERIES.length]);
    upsertBarChart("c-power", labels, powerValues, barColors, "W", null);
    upsertBarChart("c-temp", labels, tempValues, barColors, "°C", THRESHOLD_TEMP_C);
    const rejectRateValues = chartOrder.map((r) => Number((rejectRatio(r) * 100).toFixed(2)));
    const rejectColors = rejectRateValues.map((v) => v > THRESHOLD_REJECT_PCT ? CHART_REJECT_BAR.high : v > 1.0 ? CHART_REJECT_BAR.mid : CHART_REJECT_BAR.low);
    upsertBarChart("c-reject", labels, rejectRateValues, rejectColors, "%", THRESHOLD_REJECT_PCT);
    const lineMap = {};
    for (const r of chartOrder) {
      const line = r.line_id || "unknown";
      if (!lineMap[line]) lineMap[line] = { sum: 0, count: 0 };
      lineMap[line].sum += toNum(r.cycle_time_ms, 0);
      lineMap[line].count += 1;
    }
    const lineLabels = Object.keys(lineMap).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }));
    const lineCycleValues = lineLabels.map((k) => Number((lineMap[k].sum / lineMap[k].count).toFixed(1)));
    upsertHorizontalBarChart("c-line-cycle", lineLabels, lineCycleValues, lineLabels.map((_, i) => CHART_SERIES[i % CHART_SERIES.length]), "ms");
    const scatterEl = document.getElementById("c-temp-vibe");
    if (!scatterEl) return;
    const scatterCtx = scatterEl.getContext("2d");
    if (charts["c-temp-vibe"]) charts["c-temp-vibe"].destroy();
    const scatterPoints = chartOrder.map((r) => ({ x: toNum(r.temperature_c, 0), y: toNum(r.vibration_mm_s, 0), robot: r.robot_id || "-" }));
    let xMin = 0, xMax = THRESHOLD_TEMP_C + 25, yMin = 0, yMax = THRESHOLD_VIBE_MM_S * 3;
    if (scatterPoints.length) {
      const xs = scatterPoints.map((p) => p.x);
      const ys = scatterPoints.map((p) => p.y);
      xMin = Math.min(...xs, THRESHOLD_TEMP_C) - 5;
      xMax = Math.max(...xs, THRESHOLD_TEMP_C) + 8;
      const yHi = Math.max(...ys, THRESHOLD_VIBE_MM_S);
      yMax = Number.isFinite(yHi) ? yHi * 1.25 + 1 : THRESHOLD_VIBE_MM_S * 3;
    }
    charts["c-temp-vibe"] = new Chart(scatterCtx, {
      data: {
        datasets: [
          { type: "scatter", label: "로봇", data: scatterPoints, pointRadius: 6, pointHoverRadius: 8, backgroundColor: scatterPoints.map((p) => p.y > THRESHOLD_VIBE_MM_S || p.x > THRESHOLD_TEMP_C ? CHART_SCATTER.warn : CHART_SCATTER.ok), borderColor: "rgba(255,255,255,0.92)", borderWidth: 1, order: 3 },
          { type: "line", label: `진동 기준 ${THRESHOLD_VIBE_MM_S} mm/s`, data: [{ x: xMin, y: THRESHOLD_VIBE_MM_S }, { x: xMax, y: THRESHOLD_VIBE_MM_S }], borderColor: CHART_SCATTER.lineH, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false, order: 1 },
          { type: "line", label: `온도 기준 ${THRESHOLD_TEMP_C}°C`, data: [{ x: THRESHOLD_TEMP_C, y: yMin }, { x: THRESHOLD_TEMP_C, y: yMax }], borderColor: CHART_SCATTER.lineV, borderWidth: 2, borderDash: [4, 4], pointRadius: 0, fill: false, order: 2 },
        ],
      },
      options: {
        ...baseChartOptions(),
        plugins: { legend: { display: true, position: "top", labels: { boxWidth: 18, font: { size: 9 }, color: "#5c6c82", filter: (item) => item.text !== "로봇" } } },
        scales: {
          x: { ...baseChartOptions().scales.x, min: xMin, max: xMax, title: { display: true, text: "온도 (°C)", color: "#5c6c82", font: { size: 9 } } },
          y: { ...baseChartOptions().scales.y, min: yMin, max: yMax, title: { display: true, text: "진동 (mm/s)", color: "#5c6c82", font: { size: 9 } } },
        },
      },
    });
  }
  async function loadAnalytics() {
    try {
      const res = await fetch(API_BASE + "/api/v1/cobot/telemetry/all");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const latest = latestByRobot(items);
      if (!latest.length) return;
      renderCharts(latest);
      await renderTrendCycleChart();
    } catch (err) {
      console.warn("analytics:", err);
    }
  }

  syncAiMode();
  renderAiMessages();
  checkAiHealth();
  loadAnalytics();
  setInterval(loadAnalytics, REFRESH_MS);
})();
