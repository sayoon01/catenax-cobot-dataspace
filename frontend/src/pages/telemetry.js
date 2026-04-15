const { useState: useTelemetryState } = React;
const { SERVER } = window.CX_CONSTANTS;
const { Badge: TelemetryBadge, Card: TelemetryCard, Btn: TelemetryBtn, Alert: TelemetryAlert, CodeBlock: TelemetryCodeBlock } = window.CX_UI;

function PageTelemetry({ data, onRefresh }) {
  const [input, setInput] = useTelemetryState("");
  const [limit, setLimit] = useTelemetryState(20);
  const [result, setResult] = useTelemetryState(null);
  const [expanded, setExpanded] = useTelemetryState({});

  const submit = async () => {
    try {
      const body = JSON.parse(input);
      const response = await fetch(`${SERVER}/api/v1/cobot/telemetry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      setResult({ ok: response.ok, msg: response.ok ? `✓ 저장 완료: ${payload.file || ""}` : JSON.stringify(payload) });
      if (response.ok) onRefresh();
    } catch (error) {
      setResult({ ok: false, msg: `오류: ${error.message}` });
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "var(--f)", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-.02em" }}>텔레메트리 레코드</div>
        <div style={{ fontSize: ".8rem", color: "var(--ink-3)", marginTop: 3 }}>서버 POST 전송 및 저장된 JSON 열람</div>
      </div>
      <TelemetryCard title="새 텔레메트리 전송" style={{ marginBottom: 14 }} actions={<TelemetryBtn variant="primary" size="sm" onClick={submit}>서버로 전송</TelemetryBtn>}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder='{"robot_id":"cobot-01","line_id":"line-a",...}' style={{ width: "100%", padding: "8px 11px", border: "0.5px solid var(--border)", borderRadius: "var(--r-sm)", fontFamily: "var(--f-mono)", fontSize: ".75rem", color: "var(--ink)", background: "var(--surface)", resize: "vertical", minHeight: 100, outline: "none" }} />
        {result && <TelemetryAlert type={result.ok ? "success" : "warn"}>{result.msg}</TelemetryAlert>}
      </TelemetryCard>
      <TelemetryCard title="저장된 레코드" actions={
        <select value={limit} onChange={(event) => setLimit(Number(event.target.value))} style={{ padding: "4px 8px", border: "0.5px solid var(--border)", borderRadius: "var(--r-sm)", fontSize: ".72rem", background: "var(--surface)", color: "var(--ink)" }}>
          <option value={10}>10건</option>
          <option value={20}>20건</option>
          <option value={50}>50건</option>
        </select>
      }>
        {data.slice(0, limit).map((record, index) => (
          <div key={`${record.robot_id}-${record.produced_at || index}`} style={{ marginBottom: 10 }}>
            <div onClick={() => setExpanded((prev) => ({ ...prev, [index]: !prev[index] }))} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "5px 0", borderBottom: "0.5px solid var(--border-s)" }}>
              <TelemetryBadge status={record.status} />
              <span style={{ fontFamily: "var(--f-mono)", fontSize: ".75rem", color: "var(--accent)" }}>{record.robot_id}</span>
              <span style={{ fontSize: ".68rem", color: "var(--ink-3)", flex: 1 }}>{record.produced_at}</span>
              <span style={{ fontSize: ".7rem", color: "var(--ink-3)" }}>{expanded[index] ? "▲" : "▼"}</span>
            </div>
            {expanded[index] && <TelemetryCodeBlock code={JSON.stringify(record, null, 2)} maxHeight={200} />}
          </div>
        ))}
      </TelemetryCard>
    </div>
  );
}

window.CX_PAGE_TELEMETRY = { PageTelemetry };
