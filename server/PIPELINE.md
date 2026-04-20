# Server Pipeline

`server`는 `8080`에서 JSON API를 제공합니다. UI는 `3000` 정적 서버에서 제공합니다.

## 실행 흐름

```mermaid
flowchart TD
    CLIENT[Browser / Client] --> APP[server/app.py]
    APP --> HH[server/http_handler.py]
    HH --> TS[server/telemetry_store.py]
    TS --> DATA[(server/data/*.json)]
    DATA --> TS
    TS --> HH
```

AI 요청은 아래 흐름을 추가로 탑니다.

```mermaid
flowchart TD
    Q[POST /api/v1/ai/chat] --> HH[server/http_handler.py]
    HH --> AG[apps/ai_agent.py]
    AG --> OLL[Ollama qwen3:14b]
    OLL --> AG
    AG --> HH
```

## 파일별 책임

| 파일 | 담당 |
| --- | --- |
| `app.py` | 서버 실행 진입점, `ThreadingHTTPServer` 시작 |
| `http_handler.py` | 라우팅, JSON/NDJSON 응답, AI API 연결 |
| `telemetry_store.py` | telemetry 검증, 파일 저장, 조회, KPI/시계열 계산 |
| `settings.py` | 경로, 필수 필드, logger 설정 |
| `data/` | 저장된 telemetry JSON과 `latest.json` |

## 주요 요청 흐름

### 화면

```mermaid
flowchart TD
    U[사용자] -->|GET /| B8080[8080 Backend]
    B8080 --> APIROOT[API 안내 랜딩 HTML]
    U -->|GET /| B3000[3000 Frontend]
    B3000 --> FE[frontend/index.html]
    FE --> H[AI chat history<br/>localStorage load/save]
```

### 저장

```mermaid
flowchart TD
    IN[POST /api/v1/cobot/telemetry] --> V[validate_telemetry]
    V -->|invalid| E400[400 Bad Request]
    V -->|valid| S[store_telemetry]
    S --> D1[(server/data/YYYY-MM-DD/*.json)]
    S --> D2[(server/data/latest.json)]
    S --> C201[201 Created]
```

### 조회

```mermaid
flowchart TD
    A1[GET /api/v1/cobot/telemetry/all] --> R[telemetry_store read]
    A2[GET /api/v1/cobot/telemetry/latest] --> R
    A3[GET /api/v1/cobot/telemetry/kpi/summary] --> R
    A4[GET /api/v1/cobot/telemetry/timeseries] --> R
    R --> OUT[JSON Response]
```

### AI

```mermaid
flowchart TD
    H1[GET /api/v1/ai/health] --> AG[apps/ai_agent.py]
    C[POST /api/v1/ai/chat] --> AG
    AG --> OLL[Ollama qwen3:14b]
    OLL --> AG
    AG --> RESP[JSON or NDJSON stream]
```

프런트 AI 화면은 대화 히스토리를 브라우저 `localStorage`에 저장하며, 재접속 시 자동 복원합니다(최대 100개 메시지).

AI 모델 기본값은 `qwen3:14b`입니다.

## 실행

```bash
python3 server/app.py --host 127.0.0.1 --port 8080
```

API 접속: `http://localhost:8080/`
