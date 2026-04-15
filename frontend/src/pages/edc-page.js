const { useState: useEDCState } = React;
const { Card: EDCCard, Btn: EDCBtn, Badge: EDCBadge, CodeBlock: EDCCodeBlock } = window.CX_UI;

function PageEDC() {
  const [assetId, setAssetId] = useEDCState("cobot-asset-001");
  const [bpn, setBpn] = useEDCState("BPNL000000000001");
  const [baseUrl, setBaseUrl] = useEDCState("http://localhost:8080");
  const [dataPath, setDataPath] = useEDCState("/api/v1/cobot/telemetry");
  const [polId, setPolId] = useEDCState("cobot-policy-001");
  const [polBpn, setPolBpn] = useEDCState("BPNL000000000001");
  const [polAction, setPolAction] = useEDCState("USE");
  const [polOp, setPolOp] = useEDCState("EQ");
  const [payload, setPayload] = useEDCState(null);

  const buildAsset = () => setPayload({
    asset: { properties: { "asset:prop:id": assetId, "asset:prop:name": `Cobot telemetry ${assetId}`, "asset:prop:contenttype": "application/json", "asset:prop:description": "Operational telemetry from collaborative robot", "catenax:providerBpn": bpn, "catenax:assetType": "factory-cobot-telemetry" } },
    dataAddress: { type: "HttpData", baseUrl, path: dataPath, proxyMethod: "true", proxyPath: "true", proxyQueryParams: "true", proxyBody: "true" },
    contractDefinition: { "@id": `${assetId}-contract`, "@type": "ContractDefinition", accessPolicyId: `${assetId}-access-policy`, contractPolicyId: `${assetId}-contract-policy`, assetsSelector: [{ "@type": "Criterion", operandLeft: "https://w3id.org/edc/v0.0.1/ns/id", operator: "=", operandRight: assetId }] },
  });
  const buildPolicy = () => setPayload({
    "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/", odrl: "http://www.w3.org/ns/odrl/2/" },
    "@id": polId,
    "@type": "PolicyDefinition",
    policy: { "@context": "http://www.w3.org/ns/odrl.jsonld", "@type": "Set", permission: [{ action: polAction, constraint: { leftOperand: "BusinessPartnerNumber", operator: polOp, rightOperand: polBpn } }] },
  });

  const inputStyle = { padding: "7px 10px", border: "0.5px solid var(--border)", borderRadius: "var(--r-sm)", fontSize: ".8rem", background: "var(--surface)", color: "var(--ink)", outline: "none", width: "100%" };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "var(--f)", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-.02em" }}>EDC 커넥터</div>
        <div style={{ fontSize: ".8rem", color: "var(--ink-3)", marginTop: 3 }}>Eclipse Dataspace Components · 자산 등록 · 정책 · 계약 정의</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <EDCCard title="자산 등록 (Asset Registration)">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {[["Asset ID", assetId, setAssetId], ["Provider BPN", bpn, setBpn], ["Cobot API Base URL", baseUrl, setBaseUrl], ["Data Path", dataPath, setDataPath]].map(([label, value, setter]) => (
              <div key={label}>
                <div style={{ fontSize: ".62rem", fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink-2)", marginBottom: 4 }}>{label}</div>
                <input style={{ ...inputStyle, fontFamily: "var(--f-mono)", fontSize: ".73rem" }} value={value} onChange={(event) => setter(event.target.value)} />
              </div>
            ))}
          </div>
          <EDCBtn variant="primary" onClick={buildAsset}>페이로드 생성</EDCBtn>
        </EDCCard>
        <EDCCard title="Policy 빌더">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {[["Policy ID", polId, setPolId], ["Assignee BPN", polBpn, setPolBpn]].map(([label, value, setter]) => (
              <div key={label}>
                <div style={{ fontSize: ".62rem", fontWeight: 600, textTransform: "uppercase", color: "var(--ink-2)", marginBottom: 4 }}>{label}</div>
                <input style={{ ...inputStyle, fontFamily: "var(--f-mono)", fontSize: ".73rem" }} value={value} onChange={(event) => setter(event.target.value)} />
              </div>
            ))}
            {[["Action", polAction, setPolAction, ["USE", "READ", "WRITE"]], ["Operator", polOp, setPolOp, ["EQ", "NEQ", "IN"]]].map(([label, value, setter, options]) => (
              <div key={label}>
                <div style={{ fontSize: ".62rem", fontWeight: 600, textTransform: "uppercase", color: "var(--ink-2)", marginBottom: 4 }}>{label}</div>
                <select style={inputStyle} value={value} onChange={(event) => setter(event.target.value)}>
                  {options.map((option) => <option key={option}>{option}</option>)}
                </select>
              </div>
            ))}
          </div>
          <EDCBtn variant="outline" onClick={buildPolicy}>정책 페이로드 생성</EDCBtn>
        </EDCCard>
      </div>
      {payload && (
        <EDCCard title="EDC 페이로드 미리보기" actions={<EDCBadge variant="ok">ODRL 규격</EDCBadge>}>
          <EDCCodeBlock code={JSON.stringify(payload, null, 2)} />
        </EDCCard>
      )}
    </div>
  );
}

window.CX_PAGE_EDC = { PageEDC };
