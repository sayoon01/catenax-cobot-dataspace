# EDC Refactor Proposal

이 문서는 `edc.py`를 직접 수정하지 않고, 현재 구조에서 어떤 점을 개선하면 좋은지 제안만 정리한 문서입니다.

## 목적

현재 [edc.py](/home/keti_spark1/yune/catenax_react/edc.py)는 하나의 파일 안에 다음이 함께 들어 있습니다.

- CLI 엔트리포인트
- 전처리 로직
- 필드 매핑 로직
- AI 호출 로직
- AAS 반영 로직
- EDC 등록 로직
- 데이터 모델

데모 용도로는 동작하지만, 유지보수성과 확장성을 높이려면 역할 분리가 필요합니다.

## 현재 구조의 장점

- 파일 하나만 보면 전체 흐름을 이해할 수 있음
- 별도 프레임워크 없이 바로 실행 가능
- 표준 라이브러리 중심이라 환경 부담이 적음
- 파이프라인 결과를 구조화된 JSON으로 반환함

## 현재 구조의 한계

### 1. 파일 크기가 큼

- `edc.py`는 1,100줄 이상
- 기능 추가 시 읽기 비용이 큼
- 한 부분 수정이 다른 부분 회귀로 이어질 가능성이 높음

### 2. 책임 분리가 약함

현재 한 파일에 다음 관심사가 섞여 있습니다.

- 도메인 모델
- 인프라 연동
- 비즈니스 로직
- CLI 인자 파싱

이 구조는 테스트와 재사용을 어렵게 만듭니다.

### 3. 프런트와 로직 중복 위험

프런트의 `helpers.js`에도 전처리, 매핑, 검증 로직이 일부 존재합니다.

즉:

- 프런트 검증 결과
- CLI 검증 결과

가 시간이 지나며 달라질 수 있습니다.

### 4. 옵션 설계가 더 명확해질 필요가 있음

특히 `pipeline` 계열 옵션은 아래처럼 더 명확하게 다듬을 수 있습니다.

- 어떤 단계가 기본 실행인지
- 어떤 단계가 선택 실행인지
- EDC 등록이 언제 수행되는지
- AAS push가 언제 스킵되는지

## 제안하는 분리 방향

### 목표 구조

```text
catenax_react/
├── edc.py
├── edc/
│   ├── commands/
│   │   ├── onboard.py
│   │   ├── sync_aas.py
│   │   └── pipeline.py
│   ├── services/
│   │   ├── http_client.py
│   │   ├── preprocessing.py
│   │   ├── mapping.py
│   │   ├── validation.py
│   │   ├── ai_agent.py
│   │   ├── aas_bridge.py
│   │   └── edc_connector.py
│   ├── models/
│   │   ├── telemetry.py
│   │   ├── aas.py
│   │   └── edc.py
│   └── pipeline.py
```

### 루트 `edc.py` 역할

루트 `edc.py`는 최대한 얇게 유지합니다.

역할:

- 인자 파싱
- 서브커맨드 분기
- 공통 로깅 초기화
- 결과 JSON 출력

즉 실제 로직은 내부 모듈로 넘기고, 루트 파일은 엔트리포인트만 담당하게 하는 것이 좋습니다.

## 권장 분리 단위

### 1. `http_client.py`

대상:

- `HttpJsonClient`

이유:

- 다른 서비스에서 공통 사용
- 테스트 더블 주입이 쉬워짐

### 2. `preprocessing.py`

대상:

- `TelemetryPreprocessor`

이유:

- 규칙 기반 전처리는 독립성이 높음
- 프런트/백엔드/CLI 간 공통 규칙 문서화에 유리

### 3. `mapping.py`

대상:

- `SEMANTIC_MAP`
- `MappedField`
- `TelemetryMapper`

이유:

- Catena-X 매핑 규칙은 별도 관리 가치가 큼
- 향후 버전별 매핑 테이블 분리 가능

### 4. `validation.py`

대상:

- 3-Layer 검증 관련 로직 전체

이유:

- 독립 테스트 대상
- 프런트와 로직 정합성 맞추기 쉬움

### 5. `ai_agent.py`

대상:

- `OllamaAASAgent`
- `OllamaAgentError`

이유:

- AI 연결 실패, 타임아웃, fallback 전략이 별도 관심사이기 때문

### 6. `aas_bridge.py`

대상:

- `AASBridge`

이유:

- 외부 시스템 연동 책임 분리

### 7. `edc_connector.py`

대상:

- `EDCConnectorService`
- `EDCAsset`
- `EDCPolicy`
- `ContractDefinition`

이유:

- EDC 등록 계층만 독립적으로 유지 가능
- 나중에 management API 버전 변경 대응이 쉬움

## CLI 관점 개선 제안

### 1. 명령별 초기화 분리

권장 방향:

- `onboard`: EDC + AAS만 초기화
- `sync-aas`: AAS만 초기화
- `pipeline`: 필요한 서비스만 조합

이렇게 하면 환경변수 요구 범위가 명확해집니다.

### 2. 옵션 의미 명확화

권장 방향:

- `--skip-aas-push`
- `--run-edc`

또는

- `--enable-aas-push`
- `--enable-edc`

처럼 기본값과 실행 여부가 직관적으로 드러나는 이름을 쓰는 것이 좋습니다.

### 3. 출력 스키마 고정

현재도 JSON 출력은 좋지만, 스키마를 문서화하면 더 좋습니다.

권장:

- `stages.preprocessing`
- `stages.mapping`
- `stages.ai_agent`
- `stages.validation`
- `stages.aas_push`
- `stages.edc_registration`

의 필드 구조를 고정하고 문서에 명시

## 테스트 관점 제안

### 최소 테스트 세트

1. 전처리 테스트
2. 매핑 테스트
3. 검증 테스트
4. `pipeline --telemetry-json sample_telemetry.json --telemetry-index 0` golden output 테스트
5. EDC/AAS 연동 실패 fallback 테스트

### 테스트 우선순위

- 1순위: 전처리, 매핑, 검증
- 2순위: pipeline 결과 스냅샷
- 3순위: 외부 연동 모의 테스트

## 문서 관점 제안

`edc.py`는 아래 문서와 함께 가는 편이 좋습니다.

- [EDC_CLI_GUIDE.md](/home/keti_spark1/yune/catenax_react/EDC_CLI_GUIDE.md)
  현재 사용법 설명
- 이 문서
  개선 제안 정리

즉:

- 하나는 “지금 어떻게 쓰는가”
- 하나는 “앞으로 어떻게 개선할 것인가”

로 역할을 나누는 방식입니다.

## 추천 작업 순서

### Phase 1

- `HttpJsonClient`, `TelemetryPreprocessor`, `TelemetryMapper` 분리

### Phase 2

- 검증 로직과 AI 에이전트 분리

### Phase 3

- `CobotEDCPipeline`와 CLI 엔트리 분리

### Phase 4

- 테스트 추가
- 문서와 옵션 체계 정리

## 요약

현재 `edc.py`는 데모와 실험에는 충분히 유용하지만, 다음 단계로 가려면 분리가 필요합니다.

가장 효과적인 리팩터링 순서는 아래입니다.

1. 전처리 / 매핑 / 검증 분리
2. AI / AAS / EDC 연동 분리
3. CLI 엔트리포인트 얇게 만들기
4. 테스트 추가

이 문서는 제안서이며, 코드 변경 없이 방향만 정리한 문서입니다.
