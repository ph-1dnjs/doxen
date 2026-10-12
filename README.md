# Doxen

> 기존 저장소의 Markdown 폴더를 설정 파일 하나로 연결하는 npm 패키지입니다. Node.js 22 이상이 필요합니다. 현재 0.2.1 구현 기준입니다.

상단 탭, 폴더별 문서 탐색, 목차, 한국어 전체 검색, 검색 위치 이동, 문서 및 지정 섹션 안에서 찾기 기능을 제공합니다. React/Vue 등 사용자 프로젝트의 프레임워크에 의존하지 않으며, 사이트 소스는 패키지 안에 있습니다.

## 설치와 시작

npm 레지스트리에 배포된 패키지는 다음과 같이 설치합니다. 로컬 설치는 `npm pack`으로 만든 tgz 경로를 패키지명 대신 사용합니다.

```bash
npm install -D @unana_dev/doxen
npx docs init
npm run docs:dev
npm run docs:build
```

Yarn도 같은 패키지를 사용할 수 있습니다.

```bash
yarn add -D @unana_dev/doxen
yarn doxen init
yarn docs:dev
yarn docs:build
```

`docs`라는 실행 파일이 다른 의존성과 겹치면 동일한 CLI인 `doxen`을 사용하세요. 생성되는 스크립트는 충돌을 줄이기 위해 `doxen`을 사용합니다.

`init`은 기존 설정, 문서, 프로젝트 스크립트를 덮어쓰지 않습니다. 설정이 없으면 `docs/README.md`, `docs.config.ts`를 만들고 `docs:dev`, `docs:build`, `docs:deploy` 스크립트를 추가합니다. `.gitignore`에는 생성물과 `node_modules`를 등록합니다. 이미 문서 폴더가 있다면 설정 파일의 경로만 연결하고 생성된 시작 문서는 필요에 따라 제거하세요.

## 설정

```ts
// docs.config.ts
export default {
  title: '팀 문서',
  icon: { background: '#edf8ff', color: '#467792', border: '#bcdff8' },
  tabs: [
    { title: '시작하기', dir: './guide', slug: 'guide' },
    { title: '작성 가이드', dir: './writing', slug: 'writing' },
    { title: '레퍼런스', dir: './reference', slug: 'reference' },
  ],
};
```

선택적으로 `import { defineConfig } from '@unana_dev/doxen'`을 사용하면 타입 도움을 받을 수 있습니다. `.ts`, `.mjs`, `.js` 설정을 지원합니다. 설정 파일은 Node에서 실행되므로 신뢰할 수 있는 저장소에서 사용하세요.

- `dir`: 설정 파일 기준의 전용 하위 폴더. 저장소 루트 또는 외부 폴더는 허용하지 않습니다.
- `slug`: 고유한 영문 소문자·숫자·하이픈. 문서 URL의 일부입니다.
- `icon.background` / `icon.color`: 상단 로고와 파비콘의 배경색 / 글자색. `#fff` 또는 `#ffffff` 형식의 HEX 색상을 지원하며, 생략하면 각각 `#edf8ff` / `#467792`가 적용됩니다.
- `icon.border`: 상단 로고의 테두리 색상. 같은 HEX 형식을 지원하며, 기본값은 `#bcdff8`입니다.
- `icon: '#eab308'`처럼 색상 하나만 지정하면 같은 색 계열의 밝은 배경색, 중간 톤 테두리, 진한 글자색을 자동 생성합니다. 개별 색상 객체 대신 사용할 수 있습니다.
- 파일 이름순(숫자 순서 인식)으로 정렬합니다. `01-introduction.md`처럼 번호를 붙이면 순서를 제어할 수 있습니다.
- 하위 폴더는 탐색 목록에 경로로 표시합니다. 숨김 파일, `node_modules`, 심볼릭 링크 문서는 제외합니다.
- 탭 전체 내용은 같은 정적 사이트에 포함됩니다. 탭별 권한 분리는 제공하지 않습니다.

## 명령

| 명령 | 기능 |
| --- | --- |
| `docs init` | 시작 문서, 설정, 스크립트, Git 제외 설정 |
| `docs dev` | `http://127.0.0.1:4173` 미리보기와 변경 시 자동 새로고침 |
| `docs dev --port 4200` | 포트 변경 |
| `docs build` | 설정 파일 옆 `.docs-dist/`에 정적 사이트 생성 |
| `docs deploy` | 인증 설정 검사 → 빌드 → Cloudflare Pages 운영 배포 |
| `docs build --config ./config/docs.config.ts` | 설정 파일 지정 (dev, deploy, ai에도 적용) |
| `docs ai --file docs/guide.md --instruction "변경 요청"` | 표준 문서 양식과 AI 편집 작업 지침을 stdout에 출력 |

빌드는 자체 생성 표시가 있는 출력 폴더만 교체합니다. 문서 변환에 실패하면 이전 성공 결과를 유지합니다. 출력에는 문서 HTML과 검색용 본문이 포함되므로 소스가 비공개라면 결과물도 비공개로 배포해야 합니다.

## 검색과 문서 작성

`⌘/Ctrl K` 또는 상단 검색 버튼으로 모든 탭의 제목·본문·표·코드를 검색합니다. 공백으로 나눈 단어를 모두 포함하는 섹션을 찾으며 제목에 일치하는 결과를 먼저 표시합니다. 한국어 Unicode 정규화와 영문 대소문자 구분 없는 부분 일치를 지원합니다. 형태소 분석·오타 교정 검색은 포함하지 않습니다.

전체 검색 결과를 선택하면 해당 문서와 제목 위치로 이동하며 일치하는 글자를 표시합니다. 각 표 위에는 검색창이 자동으로 추가됩니다. 입력한 문자열이 포함된 본문 행만 남기고 나머지 행을 숨깁니다. 표별 검색은 독립적으로 유지되며, 표 머리글은 숨기지 않습니다. 검색어를 지우면 모든 행을 복원합니다. 영문 대소문자와 한국어 Unicode 정규화를 적용하고 앞뒤 공백을 제외한 연속 문자열로 비교합니다. 표 밖의 본문은 필터링하지 않습니다.

```markdown
## 1. 문서 작성

:::search 작성 방법 검색

| 작업 | 방법 |
| --- | --- |
| 제목 추가 | Markdown 제목 문법 사용 |
:::
```

검색창 이름을 지정하려면 위와 같이 표를 `:::search 영역 이름`과 `:::`로 감싸세요. 표가 없는 영역에는 검색창이 표시되지 않습니다. 기존처럼 검색 영역 안에 첫 제목을 작성한 문서도 화면에서는 제목 아래로 표 검색창을 배치합니다. 전체 검색은 헤더 중앙에서 제공합니다.

표준 Markdown, 코드 블록, 표, 상대 `.md` 링크, 한국어 제목 앵커, 이미지와 PDF 첨부를 지원합니다. 연결된 PNG/JPEG/GIF/WebP/AVIF/ICO/PDF만 복사하며 문서 폴더 밖 첨부는 빌드 오류로 처리합니다. 로컬 파일 링크는 현재 문서 기준 상대 경로를 사용하세요. 한 문서의 여러 검색 영역을 나란히 구성할 수 있으며 중첩 검색 영역은 사용하지 마세요.

제목은 자동으로 목차에 표시됩니다. 중복 제목에는 `-1`, `-2`가 붙습니다. Markdown 링크가 존재하지 않는 문서 파일을 가리키면 빌드를 중단합니다. 대상 제목 앵커의 존재 여부는 별도로 검사하지 않습니다.

실행 가능한 HTML, MDX, YAML frontmatter 메타데이터, 확장 Markdown 플러그인은 현재 지원하지 않습니다. 원시 HTML은 실행하지 않고 텍스트로 표시하며 결과 HTML을 정제합니다. 외부 이미지·링크는 원래 URL을 유지합니다.

## AI로 정해진 양식에 맞추기

```bash
npx docs ai --file guide/writing.md --instruction "현재 내용을 유지하고 문서 작성 방법을 표로 정리" > /tmp/writing-prompt.txt
```

생성된 내용을 사용 중인 AI 코딩 도구에 전달하세요. 문서 정보 범위 → 번호별 단계 → 예외 → 관련 문서 순서의 양식과 기존 문서, 요청을 함께 제공합니다. 결과를 검토하여 Markdown에 반영한 다음 미리보기와 Git diff를 확인합니다.

이 명령은 API를 호출하거나 파일을 자동 수정하지 않습니다. AI 제공자·모델·인증 설정이 정해지지 않아 현재 버전은 도구에 전달할 작업 지침 생성까지 제공합니다. 출력에 기존 문서 전문이 포함되므로 공유 범위는 원본 문서와 동일하게 취급하세요.

## 명령 하나로 비공개 배포하기

문서 프로젝트에서 다음 명령을 실행하세요. 최초에는 한국어 설정 안내가 나오고, 이후에는 같은 명령으로 수정한 문서를 다시 배포합니다. Node.js 22 이상이 필요하며 Wrangler는 Doxen에 포함되어 별도로 설치하지 않습니다.

```bash
npx doxen deploy
# 또는 npm run docs:deploy / yarn docs:deploy
```

문서 설정이 아직 없다면 먼저 `npx doxen init`으로 문서 폴더를 준비하세요. 기존 프로젝트도 `init`을 다시 실행하면 배포 스크립트가 추가됩니다. `--config ./config/docs.config.ts`로 다른 문서 설정을 지정할 수 있습니다.

### 첫 실행에서 하는 일

1. **Cloudflare 연결:** 안내되는 [토큰 발급 화면](https://dash.cloudflare.com/profile/api-tokens)에서 로그인하고 배포용 API 토큰을 한 번 발급합니다. 터미널의 가려진 입력란에 붙여넣습니다. 환경 변수를 직접 설정할 필요는 없습니다.
2. **계정 선택:** 접근 가능한 계정을 조회합니다. 여러 개면 사용할 계정을 선택합니다.
3. **사이트 이름과 열람자 입력:** 새 사이트 이름과 열람할 업무 이메일을 입력합니다. 본인 이메일도 포함하세요. 기존 회사 로그인 방법이 있으면 선택하고, 없으면 이메일 일회용 코드 로그인을 준비합니다.
4. **내용 확인:** 계정·사이트·열람자·업로드할 문서 폴더를 확인하고 진행합니다.
5. **자동 준비와 배포:** Pages 프로젝트, 운영·미리보기 Access 애플리케이션, 허용 이메일 정책, Fail closed 설정을 준비하고 검증합니다. AUD와 팀 주소도 자동으로 가져옵니다. 이후 문서를 빌드하고 업로드합니다.

Cloudflare 계정 생성, 토큰 발급 및 계정에서 요구하는 Zero Trust 최초 약관·플랜 선택은 사용자가 진행해야 합니다. 도구는 유료 플랜을 구매하지 않습니다. 토큰에는 사용할 **계정 하나**를 지정하고 다음 권한을 부여하세요. 일반 Wrangler 브라우저 로그인만으로 이 Access 자동 설정을 대신하지 않습니다.

| Account 권한 | 수준 | 용도 |
| --- | --- | --- |
| Account Settings | Read | 계정 조회 |
| Cloudflare Pages | Edit | 프로젝트 생성·배포 |
| Access: Apps and Policies | Edit | 접근 애플리케이션·허용 정책 생성·조회 |
| Access: Organizations, Identity Providers, and Groups | Edit | 팀 주소 확인·생성 및 로그인 방법 준비 |

기존 회사 로그인 설정은 변경하지 않고 선택한 방법을 사용합니다. 로그인 방법이 없는 계정에는 확인 화면에 안내한 대로 이메일 일회용 코드 제공자를 추가합니다. 기존 Pages 프로젝트와 이름이 충돌하면 다른 이름을 선택해야 하며, 기존 사이트를 자동으로 인수하거나 덮어쓰지 않습니다.

### 다음 배포와 저장 위치

Markdown 수정 후 **같은 `npx doxen deploy` 명령**을 실행하세요. 설정이 완료되어 있으면 사이트 이름·이메일을 다시 묻지 않습니다. 기존 정책과 Fail closed 설정을 확인한 다음 운영 브랜치에 배포합니다. Git push는 필요하지 않습니다.

- 프로젝트 설정은 문서 설정 파일 옆 `.doxen-deploy.json`에 저장합니다. 계정 ID, 사이트, 허용 이메일과 생성된 Access 식별자가 들어가며 API 토큰은 들어가지 않습니다. 기존 `docs.config.ts`를 수정하지 않습니다. 팀 저장소에 공유할 때는 이메일 목록의 공개 범위를 확인하세요.
- macOS/Linux에서는 토큰을 이 컴퓨터에 저장할지 선택할 수 있습니다. 저장하면 `~/.config/doxen/accounts/<계정 ID>.json`에 **평문으로 저장**하며 디렉터리는 700, 파일은 600 권한을 사용합니다. OS 키체인 저장은 아닙니다. 저장하지 않으면 다음 실행에서 다시 입력합니다. Windows에서는 자동 저장을 제공하지 않습니다.
- 저장된 토큰이 만료되거나 계정 권한이 거부되면 새 토큰 입력을 안내합니다. 토큰을 제거하려면 해당 계정 파일을 삭제하고, 효력을 없애려면 Cloudflare에서 토큰을 폐기하세요.
- CI에서는 저장된 프로젝트 설정과 비밀 환경 변수 `CLOUDFLARE_API_TOKEN`을 사용합니다. `CLOUDFLARE_ACCOUNT_ID`를 함께 지정할 경우 저장된 계정과 같아야 합니다. 대화형 최초 설정은 CI에서 실행하지 않습니다.

중간에 실패하면 생성된 자원의 식별자를 보존합니다. 같은 명령을 다시 실행하면 기록된 단계에서 이어갑니다. 설정이 미완료된 동안에는 일반 `docs build`도 차단합니다. 서버가 자원을 만들었지만 응답·로컬 기록에 실패한 경우에는 중복 생성이나 기존 사이트 덮어쓰기를 막기 위해 대시보드 확인이 필요할 수 있습니다. 자동으로 원격 자원을 삭제하지 않습니다.

### 열람 권한과 운영 관리

배포 이력·롤백·도메인은 Cloudflare Pages, 로그인·접근 정책은 Cloudflare One의 Access에서 관리합니다. 자동 설정은 기본 Pages 운영 주소와 미리보기 주소를 대상으로 합니다. 커스텀 도메인은 별도로 연결하고 Access로 보호해야 합니다.

열람자를 변경하려면 **`.doxen-deploy.json`의 `emails`만 수정하고 `npx doxen deploy`를 실행**하세요. 기존 이메일을 유지하면서 새 주소를 추가하면 운영·미리보기의 Doxen 허용 정책에 자동 반영됩니다. 삭제한 주소도 두 정책에서 제거합니다. JSON 목록이 기준이므로 Cloudflare에서만 추가한 주소는 다음 동기화 때 제거됩니다.

```json
"emails": ["member@company.com", "new-member@company.com"]
```

두 애플리케이션을 검사한 뒤 단일 `Doxen 열람자` 이메일 Allow 정책만 갱신하고 다시 조회하여 확인합니다. 별도 정책·그룹·추가 보안 조건이 있으면 덮어쓰지 않고 중단합니다. 중간 실패 시 문서는 업로드하지 않으며 같은 명령으로 다시 시도하면 남은 정책을 갱신합니다. 이미 반영된 정책 변경은 되돌리지 않습니다.

이메일 제거가 기존 로그인 세션을 즉시 취소하지는 않습니다. 즉시 접근을 회수하려면 Cloudflare에서 활성 세션도 취소하세요. 커스텀 도메인의 별도 정책은 직접 관리해야 합니다. 이전 배포에는 당시 목록이 남으므로 필요하면 이전 배포도 삭제합니다. 롤백하면 이전 목록도 돌아올 수 있습니다.

허용 사용자는 사이트 전체를 읽습니다. 문서별·탭별 권한은 제공하지 않습니다. 자동 설정은 초기 연결 과정을 줄이는 기능이며, 별도의 열람자 관리 화면은 아직 없습니다.

### 보호 방식과 기존 수동 설정

배포 설정이 있으면 `docs build`에도 Pages 서버 인증 코드(`_worker.js`)와 전체 경로 라우팅(`_routes.json`)이 포함됩니다. 서버는 Cloudflare Access JWT의 서명·발급자·AUD·만료와 허용 이메일을 확인한 뒤 파일을 제공합니다. HTML, `/site.json`, 이미지, PDF 모두 보호하며 인증 실패·공개키 조회 실패는 403으로 차단합니다. 응답은 `private, no-store`로 설정합니다. Cache Rules로 이를 덮어쓰지 마세요.

로그인은 Cloudflare Access가 담당합니다. Access가 연결되지 않은 주소는 로그인 화면 대신 403을 반환합니다. 배포 후 허용·미허용 계정으로 운영·미리보기 주소의 문서와 첨부파일 접근을 확인하세요. 실제 계정의 로그인과 정책 전파는 로컬 자동 테스트로 검증할 수 없습니다.

로컬 `docs dev`에는 인증이 적용되지 않습니다. 배포 설정 없는 `docs build`는 일반 정적 사이트를 만듭니다. 보호된 빌드도 일반 정적 호스팅에서는 인증 코드가 실행되지 않으므로 Pages Functions로 배포해야 합니다.

기존 `docs.config.ts`의 `deploy` 설정과 환경 변수 방식도 지원합니다. 자동 설정 파일과 수동 `deploy` 설정을 동시에 두지는 마세요. 수동 설정은 기존처럼 호스트별 Access 정책과 Fail closed를 관리자가 준비해야 합니다.

```ts
deploy: {
  project: 'team-docs',
  access: {
    teamDomain: 'https://your-team.cloudflareaccess.com',
    audiences: ['0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
    emails: ['member@company.com'],
  },
},
```

공식 참고: [Pages 프로젝트 생성 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/), [Access 애플리케이션 API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/), [Zero Trust 조직 API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/methods/create/), [JWT 검증](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Fail closed](https://developers.cloudflare.com/pages/functions/routing/).

## 패키지 개발·검증·게시

```bash
npm ci
npm run dev                 # 예제 사이트
npm run check               # Node 테스트와 문법 검사
npm run test:browser        # Chromium 브라우저 테스트
npm run test:package        # tgz를 별도 프로젝트에 설치하여 검증
npm run build              # 예제 정적 빌드
npm pack --dry-run          # 배포 파일 목록 검토
npm pack
```

브라우저 테스트는 먼저 `npx playwright install chromium`을 실행하세요. 기존 Chrome을 쓰려면 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`에 실행 파일 경로를 설정할 수 있습니다. npm에 게시하려면 스코프 소유권·이름 사용 가능 여부·로그인을 확인한 뒤 버전을 갱신하고 `npm publish --access public`을 실행합니다. 게시 여부는 이 저장소 구현 완료와 별개입니다.

배포 파일은 package.json의 `files` 허용 목록으로 제한됩니다. `bin/`, `src/`, `client/`, README, LICENSE만 포함하고 예제, 테스트, 문서 저장소 원본은 포함하지 않습니다. 런타임 의존성은 일반 npm 의존성으로 설치합니다.

구조: `bin/docs.js` → 설정 로더 → Markdown/섹션/첨부 처리 → 정적 빌드 또는 로컬 서버. 화면과 브라우저 검색은 `client/`에 있습니다. 사이트는 해시 URL을 사용해 하위 경로에서도 서버 rewrite 없이 동작합니다. 전체 문서 데이터를 한 번 내려받으므로 초기 버전은 소규모·중규모 팀 문서에 맞췄으며 대형 저장소 성능은 별도 측정이 필요합니다.

파일 감시 한도 오류(EMFILE/ENOSPC)나 네트워크 파일시스템에서 갱신이 안 되면 `CHOKIDAR_USEPOLLING=1 npm run docs:dev`를 사용하세요. 설정·문서 오류는 터미널과 미리보기 응답에 표시되며 수정 후 새로고침하면 복구됩니다.
