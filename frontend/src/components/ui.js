const S = {
  badge: {
    RUNNING: { bg: "var(--green-s)", color: "var(--green)" },
    IDLE: { bg: "var(--accent-s)", color: "var(--accent)" },
    ERROR: { bg: "var(--red-s)", color: "var(--red)" },
    MAINTENANCE: { bg: "var(--amber-s)", color: "var(--amber)" },
  },
};

function Badge({ status, children, variant }) {
  const styles = {
    RUNNING: "green",
    IDLE: "blue",
    ERROR: "red",
    MAINTENANCE: "amber",
    ok: "green",
    warn: "amber",
    fail: "red",
    info: "blue",
    ai: "purple",
  };
  const palette = {
    green: [S.badge.RUNNING.bg, "var(--green)"],
    blue: ["var(--accent-s)", "var(--accent)"],
    red: ["var(--red-s)", "var(--red)"],
    amber: ["var(--amber-s)", "var(--amber)"],
    purple: ["var(--purple-s)", "var(--purple)"],
  };
  const selected = palette[variant || styles[status] || "blue"] || palette.blue;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 100, fontSize: ".62rem", fontWeight: 600, background: selected[0], color: selected[1], whiteSpace: "nowrap" }}>
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: selected[1], flexShrink: 0 }} />
      {children || status}
    </span>
  );
}

function Card({ title, subtitle, actions, children, style }) {
  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--sh)", overflow: "hidden", ...style }}>
      {title && (
        <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--ink)" }}>{title}</div>
            {subtitle && <div style={{ fontSize: ".7rem", color: "var(--ink-3)", marginTop: 2 }}>{subtitle}</div>}
          </div>
          {actions && <div style={{ display: "flex", gap: 6 }}>{actions}</div>}
        </div>
      )}
      <div style={{ padding: "14px 16px" }}>{children}</div>
    </div>
  );
}

function Btn({ variant = "outline", size = "md", onClick, disabled, children, style }) {
  const sizes = {
    sm: { padding: "4px 10px", fontSize: ".72rem" },
    md: { padding: "6px 13px", fontSize: ".78rem" },
    lg: { padding: "8px 16px", fontSize: ".85rem" },
  };
  const variants = {
    primary: { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" },
    outline: { background: "transparent", borderColor: "var(--border)", color: "var(--ink-2)" },
    ghost: { background: "transparent", color: "var(--ink-2)", borderColor: "transparent" },
    danger: { background: "var(--red-s)", color: "var(--red)", borderColor: "transparent" },
    success: { background: "var(--green-s)", color: "var(--green)", borderColor: "transparent" },
  };

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        borderRadius: "var(--r-sm)",
        fontFamily: "var(--f-kr)",
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all .15s",
        border: "1px solid transparent",
        whiteSpace: "nowrap",
        opacity: disabled ? 0.6 : 1,
        ...sizes[size],
        ...variants[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function ScoreRing({ score, size = 70 }) {
  const radius = size / 2 - 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "var(--green)" : score >= 60 ? "var(--amber)" : "var(--red)";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset .6s ease" }}
      />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize={size * 0.18} fontWeight={700} fill={color} fontFamily="Sora,sans-serif">
        {score}
      </text>
    </svg>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--surface-2)", borderRadius: "var(--r-sm)", padding: 3, width: "fit-content", marginBottom: 14, border: "0.5px solid var(--border)", flexWrap: "wrap" }}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{ padding: "5px 12px", borderRadius: 6, fontSize: ".72rem", fontWeight: 500, cursor: "pointer", color: active === tab.id ? "var(--ink)" : "var(--ink-3)", background: active === tab.id ? "var(--surface)" : "transparent", boxShadow: active === tab.id ? "0 1px 3px rgba(0,0,0,.1)" : "none", transition: "all .15s", userSelect: "none" }}
        >
          {tab.label}
        </div>
      ))}
    </div>
  );
}

function CodeBlock({ code, maxHeight = 320 }) {
  return (
    <pre style={{ background: "#0f172a", borderRadius: "var(--r-sm)", padding: 14, fontFamily: "var(--f-mono)", fontSize: ".72rem", lineHeight: 1.65, color: "#e2e8f0", overflow: "auto", maxHeight, margin: 0 }}>
      {code}
    </pre>
  );
}

function Alert({ type = "info", children }) {
  const styles = {
    info: ["var(--accent-s)", "var(--accent)", "#bfdbfe"],
    warn: ["var(--amber-s)", "var(--amber)", "#fde68a"],
    error: ["var(--red-s)", "var(--red)", "#fecaca"],
    success: ["var(--green-s)", "var(--green)", "#bbf7d0"],
    ai: ["var(--purple-s)", "var(--purple)", "#ddd6fe"],
  };
  const [bg, fg, border] = styles[type] || styles.info;

  return (
    <div style={{ padding: "9px 12px", borderRadius: "var(--r-sm)", fontSize: ".78rem", background: bg, color: fg, border: `1px solid ${border}`, marginBottom: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
      {children}
    </div>
  );
}

function Spinner() {
  return <span style={{ width: 16, height: 16, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin .65s linear infinite", display: "inline-block", verticalAlign: "middle" }} />;
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null;

  return (
    <div onClick={(event) => event.target === event.currentTarget && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.5)", zIndex: 500, backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--surface)", borderRadius: "var(--r)", boxShadow: "var(--sh-md)", width: 680, maxWidth: "93vw", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 18px", borderBottom: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 600, fontSize: ".9rem", fontFamily: "var(--f)" }}>{title}</div>
          <Btn variant="ghost" size="sm" onClick={onClose}>✕</Btn>
        </div>
        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

function ValidationResultCard({ v }) {
  if (!v) return null;

  const color = v.overall_score >= 80 ? "var(--green)" : v.overall_score >= 60 ? "var(--amber)" : "var(--red)";
  const levelStyle = {
    CRITICAL: ["var(--red-s)", "var(--red)"],
    ERROR: ["var(--amber-s)", "var(--amber)"],
    WARN: ["var(--amber-s)", "var(--amber)"],
    INFO: ["var(--accent-s)", "var(--accent)"],
  };

  return (
    <Card title="3-Layer 검증 리포트">
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 20, alignItems: "start", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <ScoreRing score={v.overall_score} size={82} />
          <div>
            <div style={{ fontFamily: "var(--f)", fontSize: "2rem", fontWeight: 700, lineHeight: 1, color }}>{v.overall_score}/100</div>
            <div style={{ fontSize: ".72rem", color: "var(--ink-3)", marginTop: 6 }}>종합 검증 점수</div>
            <div style={{ marginTop: 8 }}><Badge variant={v.passed ? "ok" : "fail"}>{v.passed ? "✓ PASSED" : "✗ FAILED"}</Badge></div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[["L1 Standard", v.l1, "#16a34a"], ["L2 Semantic", v.l2, "#f59e0b"], ["L3 Reliability", v.l3, "#ef4444"]].map(([name, score, tone]) => (
            <div key={name} style={{ background: "var(--surface-2)", border: "1px solid var(--border-s)", borderRadius: "var(--r-sm)", padding: "12px 12px 10px" }}>
              <div style={{ fontSize: ".62rem", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>{name}</div>
              <div style={{ fontFamily: "var(--f)", fontSize: "1.35rem", fontWeight: 700, color: tone }}>{score}</div>
              <div style={{ height: 6, marginTop: 8, background: "#edf1f7", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${score}%`, height: "100%", background: tone, borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {v.issues.length > 0 ? (
        <div style={{ borderTop: "0.5px solid var(--border-s)", paddingTop: 6 }}>
          {v.issues.map((issue, index) => {
          const [bg, fg] = levelStyle[issue.level] || ["var(--accent-s)", "var(--accent)"];
          return (
            <div key={index} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: "0.5px solid var(--border-s)", fontSize: ".75rem", alignItems: "flex-start" }}>
              <span style={{ padding: "1px 6px", borderRadius: 3, background: bg, color: fg, fontSize: ".6rem", fontWeight: 700, fontFamily: "var(--f-mono)", flexShrink: 0 }}>{issue.level}</span>
              <span style={{ fontSize: ".62rem", color: "var(--ink-3)", marginRight: 6, flexShrink: 0 }}>L{issue.layer}</span>
              <span style={{ color: "var(--ink-2)" }}>{issue.msg}</span>
            </div>
          );
          })}
        </div>
      ) : (
        <Alert type="success">✓ 검증 이슈 없음 - 모든 레이어 통과</Alert>
      )}
    </Card>
  );
}

window.CX_UI = {
  Badge,
  Card,
  Btn,
  ScoreRing,
  Tabs,
  CodeBlock,
  Alert,
  Spinner,
  Modal,
  ValidationResultCard,
};
