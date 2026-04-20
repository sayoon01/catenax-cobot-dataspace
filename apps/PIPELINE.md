# Apps Full Pipeline

이 문서는 `apps` 디렉토리의 Catena-X AAS/EDC telemetry pipeline 흐름과 각 파일의 역할을 설명한다.

## Pipeline Overview

```text
Raw telemetry JSON
  ↓
[1] Preprocessor
    apps/preprocessor.py
  ↓
[2] Mapper
    apps/aas_mapper.py
  ↓
[3] AI Agent
    apps/ai_agent.py
  ↓
[4] Validator
    apps/edc.py::AASValidator
  ↓
[5] AAS Repository
    apps/edc.py::AASBridge
  ↓
[6] EDC Connector
    apps/edc.py::EDCConnectorService
```

전체 실행 흐름은 `apps/edc.py`의 `CobotEDCPipeline.run_full_pipeline()`이 조율한다.

## 1. Preprocessor

파일: `apps/preprocessor.py`

`TelemetryPreprocessor`는 원본 telemetry JSON을 mapper, validator, AAS repository가 바로 사용할 수 있는 표준 dict로 정리한다.

주요 기능:

- camelCase 입력 필드를 snake_case 표준 필드명으로 변환
- 단위 변환
  - `cycle_time_s` -> `cycle_time_ms`
  - `power_kw` -> `power_watts`
  - `temperature_f` -> `temperature_c`
  - `vibration_m_s` -> `vibration_mm_s`
- 필수 필드 기본값 보강
  - `robot_id`
  - `line_id`
  - `station_id`
  - `program_name`
  - `cycle_time_ms`
  - `power_watts`
  - `status`
- `strict=True` 모드에서는 필수 필드가 없을 때 기본값을 넣지 않고 `ValueError` 발생
- 숫자 필드 타입 정규화
- `status` 값을 허용 목록으로 정규화
- `alarms`를 문자열 리스트로 정규화
- `pose`, `joint_positions_deg` 내부 값을 float로 정규화
- `produced_at` timestamp를 ISO 형식으로 검증 및 보정
- `_preprocessed_at`, `_warnings` 메타데이터 추가
- pipeline stage summary 생성

입력 예:

```json
{
  "robotId": "R-001",
  "cycle_time_s": "1.2",
  "power_kw": "0.8",
  "temperature_f": "98.6",
  "status": "running"
}
```

전처리 후 주요 결과:

```json
{
  "robot_id": "R-001",
  "cycle_time_ms": 1200.0,
  "power_watts": 800.0,
  "temperature_c": 37.0,
  "status": "RUNNING"
}
```

## 2. Mapper

파일: `apps/aas_mapper.py`

`TelemetryMapper`는 전처리된 telemetry dict를 AAS property로 만들기 위한 중간 표현인 `MappedField` 리스트로 변환한다.

주요 기능:

- telemetry source key를 AAS `idShort`로 매핑
- telemetry source key를 Catena-X/IDTA 스타일 `semanticId`로 매핑
- 기본 매핑은 `apps/semantic_map.json`에서 로드
- 값의 타입을 AAS `valueType`으로 추론
- `pose`, `joint_positions_deg` 같은 dict 필드는 하위 key를 펼쳐서 composite field로 변환
  - `pose.x` -> `pose_x` -> `PoseX`
  - `joint_positions_deg.j1` -> `joint_positions_deg_j1` -> `JointJ1Deg`
- `_warnings`, `_preprocessed_at` 같은 내부 메타데이터 필드는 mapper에서 제외

예:

```text
cycle_time_ms -> CycleTimeMs
power_watts   -> PowerWatts
status        -> OperationalStatus
```

매핑 테이블은 `apps/semantic_map.json`에 정의되어 있다. `aas_mapper.py`의 `SEMANTIC_MAP`은 이 JSON을 로드한 기본 매핑이다.

매핑 테이블에 없는 필드는 `custom:catenax:<field>` 형태의 semanticId를 사용한다.

## 3. AI Agent

파일: `apps/ai_agent.py`

`OllamaAASAgent`는 Ollama API를 호출해서 AAS submodel 생성을 보조한다.

기본 모델:

```text
qwen3:27b
```

주요 기능:

- Ollama health check
- 일반 chat 질의응답
- validation report 자연어 설명
- telemetry context 기반 meta-model inference
- mapper가 만든 `MappedField`를 기반으로 AAS `submodelElements` 생성
- AAS builder snippet 형태의 Python code 생성
- Ollama 호출 실패 시 pipeline이 rule-based fallback으로 진행할 수 있도록 예외 제공
- AI가 생성한 AAS element JSON schema 검증

AI Agent는 optional이다. `CobotEDCPipeline`에 `ai_agent`가 없거나 Ollama 호출이 실패하면 pipeline은 mapper 결과를 사용해서 rule-based AAS elements를 만든다.

## 4. Validator

파일: `apps/edc.py`

클래스:

```text
AASValidator
ValidationReport
```

Validator는 AI Agent 또는 rule-based fallback이 만든 AAS elements를 검사한다.

검증 레이어:

- Standard & Integrity Validation
  - 필수 AAS property 존재 여부 확인
  - `idShort`, `valueType`, `semanticId` 구조 확인
- Semantic Cross-Validation
  - AAS element 값과 원본 telemetry 값의 일치성 확인
  - 생산 수량과 상태값의 논리적 일관성 확인
  - alarm과 status의 일관성 확인
- Reliability Assessment
  - 온도 상한 확인
  - 진동 상한 확인
  - 전력 상한 확인
  - cycle time 이상치 확인
  - reject ratio 확인

검증 결과는 `ValidationReport`로 반환되며, pipeline 결과의 `stages.validation`에 포함된다.

## 5. AAS Repository

파일: `apps/edc.py`

클래스:

```text
FactoryCobotTelemetry
AASBridge
```

`FactoryCobotTelemetry`는 전처리된 dict를 typed telemetry object로 변환한다.

`AASBridge`는 telemetry를 AAS Submodel payload로 만들고 BaSyx 또는 Eclipse AAS-compatible server에 PUT 요청을 보낸다.

주요 기능:

- telemetry object를 AAS Submodel JSON으로 변환
- AI Agent가 생성한 elements가 있으면 `elements_override`로 사용
- rule-based fallback elements는 `TelemetryMapper`와 `apps/semantic_map.json`을 재사용해서 생성
- AAS server endpoint에 `PUT /submodels/{submodel_id}` 호출

## 6. EDC Connector

파일: `apps/edc.py`

클래스:

```text
EDCAsset
EDCPolicy
ContractDefinition
EDCConnectorService
```

EDC Connector 단계는 AAS/telemetry asset을 EDC management API에 등록한다.

주요 기능:

- EDC asset 등록
- access policy 생성
- contract policy 생성
- contract definition 생성
- catalog request
- contract negotiation

`run_full_pipeline()`에서는 `run_edc=True`이고 `asset_id`, `provider_bpn`, `cobot_api_base_url`이 모두 있을 때 EDC registration을 수행한다.

## Orchestration

파일: `apps/edc.py`

클래스:

```text
CobotEDCPipeline
```

`CobotEDCPipeline.run_full_pipeline()`의 실제 단계:

```text
1. Preprocess raw telemetry
2. Map telemetry fields to AAS idShort/semanticId
3. Build AAS elements with AI Agent if available
4. Validate AAS elements and telemetry consistency
5. Push Submodel to AAS Repository unless skipped
6. Register asset/policies/contract in EDC if requested
```

AI 사용 가능 시:

```text
preprocessor -> mapper -> ai_agent -> validator -> AAS push -> EDC registration
```

AI 없음 또는 실패 시:

```text
preprocessor -> mapper -> rule-based elements -> validator -> AAS push -> EDC registration
```

## CLI Commands

`apps/edc.py`는 CLI entrypoint도 제공한다.

### Full Pipeline

```bash
python apps/edc.py pipeline --telemetry-json telemetry.json
```

AAS push를 건너뛰려면:

```bash
python apps/edc.py pipeline --telemetry-json telemetry.json --skip-aas-push
```

EDC registration까지 실행하려면:

```bash
python apps/edc.py pipeline \
  --telemetry-json telemetry.json \
  --run-edc \
  --asset-id cobot-asset-001 \
  --provider-bpn BPNL000000000001 \
  --cobot-api-base-url http://localhost:8000
```

### Sync AAS Only

```bash
python apps/edc.py sync-aas --telemetry-json telemetry.json
```

`sync-aas`도 dict 입력을 `TelemetryPreprocessor`로 정규화한 뒤 AAS Repository에 업로드한다.

### Onboard EDC Asset

```bash
python apps/edc.py onboard \
  --asset-id cobot-asset-001 \
  --provider-bpn BPNL000000000001 \
  --cobot-api-base-url http://localhost:8000
```

## Environment Variables

필수 또는 선택 환경변수:

```text
CATENAX_EDC_MANAGEMENT_URL   EDC management API URL
CATENAX_AAS_BASE_URL         AAS Repository base URL
CATENAX_AAS_SUBMODEL_ID      AAS Submodel ID
CATENAX_EDC_API_KEY          optional EDC API key
CATENAX_AAS_API_KEY          optional AAS API key
OLLAMA_BASE_URL              default: http://localhost:11434
OLLAMA_MODEL                 default: qwen3:27b
OLLAMA_TIMEOUT               default: 120
```

`build_pipeline_from_env()`는 위 환경변수로 `EDCConnectorService`, `AASBridge`, `OllamaAASAgent`를 생성한다.

## Current File Responsibilities

```text
apps/preprocessor.py
  Raw telemetry cleaning and normalisation

apps/aas_mapper.py
  AAS idShort / semanticId mapping

apps/ai_agent.py
  Ollama-based AAS generation agent

apps/edc.py
  Pipeline orchestrator
  Validator
  AAS Repository bridge
  EDC Connector service
  CLI entrypoint
```

## Recommended Next Refactor

`apps/edc.py`는 현재 여러 책임을 함께 가진다. 코드가 더 커지면 아래처럼 분리하는 것이 좋다.

```text
apps/validator.py
  AASValidator, ValidationReport

apps/aas_repository.py
  FactoryCobotTelemetry, AASBridge

apps/edc_connector.py
  EDCAsset, EDCPolicy, ContractDefinition, EDCConnectorService

apps/edc.py
  CobotEDCPipeline and CLI only
```
