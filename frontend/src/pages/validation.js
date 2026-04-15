const { Card: ValidationCard, ValidationResultCard } = window.CX_UI;

function PageValidation({ lastValidation }) {
  const layers = [
    { title: "Layer 1 · Standard & Integrity", key: "l1", desc: "필수 AAS Property 존재 여부 검사\nidShort / semanticId 완전성\n데이터 타입 정합성 확인" },
    { title: "Layer 2 · Semantic Cross-Val", key: "l2", desc: "AAS 값 ↔ 원본 데이터 일관성\n알람 vs 상태 논리 검증\n생산 수량 논리 교차검증" },
    { title: "Layer 3 · Reliability Assessment", key: "l3", desc: "온도 임계값 >85°C\n진동 >10mm/s\n전력 >2kW · 불량률 >10%" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "var(--f)", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-.02em" }}>검증 엔진 (3-Layer)</div>
        <div style={{ fontSize: ".8rem", color: "var(--ink-3)", marginTop: 3 }}>Standard & Integrity · Semantic Cross-Validation · Reliability Assessment</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
        {layers.map((layer) => (
          <ValidationCard key={layer.key} title={layer.title}>
            <div style={{ fontSize: ".75rem", color: "var(--ink-2)", lineHeight: 1.7, whiteSpace: "pre-line", marginBottom: 10 }}>{layer.desc}</div>
            {lastValidation && (
              <div>
                <div style={{ height: 5, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
                  <div style={{ width: `${lastValidation[layer.key]}%`, height: "100%", background: lastValidation[layer.key] >= 80 ? "var(--green)" : lastValidation[layer.key] >= 60 ? "var(--amber)" : "var(--red)", borderRadius: 3 }} />
                </div>
                <span style={{ fontFamily: "var(--f)", fontSize: "1.1rem", fontWeight: 700, color: lastValidation[layer.key] >= 80 ? "var(--green)" : lastValidation[layer.key] >= 60 ? "var(--amber)" : "var(--red)" }}>{lastValidation[layer.key]}/100</span>
              </div>
            )}
          </ValidationCard>
        ))}
      </div>
      {lastValidation ? <ValidationResultCard v={lastValidation} /> : <div style={{ color: "var(--ink-3)", fontSize: ".82rem" }}>AI 파이프라인을 실행하면 검증 결과가 여기에 표시됩니다.</div>}
    </div>
  );
}

window.CX_PAGE_VALIDATION = { PageValidation };
