# Catena-X Cobot Data Space

협동로봇 텔레메트리를 수집하고, 대시보드/AI 질의응답/AAS-EDC 파이프라인으로 확인하는 데모 프로젝트입니다.
<img width="1437" height="2323" alt="스크린샷 2026-04-20 183855" src="https://github.com/user-attachments/assets/12c33ed4-a03e-4d07-9b6f-c9b8b220e388" />

<img width="1411" height="1103" alt="스크린샷 2026-04-20 180654" src="https://github.com/user-attachments/assets/1c678fc0-c597-473b-8493-52e4002fb2c4" />

## 실행

```bash
# 1) 백엔드(API)
python3 server/app.py --host 127.0.0.1 --port 8080

# 2) 프런트(UI)
cd frontend
python3 -m http.server 3000 --bind 127.0.0.1
```

- UI: `http://localhost:3000/`
- API: `http://localhost:8080/`
- 참고: `http://localhost:8080/`는 API 안내 랜딩 페이지입니다.

## 전체 아키텍처 흐름

```mermaid
flowchart TD
    subgraph UI["UI Layer"]
        B[Browser]
        FE[frontend/index.html<br/>Dashboard + AI Assistant]
        B -->|GET /| FE
    end

    subgraph API["Backend API Layer (:8080)"]
        APP[server/app.py]
        HH[server/http_handler.py]
        TS[server/telemetry_store.py]
        APP --> HH
        HH <--> TS
    end

    subgraph STORE["Storage"]
        DATA[(server/data/*.json)]
    end

    subgraph AI["AI Layer"]
        AG[apps/ai_agent.py]
        OL[Ollama<br/>qwen3:14b]
        AG <--> OL
    end

    subgraph CLI["CLI Pipeline"]
        PR[apps/preprocessor.py]
        MP[apps/aas_mapper.py]
        AG2[apps/ai_agent.py]
        EDC[apps/edc.py]
        PR --> MP --> AG2 --> EDC
    end

    FE -->|/api/v1/...| HH
    HH --> DATA
    DATA --> HH
    HH -->|/api/v1/ai/chat| AG
```

## 실시간 텔레메트리 수집

```mermaid
flowchart TD
    SRC[Cobot / PLC / Factory App] -->|POST /api/v1/cobot/telemetry| API[server/http_handler.py]
    API --> V{validate_telemetry}
    V -->|invalid| E400[400 Bad Request]
    V -->|valid| S[store_telemetry]
    S --> F1[(server/data/YYYY-MM-DD/*.json)]
    S --> F2[(server/data/latest.json)]
    API -->|GET latest/list/all| R[read_latest/read_recent/read_all]
    R --> J[JSON Response]
```

## AI 질의응답(스트리밍)

```mermaid
flowchart TD
    Q[사용자 질문 입력] --> FE2[frontend/index.html<br/>AI Assistant]
    FE2 --> H1[chat history load/save<br/>localStorage]
    FE2 -->|POST /api/v1/ai/chat<br/>stream=true| API2[server/http_handler.py]
    API2 --> AG3[apps/ai_agent.py]
    AG3 -->|/api/chat| OLL[Ollama qwen3:14b]
    OLL -->|token stream| AG3
    AG3 -->|NDJSON chunk| API2
    API2 -->|chunk render| FE2
```

## 온보딩/EDC 파이프라인

```mermaid
flowchart TD
    IN[sample telemetry JSON] --> P1[apps/preprocessor.py<br/>정규화/기본값/경고]
    P1 --> M1[apps/aas_mapper.py<br/>semantic map 기반 매핑]
    M1 --> A1[apps/ai_agent.py<br/>메타모델/보조 추론]
    A1 --> E1[apps/edc.py]
    E1 --> OUT1[(AAS Submodel payload)]
    E1 --> OUT2[(EDC mock asset/policy/contract)]
```

## 주요 기능

- `frontend/index.html`: 운영 대시보드, 차트, AI 어시스턴트 화면
- `frontend/index.html`: AI 채팅 히스토리(localStorage, 최대 100개) 저장/복원
- `server/app.py`: 서버 실행 진입점
- `server/http_handler.py`: HTTP 라우팅, API 응답
- `server/telemetry_store.py`: 텔레메트리 검증, 저장, 조회, KPI/시계열 집계
- `apps/ai_agent.py`: Ollama health/chat/streaming/AAS 생성 보조
- `apps/edc.py`: AAS 검증, AAS push, EDC 등록, CLI 파이프라인

## 주요 API

- `GET /health`
- `GET /api/v1/cobot/telemetry/all`
- `GET /api/v1/cobot/telemetry/latest`
- `GET /api/v1/cobot/telemetry/kpi/summary`
- `GET /api/v1/cobot/telemetry/timeseries`
- `GET /api/v1/ai/health`
- `POST /api/v1/ai/chat`

## CLI

```bash
python3 -m apps.edc --help
python3 -m apps.edc pipeline --telemetry-json server/data/sample_telemetry.json --skip-aas-push
```

필요한 환경변수:

```bash
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_TIMEOUT=120

export CATENAX_AAS_BASE_URL=http://localhost:4001
export CATENAX_AAS_SUBMODEL_ID=urn:aas:cobot:submodel:001
export CATENAX_EDC_MANAGEMENT_URL=http://localhost:8181/management
```

참고:
- 서버(`server/settings.py`) 기준 모델은 현재 `qwen3:14b`로 고정입니다.

## 문서

- `server/PIPELINE.md`: 서버 요청 흐름
- `apps/PIPELINE.md`: AAS/EDC/AI 파이프라인 흐름
- `EDC_CLI_GUIDE.md`: CLI 사용법
- `EDC_REFACTOR_PROPOSAL.md`: 현재 구조 기준 리팩터링 메모
