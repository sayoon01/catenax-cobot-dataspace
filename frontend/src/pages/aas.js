const { useState: useAASState } = React;
const { buildAASElements } = window.CX_HELPERS;
const { Badge: AASBadge, Alert: AASAlert } = window.CX_UI;

function PageAAS({ data }) {
  const [expanded, setExpanded] = useAASState({});

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "var(--f)", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-.02em" }}>AAS 서브모델</div>
        <div style={{ fontSize: ".8rem", color: "var(--ink-3)", marginTop: 3 }}>Asset Administration Shell · CobotOperationalData · 클릭하여 Properties 펼치기</div>
      </div>
      <AASAlert type="info">각 로봇 카드를 클릭하면 AAS 서브모델의 모든 Property(idShort, semanticId, value, type)를 확인할 수 있습니다.</AASAlert>
      {data.map((telemetry, index) => {
        const elements = buildAASElements(telemetry);
        const open = expanded[index];

        return (
          <div key={`${telemetry.robot_id || "telemetry"}-${telemetry.produced_at || index}`} style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden", marginBottom: 10, boxShadow: "var(--sh)" }}>
            <div onClick={() => setExpanded((prev) => ({ ...prev, [index]: !prev[index] }))} style={{ background: "var(--surface-2)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: open ? "0.5px solid var(--border)" : "none", cursor: "pointer" }}>
              <AASBadge status={telemetry.status} />
              <span style={{ fontFamily: "var(--f-mono)", fontSize: ".78rem", fontWeight: 500, color: "var(--accent)" }}>{telemetry.robot_id}</span>
              <span style={{ fontSize: ".7rem", color: "var(--ink-3)" }}>{telemetry.line_id} · {telemetry.station_id}</span>
              <span style={{ marginLeft: "auto", fontSize: ".65rem", color: "var(--ink-3)" }}>{elements.length} properties</span>
              <span style={{ fontSize: ".7rem", color: "var(--ink-3)" }}>{open ? "▲" : "▼"}</span>
            </div>
            {open && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 130px 60px", padding: "5px 14px", background: "var(--surface-2)", borderBottom: "0.5px solid var(--border)" }}>
                  {["idShort", "semanticId", "value", "type"].map((header) => (
                    <span key={header} style={{ fontSize: ".58rem", fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)", letterSpacing: ".05em" }}>{header}</span>
                  ))}
                </div>
                {elements.map((element, elementIndex) => (
                  <div
                    key={`${element.idShort}-${elementIndex}`}
                    style={{ display: "grid", gridTemplateColumns: "180px 1fr 130px 60px", padding: "5px 14px", borderBottom: "0.5px solid var(--border-s)", fontSize: ".72rem" }}
                    onMouseEnter={(event) => { event.currentTarget.style.background = "var(--accent-s)"; }}
                    onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ fontFamily: "var(--f-mono)", color: "var(--accent)", fontSize: ".65rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{element.idShort}</div>
                    <div style={{ fontFamily: "var(--f-mono)", color: "var(--ink-3)", fontSize: ".6rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{element.semanticId}</div>
                    <div style={{ textAlign: "right", fontFamily: "var(--f-mono)", fontSize: ".68rem", color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(element.value).substring(0, 20)}</div>
                    <div style={{ textAlign: "right", fontSize: ".6rem", color: "var(--ink-3)" }}>{element.valueType}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

window.CX_PAGE_AAS = { PageAAS };
