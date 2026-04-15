const { useState: useRobotsState } = React;
const { Badge: RobotsBadge, Card: RobotsCard, Modal, CodeBlock } = window.CX_UI;

function PageRobots({ data }) {
  const [modal, setModal] = useRobotsState(null);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "var(--f)", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-.02em" }}>로봇 플릿</div>
        <div style={{ fontSize: ".8rem", color: "var(--ink-3)", marginTop: 3 }}>10대 협동로봇 · 클릭 시 JSON 상세 보기</div>
      </div>
      <RobotsCard>
        <div style={{ overflowX: "auto", margin: "-14px -16px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".75rem" }}>
            <thead>
              <tr>
                {["Robot ID", "Line", "Station", "상태", "프로그램", "사이클(ms)", "전력(W)", "온도(°C)", "진동", "양품", "불량", "알람"].map((header) => (
                  <th key={header} style={{ textAlign: "left", padding: "9px 12px", fontSize: ".62rem", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", borderBottom: "0.5px solid var(--border)", background: "var(--surface-2)", whiteSpace: "nowrap" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((robot, index) => (
                <tr
                  key={`${robot.robot_id}-${robot.produced_at || index}`}
                  onClick={() => setModal(robot)}
                  style={{ borderBottom: "0.5px solid var(--border-s)", cursor: "pointer" }}
                  onMouseEnter={(event) => { event.currentTarget.style.background = "var(--accent-s)"; }}
                  onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
                >
                  <td style={{ padding: "9px 12px", fontFamily: "var(--f-mono)", fontSize: ".72rem", color: "var(--accent)", fontWeight: 500 }}>{robot.robot_id}</td>
                  <td style={{ padding: "9px 12px", color: "var(--ink-2)" }}>{robot.line_id}</td>
                  <td style={{ padding: "9px 12px", color: "var(--ink-2)" }}>{robot.station_id}</td>
                  <td style={{ padding: "9px 12px" }}><RobotsBadge status={robot.status} /></td>
                  <td style={{ padding: "9px 12px", color: "var(--ink-2)", fontSize: ".7rem" }}>{robot.program_name}</td>
                  <td style={{ padding: "9px 12px", color: "var(--ink)", fontWeight: 500 }}>{(robot.cycle_time_ms || 0).toLocaleString()}</td>
                  <td style={{ padding: "9px 12px", color: "var(--ink)", fontWeight: 500 }}>{(robot.power_watts || 0).toFixed(1)}</td>
                  <td style={{ padding: "9px 12px", color: (robot.temperature_c || 0) > 60 ? "var(--red)" : "var(--ink-2)" }}>{robot.temperature_c != null ? robot.temperature_c.toFixed(1) : "—"}</td>
                  <td style={{ padding: "9px 12px", color: (robot.vibration_mm_s || 0) > 3 ? "var(--amber)" : "var(--ink-2)" }}>{robot.vibration_mm_s != null ? robot.vibration_mm_s.toFixed(1) : "—"}</td>
                  <td style={{ padding: "9px 12px", color: "var(--ink-2)" }}>{(robot.good_parts || 0).toLocaleString()}</td>
                  <td style={{ padding: "9px 12px", color: (robot.reject_parts || 0) > 0 ? "var(--amber)" : "var(--ink-2)" }}>{robot.reject_parts || 0}</td>
                  <td style={{ padding: "9px 12px" }}>{robot.alarms?.length ? <RobotsBadge variant="warn">{robot.alarms.length}건</RobotsBadge> : <span style={{ color: "var(--ink-3)" }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </RobotsCard>
      <Modal open={!!modal} title={`${modal?.robot_id} · 상세 JSON`} onClose={() => setModal(null)}>
        <CodeBlock code={JSON.stringify(modal, null, 2)} />
      </Modal>
    </div>
  );
}

window.CX_PAGE_ROBOTS = { PageRobots };
