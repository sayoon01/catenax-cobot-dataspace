# Server Full Pipeline

이 문서는 `server` 디렉토리의 cobot telemetry backend 흐름과 각 파일의 역할을 설명한다.

## Server Overview

`server`는 Python standard library 기반 HTTP JSON API 서버다. FastAPI/Flask 같은 외부 프레임워크 없이 `ThreadingHTTPServer`와 `BaseHTTPRequestHandler`로 동작한다.

주요 목적:

- cobot telemetry JSON 수신
- 필수 필드 검증
- telemetry event를 파일로 저장
- latest/recent/all telemetry 조회
- KPI summary 계산
- time series bucket 집계
- Ollama 기반 AI chat/explanation API 제공
- frontend 또는 EDC data address가 호출할 수 있는 HTTP endpoint 제공

## Directory Structure

```text
server/
  app.py
  http_handler.py
  telemetry_store.py
  settings.py
  data/
    latest.json
    sample_telemetry.json
    YYYY-MM-DD/
      <timestamp>_<robot_id>.json
```

## Full Pipeline

서버의 핵심 흐름은 요청 종류에 따라 두 갈래다.

### Write Pipeline

```text
Client / Simulator / Frontend
  ↓
POST /api/v1/cobot/telemetry
  ↓
server/http_handler.py
  TelemetryHandler.do_POST()
  ↓
_read_json()
  request body JSON parse
  ↓
server/telemetry_store.py
  validate_telemetry()
  ↓
store_telemetry()
  ↓
server/data/YYYY-MM-DD/<timestamp>_<robot_id>.json
server/data/latest.json
  ↓
HTTP 201 response
```

### Read Pipeline

```text
Client / Frontend / Dashboard
  ↓
GET /health
GET /api/v1/cobot/telemetry/latest
GET /api/v1/cobot/telemetry
GET /api/v1/cobot/telemetry/all
GET /api/v1/cobot/telemetry/kpi/summary
GET /api/v1/cobot/telemetry/timeseries
GET /api/v1/ai/health
  ↓
server/http_handler.py
  TelemetryHandler.do_GET()
  ↓
server/telemetry_store.py
  read_latest()
  read_recent()
  read_all()
  kpi_summary()
  timeseries_buckets()
  ↓
JSON response
```

### AI Pipeline

```text
Client / Frontend
  ↓
POST /api/v1/ai/chat
  ↓
server/http_handler.py
  TelemetryHandler._handle_ai_chat()
  ↓
apps/ai_agent.py
  OllamaAASAgent.chat()
  OllamaAASAgent.explain_validation_report()
  ↓
Ollama /api/chat
  ↓
JSON response with answer
```

## 1. Entrypoint

파일: `server/app.py`

`app.py`는 backend server 실행 엔트리포인트다.

주요 기능:

- CLI argument 파싱
- logging 설정
- data directory 생성
- `ThreadingHTTPServer` 시작
- `TelemetryHandler`를 HTTP request handler로 연결

실행:

```bash
python server/app.py --host 0.0.0.0 --port 8080
```

기본값:

```text
host: 0.0.0.0
port: 8080
```

실행 후 서버는 다음 주소에서 요청을 받는다.

```text
http://<host>:<port>
```

## 2. HTTP Handler

파일: `server/http_handler.py`

클래스:

```text
TelemetryHandler
```

`TelemetryHandler`는 HTTP routing, request parsing, JSON response 전송을 담당한다.

주요 기능:

- CORS preflight 처리
- JSON request body 읽기
- JSON response 전송
- GET endpoint routing
- POST endpoint routing
- validation/storage/query 함수 호출
- HTTP status code 결정

공통 응답 처리:

- `_cors_headers()`
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type`
- `_send_json(status, payload)`
  - JSON 직렬화
  - `Content-Type: application/json; charset=utf-8`
  - CORS header 포함
- `_read_json()`
  - request body 읽기
  - 빈 body면 `ValueError`
  - invalid JSON이면 `JSONDecodeError`

## 3. Telemetry Store

파일: `server/telemetry_store.py`

`telemetry_store.py`는 telemetry 검증, 저장, 조회, KPI 집계, time series bucket 계산을 담당한다.

주요 기능:

- `validate_telemetry(payload)`
  - 필수 필드 확인
  - numeric field 검증
  - string field empty 검증
- `store_telemetry(payload)`
  - `stored_at` timestamp 추가
  - 날짜별 JSON 파일 저장
  - `latest.json` 갱신
  - 저장 결과 response 생성
- `read_latest()`
  - `server/data/latest.json` 읽기
- `read_recent(limit)`
  - 최근 JSON 파일을 최대 `limit`개까지 읽기
- `read_all()`
  - 최대 10000개까지 읽기
- `kpi_summary(window_spec, compare_previous)`
  - 지정 window의 KPI 계산
  - previous window 비교와 delta 계산
- `timeseries_buckets(from_dt, to_dt, bucket_spec, robot_id)`
  - 기간 내 telemetry를 bucket 단위로 집계

파일 저장은 `STORE_LOCK`으로 보호된다. 동시에 여러 POST 요청이 들어와도 파일 write와 `latest.json` 갱신이 같은 critical section 안에서 처리된다.

## 4. Settings

파일: `server/settings.py`

서버 전역 설정을 정의한다.

```text
APP_DIR       server 디렉토리 경로
DATA_DIR      server/data
LATEST_FILE   server/data/latest.json
LOGGER        catenax.server logger
```

필수 telemetry field:

```text
robot_id
line_id
station_id
cycle_time_ms
power_watts
program_name
status
```

`validate_telemetry()`는 이 필수 필드 목록을 기준으로 POST payload를 검증한다.

## API Endpoints

### Health Check

```http
GET /health
```

응답 예:

```json
{
  "status": "ok",
  "service": "catenax-cobot-telemetry",
  "timestamp": "2026-04-20T00:00:00+00:00"
}
```

### Store Telemetry

```http
POST /api/v1/cobot/telemetry
Content-Type: application/json
```

필수 필드:

```json
{
  "robot_id": "cobot-01",
  "line_id": "line-a",
  "station_id": "station-07",
  "cycle_time_ms": 1825.4,
  "power_watts": 438.7,
  "program_name": "door-assembly-v2",
  "status": "RUNNING"
}
```

선택 필드 예:

```json
{
  "good_parts": 1280,
  "reject_parts": 9,
  "temperature_c": 42.8,
  "vibration_mm_s": 1.9,
  "pose": {
    "x": 412.5,
    "y": 88.2,
    "z": 265.0
  },
  "joint_positions_deg": {
    "j1": 10.5,
    "j2": -24.0
  },
  "alarms": [],
  "produced_at": "2025-01-15T08:30:00Z"
}
```

성공 응답:

```json
{
  "status": "stored",
  "stored_at": "2026-04-20T00:00:00+00:00",
  "file": "data/2026-04-20/2026-04-20T00-00-00+00-00_cobot-01.json",
  "telemetry": {
    "robot_id": "cobot-01",
    "stored_at": "2026-04-20T00:00:00+00:00"
  }
}
```

실패 케이스:

- 빈 body: `400`
- invalid JSON: `400`
- 필수 필드 누락: `400`
- numeric field가 숫자로 변환 불가: `400`
- 필수 string field가 empty: `400`

### Latest Telemetry

```http
GET /api/v1/cobot/telemetry/latest
```

`server/data/latest.json`을 반환한다.

저장된 telemetry가 없으면:

```json
{
  "error": "No telemetry stored yet"
}
```

HTTP status는 `404`다.

### Recent Telemetry

```http
GET /api/v1/cobot/telemetry?limit=20
```

최근 telemetry 파일을 읽어 반환한다.

제약:

- 기본 `limit`: `20`
- 최소 `limit`: `1`
- 최대 `limit`: `500`
- `limit`이 integer가 아니면 `400`

응답:

```json
{
  "items": [],
  "count": 0
}
```

### All Telemetry

```http
GET /api/v1/cobot/telemetry/all
```

내부적으로 `read_all()`을 호출한다.

현재 구현은 최대 10000개까지 읽는다.

응답:

```json
{
  "items": [],
  "count": 0
}
```

### KPI Summary

```http
GET /api/v1/cobot/telemetry/kpi/summary?window=1h&compare=previous
```

지원 window:

```text
15m
1h
24h
7d
```

`compare` 값:

```text
previous   previous window와 비교한다.
none       previous 비교를 끈다.
false      previous 비교를 끈다.
0          previous 비교를 끈다.
no         previous 비교를 끈다.
```

KPI 계산 기준:

- 지정 window에 포함된 event를 읽는다.
- robot별 최신 event만 KPI 대표값으로 사용한다.
- 전체 event 개수는 `event_count`에 반영한다.
- robot별 최신 event 수는 `robot_count`에 반영한다.

KPI field:

```text
event_count
robot_count
avg_temperature_c
avg_power_watts
good_parts_sum
reject_parts_sum
running_count
alerts_count
```

Alert 판정 기준:

- `status`가 `ERROR`, `FAULT`, `WARNING`
- `temperature_c > 75.0`
- `vibration_mm_s > 5.0`
- reject ratio > `0.02`
- `alarms` 리스트가 비어 있지 않음

응답 구조:

```json
{
  "window": {
    "label": "1h",
    "from": "2026-04-20T00:00:00Z",
    "to": "2026-04-20T01:00:00Z"
  },
  "current": {
    "event_count": 0,
    "robot_count": 0,
    "avg_temperature_c": 0.0,
    "avg_power_watts": 0.0,
    "good_parts_sum": 0,
    "reject_parts_sum": 0,
    "running_count": 0,
    "alerts_count": 0
  },
  "previous": {},
  "previous_window": {},
  "delta": {}
}
```

### Timeseries

```http
GET /api/v1/cobot/telemetry/timeseries?from=2026-04-20T00:00:00Z&to=2026-04-20T01:00:00Z&bucket=5m
```

Optional robot filter:

```http
GET /api/v1/cobot/telemetry/timeseries?from=2026-04-20T00:00:00Z&to=2026-04-20T01:00:00Z&bucket=5m&robot_id=cobot-01
```

지원 bucket:

```text
1m
5m
15m
1h
```

제약:

- `from`, `to`는 ISO8601 timestamp여야 한다.
- `to <= from`이면 빈 points를 반환한다.
- 조회 범위는 최대 14일이다.
- bucket 값이 허용 목록에 없으면 `400`

응답 구조:

```json
{
  "bucket": "5m",
  "from": "2026-04-20T00:00:00Z",
  "to": "2026-04-20T01:00:00Z",
  "robot_id": null,
  "count": 12,
  "points": [
    {
      "t": "2026-04-20T00:00:00Z",
      "t_end": "2026-04-20T00:05:00Z",
      "sample_count": 0,
      "avg_temperature_c": null,
      "avg_power_watts": null,
      "avg_cycle_time_ms": null
    }
  ]
}
```

### AI Health

```http
GET /api/v1/ai/health
```

Ollama `/api/tags`를 호출해 configured model이 사용 가능한지 확인한다.

응답 예:

```json
{
  "ok": true,
  "base_url": "http://localhost:11434",
  "model": "qwen3:27b",
  "available_models": ["qwen3:27b"]
}
```

### AI Chat

```http
POST /api/v1/ai/chat
Content-Type: application/json
```

일반 질문:

```json
{
  "message": "이 telemetry에서 위험한 부분을 설명해줘",
  "telemetry": {
    "robot_id": "cobot-01",
    "status": "RUNNING",
    "temperature_c": 82.0
  }
}
```

latest telemetry를 context로 포함:

```json
{
  "message": "최근 로봇 상태를 요약해줘",
  "include_latest": true
}
```

validation report 설명:

```json
{
  "mode": "explain_validation",
  "validation_report": {
    "passed": false,
    "overall_score": 55.0,
    "issues": ["[CRITICAL] temperature_c=90 exceeds max 85.0°C"]
  }
}
```

응답:

```json
{
  "mode": "chat",
  "model": "qwen3:27b",
  "answer": "..."
}
```

## Storage Layout

Telemetry event 저장 위치:

```text
server/data/YYYY-MM-DD/<stored_at>_<robot_id>.json
```

예:

```text
server/data/2026-04-20/2026-04-20T03-46-45-780172+00-00_cobot-01.json
```

최신 event cache:

```text
server/data/latest.json
```

저장 시 동작:

1. POST payload를 복사한다.
2. `stored_at`에 현재 UTC timestamp를 추가한다.
3. 날짜별 디렉토리를 만든다.
4. `<timestamp>_<robot_id>.json` 파일을 쓴다.
5. 같은 event를 `latest.json`에도 쓴다.
6. 저장 결과를 HTTP response로 반환한다.

## Validation Rules

`validate_telemetry()` 검증 규칙:

```text
1. REQUIRED_FIELDS가 모두 있어야 한다.
2. cycle_time_ms, power_watts는 float 변환 가능해야 한다.
3. robot_id, line_id, station_id, program_name, status는 빈 문자열이면 안 된다.
```

주의:

- `server`의 validation은 `apps/preprocessor.py`처럼 alias 변환이나 단위 변환을 하지 않는다.
- `server`는 저장 API이므로 현재는 표준 telemetry schema가 들어온다고 가정한다.
- alias/unit 정규화까지 서버에서 처리하려면 `apps.preprocessor.TelemetryPreprocessor`를 import해서 POST 저장 전에 실행하는 구조로 바꿀 수 있다.

## Current File Responsibilities

```text
server/app.py
  Server entrypoint
  CLI argument parsing
  ThreadingHTTPServer startup

server/http_handler.py
  HTTP routing
  Request body parsing
  JSON response formatting
  CORS handling
  AI health/chat routing

server/telemetry_store.py
  Telemetry validation
  File-backed storage
  Latest/recent/all reads
  KPI aggregation
  Timeseries bucketing

server/settings.py
  Paths
  Required field list
  Logger

server/data/
  Stored telemetry JSON files
  latest.json cache
  sample telemetry input
```

## Relation To Apps Pipeline

`server`와 `apps`는 역할이 다르다.

```text
server
  telemetry HTTP API
  receive/store/query telemetry
  dashboard KPI/timeseries source

apps
  telemetry preprocessing
  AAS semantic mapping
  AI AAS element generation
  validation
  AAS Repository push
  EDC asset/policy/contract registration
```

연결 가능한 흐름:

```text
Factory / simulator / frontend
  ↓
server POST /api/v1/cobot/telemetry
  ↓
server/data/*.json
  ↓
apps/edc.py pipeline --telemetry-json <stored-json>
  ↓
AAS Repository
  ↓
EDC Connector
```

또는 EDC asset의 `dataAddress`가 server endpoint를 가리키게 해서 telemetry API를 EDC data asset으로 노출할 수 있다.

## Recommended Next Improvements

1. POST 저장 전에 `apps.preprocessor.TelemetryPreprocessor`를 선택적으로 적용
2. `server` validation rule을 preprocessor schema와 통합
3. `settings.py`에 query limit, threshold, max span 값을 모으기
4. KPI/timeseries/AI route 함수 단위 테스트 추가
5. JSON file storage가 커질 경우 SQLite 또는 time-series DB로 storage adapter 분리
6. `GET /api/v1/cobot/telemetry/{robot_id}/latest` 같은 robot별 latest endpoint 추가
7. frontend에 AI chat panel 추가
