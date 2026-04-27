# DEV FC Planner

Team balancer and lineup planner for DEV FC.

DEV FC Planner는 축구 필드 참석자 26명을 기준으로 13명씩 2팀을 밸런스 있게 나누고, 각 팀의 1~4쿼터 라인업을 자동 추천하는 웹 기반 도구다.

초기 버전은 별도 DB나 관리자 페이지 없이 **Google Sheets를 선수 DB처럼 사용**한다. 웹에서는 Google Sheets CSV 데이터를 불러오고, 정규 선수 선택, 용병 추가, 전담 GK 선택, 팀 분배, 라인업 추천, 공유 텍스트 생성을 수행한다.

---

## 1. 핵심 요구사항

- 코치진이 Google Sheets로 선수 데이터를 관리한다.
- 웹에서 Google Sheets CSV 데이터를 불러온다.
- 오늘 필드 참석자 26명을 구성한다.
- 전담 GK 참석자가 있으면 별도로 구성한다.
- 필드 참석자 26명을 13명씩 A팀/B팀으로 자동 분배한다.
- 각 팀은 반드시 `공격 4명 / 미드 4명 / 수비 5명` 구성을 갖는다.
- 팀 밸런스는 전체 점수만 보는 것이 아니라, 포지션 그룹별로 맞춘다.
- 각 팀의 1~4쿼터 라인업을 추천한다.
- 쿼터별 필드 구성은 `공격 3명 / 미드 3명 / 수비 4명`을 기본으로 한다.
- 전담 GK가 있으면 전담 GK를 우선 배정한다.
- 전담 GK가 없거나 부족하면 해당 팀에서 쉬는 필드 선수 중 1명이 GK를 본다.
- 결과는 카카오톡 등에 공유하기 쉽게 텍스트로 복사할 수 있어야 한다.

---

## 2. 전체 서비스 구조

초기 MVP는 서버 없이, 또는 최소 서버리스 구조로 만든다.

```text
Google Sheets
  ↓ CSV URL
Web Page
  ↓
브라우저에서 팀 분배 / 라인업 계산
  ↓
결과 화면 표시
  ↓
공유용 텍스트 복사
```

초기 방식은 다음과 같다.

- Google Sheets를 “링크가 있는 모든 사용자 보기 가능”으로 설정한다.
- CSV URL로 선수 데이터를 읽는다.
- 웹에서는 CSV를 fetch해서 파싱한다.
- 추천 알고리즘은 브라우저에서 실행한다.
- 별도 DB는 없다.
- 별도 관리자 페이지는 없다.
- Google Sheets가 선수 DB이자 관리자 페이지 역할을 한다.

---

## 3. Google Sheets 준비 방법

### 3.1 새 Google Sheets 생성

1. Google Sheets에서 새 스프레드시트를 만든다.
2. 파일 이름은 예를 들어 `DEV FC Players`로 한다.
3. 첫 번째 시트 이름은 `players`로 둔다.
4. 1행에 아래 컬럼명을 정확히 입력한다.

```text
active, member_type, name, primary_position, secondary_positions, attack_score, mid_score, defense_score, activity_score, gk, memo
```

컬럼명은 웹에서 CSV를 파싱할 때 기준으로 사용하므로 가능하면 그대로 유지한다.

---

### 3.2 Google Sheets 컬럼 정의

| 컬럼명 | 필수 | 예시 | 설명 |
|---|---:|---|---|
| active | Y | Y | 사용 여부. N이면 웹에서 제외 |
| member_type | Y | REGULAR | REGULAR 또는 GUEST |
| name | Y | 홍길동 | 선수 이름 |
| primary_position | Y | CM | 주포지션 |
| secondary_positions | N | CDM,CB | 부포지션. 여러 개면 쉼표로 구분 |
| attack_score | Y | 3 | 공격 역할 점수, 1~5 |
| mid_score | Y | 5 | 미드 역할 점수, 1~5 |
| defense_score | Y | 4 | 수비 역할 점수, 1~5 |
| activity_score | Y | 4 | 활동량, 1~5 |
| gk | Y | Y | 필드 선수로 쉬는 쿼터에 GK 가능 여부 |
| memo | N | 무릎 조심 | 참고 메모 |

---

### 3.3 Google Sheets 예시 데이터

아래 표를 그대로 Google Sheets에 붙여넣고 시작할 수 있다.

| active | member_type | name | primary_position | secondary_positions | attack_score | mid_score | defense_score | activity_score | gk | memo |
|---|---|---|---|---|---:|---:|---:|---:|---|---|
| Y | REGULAR | 김철수 | ST | RW,CF | 5 | 3 | 1 | 4 | N | |
| Y | REGULAR | 박민수 | CM | CDM,CB | 3 | 5 | 4 | 5 | Y | |
| Y | REGULAR | 이준호 | CB | RB,CDM | 1 | 3 | 5 | 3 | Y | 무릎 조심 |
| Y | REGULAR | 최성훈 | RW | ST,CM | 4 | 3 | 2 | 5 | N | |
| Y | GUEST | 용병A | RW | ST | 4 | 3 | 2 | 4 | N | 자주 오는 용병 |
| Y | GUEST | 용병B | CB | CDM,RB | 1 | 3 | 5 | 3 | Y | 자주 오는 용병 |

---

### 3.4 값 입력 규칙

#### active

```text
Y = 사용
N = 숨김 / 비활성
```

더 이상 잘 안 나오는 사람은 삭제하지 말고 `active = N`으로 바꾼다.

#### member_type

```text
REGULAR = 정규 선수
GUEST   = 저장된 용병
```

자주 오는 용병은 Google Sheets에 `member_type = GUEST`로 저장한다. 당일만 오는 용병은 웹에서 임시 용병으로 추가한다.

#### primary_position / secondary_positions

허용 포지션은 아래 값만 사용한다.

```text
ST, CF, LW, RW, CAM, CM, CDM, LB, RB, CB
```

`secondary_positions`는 비워도 된다. 여러 개면 쉼표로 구분한다.

예:

```text
CDM,CB
RW,CF
ST,CM
```

#### 점수 컬럼

아래 컬럼은 모두 1~5 숫자로 입력한다.

```text
attack_score
mid_score
defense_score
activity_score
```

점수 기준은 단순하게 둔다.

```text
1 = 낮음
2 = 약간 낮음
3 = 보통
4 = 좋음
5 = 매우 좋음
```

#### gk

```text
Y = 필드 선수로 쉬는 쿼터에 GK 가능
N = GK 불가
```

여기서 `gk`는 전담 GK 참석 여부가 아니다. 필드 선수로 참석했을 때 쉬는 쿼터에 GK를 볼 수 있는지를 의미한다.

---

### 3.5 Google Sheets CSV URL 준비

초기 MVP에서는 Google Sheets를 공개 CSV로 읽는다.

1. Google Sheets 우측 상단의 `공유` 버튼을 누른다.
2. 일반 액세스를 `링크가 있는 모든 사용자`로 변경한다.
3. 권한은 `뷰어`로 둔다.
4. 시트 URL에서 spreadsheet id를 확인한다.
5. 아래 형태의 CSV URL을 만든다.

```text
https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/export?format=csv&gid={SHEET_GID}
```

예시:

```text
https://docs.google.com/spreadsheets/d/1abcDEFgHIjkLMNopQRstuVWxyz/export?format=csv&gid=0
```

보통 첫 번째 시트의 `gid`는 `0`이다. 실제 URL의 마지막에 `gid=...` 값이 있으면 그 값을 사용한다.

---

### 3.6 Google Sheets 사용 시 주의사항

공개 CSV 방식은 만들기 쉽지만, 링크를 아는 사람은 접근할 수 있다. 따라서 아래 정보는 시트에 넣지 않는다.

```text
전화번호
생년월일
주소
회비 납부 정보
민감한 부상 상세
개인적인 메모
```

메모는 가볍게만 작성한다.

```text
무릎 조심
GK 가능
오랜만에 참석
강도 낮게
```

---

## 4. 포지션 정책

선수는 주포지션과 부포지션을 세부 포지션으로 입력한다.

```text
ST
CF
LW
RW
CAM
CM
CDM
LB
RB
CB
```

알고리즘은 세부 포지션을 내부적으로 3개 그룹으로 변환해서 사용한다.

| 세부 포지션 | 내부 그룹 |
|---|---|
| ST, CF, LW, RW | ATTACK |
| CAM, CM, CDM | MID |
| LB, RB, CB | DEFENSE |

```ts
const POSITION_GROUP_MAP = {
  ST: "ATTACK",
  CF: "ATTACK",
  LW: "ATTACK",
  RW: "ATTACK",
  CAM: "MID",
  CM: "MID",
  CDM: "MID",
  LB: "DEFENSE",
  RB: "DEFENSE",
  CB: "DEFENSE",
} as const;
```

---

## 5. 주포지션 / 부포지션 / 점수의 의미

`primary_position`은 선수가 기본적으로 가장 자연스럽게 뛰는 포지션이다.

`secondary_positions`는 선수가 대체로 소화 가능한 포지션이다.

포지션별 점수는 그 역할에서의 실력을 의미한다.

예를 들어 아래 두 선수가 있다고 하자.

| 이름 | 주포지션 | 부포지션 | 공격 | 미드 | 수비 |
|---|---|---|---:|---:|---:|
| A | CM | CB | 2 | 5 | 4 |
| B | CM | ST | 4 | 5 | 2 |

둘 다 주포지션은 CM이지만:

- 수비가 부족하면 A를 수비로 돌리는 것이 자연스럽다.
- 공격이 부족하면 B를 공격으로 돌리는 것이 자연스럽다.

알고리즘은 다음 우선순위를 갖는다.

```text
1순위: 주포지션 그룹 배정
2순위: 부포지션 그룹 배정
3순위: 점수가 높은 다른 그룹 배정
```

---

## 6. 선수 소스 정책

웹에서 사용하는 선수는 다음 소스를 가질 수 있다.

```text
SHEET       = Google Sheets에서 불러온 선수
TEMP_GUEST  = 오늘만 웹에서 입력한 임시 용병
LOCAL_GUEST = 브라우저에 저장된 최근 용병
```

알고리즘 입장에서는 정규 선수든 용병이든 동일한 Player 타입으로 처리한다. 팀 분배에는 이름, 포지션, 점수, 활동량, GK 가능 여부만 필요하다.

---

## 7. 용병 / 임시 선수 처리 정책

실제 운영에서는 정규 선수만으로 26명이 채워지지 않을 수 있다.

예:

```text
정규 선수 투표 14명
용병 12명
총 필드 참석자 26명
```

이런 경우를 위해 웹은 Google Sheets 선수 목록만 사용하는 것이 아니라, 당일 임시 용병을 추가할 수 있어야 한다.

초기 MVP에서는 다음 방식을 사용한다.

```text
정규 선수 / 저장된 용병 = Google Sheets에서 불러옴
당일 용병 = 웹에서 임시 추가
```

임시 용병은 다음 정보를 입력한다.

| 필드 | 설명 |
|---|---|
| 이름 | 용병 이름 또는 식별명 |
| 주포지션 | ST, CF, LW, RW, CAM, CM, CDM, LB, RB, CB 중 하나 |
| 부포지션 | 여러 개 선택 가능 |
| 공격 점수 | 1~5 |
| 미드 점수 | 1~5 |
| 수비 점수 | 1~5 |
| 활동량 | 1~5 |
| GK 가능 여부 | Y/N |
| 메모 | 선택 |

MVP 1차에서는 임시 용병을 새로고침 시 사라지게 해도 된다. MVP 1.5에서는 브라우저 `localStorage`에 최근 용병을 저장할 수 있다.

---

## 8. 필드 참석자와 전담 GK 참석자 분리

### 필드 참석자

필드 참석자는 정확히 26명이어야 한다.

```text
필드 참석자 26명
→ A팀 13명
→ B팀 13명
```

필드 참석자는 팀 분배 대상이다. 따라서 포지션, 공격/미드/수비 점수, 활동량 정보가 필요하다.

### 전담 GK 참석자

전담 GK는 필드 참석자 26명에 포함하지 않는다.

```text
필드 참석자: 26명
전담 GK 참석자: 0명 이상
```

전담 GK는 팀 밸런스 계산 대상이 아니다. 전담 GK는 포지션 점수가 없어도 된다.

실제 운영에서는 다음 케이스가 모두 가능하다.

```text
전담 GK 0명
전담 GK 1명
전담 GK 2명
전담 GK 3명 이상
```

전담 GK가 없거나 부족하면, 각 팀에서 쉬는 필드 선수 중 GK 가능한 사람이 GK를 본다.

---

## 9. GK 정책

### 필드 선수의 gk 값 의미

Google Sheets의 `gk` 컬럼은 다음 뜻이다.

```text
필드 선수로 참석했을 때,
쉬는 쿼터에 GK를 볼 수 있는지 여부
```

즉 `gk = Y`인 필드 선수는 전담 GK가 없거나 부족한 쿼터에서 GK 후보가 된다.

### 전담 GK 0명

전담 GK가 없으면 각 팀은 매 쿼터 쉬는 3명 중 1명을 GK로 배정한다.

```text
필드 10명
GK 1명 = 쉬는 선수 중 1명
대기 2명
```

### 전담 GK 1명

전담 GK가 1명 있으면, 해당 GK를 쿼터별로 A팀/B팀에 번갈아 배정한다.

```text
1Q: 전담 GK → A팀
2Q: 전담 GK → B팀
3Q: 전담 GK → A팀
4Q: 전담 GK → B팀
```

전담 GK가 배정되지 않은 팀은 해당 쿼터에 쉬는 선수 중 1명을 GK로 배정한다.

### 전담 GK 2명

전담 GK가 2명 있으면, 각 쿼터마다 양 팀에 한 명씩 배정한다.

```text
1Q: GK1 → A팀 / GK2 → B팀
2Q: GK1 → B팀 / GK2 → A팀
3Q: GK1 → A팀 / GK2 → B팀
4Q: GK1 → B팀 / GK2 → A팀
```

이 경우 각 팀의 쉬는 필드 선수 3명은 모두 대기자가 된다.

```text
필드 10명
전담 GK 1명
대기 3명
```

### 전담 GK 3명 이상

MVP에서는 전담 GK 2명을 우선 자동 배정하고, 나머지는 교대 GK로 표시한다.

```text
자동 배정 GK: GK1, GK2
교대/대기 GK: GK3
```

전담 GK 3명 이상의 정교한 로테이션은 향후 기능으로 둔다.

### 전담 GK와 필드 참석자 중복 방지

같은 사람은 필드 참석자와 전담 GK에 동시에 들어갈 수 없다.

---

## 10. 참석자 구성 UX

웹은 단순히 “26명 체크” 화면이 아니라, **오늘 참석자 명단을 만드는 화면**이어야 한다.

```text
선수 풀
  - 정규 선수
  - 저장된 용병
  - 최근 용병
  - 임시 용병 추가

        ↓ 추가

오늘 필드 참석자
  - 정확히 26명

전담 GK 참석자
  - 0명 이상

        ↓ 추천

팀 분배 / 라인업
```

참석자 구성 화면에는 다음 카운터를 보여준다.

```text
오늘 필드 참석자 26 / 26명
전담 GK 1명
정규 선수 14명
저장 용병 4명
임시 용병 8명
필드 GK 가능자 3명
```

선수 풀에서는 각 선수에게 다음 액션을 제공한다.

```text
필드 추가
전담 GK 추가
```

단 같은 사람이 필드 참석자와 전담 GK에 동시에 들어갈 수 없다.

---

## 11. 팀 분배 원칙

필드 참석자는 총 26명이다.

각 팀은 13명으로 구성한다.

```text
A팀 13명
B팀 13명
```

각 팀의 포지션 그룹 구성은 반드시 다음과 같다.

```text
공격 4명
미드 4명
수비 5명
```

따라서 전체 필드 참석자 26명은 이번 경기 역할 기준으로 다음과 같이 배정되어야 한다.

```text
ATTACK 8명
MID 8명
DEFENSE 10명
```

전담 GK는 이 26명에 포함하지 않는다.

---

## 12. 팀 분배 알고리즘

팀 분배는 크게 2단계로 진행한다.

### 1단계: 이번 경기 역할 배정

먼저 필드 참석자 26명을 다음 역할로 나눈다.

```text
ATTACK 8명
MID 8명
DEFENSE 10명
```

이때 단순히 주포지션만 보지 않는다.

다음 요소를 함께 고려한다.

- 주포지션 그룹
- 부포지션 그룹
- 공격 점수
- 미드 점수
- 수비 점수
- 포지션 변경 penalty

특정 선수를 공격 역할로 배정할 때 예시는 다음과 같다.

```text
attack_score
+ 주포지션이 ATTACK이면 bonus
+ 부포지션에 ATTACK 계열이 있으면 bonus
- 전혀 관련 없는 포지션이면 penalty
```

예시 가중치:

```text
주포지션 그룹 배정: +2
부포지션 그룹 배정: +1
그 외 그룹 배정: -1
```

### 2단계: 역할 그룹별 A/B팀 분배

역할이 정해지면, 각 역할 그룹 안에서 A/B팀을 나눈다.

```text
ATTACK 8명 → A팀 4명 / B팀 4명
MID 8명 → A팀 4명 / B팀 4명
DEFENSE 10명 → A팀 5명 / B팀 5명
```

이렇게 하면 각 팀은 반드시 4/4/5 구성이 된다.

---

## 13. 팀 밸런스 평가 기준

팀 밸런스는 전체 점수만 비교하지 않는다. 중요한 것은 포지션별 균형이다.

| 항목 | 설명 |
|---|---|
| 공격 점수 차이 | A팀 공격 4명 vs B팀 공격 4명 |
| 미드 점수 차이 | A팀 미드 4명 vs B팀 미드 4명 |
| 수비 점수 차이 | A팀 수비 5명 vs B팀 수비 5명 |
| 활동량 차이 | A팀 전체 활동량 vs B팀 전체 활동량 |
| 필드 GK 가능자 차이 | 전담 GK가 없거나 부족할 때 고려 |
| 포지션 변경 penalty | 주포지션/부포지션이 아닌 역할 배정에 대한 penalty |
| 용병 비율 차이 | 정규/용병 수가 한쪽에 심하게 몰리는 경우 약한 penalty |

```text
balance_score =
  공격 점수 차이 * weight_attack
+ 미드 점수 차이 * weight_mid
+ 수비 점수 차이 * weight_defense
+ 활동량 차이 * weight_activity
+ 필드 GK 가능자 차이 * weight_gk
+ 포지션 변경 penalty
+ 용병 비율 차이 * weight_guest
```

MVP 권장 가중치 방향:

```text
포지션별 점수 차이 > 활동량 차이 > GK 가능자 차이 > 용병 비율 차이
```

---

## 14. 팀 분배 결과 화면

추천 결과는 단순히 팀만 보여주지 않고, 왜 그렇게 나왔는지도 보여줘야 한다.

### 팀 요약

| 항목 | A팀 | B팀 | 차이 |
|---|---:|---:|---:|
| 공격 인원 | 4 | 4 | 0 |
| 미드 인원 | 4 | 4 | 0 |
| 수비 인원 | 5 | 5 | 0 |
| 공격 점수 | 17 | 16 | 1 |
| 미드 점수 | 15 | 15 | 0 |
| 수비 점수 | 21 | 20 | 1 |
| 활동량 | 44 | 43 | 1 |
| 필드 GK 가능 | 2 | 2 | 0 |
| 정규 선수 | 8 | 6 | 2 |
| 용병 | 5 | 7 | 2 |

### 포지션 변경자 표시

주포지션과 다른 역할로 배정된 사람은 따로 보여준다.

| 선수 | 주포지션 | 부포지션 | 이번 역할 | 이유 |
|---|---|---|---|---|
| 박민수 | CM | CDM,CB | DEFENSE | 수비 인원 부족 + CB 가능 |
| 이성민 | RW | CM | MID | 미드 인원 부족 + CM 가능 |

---

## 15. 쿼터별 라인업 원칙

각 팀은 13명이다.

```text
공격 4명
미드 4명
수비 5명
```

한 쿼터에 필드로 들어가는 선수는 10명이다.

```text
공격 3명
미드 3명
수비 4명
총 10명
```

각 쿼터마다 쉬는 필드 선수는 3명이다.

```text
공격 1명 휴식
미드 1명 휴식
수비 1명 휴식
```

GK는 전담 GK 여부에 따라 다르게 배정된다.

---

## 16. 출전 시간 구조

공격은 팀당 4명이고 쿼터당 3명이 출전한다.

```text
공격 4명
쿼터당 공격 출전 3명
4쿼터 총 공격 슬롯 = 3 * 4 = 12
공격 4명 * 3쿼터 = 12
```

미드도 팀당 4명이고 쿼터당 3명이 출전한다.

```text
미드 4명
쿼터당 미드 출전 3명
4쿼터 총 미드 슬롯 = 3 * 4 = 12
미드 4명 * 3쿼터 = 12
```

수비는 팀당 5명이고 쿼터당 4명이 출전한다.

```text
수비 5명
쿼터당 수비 출전 4명
4쿼터 총 수비 슬롯 = 4 * 4 = 16
수비 5명 * 3쿼터 = 15
```

따라서 수비는 필드 슬롯이 1개 남는다.

```text
공격 4명: 전원 3쿼터 출전
미드 4명: 전원 3쿼터 출전
수비 5명: 4명은 3쿼터 출전, 1명은 4쿼터 출전
```

---

## 17. 라인업 생성 규칙

각 팀별로 `1Q`, `2Q`, `3Q`, `4Q`를 생성한다.

각 쿼터는 다음 구조를 갖는다.

```text
공격 3명
미드 3명
수비 4명
필드 총 10명
```

전담 GK가 없는 팀/쿼터:

```text
필드 10명
GK 1명 = 쉬는 선수 중 1명
대기 2명
```

전담 GK가 있는 팀/쿼터:

```text
필드 10명
GK 1명 = 전담 GK
대기 3명 = 쉬는 선수 3명 전원
```

---

## 18. 수비 4쿼터 출전자 정책

각 팀의 수비 5명 중 1명은 4쿼터 모두 필드 출전한다.

선정 기준:

```text
1순위: activity_score가 높은 선수
2순위: defense_score가 높은 선수
3순위: canGk = false인 선수
4순위: 동점이면 랜덤
```

`canGk = false`를 우선하는 이유는, GK 가능한 수비수는 쉬는 쿼터에 GK 후보로 활용할 수 있기 때문이다.

수비 4쿼터 출전자는 모든 쿼터 FIELD다. 따라서 다음 역할이 될 수 없다.

```text
GK
BENCH
```

---

## 19. 라인업 결과 화면

### 쿼터별 라인업

| 쿼터 | 공격 3 | 미드 3 | 수비 4 | GK | 대기 |
|---|---|---|---|---|---|
| 1Q | A, B, C | D, E, F | G, H, I, J | 전담GK1 또는 쉬는 선수 | K, L, M |
| 2Q | ... | ... | ... | ... | ... |
| 3Q | ... | ... | ... | ... | ... |
| 4Q | ... | ... | ... | ... | ... |

### 선수별 출전표

| 선수 | 역할 | 1Q | 2Q | 3Q | 4Q | 필드 | GK | 대기 |
|---|---|---|---|---|---|---:|---:|---:|
| 김철수 | ATTACK | FIELD | FIELD | BENCH | FIELD | 3 | 0 | 1 |
| 박민수 | DEFENSE | FIELD | FIELD | FIELD | FIELD | 4 | 0 | 0 |
| 이준호 | DEFENSE | GK | FIELD | FIELD | FIELD | 3 | 1 | 0 |

전담 GK가 있는 경우 전담 GK도 별도 표에 표시한다.

| GK | 1Q | 2Q | 3Q | 4Q |
|---|---|---|---|---|
| GK1 | A팀 | B팀 | A팀 | B팀 |
| GK2 | B팀 | A팀 | B팀 | A팀 |

---

## 20. 웹 화면 구성

### 데이터 불러오기 화면

기능:

- Google Sheets CSV URL 입력
- 데이터 불러오기
- 데이터 유효성 검사

표시할 내용:

```text
총 선수 수
active = Y 선수 수
정규 선수 수
저장 용병 수
포지션 오류 여부
점수 누락 여부
필드 GK 가능자 수
```

### 참석자 구성 화면

기능:

- 선수 검색
- 포지션 필터
- 정규/용병 필터
- 필드 참석자로 추가
- 전담 GK로 추가
- 임시 용병 추가
- 임시 전담 GK 추가
- 오늘 필드 참석자 26명 구성
- 전담 GK 참석자 구성

카운터:

```text
오늘 필드 참석자 26 / 26명
전담 GK 1명
정규 선수 14명
저장 용병 4명
임시 용병 8명
필드 GK 가능자 3명
```

### 팀 추천 화면

기능:

- 자동 팀 분배
- 팀 밸런스 요약 표시
- 팀별 선수 목록 표시
- 포지션 변경자 표시
- 추천 품질 표시
- 경고 표시
- 다른 추천안 다시 생성

### 라인업 화면

기능:

- 각 팀의 1~4Q 라인업 표시
- 선수별 출전표 표시
- 전담 GK 로테이션 표시
- 쉬는 선수 GK 배정 표시
- 라인업 재생성
- 경고 표시

### 공유 화면

기능:

- 카카오톡 공유용 텍스트 생성
- 복사 버튼

공유 텍스트 예시:

```text
[A팀]

1Q
공격: 김철수, 이성민, 박준호
미드: 박민수, 강도윤, 정우진
수비: 이준호, 오세훈, 나철수, 유재석
GK: 전담GK1
대기: 최민수, 한성민, 김도현

2Q
...

[B팀]

1Q
...
```

전담 GK가 없는 경우:

```text
GK: 김도현
대기: 최민수, 한성민
```

---

## 21. 오류 / 경고 / 엣지 케이스 정책

### 팀 추천을 막아야 하는 오류

다음 조건에서는 팀 추천 버튼을 비활성화한다.

```text
필드 참석자가 정확히 26명이 아닌 경우
필수 컬럼이 누락된 경우
점수가 1~5 숫자가 아닌 경우
허용되지 않은 포지션이 입력된 경우
gk 값이 Y/N이 아닌 경우
같은 사람이 필드 참석자와 전담 GK에 동시에 들어간 경우
```

### 경고만 표시하고 진행 가능한 경우

다음 조건에서는 추천은 진행하되 경고를 표시한다.

```text
전담 GK가 없고 필드 GK 가능자가 부족한 경우
전담 GK가 1명뿐이라 특정 쿼터에서 쉬는 선수 GK가 필요한 경우
한 팀에 필드 GK 가능자가 없는 경우
포지션 변경자가 많은 경우
수비 역할에 주/부포지션 수비가 아닌 선수가 많이 배정된 경우
정규 선수와 용병 비율이 한쪽으로 크게 몰린 경우
팀별 활동량 차이가 큰 경우
전담 GK가 3명 이상인 경우
같은 이름의 선수가 중복으로 추가된 경우
```

---

## 22. 주요 엣지 케이스 상세

### 필드 참석자가 26명이 아닌 경우

```text
26명 미만 → 팀 추천 비활성화
26명 초과 → 팀 추천 비활성화
정확히 26명 → 팀 추천 가능
```

### 전담 GK가 없는 경우

전담 GK가 없으면 각 팀의 쉬는 선수 중 1명이 GK를 해야 한다.

경고 조건:

```text
특정 팀/쿼터의 쉬는 선수 중 canGk = true인 사람이 없음
```

이 경우에도 라인업은 생성하되, 해당 쿼터에 경고 표시.

### 전담 GK가 1명인 경우

전담 GK가 없는 반대 팀은 쉬는 선수 중 GK를 배정해야 한다.

경고 조건:

```text
반대 팀의 쉬는 선수 중 canGk = true인 사람이 없음
```

### 전담 GK가 2명인 경우

가장 안정적인 케이스다.

```text
양 팀 모두 전담 GK 사용
쉬는 필드 선수는 모두 BENCH
```

### 전담 GK가 3명 이상인 경우

MVP에서는 2명을 우선 자동 배정하고 나머지는 교대/대기 GK로 표시한다.

### 포지션 점수가 누락된 경우

예:

```text
attack_score 비어 있음
mid_score = 상
defense_score = 6
```

처리:

```text
데이터 오류로 표시
팀 추천 비활성화
```

### 잘못된 포지션 입력

예:

```text
primary_position = FW
secondary_positions = 윙,중앙
```

처리:

```text
허용되지 않은 포지션입니다.
허용값: ST, CF, LW, RW, CAM, CM, CDM, LB, RB, CB
```

### 이름 중복

용병까지 들어오면 이름 중복 가능성이 있다.

처리:

```text
알고리즘은 이름이 아니라 id로 구분한다.
UI에서는 이름 중복 시 경고한다.
```

### 부포지션이 비어 있는 경우

허용한다.

```text
secondary_positions = 빈 값
부포지션 없음 = []
```

### 역할 배정이 억지로 되는 경우

참석자 구성이 너무 한쪽으로 몰리면, 8/8/10은 만들 수 있지만 말이 안 되는 배정이 나올 수 있다.

예:

```text
공격형 16명
미드형 7명
수비형 3명
```

처리:

```text
팀 추천은 진행
포지션 변경자 수를 크게 표시
추천 품질을 주의 또는 나쁨으로 표시
```

### 수비 4쿼터 출전자가 GK로 배정되는 문제

수비 4쿼터 출전자는 모든 쿼터 FIELD이므로 GK가 될 수 없다.

처리:

```text
수비 4쿼터 출전자는 GK 후보에서 제외
수비 4쿼터 출전자는 BENCH 후보에서도 제외
```

### 정규 선수와 용병이 한쪽에 몰리는 경우

예:

```text
A팀 정규 11명 + 용병 2명
B팀 정규 3명 + 용병 10명
```

처리:

```text
강한 실패 조건은 아님
팀 요약에 정규/용병 비율 표시
필요하면 약한 penalty 부여
```

---

## 23. 추천 품질 표시

추천 결과에는 품질 상태를 표시한다.

```text
좋음
주의
나쁨
```

### 좋음

```text
큰 경고 없음
포지션 변경자 적음
팀별 점수 차이 작음
GK 배정 문제 없음
```

### 주의

```text
일부 포지션 변경자 있음
팀별 활동량 차이 있음
특정 쿼터에서 쉬는 선수 GK 필요
용병 비율 차이 있음
```

### 나쁨

```text
포지션 변경자가 많음
GK 배정이 불안정함
특정 팀/쿼터에 GK 가능자가 없음
역할 배정이 억지로 됨
```

---

## 24. 기술 스택

추천 MVP 기술 선택:

```text
Next.js
TypeScript
Tailwind CSS
Google Sheets CSV
Vercel
```

이유:

- 웹 배포가 쉽다.
- 나중에 서버리스 함수로 확장하기 쉽다.
- 현재는 브라우저에서 계산하고, 나중에 Google Sheets API 방식으로 바꾸기 쉽다.
- UI를 빠르게 만들 수 있다.

---

## 25. 주요 타입 설계

```ts
type Position =
  | "ST"
  | "CF"
  | "LW"
  | "RW"
  | "CAM"
  | "CM"
  | "CDM"
  | "LB"
  | "RB"
  | "CB";

type PositionGroup = "ATTACK" | "MID" | "DEFENSE";

type PlayerSource = "SHEET" | "TEMP_GUEST" | "LOCAL_GUEST";

type MemberType = "REGULAR" | "GUEST";

type Player = {
  id: string;
  source: PlayerSource;
  memberType: MemberType;
  active: boolean;
  name: string;
  primaryPosition: Position;
  secondaryPositions: Position[];
  attackScore: number;
  midScore: number;
  defenseScore: number;
  activityScore: number;
  canGk: boolean;
  memo?: string;
};

type DedicatedGoalkeeper = {
  id: string;
  source: "SHEET" | "TEMP_GK" | "LOCAL_GK";
  name: string;
  memo?: string;
};

type AssignedPlayer = Player & {
  assignedGroup: PositionGroup;
  assignmentReason: string;
  isPositionOverride: boolean;
};

type Team = {
  name: "A" | "B";
  players: AssignedPlayer[];
};

type LineupRole = "FIELD" | "GK" | "BENCH";

type LineupSlot = {
  quarter: 1 | 2 | 3 | 4;
  team: "A" | "B";
  playerId: string;
  assignedGroup?: PositionGroup;
  role: LineupRole;
  isDedicatedGk?: boolean;
};
```

---

## 26. 개발 순서

### 1단계: 프로젝트 생성

```bash
npx create-next-app@latest football-balancer --typescript --tailwind --eslint
```

### 2단계: 기본 타입 작성

```text
src/types/player.ts
src/types/team.ts
src/types/lineup.ts
src/types/gk.ts
```

### 3단계: Google Sheets CSV 로더 작성

```text
src/lib/loadPlayersFromCsv.ts
```

기능:

```text
CSV fetch
CSV 파싱
컬럼 검증
Player[] 반환
오류 목록 반환
```

### 4단계: 포지션 유틸 작성

```text
src/lib/positions.ts
```

기능:

```text
세부 포지션 → 그룹 변환
주포지션 그룹 확인
부포지션 그룹 확인
포지션 유효성 검사
```

### 5단계: 참석자 관리 로직 작성

```text
src/lib/participants.ts
```

기능:

```text
필드 참석자 추가/제거
임시 용병 추가/수정/제거
전담 GK 추가/제거
중복 이름 경고
필드 참석자와 전담 GK 중복 방지
```

### 6단계: 팀 추천 알고리즘 작성

```text
src/lib/teamBalancer.ts
```

기능:

```text
필드 참석자 26명 검증
8/8/10 역할 배정
4/4/5 A/B팀 분배
밸런스 점수 계산
포지션 변경자 계산
추천 품질 계산
경고 생성
```

### 7단계: 라인업 알고리즘 작성

```text
src/lib/lineupGenerator.ts
```

기능:

```text
각 팀 4/4/5 검증
1~4Q 라인업 생성
수비 4쿼터 출전자 선정
전담 GK 로테이션 생성
쉬는 선수 GK 배정
선수별 출전 횟수 계산
경고 생성
```

### 8단계: UI 작성

```text
src/app/page.tsx
```

화면:

```text
1. CSV URL 입력
2. 선수 목록 로딩
3. 참석자 구성
4. 임시 용병 추가
5. 전담 GK 추가
6. 팀 추천 결과
7. 라인업 결과
8. 공유 텍스트 복사
```

---

## 27. MVP에서 제외할 기능

초기 버전에서는 다음 기능을 제외한다.

```text
로그인
별도 DB
관리자 페이지
경기 기록 저장
늦참/조기퇴장
회비 관리
개인 통계
모바일 앱
AI 추천
전담 GK 3명 이상 정교한 로테이션
드래그앤드롭 수동 편집
```

---

## 28. 향후 확장 후보

나중에 필요하면 추가한다.

```text
Google Sheets API 비공개 연동
Supabase DB 저장
로그인
경기 기록 저장
지난 경기 출전 시간 반영
GK 횟수 누적 관리
팀 분배 후보 여러 개 표시
수동 드래그 앤 드롭
전담 GK 로테이션 편집
최근 용병 공유 저장
모바일 최적화
```

---

## 29. 최종 MVP 정의

초기 MVP는 다음만 만족하면 된다.

```text
1. Google Sheets에서 선수 데이터를 불러온다.
2. 정규 선수와 저장된 용병을 불러온다.
3. 임시 용병을 웹에서 추가할 수 있다.
4. 필드 참석자 26명을 구성할 수 있다.
5. 전담 GK 참석자를 0명 이상 구성할 수 있다.
6. 필드 참석자 26명을 공격 8 / 미드 8 / 수비 10 역할로 배정한다.
7. A팀/B팀을 각각 공격 4 / 미드 4 / 수비 5로 나눈다.
8. 포지션별 밸런스 점수를 보여준다.
9. 각 팀의 1~4Q 라인업을 생성한다.
10. 쿼터별 공격 3 / 미드 3 / 수비 4를 유지한다.
11. 전담 GK가 있으면 우선 GK로 배정한다.
12. 전담 GK가 없거나 부족하면 쉬는 선수 중 GK 가능자를 배정한다.
13. 선수별 출전 횟수, GK 횟수, 대기 횟수를 보여준다.
14. 경고와 추천 품질을 보여준다.
15. 결과를 카톡 공유용 텍스트로 복사할 수 있다.
```

---

## 30. Codex 구현 프롬프트

아래 내용을 Codex에 그대로 넣으면 된다.

```text
이 저장소에 Next.js + TypeScript + Tailwind 기반 MVP를 구현해줘.

목표는 Google Sheets CSV를 선수 DB로 사용해서 축구 필드 참석자 26명을 13명씩 A/B팀으로 나누고, 각 팀의 1~4쿼터 라인업을 추천하는 웹 도구야.

README.md의 설계를 기준으로 구현해줘.

핵심 조건:
- 선수 데이터는 Google Sheets CSV URL에서 불러온다.
- 선수 데이터 컬럼은 active, member_type, name, primary_position, secondary_positions, attack_score, mid_score, defense_score, activity_score, gk, memo를 사용한다.
- primary_position과 secondary_positions는 ST, CF, LW, RW, CAM, CM, CDM, LB, RB, CB 중 하나 또는 여러 개다.
- 내부 그룹은 다음처럼 매핑한다.
  - ST, CF, LW, RW → ATTACK
  - CAM, CM, CDM → MID
  - LB, RB, CB → DEFENSE
- 정규 선수와 저장 용병은 Google Sheets에서 불러온다.
- 당일 임시 용병은 웹에서 추가할 수 있어야 한다.
- 필드 참석자는 정확히 26명이어야 한다.
- 전담 GK 참석자는 0명 이상 추가할 수 있어야 한다.
- 전담 GK는 필드 참석자 26명에 포함하지 않는다.
- 같은 사람은 필드 참석자와 전담 GK에 동시에 들어갈 수 없다.

팀 분배:
- 전체 필드 참석자 26명을 ATTACK 8 / MID 8 / DEFENSE 10 역할로 배정한다.
- A팀/B팀은 각각 ATTACK 4 / MID 4 / DEFENSE 5가 되도록 나눈다.
- 주포지션/부포지션/포지션별 점수/활동량/GK 가능 여부/용병 비율을 고려한다.
- 팀 밸런스 요약, 포지션 변경자, 추천 품질, 경고 목록을 보여준다.

라인업:
- 각 팀 1~4Q 라인업을 생성한다.
- 쿼터별 필드 구성은 ATTACK 3 / MID 3 / DEFENSE 4다.
- 각 쿼터마다 팀당 필드 선수 10명, 쉬는 필드 선수 3명이 생긴다.
- 전담 GK가 해당 팀/쿼터에 배정되면 쉬는 3명은 모두 BENCH다.
- 전담 GK가 해당 팀/쿼터에 없으면 쉬는 3명 중 canGk=true인 사람을 GK로 배정하고 나머지 2명은 BENCH다.
- 전담 GK 0명: 양 팀 모두 쉬는 선수 중 GK를 배정한다.
- 전담 GK 1명: 쿼터별로 A/B팀에 번갈아 배정하고, 반대 팀은 쉬는 선수 중 GK를 배정한다.
- 전담 GK 2명: 매 쿼터 양 팀에 1명씩 배정하고, 쿼터마다 A/B를 번갈아 바꾼다.
- 전담 GK 3명 이상: 2명을 우선 배정하고 나머지는 교대/대기 GK로 표시하며 경고를 보여준다.
- 수비 5명 중 1명은 4쿼터 모두 FIELD로 출전한다.
- 수비 4쿼터 출전자는 GK/BENCH가 될 수 없다.
- 선수별 FIELD/GK/BENCH 횟수를 보여준다.

초기 버전에서는 로그인, DB, 관리자 페이지, 경기 기록 저장, 늦참/조기퇴장, 드래그앤드롭 수동 편집은 만들지 마.

코드 구조:
- 알고리즘 로직은 UI 컴포넌트에서 분리해줘.
- src/lib/positions.ts
- src/lib/loadPlayersFromCsv.ts
- src/lib/participants.ts
- src/lib/teamBalancer.ts
- src/lib/lineupGenerator.ts
- src/types/player.ts
- src/types/team.ts
- src/types/lineup.ts
- src/types/gk.ts
- src/app/page.tsx

UI는 모바일에서도 보기 좋게 만들어줘.
추천 결과에는 팀 요약, 포지션 변경자, 추천 품질, 경고 목록, 쿼터별 라인업, 선수별 출전표, 전담 GK 로테이션, 카톡 공유용 텍스트 복사 버튼이 포함되어야 해.
```

---

## 31. 핵심 설계 요약

```text
Google Sheets = 정규 선수 + 저장 용병 DB
Web = 참석자 구성 + 임시 용병 추가 + 전담 GK 추가 + 팀 분배 + 라인업 추천
DB = 없음
서버 = 없음 또는 최소화
알고리즘 = 브라우저에서 실행
필드 참석자 = 정확히 26명
전담 GK = 0명 이상
팀 구성 = 4/4/5
쿼터 필드 구성 = 3/3/4
밸런스 = 포지션 그룹별 비교
GK = 전담 GK 우선, 없거나 부족하면 쉬는 선수 중 배정
```
