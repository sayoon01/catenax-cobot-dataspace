const { useState: useCatalogState } = React;
const { Alert: CatalogAlert, Card: CatalogCard, Btn: CatalogBtn, Badge: CatalogBadge, CodeBlock: CatalogCodeBlock } = window.CX_UI;

function PageCatalog() {
  const [catUrl, setCatUrl] = useCatalogState("http://provider-edc:8282/protocol");
  const [catAid, setCatAid] = useCatalogState("");
  const [result, setResult] = useCatalogState(null);

  const simCatalog = () => {
    const req = {
      counterPartyAddress: catUrl,
      protocol: "dataspace-protocol-http",
      ...(catAid ? { querySpec: { filterExpression: [{ operandLeft: "https://w3id.org/edc/v0.0.1/ns/id", operator: "=", operandRight: catAid }] } } : {}),
    };
    const resp = { "@context": "https://w3id.org/edc/v0.0.1/ns/", "@type": "dcat:Catalog", datasets: [{ "@type": "dcat:Dataset", "@id": "cobot-asset-001", "dct:title": "Cobot Telemetry Stream", "dct:description": "Operational data from factory cobots", "odrl:hasPolicy": { "@id": "offer-001", "@type": "odrl:Offer" } }], participantId: "BPNL000000000001", createdAt: new Date().toISOString() };
    setResult({ type: "catalog", req, resp });
  };

  const simNegotiate = () => {
    setResult({
      type: "negotiate",
      resp: { "@type": "ContractNegotiation", "@id": `neg-${Date.now()}`, state: "REQUESTED", createdAt: new Date().toISOString(), counterPartyAddress: catUrl, protocol: "dataspace-protocol-http" },
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "var(--f)", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-.02em" }}>데이터 카탈로그</div>
        <div style={{ fontSize: ".8rem", color: "var(--ink-3)", marginTop: 3 }}>Catena-X 카탈로그 조회 → 계약 협상 → 데이터 전송 흐름</div>
      </div>
      <CatalogAlert type="info">카탈로그 요청 → 계약 협상 → 데이터 전송까지의 Catena-X 흐름을 시뮬레이션합니다.</CatalogAlert>
      <CatalogCard title="카탈로그 요청 시뮬레이션" style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          {[["상대방 EDC 프로토콜 URL", catUrl, setCatUrl], ["Asset ID (선택)", catAid, setCatAid, "cobot-asset-001"]].map(([label, value, setter, placeholder]) => (
            <div key={label}>
              <div style={{ fontSize: ".62rem", fontWeight: 600, textTransform: "uppercase", color: "var(--ink-2)", marginBottom: 4 }}>{label}</div>
              <input style={{ padding: "7px 10px", border: "0.5px solid var(--border)", borderRadius: "var(--r-sm)", fontSize: ".75rem", fontFamily: "var(--f-mono)", background: "var(--surface)", color: "var(--ink)", outline: "none", width: "100%" }} value={value} onChange={(event) => setter(event.target.value)} placeholder={placeholder || ""} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <CatalogBtn variant="primary" onClick={simCatalog}>카탈로그 조회</CatalogBtn>
          <CatalogBtn variant="outline" onClick={simNegotiate}>계약 협상 시작</CatalogBtn>
        </div>
      </CatalogCard>
      {result && (
        result.type === "catalog" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <CatalogCard title="요청 페이로드"><CatalogCodeBlock code={JSON.stringify(result.req, null, 2)} /></CatalogCard>
            <CatalogCard title="카탈로그 응답 (시뮬레이션)" actions={<CatalogBadge variant="ok">성공</CatalogBadge>}><CatalogCodeBlock code={JSON.stringify(result.resp, null, 2)} /></CatalogCard>
          </div>
        ) : (
          <CatalogCard title="계약 협상 시작됨" actions={<CatalogBadge variant="warn">REQUESTED</CatalogBadge>}>
            <CatalogAlert type="success">✓ 협상 요청 전송됨 (시뮬레이션)</CatalogAlert>
            <CatalogCodeBlock code={JSON.stringify(result.resp, null, 2)} />
          </CatalogCard>
        )
      )}
    </div>
  );
}

window.CX_PAGE_CATALOG = { PageCatalog };
