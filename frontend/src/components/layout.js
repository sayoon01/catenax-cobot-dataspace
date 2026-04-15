const { NAV_ITEMS, PAGE_TITLES } = window.CX_CONSTANTS;
const { Btn } = window.CX_UI;

function Sidebar({ activePage, setActivePage, robotCount, serverStatus }) {
  return (
    <aside style={{ width: 220, flexShrink: 0, background: "#111827", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 200 }}>
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, background: "var(--accent)", clipPath: "polygon(50% 0%,95% 25%,95% 75%,50% 100%,5% 75%,5% 25%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".62rem", color: "#fff", fontWeight: 700, fontFamily: "var(--f)", flexShrink: 0 }}>CX</div>
          <span style={{ fontFamily: "var(--f)", fontWeight: 700, fontSize: ".9rem", color: "#fff", letterSpacing: "-.01em" }}>Catena-X</span>
        </div>
        <div style={{ fontSize: ".58rem", color: "rgba(255,255,255,.3)", marginTop: 4, letterSpacing: ".06em" }}>COBOT DATA SPACE v1.0</div>
      </div>

      <nav style={{ flex: 1, padding: "10px 8px", overflowY: "auto" }}>
        {NAV_ITEMS.map((item, index) => {
          const active = activePage === item.id;
          const previous = NAV_ITEMS[index - 1];
          const showSection = item.section && (!previous || previous.section !== item.section);

          return (
            <React.Fragment key={item.id}>
              {showSection && (
                <div style={{ fontSize: ".58rem", fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.25)", padding: "10px 8px 4px" }}>
                  {item.section}
                </div>
              )}
              <div
                onClick={() => setActivePage(item.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: ".78rem", fontWeight: active ? 500 : 400, color: active ? "#fff" : "rgba(255,255,255,.5)", background: active ? "var(--accent)" : "transparent", marginBottom: 1, transition: "all .15s", userSelect: "none" }}
                onMouseEnter={(event) => {
                  if (active) return;
                  event.currentTarget.style.background = "rgba(255,255,255,.07)";
                  event.currentTarget.style.color = "rgba(255,255,255,.8)";
                }}
                onMouseLeave={(event) => {
                  if (active) return;
                  event.currentTarget.style.background = "transparent";
                  event.currentTarget.style.color = "rgba(255,255,255,.5)";
                }}
              >
                <span style={{ fontSize: ".8rem", opacity: active ? 1 : 0.6 }}>{item.icon}</span>
                {item.label}
                {item.badge && (
                  <span style={{ marginLeft: "auto", fontSize: ".6rem", fontWeight: 600, background: active ? "rgba(255,255,255,.25)" : "rgba(255,255,255,.15)", color: active ? "#fff" : "rgba(255,255,255,.7)", borderRadius: 8, padding: "1px 6px" }}>
                    {robotCount}
                  </span>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </nav>

      <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", gap: 7, fontSize: ".65rem", color: "rgba(255,255,255,.35)" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", animation: "pulse 2.5s infinite" }} />
        {serverStatus}
      </div>
    </aside>
  );
}

function Topbar({ activePage, onRefresh, onGoToPipeline }) {
  return (
    <div style={{ background: "var(--surface)", borderBottom: "0.5px solid var(--border)", padding: "0 24px", height: 54, display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ fontSize: ".78rem", color: "var(--ink-3)", flex: 1 }}>
        Catena-X <span style={{ margin: "0 6px" }}>›</span>
        <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{PAGE_TITLES[activePage] || activePage}</strong>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Btn variant="outline" size="sm" onClick={onRefresh}>↺ 새로고침</Btn>
        <Btn variant="primary" size="sm" onClick={onGoToPipeline}>▶ AI 파이프라인</Btn>
      </div>
    </div>
  );
}

window.CX_LAYOUT = { Sidebar, Topbar };
