const { useState, useEffect, useCallback } = React;
const { SAMPLES, SERVER } = window.CX_CONSTANTS;
const { Sidebar, Topbar } = window.CX_LAYOUT;
const {
  PageDashboard,
  PageRobots,
  PageTelemetry,
  PagePipeline,
  PageAAS,
  PageValidation,
  PageEDC,
  PageCatalog,
} = window.CX_PAGES;

function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [data, setData] = useState(Object.values(SAMPLES));
  const [serverStatus, setServerStatus] = useState("로컬 샘플 데이터");
  const [lastValidation, setLastValidation] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch(`${SERVER}/api/v1/cobot/telemetry/all`, { signal: AbortSignal.timeout(2000) });
      const payload = await response.json();
      if (payload.items?.length > 0) {
        setData(payload.items);
        setServerStatus("서버 연결됨");
        return;
      }
    } catch {
      // fallback to local samples when backend is unavailable
    }
    setData(Object.values(SAMPLES));
    setServerStatus("로컬 샘플 데이터");
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pages = {
    dashboard: <PageDashboard data={data} />,
    robots: <PageRobots data={data} />,
    telemetry: <PageTelemetry data={data} onRefresh={loadData} />,
    pipeline: <PagePipeline onValidationResult={setLastValidation} />,
    aas: <PageAAS data={data} />,
    validation: <PageValidation lastValidation={lastValidation} />,
    edc: <PageEDC />,
    catalog: <PageCatalog />,
  };

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.85)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        .page-enter { animation: fadeUp .25s ease; }
      `}</style>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar activePage={activePage} setActivePage={setActivePage} robotCount={data.length} serverStatus={serverStatus} />
        <div style={{ marginLeft: 220, flex: 1, display: "flex", flexDirection: "column" }}>
          <Topbar activePage={activePage} onRefresh={loadData} onGoToPipeline={() => setActivePage("pipeline")} />
          <div className="page-enter" key={activePage} style={{ flex: 1, padding: "24px 26px", overflowY: "auto" }}>
            {pages[activePage]}
          </div>
        </div>
      </div>
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
