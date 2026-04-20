# EDC CLI Guide

이 문서는 프로젝트 루트의 [edc.py](/home/keti_spark1/yune/catenax_react/edc.py)를 설명하는 사용 문서입니다.

## 개요

`edc.py`는 Catena-X 데모용 CLI입니다. 협동로봇 텔레메트리 JSON을 입력으로 받아 아래 흐름을 수행합니다.

1. 전처리
2. AAS 필드 매핑
3. AI 메타모델 추론 및 코드 생성
4. 3-Layer 검증
5. AAS 저장소 반영
6. EDC 자산/정책/계약 등록

이 파일은 현재 프로젝트에서 Catena-X EDC + AAS + AI 파이프라인을 담당하는 메인 CLI 엔트리포인트입니다.

## 지원 명령

`edc.py`는 3개 서브커맨드를 제공합니다.

### `onboard`

EDC 자산, 접근 정책, 계약 정책, 계약 정의를 생성합니다.

예시:

```bash
python3 edc.py onboard \
  --asset-id cobot-01 \
  --provider-bpn BPNL000000000001 \
  --cobot-api-base-url http://localhost:8080
```

옵션:

- `--asset-id`
- `--provider-bpn`
- `--cobot-api-base-url`
- `--cobot-data-path`
  기본값: `/api/v1/cobot/telemetry`

### `sync-aas`

로컬 텔레메트리 JSON 파일을 읽어 AAS 저장소에 반영합니다.

예시:

```bash
python3 edc.py sync-aas \
  --telemetry-json server/data/sample_telemetry.json \
  --telemetry-index 0
```

옵션:

- `--telemetry-json`
- `--telemetry-index`
  - 입력 파일이 JSON 배열일 때 사용할 항목 index
  - 기본값: `0`

### `pipeline`

전체 파이프라인을 실행합니다. 전처리, 매핑, AI 생성, 검증, AAS push, EDC 등록까지 포함하는 가장 큰 명령입니다.

예시:

```bash
python3 edc.py pipeline \
  --telemetry-json server/data/sample_telemetry.json \
  --telemetry-index 0 \
  --skip-aas-push
```

옵션:

- `--telemetry-json`
- `--telemetry-index`
- `--skip-aas-push`
- `--run-edc`
- `--asset-id`
- `--provider-bpn`
- `--cobot-api-base-url`

## 중요한 현재 동작

현재 구현상 주의할 점이 있습니다.

### 1. 명령별로 필요한 환경변수만 요구됨

현재는 명령별로 필요한 서비스만 초기화합니다.

- `onboard`: EDC + AAS 환경변수 필요
- `sync-aas`: AAS 환경변수 필요
- `pipeline`: EDC + AAS 환경변수 필요, AI는 선택 환경변수 사용

필수:

- `CATENAX_EDC_MANAGEMENT_URL`
- `CATENAX_AAS_BASE_URL`
- `CATENAX_AAS_SUBMODEL_ID`

선택:

- `CATENAX_EDC_API_KEY`
- `CATENAX_AAS_API_KEY`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OLLAMA_TIMEOUT`

예시:

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

### 2. `pipeline`의 EDC 등록은 `--run-edc`를 붙였을 때만 수행됨

현재 코드 기준 실제 동작은:

- `pipeline` 기본 실행: EDC 등록 스킵
- `pipeline --run-edc ...`: EDC 등록 수행 시도

## 내부 구성

`edc.py`는 크게 다음 역할을 포함합니다.

### HTTP 클라이언트

- `HttpJsonClient`

표준 라이브러리 기반 JSON-over-HTTP 요청 처리

### 전처리기

- `TelemetryPreprocessor`

역할:

- 누락 필드 기본값 보정
- 숫자형 변환
- status 정규화
- 음수 값 클램핑
- alarms 형식 정리
- timestamp 보정

### 매퍼

- `TelemetryMapper`

역할:

- telemetry 필드를 AAS용 `idShort`, `semanticId`, `valueType` 구조로 변환
- nested object 평탄화

### AI 에이전트

- `OllamaAASAgent`

역할:

- 메타모델 추론
- AAS Submodel element 생성
- Python AAS 코드 생성

기본 모델:

- `qwen3:27b`

### EDC 서비스

- `EDCConnectorService`

역할:

- 자산 등록
- 정책 생성
- 계약 정의 생성

### 파이프라인 오케스트레이터

- `CobotEDCPipeline`

역할:

- 전처리 → 매핑 → AI → 검증 → AAS push → EDC registration 전체 흐름 제어

## `pipeline` 출력 구조

`pipeline` 명령은 JSON 결과를 stdout으로 출력합니다.

주요 필드:

- `pipeline_start`
- `pipeline_end`
- `input`
- `stages.preprocess`
- `stages.mapping`
- `stages.ai_agent`
- `stages.validation`
- `stages.aas_push`
- `stages.edc_registration`
- `final_elements`
- `validation_passed`

즉, 이 CLI는 단순 성공/실패 메시지가 아니라 단계별 산출물까지 포함한 구조화 결과를 반환합니다.

## 자주 쓰는 실행 예시

### 검증 중심 실행

```bash
python3 edc.py pipeline \
  --telemetry-json server/data/sample_telemetry.json \
  --telemetry-index 5 \
  --skip-aas-push
```

### AAS 반영

```bash
python3 edc.py sync-aas \
  --telemetry-json server/data/sample_telemetry.json \
  --telemetry-index 0
```

### EDC 자산 등록

```bash
python3 edc.py onboard \
  --asset-id cobot-asset-001 \
  --provider-bpn BPNL000000000001 \
  --cobot-api-base-url http://localhost:8080
```

## 현재 제한사항

- 단일 파일 크기가 큼
- 명령별 lazy initialization이 아님
- 리스트형 입력 사용 시 `--telemetry-index` 관리를 사용자가 직접 해야 함
- Ollama, AAS, EDC 오류 처리와 재시도 정책이 단순함

## 권장 개선 방향

- 명령별 서비스 초기화 분리
- `--telemetry-index` 반복 실행을 줄이기 위한 배치 처리 옵션 검토
- `edc.py`를 `services/`, `models/`, `commands/` 단위로 분리
- 출력 JSON 스키마 고정 및 테스트 추가

## 빠른 확인 명령

```bash
python3 edc.py --help
```

도움말이 정상 출력되면 CLI 엔트리포인트는 정상입니다.
