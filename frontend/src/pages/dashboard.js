const { Badge, Card } = window.CX_UI;

function PageDashboard({ data }) {
  const total = data.length;
  const running = data.filter((robot) => robot.status === "RUNNING").length;
  const alarm = data.filter((robot) => robot.alarms?.length > 0).length;
  const good = data.reduce((sum, robot) => sum + (robot.good_parts || 0), 0);
  const reject = data.reduce((sum, robot) => sum + (robot.reject_parts || 0), 0);
  const ratio = good + reject > 0 ? `${((reject / (good + reject)) * 100).toFixed(1)}%` : "0%";

  const lines = data.reduce((acc, robot) => {
    const line = robot.line_id || "?";
    if (!acc[line]) acc[line] = [];
    acc[line].push(robot.power_watts || 0);
    return acc;
  }, {});
  const lineAvgs = Object.entries(lines).map(([line, watts]) => ({
    line,
    avg: watts.reduce((sum, value) => sum + value, 0) / watts.length,
  }));
  const maxAvg = Math.max(...lineAvgs.map((item) => item.avg), 0);
  const alarmRobots = data.filter((robot) => robot.alarms?.length > 0);

  const flowSteps = [
    { step: "STEP 1", icon: "🤖", name: "Raw Telemetry", sub: "로봇 JSON 수신", badge: "• 전송 중", bv: "green" },
    { step: "STEP 2", icon: "📋", name: "AAS 표준화", sub: "데이터 → 설명서", badge: "• AI Agent", bv: "info" },
    { step: "STEP 3", icon: "🔒", name: "EDC 통제", sub: "계약·권한 부여", badge: "• 자산화", bv: "warn" },
    { step: "STEP 4", icon: "🌐", name: "Catena-X", sub: "회사간 데이터 거래", badge: "• 마켓", bv: "ok" },
  ];
  const stats = [
    { label: "등록된 로봇", value: total, sub: "총 cobot 수", accent: "var(--accent)" },
    { label: "가동 중 (RUNNING)", value: running, sub: "정상 운영", accent: "var(--green)" },
    { label: "알람 발생", value: alarm, sub: "즉시 확인 필요", accent: "var(--amber)" },
    { label: "평균 불량률", value: ratio, sub: "reject ratio", accent: "var(--red)" },
  ];

  return (
    <div>
      <div style={{ display: "flex", border: "0.5px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden", marginBottom: 14, background: "var(--surface)" }}>
        {flowSteps.map((step, index) => (
          <div key={index} style={{ flex: 1, padding: "10px 10px 11px", borderRight: index < flowSteps.length - 1 ? "0.5px solid var(--border)" : "none", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: ".55rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#9aa5b4" }}>{step.step}</div>
            <div style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--ink)" }}>{step.icon} {step.name}</div>
            <div style={{ fontSize: ".66rem", color: "var(--ink-3)", lineHeight: 1.3 }}>{step.sub}</div>
            <Badge variant={step.bv} status={step.badge}>{step.badge}</Badge>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: "var(--r)", padding: "14px 14px 12px", boxShadow: "var(--sh)", position: "relative", overflow: "hidden", minHeight: 76 }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: stat.accent, borderRadius: "var(--r) var(--r) 0 0" }} />
            <div style={{ fontSize: ".62rem", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>{stat.label}</div>
            <div style={{ fontFamily: "var(--f)", fontSize: "1.8rem", fontWeight: 700, color: stat.accent, lineHeight: 1 }}>{stat.value}</div>
            <div style={{ fontSize: ".65rem", color: "var(--ink-3)", marginTop: 5 }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card title="라인별 평균 전력 소비" subtitle="power_watts 평균">
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 76, marginTop: 8 }}>
            {lineAvgs.map((item) => (
              <div key={item.line} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                <div style={{ width: "100%", background: "#eef3ff", borderRadius: 2, height: `${maxAvg ? Math.max(24, (item.avg / maxAvg) * 100) : 24}%`, transition: "height .3s" }} title={`${item.line}: ${item.avg.toFixed(0)}W`} />
                <div style={{ fontSize: ".62rem", color: "var(--ink-3)", marginTop: 6, whiteSpace: "nowrap" }}>{item.line}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="활성 알람" subtitle="즉시 대응 필요">
          {alarmRobots.length === 0 ? (
            <div style={{ color: "var(--green)", fontSize: ".78rem" }}>✓ 현재 활성 알람 없음</div>
          ) : (
            alarmRobots.map((robot, index) => (
              <div key={`${robot.robot_id}-${robot.produced_at || index}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: index < alarmRobots.length - 1 ? "0.5px solid var(--border-s)" : "none", fontSize: ".72rem" }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: ".63rem", fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: "var(--amber-s)", color: "var(--amber)" }}>{robot.robot_id}</span>
                <span style={{ color: "var(--ink-2)" }}>{robot.alarms.join(" · ")}</span>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

window.CX_PAGE_DASHBOARD = { PageDashboard };
