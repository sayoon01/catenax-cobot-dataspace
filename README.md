# Catena-X Cobot Data Space

공장 협동로봇 텔레메트리 데이터를 수집하고, Catena-X 관점에서 표준화, 검증, AAS/EDC 흐름까지 시뮬레이션하는 데모 프로젝트입니다.
<img width="1438" height="1871" alt="스크린샷 2026-04-20 180712" src="https://github.com/user-attachments/assets/7b09b866-3fbd-47f5-96e1-f5a9ed5daa5e" />
<img width="1411" height="1103" alt="스크린샷 2026-04-20 180654" src="https://github.com/user-attachments/assets/1c678fc0-c597-473b-8493-52e4002fb2c4" />

구성은 3개 축입니다.

- 프런트엔드: `frontend/index.html` 기반 단일 대시보드 (Vanilla JS + Chart.js)
- 백엔드: Python 표준 라이브러리 기반 텔레메트리 HTTP 서버
- CLI: `edc.py` 기반 Catena-X EDC + AAS + AI 파이프라인

## 프로젝트 구조

```text
catenax_react/
├── edc.py
├── frontend/
│   ├── index.html
│   └── src/ (legacy React 코드, 현재 기본 실행 경로 아님)
├── server/
│   ├── app.py
│   └── data/
│       ├── sample_telemetry.json
│       └── latest.json
├── EDC_CLI_GUIDE.md
├── EDC_REFACTOR_PROPOSAL.md
├── CURRENT_GAPS_AND_REFACTORING.md
├── 구현예시.png
└── 구현예시2.png
```

## 현재 화면 구성

- 화이트톤 단일 대시보드 UI (`frontend/index.html`)
- KPI 카드(레코드 수, 로봇 수, 평균 온도/전력, good/reject, running 수)
- 로봇 상태 카드 그리드
- 차트 4종(수율/전력/온도/상태 분포)
- 15초 자동 새로고침 + 수동 Refresh 버튼

## 빠른 실행

### 1. 백엔드 실행

```bash
python3 server/app.py --host 127.0.0.1 --port 8080
```

주요 API:

- `GET /health`
- `POST /api/v1/cobot/telemetry`
- `GET /api/v1/cobot/telemetry/latest`
- `GET /api/v1/cobot/telemetry?limit=20`
- `GET /api/v1/cobot/telemetry/all`

### 2. 프런트 실행

```bash
cd frontend
python3 -m http.server 3000 --bind 127.0.0.1
```

브라우저 접속:

- `http://127.0.0.1:3000`

또는 파일 직접 열기:

- `xdg-open frontend/index.html`

프런트는 기본적으로 `http://localhost:8080` 백엔드를 바라보며, 서버가 없으면 로컬 샘플 데이터로 동작합니다.

### 3. CLI 실행

```bash
python3 edc.py --help
```

대표 명령:

```bash
python3 edc.py sync-aas --telemetry-json server/data/sample_telemetry.json --telemetry-index 0
python3 edc.py onboard --asset-id cobot-01 --provider-bpn BPNL000000000001 --cobot-api-base-url http://localhost:8080
python3 edc.py pipeline --telemetry-json server/data/sample_telemetry.json --telemetry-index 0
```

## CLI 환경변수

`edc.py`는 아래 환경변수를 사용합니다.

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

자세한 사용법은 아래 문서를 참고하면 됩니다.

- [EDC_CLI_GUIDE.md](/home/keti_spark1/yune/catenax_react/EDC_CLI_GUIDE.md)

## 현재 구현 포인트

### 프런트엔드

- [frontend/index.html](/home/keti_spark1/yune/catenax_react/frontend/index.html)
  Chart.js 기반 단일 대시보드 화면
- [frontend/src](/home/keti_spark1/yune/catenax_react/frontend/src)
  이전 React 구조(레거시 참고 코드)

### 백엔드

- [server/app.py](/home/keti_spark1/yune/catenax_react/server/app.py)
  텔레메트리 수신, 파일 저장, 최근/전체 조회

### CLI

- [edc.py](/home/keti_spark1/yune/catenax_react/edc.py)
  Catena-X EDC + AAS + AI 파이프라인

## 현재 확인된 상태

- `python3 server/app.py --help` 정상
- `python3 edc.py --help` 정상
- 프런트 정적 서버 실행 및 실제 브라우저 렌더링 확인 완료
- `apps/` 디렉터리 없이 동작하도록 정리 완료

## 관련 문서

- [CURRENT_GAPS_AND_REFACTORING.md](/home/keti_spark1/yune/catenax_react/CURRENT_GAPS_AND_REFACTORING.md)
- [EDC_CLI_GUIDE.md](/home/keti_spark1/yune/catenax_react/EDC_CLI_GUIDE.md)
- [EDC_REFACTOR_PROPOSAL.md](/home/keti_spark1/yune/catenax_react/EDC_REFACTOR_PROPOSAL.md)

## 참고 이미지

- [구현예시.png](/home/keti_spark1/yune/catenax_react/구현예시.png)
- [구현예시2.png](/home/keti_spark1/yune/catenax_react/구현예시2.png)
