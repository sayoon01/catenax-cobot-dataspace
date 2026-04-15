const { useState: usePipelineState, useRef: usePipelineRef } = React;
const { SAMPLES, STAGE_LABELS } = window.CX_CONSTANTS;
const {
  preprocess,
  mapFields,
  runValidation,
  fallbackMetamodel,
  fallbackCode,
  callAI,
  extractJSON,
  sleep,
} = window.CX_HELPERS;
const {
  Badge: PipelineBadge,
  Card: PipelineCard,
  Btn: PipelineBtn,
  Tabs,
  CodeBlock,
  Alert,
  Spinner,
  ValidationResultCard,
} = window.CX_UI;

function StageTrack({ stages }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", padding: "10px 2px 2px" }}>
      {STAGE_LABELS.map((label, index) => {
        const state = stages[index] || "idle";
        const colors = {
          done: { border: "#63d08a", bg: "#f4fff8", color: "#22a75a", line: "#63d08a" },
          active: { border: "var(--accent)", bg: "var(--accent-s)", color: "var(--accent)", line: "var(--accent)" },
          error: { border: "#f87171", bg: "#fff5f5", color: "#ef4444", line: "#f87171" },
          idle: { border: "var(--border)", bg: "var(--surface)", color: "var(--ink-3)", line: "#d7deeb" },
        };
        const tone = colors[state];
        const icon = state === "done" ? "✓" : state === "error" ? "✗" : state === "active" ? "…" : String(index + 1);

        return (
          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, minWidth: 72, position: "relative" }}>
            {index < STAGE_LABELS.length - 1 && (
              <div style={{ position: "absolute", top: 18, left: "calc(50% + 18px)", width: "calc(100% - 36px)", height: 2, background: tone.line, zIndex: 0 }} />
            )}
            <div style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${tone.border}`, background: tone.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".72rem", fontWeight: 700, color: tone.color, position: "relative", zIndex: 1, transition: "all .3s", boxShadow: state === "active" ? "0 0 0 4px rgba(29,78,216,.12)" : "none" }}>
              {icon}
            </div>
            <div style={{ fontSize: ".58rem", color: tone.color, marginTop: 7, textAlign: "center", lineHeight: 1.25, whiteSpace: "pre-line", fontWeight: 600 }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

function PagePipeline({ onValidationResult }) {
  const [selectedSample, setSelectedSample] = usePipelineState("1");
  const [jsonInput, setJsonInput] = usePipelineState(JSON.stringify(SAMPLES[1], null, 2));
  const [stages, setStages] = usePipelineState(Array(8).fill("idle"));
  const [running, setRunning] = usePipelineState(false);
  const [status, setStatus] = usePipelineState("");
  const [activeTab, setActiveTab] = usePipelineState("pre");
  const [results, setResults] = usePipelineState(null);
  const [aiLogs, setAiLogs] = usePipelineState([]);
  const logRef = usePipelineRef([]);
  const selectedTelemetry = selectedSample ? SAMPLES[selectedSample] : null;

  const addLog = (type, msg) => {
    const entry = { type, msg, ts: new Date().toLocaleTimeString() };
    logRef.current = [...logRef.current, entry];
    setAiLogs(logRef.current);
  };

  const setStage = (index, next) => {
    setStages((prev) => {
      const copy = [...prev];
      copy[index] = next;
      return copy;
    });
  };

  const clearPipeline = () => {
    setSelectedSample("");
    setJsonInput("");
    setStages(Array(8).fill("idle"));
    setStatus("");
    setResults(null);
    setAiLogs([]);
    logRef.current = [];
  };

  const runPipeline = async () => {
    let input;
    try {
      input = JSON.parse(jsonInput);
    } catch (error) {
      alert(`JSON 파싱 오류: ${error.message}`);
      return;
    }

    setRunning(true);
    setResults(null);
    setAiLogs([]);
    logRef.current = [];
    setStages(Array(8).fill("idle"));
    setStatus("");
    setActiveTab("pre");

    const nextResults = {};

    setStage(0, "active");
    addLog("sys", "[Stage 1] 전처리 시작 (Rule-based)");
    await sleep(300);
    const { cleaned, warnings } = preprocess(input);
    nextResults.pre = { cleaned, warnings };
    setStage(0, "done");
    addLog("ok", `[Stage 1] 완료. 경고: ${warnings.length}건`);

    setStage(1, "active");
    addLog("sys", "[Stage 2] 필드 매핑 시작");
    await sleep(250);
    const fields = mapFields(cleaned);
    nextResults.mapping = { fields };
    setStage(1, "done");
    addLog("ok", `[Stage 2] 완료. 필드 수: ${fields.length}`);

    setStage(2, "active");
    addLog("sys", "[Stage 3] AI Agent - 메타모델 추론 (Anthropic API)");
    let metamodel;
    try {
      addLog("sys", "→ AI 호출: 메타모델 추론 요청...");
      const aiResp = await callAI(
        "당신은 Catena-X 제조 데이터 공간 전문가입니다. 반드시 JSON만 반환하세요.",
        `협동로봇 데이터를 분석해 AAS 메타모델을 추론하세요.\nrobot_id: ${cleaned.robot_id}\nprogram_name: ${cleaned.program_name}\nstatus: ${cleaned.status}\nalarms: ${JSON.stringify(cleaned.alarms || [])}\n\n다음 JSON 형식으로 반환:\n{"domain":"...","idta_template":"...","risk_level":"low|medium|high","recommended_submodel_id":"urn:...","semantic_version":"1.0","analysis":"(한국어 분석)","suggested_optimizations":["..",".."]}`
      );
      metamodel = extractJSON(aiResp) || fallbackMetamodel(cleaned);
      addLog("ai", `← AI 응답: domain=${metamodel.domain}, risk=${metamodel.risk_level}`);
    } catch {
      metamodel = fallbackMetamodel(cleaned);
      addLog("sys", "AI 미연결 - fallback 적용");
    }
    nextResults.metamodel = metamodel;
    setStage(2, "done");
    addLog("ok", `[Stage 3] 완료. domain=${metamodel.domain}`);

    setStage(3, "active");
    addLog("sys", "[Stage 4] AI Agent - Python 코드 생성");
    let genCode;
    try {
      addLog("sys", "→ AI 호출: basyx-sdk 코드 생성 요청...");
      genCode = await callAI(
        "당신은 AAS Python SDK 전문가입니다. 코드만 반환하세요.",
        `cobot ${cleaned.robot_id}의 AAS Submodel Python 코드를 basyx-python-sdk로 작성하세요.\n도메인: ${metamodel.domain}\n주요 필드: ${fields.slice(0, 8).map((field) => `${field.idShort}(${field.valueType})`).join(", ")}`
      );
      addLog("ai", `← AI 응답: ${genCode.split("\n").length}줄 생성됨`);
    } catch {
      genCode = fallbackCode(fields, cleaned);
      addLog("sys", "AI 미연결 - fallback 코드 생성");
    }
    nextResults.code = genCode;
    setStage(3, "done");
    addLog("ok", `[Stage 4] 완료. ${genCode.split("\n").length}줄`);

    setStage(4, "active");
    addLog("sys", "[Stage 5] AI Agent - AAS submodelElements 빌드");
    let aiElements = null;
    try {
      addLog("sys", "→ AI 호출: AAS Elements 생성 요청...");
      const aiResp = await callAI(
        "당신은 AAS 서브모델 빌더입니다. JSON 배열만 반환하세요.",
        `다음 데이터로 AAS submodelElements를 생성하세요.\n도메인: ${metamodel.domain}\n데이터: ${JSON.stringify(cleaned).substring(0, 400)}\n\n각 요소: {"modelType":"Property","idShort":"camelCase","valueType":"string|double|integer","value":값,"semanticId":"IDTA코드"}\n15~25개 생성`
      );
      const parsed = extractJSON(aiResp);
      if (Array.isArray(parsed)) {
        aiElements = parsed;
        addLog("ai", `← AI 응답: ${aiElements.length}개 Elements 생성`);
      } else {
        addLog("sys", "AI 응답 파싱 실패 - fallback");
      }
    } catch {
      addLog("sys", "AI 미연결 - fallback Elements 생성");
    }
    const finalElements = aiElements || fields.map((field) => ({
      modelType: "Property",
      idShort: field.idShort,
      valueType: field.valueType,
      value: field.value,
      semanticId: field.semanticId,
    }));
    nextResults.elements = finalElements;
    setStage(4, "done");
    addLog("ok", `[Stage 5] 완료. ${aiElements ? "AI 생성" : "fallback"} ${finalElements.length}개`);

    setStage(5, "active");
    addLog("sys", "[Stage 6] 3-Layer 검증 시작");
    await sleep(300);
    const validation = runValidation(finalElements, cleaned);
    nextResults.validation = validation;
    onValidationResult(validation);
    setStage(5, validation.passed ? "done" : "error");
    addLog(validation.passed ? "ok" : "err", `[Stage 6] ${validation.passed ? "통과" : "실패"}. 점수: ${validation.overall_score}`);

    setStage(6, "active");
    addLog("sys", "[Stage 7] AAS 저장소 전송 (시뮬레이션)");
    await sleep(400);
    setStage(6, "done");
    addLog("ok", `[Stage 7] 완료. id: urn:aas:cobot:${cleaned.robot_id}:submodel`);

    setStage(7, "active");
    addLog("sys", "[Stage 8] EDC 자산 등록");
    await sleep(250);
    setStage(7, "done");
    addLog("ok", "[Stage 8] 완료 (데모 모드)");
    addLog("ok", "═══ 파이프라인 완료 ═══");

    nextResults.aiLogs = logRef.current;
    setResults(nextResults);
    setStatus(`완료 · ${validation.passed ? "검증 통과" : "검증 실패"} · score ${validation.overall_score}`);
    setActiveTab("val");
    setRunning(false);
  };

  const tabs = [
    { id: "pre", label: "전처리" },
    { id: "map", label: "매핑" },
    { id: "meta", label: "메타모델" },
    { id: "code", label: "코드생성" },
    { id: "aas", label: "AAS Elements" },
    { id: "val", label: "검증" },
    { id: "log", label: "로그" },
  ];

  return (
    <div>
      <PipelineCard style={{ marginBottom: 10 }} actions={results?.validation && <div style={{ fontSize: ".88rem", fontWeight: 700, color: results.validation.passed ? "var(--green)" : "var(--red)" }}>{results.validation.passed ? "✓ 종합점수 통과" : `✗ 종합점수 ${results.validation.overall_score}/100 · 검증 실패`}</div>}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: ".92rem", fontWeight: 700, color: "var(--ink)" }}>📥 입력: {selectedTelemetry?.robot_id || "custom"} · {selectedTelemetry?.program_name || "custom-json"} {selectedTelemetry ? `(${selectedTelemetry.status}${selectedTelemetry.alarms?.length ? " + 알람" : ""})` : ""}</div>
        </div>
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "#fafcff", border: "1px solid #e6ecfb", fontFamily: "var(--f-mono)", fontSize: ".68rem", color: "#4c6ef5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {jsonInput.replace(/\s+/g, " ").slice(0, 180)}{jsonInput.length > 180 ? " ..." : ""}
        </div>
      </PipelineCard>

      <PipelineCard title="파이프라인 단계 진행" style={{ marginBottom: 14 }}>
        <StageTrack stages={stages} />
      </PipelineCard>

      <PipelineCard title="파이프라인 입력" style={{ marginBottom: 14 }} actions={<div style={{ display: "flex", gap: 6 }}>
        <PipelineBtn variant="outline" size="sm" onClick={clearPipeline}>초기화</PipelineBtn>
        <PipelineBtn variant="primary" size="sm" onClick={runPipeline} disabled={running}>
          {running ? <><Spinner /> 실행 중</> : "AI 파이프라인 실행"}
        </PipelineBtn>
      </div>}>
        <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={selectedSample}
            onChange={(event) => {
              const next = event.target.value;
              setSelectedSample(next);
              setJsonInput(next ? JSON.stringify(SAMPLES[next], null, 2) : "");
            }}
            style={{ padding: "7px 10px", border: "0.5px solid var(--border)", borderRadius: "var(--r-sm)", fontSize: ".75rem", background: "var(--surface)", color: "var(--ink)" }}
          >
            <option value="">샘플 선택</option>
            {Object.keys(SAMPLES).map((key) => (
              <option key={key} value={key}>{SAMPLES[key].robot_id}</option>
            ))}
          </select>
          {status && <PipelineBadge variant={results?.validation?.passed ? "ok" : "warn"}>{status}</PipelineBadge>}
        </div>
        <textarea value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} style={{ width: "100%", minHeight: 128, padding: "12px 14px", border: "0.5px solid var(--border)", borderRadius: "var(--r-sm)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--f-mono)", fontSize: ".72rem", lineHeight: 1.6, outline: "none", resize: "vertical" }} />
      </PipelineCard>

      {results && (
        <div>
          <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
          {activeTab === "pre" && (
            <PipelineCard title="전처리 결과" actions={<PipelineBadge variant="info">{results.pre.warnings.length} warnings</PipelineBadge>}>
              {results.pre.warnings.length > 0 && results.pre.warnings.map((warning) => (
                <Alert key={warning} type="warn">{warning}</Alert>
              ))}
              <CodeBlock code={JSON.stringify(results.pre.cleaned, null, 2)} />
            </PipelineCard>
          )}
          {activeTab === "map" && (
            <PipelineCard title="필드 매핑 결과" actions={<PipelineBadge variant="ok">{results.mapping.fields.length} fields</PipelineBadge>}>
              <div style={{ overflowX: "auto", margin: "-14px -16px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".7rem" }}>
                  <thead>
                    <tr>
                      {["sourceKey", "idShort", "valueType", "semanticId"].map((header) => (
                        <th key={header} style={{ textAlign: "left", padding: "7px 12px", fontSize: ".6rem", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", borderBottom: "0.5px solid var(--border)", background: "var(--surface-2)" }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.mapping.fields.map((field) => (
                      <tr key={field.sourceKey} style={{ borderBottom: "0.5px solid var(--border-s)" }}>
                        <td style={{ padding: "6px 12px", fontFamily: "var(--f-mono)", color: "var(--ink-2)" }}>{field.sourceKey}</td>
                        <td style={{ padding: "6px 12px", fontFamily: "var(--f-mono)", color: "var(--accent)" }}>{field.idShort}</td>
                        <td style={{ padding: "6px 12px" }}><PipelineBadge variant="info">{field.valueType}</PipelineBadge></td>
                        <td style={{ padding: "6px 12px", fontFamily: "var(--f-mono)", color: "var(--ink-3)", fontSize: ".62rem" }}>{field.semanticId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PipelineCard>
          )}
          {activeTab === "meta" && (
            <PipelineCard title="메타모델 추론 결과" actions={<PipelineBadge variant="ai">{results.metamodel.domain}</PipelineBadge>}>
              <CodeBlock code={JSON.stringify(results.metamodel, null, 2)} />
            </PipelineCard>
          )}
          {activeTab === "code" && (
            <PipelineCard title="생성된 Python 코드">
              <CodeBlock code={results.code} maxHeight={420} />
            </PipelineCard>
          )}
          {activeTab === "aas" && (
            <PipelineCard title="AAS Elements" actions={<PipelineBadge variant={results.aiLogs.some((log) => log.msg.includes("AI 응답")) ? "ai" : "info"}>{results.elements.length}개 Properties</PipelineBadge>}>
              <div style={{ overflowX: "auto", margin: "-14px -16px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".7rem" }}>
                  <thead>
                    <tr>
                      {["idShort", "value", "valueType", "semanticId"].map((header) => (
                        <th key={header} style={{ textAlign: "left", padding: "7px 12px", fontSize: ".6rem", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", borderBottom: "0.5px solid var(--border)", background: "var(--surface-2)" }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.elements.map((element, index) => (
                      <tr key={`${element.idShort}-${index}`} style={{ borderBottom: "0.5px solid var(--border-s)" }}>
                        <td style={{ padding: "6px 12px", fontFamily: "var(--f-mono)", color: "var(--accent)", fontSize: ".65rem" }}>{element.idShort}</td>
                        <td style={{ padding: "6px 12px", color: "var(--ink)", fontWeight: 500 }}>{String(element.value || "").substring(0, 35)}</td>
                        <td style={{ padding: "6px 12px" }}><PipelineBadge variant="info">{element.valueType || "string"}</PipelineBadge></td>
                        <td style={{ padding: "6px 12px", fontFamily: "var(--f-mono)", color: "var(--ink-3)", fontSize: ".6rem" }}>{String(element.semanticId || "").substring(0, 35)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PipelineCard>
          )}
          {activeTab === "val" && results.validation && <ValidationResultCard v={results.validation} />}
          {activeTab === "log" && (
            <PipelineCard title="AI 에이전트 실행 로그" actions={<PipelineBadge variant="ai">Anthropic API</PipelineBadge>}>
              <div style={{ background: "#0f172a", borderRadius: "var(--r-sm)", padding: 14, fontFamily: "var(--f-mono)", fontSize: ".7rem", lineHeight: 1.7, color: "#94a3b8", maxHeight: 300, overflowY: "auto" }}>
                {aiLogs.map((log, index) => {
                  const tone = { sys: "#475569", ai: "#a78bfa", ok: "#86efac", err: "#fca5a5" };
                  return <div key={index} style={{ color: tone[log.type] || "#94a3b8" }}><span style={{ opacity: 0.4 }}>[{log.ts}]</span> {log.msg}</div>;
                })}
              </div>
            </PipelineCard>
          )}
        </div>
      )}
    </div>
  );
}

window.CX_PAGE_PIPELINE = { PagePipeline };
