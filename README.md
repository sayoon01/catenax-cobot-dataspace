# Catena-X Cobot Data Space

공장 협동로봇 텔레메트리 데이터를 Catena-X 흐름에 맞춰 수집, 표준화, 검증, AAS/EDC 시뮬레이션까지 연결하는 데모 프로젝트입니다.

현재 구성은 세 부분으로 나뉩니다.

- 프런트엔드: React 18 CDN + Babel 기반 SPA
- 백엔드: Python 표준 라이브러리 기반 텔레메트리 HTTP 서버
- CLI: `edc.py` 기반 Catena-X EDC + AAS + AI 파이프라인 도구

## 프로젝트 구조

```text
catenax_react/
├── frontend/
│   ├── index.html
│   └── src/
│       ├── app.jsx
│       ├── components/
│       │   ├── layout.js
│       │   └── ui.js
│       ├── pages/
│       │   └── pages.js
│       └── utils/
│           ├── constants.js
│           └── helpers.js
├── server/
│   ├── app.py
│   └── data/
│       ├── sample_01.json ~ sample_10.json
│       └── latest.json
├── edc.py
└── README.md
```

## 현재 화면 구성

- 대시보드: KPI, 4-step 흐름도, 전력 바차트, 알람 패널
- 로봇 플릿: 저장된 로봇 목록과 JSON 상세 모달
- 텔레메트리: JSON POST 전송과 저장 레코드 조회
- AI 파이프라인: 전처리, 매핑, 메타모델 추론, 코드 생성, AAS 빌드, 3-Layer 검증
- AAS: 텔레메트리 기반 AAS Property 테이블
- Validation: 최근 검증 결과 요약
- EDC: Asset/Policy 페이로드 빌더
- Catalog: 카탈로그 조회와 계약 협상 시뮬레이션

## 빠른 실행

### 1. 백엔드 실행

```bash
python3 server/app.py --host 127.0.0.1 --port 8080
```

기본 API:

- `GET /health`
- `POST /api/v1/cobot/telemetry`
- `GET /api/v1/cobot/telemetry/latest`
- `GET /api/v1/cobot/telemetry?limit=20`
- `GET /api/v1/cobot/telemetry/all`

### 2. 프런트 실행

정적 서버를 하나 띄우는 방식이 가장 단순합니다.

```bash
cd frontend
python3 -m http.server 3000 --bind 127.0.0.1
```

브라우저 접속:

- `http://127.0.0.1:3000`

프런트는 기본적으로 백엔드 `http://localhost:8080`을 바라보며, 서버가 없으면 로컬 샘플 데이터로 동작합니다.

### 3. EDC CLI 실행

```bash
python3 edc.py --help
```

대표 명령:

```bash
python3 edc.py pipeline --telemetry-json server/data/sample_01.json
python3 edc.py onboard --asset-id cobot-01 --provider-bpn BPNL000000000001 --cobot-api-base-url http://localhost:8080
python3 edc.py sync-aas --telemetry-json server/data/sample_01.json
```

## EDC CLI 환경변수

`edc.py`는 다음 환경변수를 사용합니다.

```bash
export CATENAX_EDC_MANAGEMENT_URL=http://localhost:8181/management
export CATENAX_AAS_BASE_URL=http://localhost:4001
export CATENAX_AAS_SUBMODEL_ID=urn:aas:cobot:submodel:001
export CATENAX_EDC_API_KEY=
export CATENAX_AAS_API_KEY=
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=qwen3:27b
export OLLAMA_TIMEOUT=120
```

환경변수가 없으면 일부 단계는 시뮬레이션 또는 제한 모드로 동작합니다.

## 현재 구현 포인트

### 프런트엔드

- `frontend/src/app.jsx`
  루트 상태와 페이지 조립
- `frontend/src/components/ui.js`
  Badge, Card, Btn, Tabs, Modal, ValidationResultCard 등 공통 UI
- `frontend/src/components/layout.js`
  Sidebar, Topbar
- `frontend/src/pages/pages.js`
  주요 화면 구현
- `frontend/src/utils/helpers.js`
  전처리, 필드 매핑, 검증, AI 호출 헬퍼

### 백엔드

- `server/app.py`
  텔레메트리 수신, 파일 저장, 최근/전체 조회

### CLI

- `edc.py`
  전처리, AAS 매핑, AI 추론, 검증, AAS/EDC 연동 파이프라인

## 현재 확인된 실행 상태

- `python3 server/app.py --help` 정상
- `python3 edc.py --help` 정상
- 프런트는 정적 서버로 실제 브라우저 렌더링 확인 완료

## 다음 문서

현재 부족한 부분과 리팩터링 우선순위는 아래 문서에 정리했습니다.

- [CURRENT_GAPS_AND_REFACTORING.md](/home/keti_spark1/yune/catenax_react/CURRENT_GAPS_AND_REFACTORING.md)
- [EDC_CLI_GUIDE.md](/home/keti_spark1/yune/catenax_react/EDC_CLI_GUIDE.md)
