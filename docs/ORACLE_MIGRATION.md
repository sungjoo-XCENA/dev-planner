# Oracle 공통 API 전환

운영 전환 완료: 2026-10-17. 플래너 주소는 https://devutd-planner.vercel.app 이며, 웹 주소는 https://devutd-web.vercel.app 이다. 기존 플래너 주소는 새 주소로 리다이렉트한다.

Google Sheets CSV 불러오기, 평가/포지션 기반 팀 편성은 기존 방식 그대로 유지한다. 경기 기록, 공유 링크, 확정 팀 기록은 Oracle 공통 API를 통해 하나의 SQLite DB에 저장한다. Firebase 연결 코드는 제거했다.

Vercel 서버 환경 변수: `DEVUTD_API_URL` (끝에 `/api/v1`), `DEVUTD_API_TOKEN`, `DEVUTD_ADMIN_CREDENTIAL` (`관리자아이디:비밀번호`). 비밀에는 `NEXT_PUBLIC_`를 붙이지 않는다. Oracle 비밀과 일치해야 하며 Production에 설정한 후 재배포한다. Preview에 운영 쓰기 토큰을 무조건 공유하지 않는다.

방문자는 플래너와 공유 링크를 열람할 수 있다. 저장/삭제 전 상단 `관리자 로그인` 또는 `/admin`에서 로그인한다. 관리자 브라우저 인증은 HTTPS에서만 사용한다. 로그아웃은 브라우저 인증 세션을 종료해야 한다.

경기 기록 화면의 `웹 일정 연결`에서 Oracle 웹 일정을 선택하면 날짜/시간/장소/상대가 채워진다. 연결 ID가 경기 기록에 저장된다. 이미 작성한 경기 기록은 기존 ID를 유지한다. 기존 기록은 연결 없이 그대로 남는다.

시트 정보가 DB 회원 명부로 자동 덮어써지지는 않는다. 안정적인 회원 연결을 위해 시트 이름과 웹 회원 이름을 일치시켜 관리한다. Google Sheets 편집 결과는 CSV를 다시 불러와 확인한다.

검증: `npm ci`, `npm run typecheck`, `npm run build`. 실제 배포 후 Google Sheets 불러오기, 과거 경기, 기존 공유 링크, 관리자 로그인, 테스트 기록 저장/수정/조회/삭제와 Oracle 웹 반영까지 별도로 확인해야 한다.

Vercel 환경 변수와 Oracle 외부 HTTPS 연결을 확인하고 main에 병합한 뒤 운영 CRUD 검사를 통과했다. 기존 웹 도메인 `dev-utd.kro.kr`과 EC2는 변경하지 않았다.
