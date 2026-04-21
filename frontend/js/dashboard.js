(function () {
    const API_BASE = "http://localhost:8080";
    const REFRESH_MS = 15000;
    const charts = {};
    /** destroy 시 진행 중인 시계열 응답 무시 · 연속 호출 시 마지막 응답만 반영 */
    let trendRequestId = 0;

    const OPS_LOG_MAX = 120;
    let opsLogBuffer = [];
    let _lastOpsSnapshotSig = "";
    /** 운영 분석 차트: 인디고·틸·바이올렛 계열 (배경과 대비·시리즈 구분) */
    const CHART_SERIES = ["#5b6ee8", "#0d9f9f", "#8b6ae6", "#3b9eff", "#d977c4", "#47b881", "#6b8cff", "#14a3a8"];
    const CHART_THRESH = { temp: "rgba(124, 58, 237, 0.92)", reject: "rgba(217, 119, 6, 0.92)" };
    const CHART_SCATTER = { ok: "rgba(91, 110, 232, 0.55)", warn: "rgba(232, 93, 117, 0.85)", lineH: "rgba(232, 93, 117, 0.88)", lineV: "rgba(124, 58, 237, 0.88)" };
    const CHART_REJECT_BAR = { high: "#e85d75", mid: "#e8a23d", low: "#3db88c" };
    const CHART_STATUS = {
      RUNNING: "#3db88c",
      IDLE: "#d4a017",
      ERROR: "#e85d75",
      FAULT: "#d63d5c",
      STOP: "#6b7c93",
      UNKNOWN: "#94a3b8",
      MAINTENANCE: "#9b6bff",
      WARNING: "#e8a23d",
    };
    const STATUS_LABEL_KO = {
      RUNNING: "가동",
      IDLE: "대기",
      WARNING: "주의",
      ERROR: "오류",
      FAULT: "고장",
      STOP: "정지",
      MAINTENANCE: "정비",
      UNKNOWN: "미확인"
    };

    const THRESHOLD_TEMP_C = 75;
    const THRESHOLD_VIBE_MM_S = 5;
    const THRESHOLD_REJECT_PCT = 2;

    let _cachedNormalized = [];

    function toNum(v, d = 0) {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    }

    function latestByRobot(items) {
      const byRobot = new Map();
      for (const row of items) {
        const id = row.robot_id || "unknown";
        const ts = Date.parse(row.stored_at || row.produced_at || "") || 0;
        const prev = byRobot.get(id);
        const prevTs = prev ? (Date.parse(prev.stored_at || prev.produced_at || "") || 0) : -1;
        if (!prev || ts >= prevTs) {
          byRobot.set(id, row);
        }
      }
      return Array.from(byRobot.values());
    }

    function rejectRatio(r) {
      const good = toNum(r.good_parts, 0);
      const reject = toNum(r.reject_parts, 0);
      const total = good + reject;
      return total ? reject / total : 0;
    }

    function riskScore(r) {
      const st = String(r.status || "UNKNOWN").toUpperCase();
      let s = 0;
      if (st === "FAULT" || st === "ERROR") s += 100;
      else if (st === "WARNING") s += 55;
      else if (st === "MAINTENANCE") s += 35;
      else if (st === "IDLE") s += 12;
      else if (st === "STOP" || st === "UNKNOWN") s += 25;

      const temp = toNum(r.temperature_c, NaN);
      if (Number.isFinite(temp) && temp > THRESHOLD_TEMP_C) {
        s += (temp - THRESHOLD_TEMP_C) * 2.5;
      }
      const vib = toNum(r.vibration_mm_s, NaN);
      if (Number.isFinite(vib) && vib > THRESHOLD_VIBE_MM_S) {
        s += (vib - THRESHOLD_VIBE_MM_S) * 12;
      }
      s += rejectRatio(r) * 80;

      const alarms = r.alarms;
      if (Array.isArray(alarms) && alarms.length) s += Math.min(alarms.length * 8, 24);

      return s;
    }

    function sortRobotsByRisk(robots) {
      return [...robots].sort((a, b) => riskScore(b) - riskScore(a));
    }

    /** 차트 X축: cobot-01, cobot-02 … 숫자 인식 정렬 (위험도 정렬과 분리) */
    function sortRobotsByIdNatural(robots) {
      return [...robots].sort((a, b) => {
        const ida = String(a.robot_id || "");
        const idb = String(b.robot_id || "");
        return ida.localeCompare(idb, undefined, { numeric: true, sensitivity: "base" });
      });
    }

    function applyFilters(latest) {
      const line = document.getElementById("filter-line").value;
      const status = document.getElementById("filter-status").value;
      return latest.filter((r) => {
        if (line && String(r.line_id || "").trim() !== line) return false;
        if (status && String(r.status || "").toUpperCase() !== status) return false;
        return true;
      });
    }

    function escapeAttr(s) {
      return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function populateFilterOptions(latest) {
      const lineSel = document.getElementById("filter-line");
      const statSel = document.getElementById("filter-status");
      const prevLine = lineSel.value;
      const prevStat = statSel.value;

      const lines = [...new Set(latest.map((r) => String(r.line_id || "").trim()).filter(Boolean))].sort();
      lineSel.innerHTML = '<option value="">전체 라인</option>' +
        lines.map((l) => `<option value="${escapeAttr(l)}">${escapeAttr(l)}</option>`).join("");
      lineSel.value = lines.includes(prevLine) ? prevLine : "";

      const statuses = [...new Set(latest.map((r) => String(r.status || "UNKNOWN").toUpperCase()))].sort();
      statSel.innerHTML = '<option value="">전체 상태</option>' +
        statuses.map((s) => `<option value="${escapeAttr(s)}">${STATUS_LABEL_KO[s] || s}</option>`).join("");
      statSel.value = statuses.includes(prevStat) ? prevStat : "";
    }

    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    function normalizeItems(rawItems) {
      const flat = [];
      for (const item of rawItems) {
        if (Array.isArray(item)) {
          for (const nested of item) {
            if (nested && typeof nested === "object" && !Array.isArray(nested)) {
              flat.push(nested);
            }
          }
          continue;
        }
        if (item && typeof item === "object") {
          flat.push(item);
        }
      }
      return flat;
    }

    function showError(msg) {
      const box = document.getElementById("error-box");
      box.style.display = "block";
      box.textContent = msg;
    }

    function hideError() {
      const box = document.getElementById("error-box");
      box.style.display = "none";
      box.textContent = "";
    }

    function renderRobots(robots) {
      const grid = document.getElementById("robot-grid");
      grid.innerHTML = "";
      for (const r of robots) {
        const status = String(r.status || "UNKNOWN").toUpperCase();
        const statusLabel = STATUS_LABEL_KO[status] || status;
        const good = toNum(r.good_parts, 0);
        const reject = toNum(r.reject_parts, 0);
        const total = good + reject;
        const yieldPct = total ? ((good / total) * 100).toFixed(1) : "0.0";

        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <div class="robot-top">
            <div>
              <div class="rid">${r.robot_id || "-"}</div>
              <div class="loc">${r.line_id || "-"} / ${r.station_id || "-"}</div>
            </div>
            <div class="badge ${status}">${statusLabel}</div>
          </div>
          <div class="metric-grid">
            <div class="metric"><div class="m-label">온도</div><div class="m-val">${toNum(r.temperature_c, 0).toFixed(1)} °C</div></div>
            <div class="metric"><div class="m-label">전력</div><div class="m-val">${toNum(r.power_watts, 0).toFixed(1)} W</div></div>
            <div class="metric"><div class="m-label">사이클 타임</div><div class="m-val">${toNum(r.cycle_time_ms, 0).toFixed(0)} ms</div></div>
            <div class="metric"><div class="m-label">수율</div><div class="m-val">${yieldPct} %</div></div>
          </div>
        `;
        grid.appendChild(card);
      }
    }

    function buildAlarmFeedEntries(filtered) {
      const rows = [];
      for (const r of sortRobotsByRisk(filtered)) {
        const rid = r.robot_id || "-";
        const prog = r.program_name || "-";
        const st = String(r.status || "UNKNOWN").toUpperCase();
        if (st === "ERROR" || st === "FAULT") {
          const al = Array.isArray(r.alarms) && r.alarms.length ? r.alarms.join(", ") : "";
          rows.push({
            severity: "CRITICAL",
            robot: rid,
            text: `상태 ${st}`,
            detail: al ? `${prog} · ${al}` : prog,
          });
        } else if (st === "WARNING") {
          rows.push({ severity: "WARN", robot: rid, text: "상태 WARNING", detail: prog });
        } else if (Array.isArray(r.alarms) && r.alarms.length) {
          rows.push({
            severity: "WARN",
            robot: rid,
            text: r.alarms.join(", "),
            detail: `상태 ${st} · ${prog}`,
          });
        }
        const temp = toNum(r.temperature_c, NaN);
        if (Number.isFinite(temp) && temp > THRESHOLD_TEMP_C) {
          rows.push({
            severity: "WARN",
            robot: rid,
            text: `온도 ${temp.toFixed(1)}°C`,
            detail: `기준 ${THRESHOLD_TEMP_C}°C 초과 · ${prog}`,
          });
        }
        const vib = toNum(r.vibration_mm_s, NaN);
        if (Number.isFinite(vib) && vib > THRESHOLD_VIBE_MM_S) {
          rows.push({
            severity: "WARN",
            robot: rid,
            text: `진동 ${vib.toFixed(1)} mm/s`,
            detail: `기준 ${THRESHOLD_VIBE_MM_S} mm/s 초과 · ${prog}`,
          });
        }
        const rr = rejectRatio(r) * 100;
        if (rr > THRESHOLD_REJECT_PCT) {
          rows.push({
            severity: "WARN",
            robot: rid,
            text: `불량률 ${rr.toFixed(1)}%`,
            detail: `기준 ${THRESHOLD_REJECT_PCT}% 초과 · ${prog}`,
          });
        }
      }
      const rank = { CRITICAL: 0, WARN: 1, INFO: 2 };
      rows.sort((a, b) => rank[a.severity] - rank[b.severity]);
      return rows.slice(0, 20);
    }

    function renderAlarmFeed(entries) {
      const el = document.getElementById("ops-alarm-feed");
      if (!el) return;
      if (!entries.length) {
        el.innerHTML =
          '<div class="alarm-empty">현재 임계·알람 조건에 해당하는 항목이 없습니다.<br/>상태·알람 필드는 텔레메트리 JSON 기준입니다.</div>';
        return;
      }
      el.innerHTML = entries
        .map(
          (e) => `
        <div class="alarm-row alarm-${String(e.severity).toLowerCase()}">
          <span class="alarm-sev">${escapeHtml(e.severity)}</span>
          <div class="alarm-body">
            <div class="alarm-robot">${escapeHtml(e.robot)} · ${escapeHtml(e.text)}</div>
            ${e.detail ? `<div class="alarm-detail">${escapeHtml(e.detail)}</div>` : ""}
          </div>
        </div>`
        )
        .join("");
    }

    function buildOpsLogLines(filtered, statusMap) {
      const now = new Date();
      const ts = now.toLocaleTimeString(undefined, { hour12: false });
      const lines = [];
      lines.push({ ts, level: "INFO", msg: "── 스냅샷 동기화 ──" });
      lines.push({
        ts,
        level: "INFO",
        msg: `텔레메트리 반영 · 표시 ${filtered.length}대 · 전체 이벤트 ${_cachedNormalized.length}건`,
      });
      lines.push({ ts, level: "INFO", msg: "→ [수집] latestByRobot · stored_at 기준 최신 1건" });
      lines.push({
        ts,
        level: "INFO",
        msg: `→ [검증] 온도≤${THRESHOLD_TEMP_C}°C · 진동≤${THRESHOLD_VIBE_MM_S}mm/s · 불량≤${THRESHOLD_REJECT_PCT}%`,
      });
      const bad = (statusMap.ERROR || 0) + (statusMap.FAULT || 0);
      if (bad) {
        lines.push({ ts, level: "WARN", msg: `← 상태 오류/고장 ${bad}대 · 우선 점검 타임라인 확인` });
      }
      let anyDetail = false;
      for (const r of sortRobotsByRisk(filtered).slice(0, 10)) {
        const parts = [];
        const st = String(r.status || "").toUpperCase();
        if (st === "ERROR" || st === "FAULT" || st === "WARNING") parts.push(`status=${st}`);
        const t = toNum(r.temperature_c, NaN);
        if (Number.isFinite(t) && t > THRESHOLD_TEMP_C) parts.push(`temp=${t.toFixed(1)}°C`);
        const v = toNum(r.vibration_mm_s, NaN);
        if (Number.isFinite(v) && v > THRESHOLD_VIBE_MM_S) parts.push(`vib=${v.toFixed(1)}`);
        const rr = rejectRatio(r) * 100;
        if (rr > THRESHOLD_REJECT_PCT) parts.push(`reject=${rr.toFixed(1)}%`);
        if (Array.isArray(r.alarms) && r.alarms.length) parts.push(`alarms=[${r.alarms.join(", ")}]`);
        if (parts.length) {
          anyDetail = true;
          const lv = st === "ERROR" || st === "FAULT" ? "CRITICAL" : "WARN";
          lines.push({ ts, level: lv, msg: `${r.robot_id || "-"} · ${parts.join(" · ")}` });
        }
      }
      if (!bad && !anyDetail) {
        lines.push({ ts, level: "INFO", msg: "← [요약] 현재 스냅샷 기준 임계 초과·코드 알람 없음" });
      }
      return lines;
    }

    function appendOpsLog(lines) {
      const sig = lines.map((l) => `${l.level}:${l.msg}`).join("\x01");
      if (sig === _lastOpsSnapshotSig) return;
      _lastOpsSnapshotSig = sig;
      opsLogBuffer.push(...lines);
      if (opsLogBuffer.length > OPS_LOG_MAX) {
        opsLogBuffer = opsLogBuffer.slice(-OPS_LOG_MAX);
      }
      const el = document.getElementById("ops-event-log");
      if (!el) return;
      el.innerHTML = opsLogBuffer
        .map((l) => {
          const lev = String(l.level || "INFO").toLowerCase();
          return `<div class="log-line log-${lev}"><span class="log-ts">[${escapeHtml(l.ts)}]</span> <span class="log-tag">${escapeHtml(
            l.level
          )}</span> ${escapeHtml(l.msg)}</div>`;
        })
        .join("");
      el.scrollTop = el.scrollHeight;
    }

    function renderOpsInsights(filtered, statusMap) {
      if (!filtered.length) {
        renderAlarmFeed([]);
        appendOpsLog([
          {
            ts: new Date().toLocaleTimeString(undefined, { hour12: false }),
            level: "INFO",
            msg: "필터와 일치하는 로봇이 없습니다. 필터를 조정하세요.",
          },
        ]);
        return;
      }
      renderAlarmFeed(buildAlarmFeedEntries(filtered));
      appendOpsLog(buildOpsLogLines(filtered, statusMap));
    }

    function renderOpsTimeline(robots) {
      const wrap = document.getElementById("ops-timeline");
      if (!wrap) return;
      wrap.innerHTML = "";
      const top = robots.slice(0, 4);
      if (!top.length) {
        wrap.innerHTML = '<div class="ops-sub">표시할 로봇 데이터가 없습니다.</div>';
        return;
      }
      top.forEach((r, idx) => {
        const st = String(r.status || "UNKNOWN").toUpperCase();
        const card = document.createElement("div");
        card.className = "ops-item";
        card.innerHTML = `
          <div class="ops-index">${idx + 1}</div>
          <div>
            <div><b>${r.robot_id || "-"}</b> · ${r.line_id || "-"} / ${r.station_id || "-"}</div>
            <div class="ops-sub">온도 ${toNum(r.temperature_c, 0).toFixed(1)}°C · 진동 ${toNum(r.vibration_mm_s, 0).toFixed(1)} mm/s</div>
          </div>
          <div class="badge ${st}">${STATUS_LABEL_KO[st] || st}</div>
        `;
        wrap.appendChild(card);
      });
    }

    function renderStageBoard(allLatest, filtered, statusMap) {
      const wrap = document.getElementById("ops-stage-board");
      if (!wrap) return;
      const warnings = (statusMap.WARNING || 0) + (statusMap.ERROR || 0) + (statusMap.FAULT || 0);
      const stageData = [
        { name: "ingest", val: `${_cachedNormalized.length}건`, note: `최신 로봇 ${allLatest.length}대` },
        { name: "quality", val: warnings ? `주의 ${warnings}건` : "정상", note: warnings ? "이상 상태 점검 필요" : "이상 상태 없음" },
        { name: "insight", val: filtered.length ? "분석 가능" : "데이터 부족", note: "필터 결과 기반 지표 계산" },
        { name: "ai-assist", val: document.getElementById("ai-health-text")?.textContent || "AI 화면에서 연결 확인", note: "AI 어시스턴트 연결 상태" },
      ];
      wrap.innerHTML = stageData.map((s) => `
        <div class="stage-card">
          <div class="stage-name">${s.name}</div>
          <div class="stage-val">${s.val}</div>
          <div class="stage-note">${s.note}</div>
        </div>
      `).join("");
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
        type: "line",
        label: labelText,
        data: labels.map(() => yValue),
        borderColor: borderColor || CHART_THRESH.temp,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
        order: 1,
        tension: 0,
      };
    }

    function upsertBarChart(id, labels, values, colors, unit, thresholdY) {
      const ctx = document.getElementById(id).getContext("2d");
      if (charts[id]) charts[id].destroy();
      const datasets = [{
        type: "bar",
        label: "값",
        data: values,
        backgroundColor: colors,
        borderRadius: 8,
        borderSkipped: false,
        order: 2,
      }];
      if (thresholdY != null && labels.length) {
        const thrLabel = unit === "°C" ? `온도 기준 ${thresholdY}°C` : `기준 ${thresholdY}${unit}`;
        const thrColor = unit === "°C" ? CHART_THRESH.temp : CHART_THRESH.reject;
        datasets.push(thresholdLineDataset(labels, thresholdY, thrLabel, thrColor));
      }
      charts[id] = new Chart(ctx, {
        data: { labels, datasets },
        options: {
          ...baseChartOptions(),
          plugins: {
            ...baseChartOptions().plugins,
            legend: { display: !!thresholdY, position: "top", labels: { boxWidth: 24, font: { size: 9 }, color: "#5c6c82" } },
          },
          scales: {
            ...baseChartOptions().scales,
            y: {
              ...baseChartOptions().scales.y,
              title: { display: true, text: unit, color: "#5c6c82", font: { size: 9 } },
              beginAtZero: true,
            },
          },
        },
      });
    }

    function upsertHorizontalBarChart(id, labels, values, colors, unit) {
      const ctx = document.getElementById(id).getContext("2d");
      if (charts[id]) charts[id].destroy();
      charts[id] = new Chart(ctx, {
        type: "bar",
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 8 }] },
        options: {
          ...baseChartOptions(),
          indexAxis: "y",
          scales: {
            ...baseChartOptions().scales,
            x: { ...baseChartOptions().scales.x, title: { display: true, text: unit, color: "#5c6c82", font: { size: 9 } } }
          }
        }
      });
    }

    function destroyAllCharts() {
      trendRequestId += 1;
      for (const k of Object.keys(charts)) {
        if (charts[k]) {
          charts[k].destroy();
          delete charts[k];
        }
      }
    }

    const TREND_CANVAS_ID = "c-trend-cycle";
    /** 짧은 구간만 보면 데모/오래된 JSON은 범위 밖이라 선이 안 그려짐 → 없으면 구간을 넓힘 */
    const TREND_SPECS = [
      { windowMs: 60 * 60 * 1000, bucket: "5m", subtitle: "최근 1시간 · 5분 버킷 · 저장된 텔레메트리 샘플 집계" },
      { windowMs: 24 * 60 * 60 * 1000, bucket: "15m", subtitle: "최근 24시간 · 15분 버킷 · 저장된 텔레메트리 샘플 집계" },
      { windowMs: 7 * 24 * 60 * 60 * 1000, bucket: "1h", subtitle: "최근 7일 · 1시간 버킷 · 저장된 텔레메트리 샘플 집계" },
    ];

    function trendHasRenderableCycle(points) {
      return points.some((p) => {
        const v = p.avg_cycle_time_ms;
        return v != null && Number.isFinite(Number(v));
      });
    }

    function formatTrendAxisLabel(iso, windowMs) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso || "").slice(11, 16);
      if (windowMs <= 36 * 60 * 60 * 1000) {
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      }
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
      try {
        for (const spec of TREND_SPECS) {
          const from = new Date(to.getTime() - spec.windowMs);
          const qs = new URLSearchParams({
            from: from.toISOString(),
            to: to.toISOString(),
            bucket: spec.bucket,
          });
          const res = await fetch(API_BASE + "/api/v1/cobot/telemetry/timeseries?" + qs.toString());
          if (!res.ok) throw new Error("HTTP " + res.status);
          const body = await res.json();
          if (myId !== trendRequestId) return;
          const pts = Array.isArray(body.points) ? body.points : [];
          chosen = spec;
          points = pts;
          if (trendHasRenderableCycle(pts)) break;
        }
        if (subEl) {
          subEl.textContent = trendHasRenderableCycle(points)
            ? chosen.subtitle
            : chosen.subtitle + " · 이 구간에 사이클(ms) 값이 없습니다";
        }
        const labels = points.map((p) => formatTrendAxisLabel(p.t, chosen.windowMs));
        const cycleData = points.map((p) =>
          p.avg_cycle_time_ms == null || p.avg_cycle_time_ms === undefined ? null : Number(p.avg_cycle_time_ms)
        );
        const ctx = el.getContext("2d");
        if (charts[TREND_CANVAS_ID]) charts[TREND_CANVAS_ID].destroy();
        charts[TREND_CANVAS_ID] = new Chart(ctx, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "평균 사이클 (ms)",
                data: cycleData,
                borderColor: "#5b6ee8",
                backgroundColor: "rgba(91, 110, 232, 0.12)",
                fill: true,
                tension: 0.25,
                pointRadius: 2,
                spanGaps: false,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: {
                display: true,
                position: "top",
                labels: { boxWidth: 18, font: { size: 9 }, color: "#5c6c82" },
              },
              tooltip: {
                callbacks: {
                  label: (c) => {
                    const v = c.parsed.y;
                    if (v == null || Number.isNaN(v)) return "데이터 없음";
                    return `평균 사이클 ${v} ms (n=${points[c.dataIndex]?.sample_count ?? "?"})`;
                  },
                },
              },
            },
            scales: {
              x: {
                ticks: { color: "#5c6c82", font: { family: "DM Mono", size: 10 }, maxRotation: 45, minRotation: 0 },
                grid: { color: "#e4eaf4" },
              },
              y: {
                ticks: { color: "#5c6c82", font: { family: "DM Mono", size: 10 } },
                grid: { color: "#e4eaf4" },
                title: { display: true, text: "ms", color: "#5c6c82", font: { size: 9 } },
                beginAtZero: false,
              },
            },
          },
        });
      } catch (err) {
        if (myId !== trendRequestId) return;
        console.warn("timeseries:", err);
        if (charts[TREND_CANVAS_ID]) {
          charts[TREND_CANVAS_ID].destroy();
          delete charts[TREND_CANVAS_ID];
        }
      }
    }

    function renderCharts(robots, statusMap) {
      if (!robots.length) {
        destroyAllCharts();
        return;
      }
      const chartOrder = sortRobotsByIdNatural(robots);
      const labels = chartOrder.map((r) => r.robot_id || "-");
      const powerValues = chartOrder.map((r) => toNum(r.power_watts, 0));
      const tempValues = chartOrder.map((r) => toNum(r.temperature_c, 0));
      const barColors = labels.map((_, i) => CHART_SERIES[i % CHART_SERIES.length]);
      upsertBarChart("c-power", labels, powerValues, barColors, "W", null);
      upsertBarChart("c-temp", labels, tempValues, barColors, "°C", THRESHOLD_TEMP_C);

      const rejectRateValues = chartOrder.map((r) => Number((rejectRatio(r) * 100).toFixed(2)));
      const rejectColors = rejectRateValues.map((v) =>
        v > THRESHOLD_REJECT_PCT ? CHART_REJECT_BAR.high : v > 1.0 ? CHART_REJECT_BAR.mid : CHART_REJECT_BAR.low);
      upsertBarChart("c-reject", labels, rejectRateValues, rejectColors, "%", THRESHOLD_REJECT_PCT);

      const lineMap = {};
      for (const r of chartOrder) {
        const line = r.line_id || "unknown";
        if (!lineMap[line]) lineMap[line] = { sum: 0, count: 0 };
        lineMap[line].sum += toNum(r.cycle_time_ms, 0);
        lineMap[line].count += 1;
      }
      const lineLabels = Object.keys(lineMap).sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }));
      const lineCycleValues = lineLabels.map((k) => Number((lineMap[k].sum / lineMap[k].count).toFixed(1)));
      upsertHorizontalBarChart(
        "c-line-cycle",
        lineLabels,
        lineCycleValues,
        lineLabels.map((_, i) => CHART_SERIES[i % CHART_SERIES.length]),
        "ms"
      );

      const scatterCtx = document.getElementById("c-temp-vibe").getContext("2d");
      if (charts["c-temp-vibe"]) charts["c-temp-vibe"].destroy();
      const scatterPoints = chartOrder.map((r) => ({
        x: toNum(r.temperature_c, 0),
        y: toNum(r.vibration_mm_s, 0),
        robot: r.robot_id || "-"
      }));
      let xMin = 0, xMax = THRESHOLD_TEMP_C + 25, yMin = 0, yMax = THRESHOLD_VIBE_MM_S * 3;
      if (scatterPoints.length) {
        const xs = scatterPoints.map((p) => p.x);
        const ys = scatterPoints.map((p) => p.y);
        xMin = Math.min(...xs, THRESHOLD_TEMP_C) - 5;
        xMax = Math.max(...xs, THRESHOLD_TEMP_C) + 8;
        yMin = 0;
        const yHi = Math.max(...ys, THRESHOLD_VIBE_MM_S);
        yMax = Number.isFinite(yHi) ? yHi * 1.25 + 1 : THRESHOLD_VIBE_MM_S * 3;
      }
      charts["c-temp-vibe"] = new Chart(scatterCtx, {
        data: {
          datasets: [
            {
              type: "scatter",
              label: "로봇",
              data: scatterPoints,
              pointRadius: 6,
              pointHoverRadius: 8,
              backgroundColor: scatterPoints.map((p) =>
                p.y > THRESHOLD_VIBE_MM_S || p.x > THRESHOLD_TEMP_C ? CHART_SCATTER.warn : CHART_SCATTER.ok),
              borderColor: "rgba(255,255,255,0.92)",
              borderWidth: 1,
              order: 3,
            },
            {
              type: "line",
              label: `진동 기준 ${THRESHOLD_VIBE_MM_S} mm/s`,
              data: [{ x: xMin, y: THRESHOLD_VIBE_MM_S }, { x: xMax, y: THRESHOLD_VIBE_MM_S }],
              borderColor: CHART_SCATTER.lineH,
              borderWidth: 2,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false,
              order: 1,
            },
            {
              type: "line",
              label: `온도 기준 ${THRESHOLD_TEMP_C}°C`,
              data: [{ x: THRESHOLD_TEMP_C, y: yMin }, { x: THRESHOLD_TEMP_C, y: yMax }],
              borderColor: CHART_SCATTER.lineV,
              borderWidth: 2,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false,
              order: 2,
            },
          ],
        },
        options: {
          ...baseChartOptions(),
          plugins: {
            legend: {
              display: true,
              position: "top",
              labels: {
                boxWidth: 18,
                font: { size: 9 },
                color: "#5c6c82",
                filter: (item) => item.text !== "로봇",
              },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  if (ctx.datasetIndex !== 0) return ctx.dataset.label || "";
                  const p = scatterPoints[ctx.dataIndex];
                  return `${p.robot} · 온도 ${ctx.parsed.x}°C / 진동 ${ctx.parsed.y}mm/s`;
                },
              },
            },
          },
          scales: {
            x: {
              ...baseChartOptions().scales.x,
              min: xMin,
              max: xMax,
              title: { display: true, text: "온도 (°C)", color: "#5c6c82", font: { size: 9 } },
            },
            y: {
              ...baseChartOptions().scales.y,
              min: yMin,
              max: yMax,
              title: { display: true, text: "진동 (mm/s)", color: "#5c6c82", font: { size: 9 } },
            },
          },
        },
      });
    }

    function buildStatusMapFor(robots) {
      const m = {};
      for (const r of robots) {
        const st = String(r.status || "UNKNOWN").toUpperCase();
        m[st] = (m[st] || 0) + 1;
      }
      return m;
    }

    function renderFromCache() {
      if (!_cachedNormalized.length) {
        renderAlarmFeed([]);
        opsLogBuffer = [];
        _lastOpsSnapshotSig = "";
        const logEl = document.getElementById("ops-event-log");
        if (logEl) {
          logEl.innerHTML =
            '<div class="log-line log-info"><span class="log-ts">[--]</span> <span class="log-tag">INFO</span> 저장된 텔레메트리가 없습니다. API 연결을 확인하세요.</div>';
        }
        return;
      }
      const allLatest = latestByRobot(_cachedNormalized);
      populateFilterOptions(allLatest);
      const filtered = applyFilters(allLatest);
      const sortedForCards = sortRobotsByRisk(filtered);
      const statusMap = buildStatusMapFor(filtered);

      let sumTemp = 0, tempCount = 0, sumPower = 0, powerCount = 0;
      let totalGood = 0, totalReject = 0, running = 0;
      for (const r of filtered) {
        const t = toNum(r.temperature_c, NaN);
        const p = toNum(r.power_watts, NaN);
        if (Number.isFinite(t)) { sumTemp += t; tempCount += 1; }
        if (Number.isFinite(p)) { sumPower += p; powerCount += 1; }
        totalGood += toNum(r.good_parts, 0);
        totalReject += toNum(r.reject_parts, 0);
        if (String(r.status || "").toUpperCase() === "RUNNING") running += 1;
      }

      setText("k-count", _cachedNormalized.length.toLocaleString());
      setText("k-robots", filtered.length.toLocaleString());
      setText("k-temp", tempCount ? (sumTemp / tempCount).toFixed(1) : "0.0");
      setText("k-power", powerCount ? (sumPower / powerCount).toFixed(1) : "0.0");
      setText("k-good", totalGood.toLocaleString());
      setText("k-reject", totalReject.toLocaleString() + " 불량");
      setText("k-running", running.toLocaleString());

      renderOpsTimeline(sortedForCards);
      renderStageBoard(allLatest, filtered, statusMap);
      renderOpsInsights(filtered, statusMap);
      renderRobots(sortedForCards);
      setText("last-update", "업데이트 " + new Date().toLocaleTimeString());
    }

    function renderDashboard(rawItems) {
      _cachedNormalized = normalizeItems(rawItems);
      renderFromCache();
    }

    async function loadData() {
      try {
        const res = await fetch(API_BASE + "/api/v1/cobot/telemetry/all");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        hideError();
        renderDashboard(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        showError("API 연결 실패: " + err.message + " (python server/app.py --port 8080 실행 확인)");
      }
    }
    document.getElementById("refresh-btn").addEventListener("click", loadData);
    document.getElementById("filter-line").addEventListener("change", () => renderFromCache());
    document.getElementById("filter-status").addEventListener("change", () => renderFromCache());
    loadData();
    setInterval(loadData, REFRESH_MS);
})();
