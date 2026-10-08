# Doxen

> 기존 저장소의 Markdown 폴더를 설정 파일 하나로 연결하는 npm 패키지입니다. Node.js 20.19 이상이 필요합니다. 현재 0.1.1 구현 기준입니다.

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

결과를 선택하면 해당 문서와 제목 위치로 이동하며 일치하는 글자를 표시합니다. 문서 상단 검색창 또는 다음과 같은 섹션 검색창에서 이전·다음 버튼, Enter / Shift+Enter로 이동합니다. 검색은 현재 선택한 한 영역에 적용됩니다. 섹션 및 문서 내 검색은 입력한 문자열이 포함된 표의 본문 행만 남기고 나머지 행을 숨깁니다. 표 머리글은 유지하며 검색어를 지우면 모든 행을 복원합니다. 영문 대소문자와 한국어 Unicode 정규화를 적용하고 앞뒤 공백을 제외한 연속 문자열로 비교합니다. 표 밖의 본문은 숨기지 않고 일치 위치를 강조합니다.

```markdown
## 1. 문서 작성

:::search 작성 방법 검색

| 작업 | 방법 |
| --- | --- |
| 제목 추가 | Markdown 제목 문법 사용 |
:::
```

번호가 있는 제목은 검색 영역 밖에 두세요. 제목 바로 아래에 `:::search 영역 이름`을 작성하면 해당 영역에만 검색창이 표시됩니다. 검색이 필요 없는 섹션은 일반 Markdown으로 작성합니다. 기존처럼 검색 영역 안에 첫 제목을 작성한 문서도 화면에서는 제목 아래로 검색창을 배치합니다. 전체 검색은 헤더 중앙, 문서 전체에서 찾기는 본문 상단의 접이식 메뉴로 제공합니다.

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

최초 설정 후 `npx doxen deploy` 또는 `npm run docs:deploy`로 Cloudflare Pages 운영 브랜치에 직접 배포합니다. Git push는 필요하지 않습니다. 기존 프로젝트는 `npx doxen init`을 다시 실행하면 배포 스크립트가 추가됩니다. 이 저장소 자체에는 실제 Cloudflare 계정이 연결되어 있지 않습니다.

### 최초 설정

1. 문서 프로젝트에 `npm install -D wrangler@4`를 실행하고 Cloudflare에 Direct Upload 방식 Pages 프로젝트를 만듭니다. 민감 문서는 설정 완료 전 업로드하지 마세요. Git 연동 프로젝트는 자동 빌드에서도 같은 인증 설정을 사용해야 합니다.
2. Cloudflare Zero Trust에서 로그인 방법(이메일 일회용 코드 또는 회사 IdP)을 설정합니다. Access 애플리케이션에 업무 사용자 이메일만 허용하는 Allow 정책을 만듭니다. Everyone/Bypass 정책은 사용하지 않습니다.
3. 운영 `<project>.pages.dev`, 미리보기 `*.<project>.pages.dev`, 사용하는 커스텀 도메인 전체 경로를 Access로 보호합니다. Pages의 **Enable access policy**만 켜면 운영 주소는 보호되지 않습니다. 기본 정책의 와일드카드를 제거해 운영 주소를 보호하고, Pages에서 다시 정책을 활성화해 미리보기도 보호합니다. 커스텀 도메인은 별도 Self-hosted 애플리케이션으로 등록합니다.
4. 각 Access 애플리케이션의 **Application Audience (AUD)**와 팀 도메인을 아래 설정에 입력합니다. `emails`에는 실제 열람할 업무 사용자만 등록합니다. 여기의 이메일 목록과 Access 정책 모두 통과해야 문서를 읽을 수 있습니다.
5. Pages 프로젝트 Settings의 Functions 요청 한도 초과 동작을 운영·미리보기 모두 **Fail closed**로 설정합니다. 배포 명령은 API로 두 환경의 `fail_open: false`를 확인하며, 확인하지 못하면 업로드하지 않습니다.
6. 해당 계정의 **Cloudflare Pages Edit** 권한을 가진 API 토큰을 만들고 `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` 환경 변수로 제공합니다. 토큰을 설정 파일이나 Git에 넣지 마세요. 로그인용 Access 설정과 배포용 API 토큰은 별개입니다.

```ts
// docs.config.ts
export default {
  title: '팀 문서',
  tabs: [{ title: '가이드', dir: './docs', slug: 'guide' }],
  deploy: {
    project: 'team-docs',
    access: {
      teamDomain: 'https://your-team.cloudflareaccess.com',
      // 아래 값은 예시입니다. 각 호스트를 보호하는 애플리케이션의 실제 AUD로 교체하세요.
      audiences: ['0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
      emails: ['member@company.com'],
    },
  },
};
```

```bash
# 위 환경 변수를 셸 또는 CI의 비밀 변수로 설정한 뒤 실행
npx doxen deploy
# 또는
npm run docs:deploy
# Yarn
yarn docs:deploy
```

`--config ./config/docs.config.ts`도 지원합니다. 배포 대상은 설정의 프로젝트와 해당 프로젝트의 운영 브랜치입니다. 기존 프로젝트의 Wrangler 설정과 functions 폴더는 사용하지 않습니다. 배포 도구는 사용자가 설치한 Wrangler 4를 사용하며 자동 설치하지 않습니다.

### 접근 제한 범위

`deploy` 설정이 있으면 `docs build`에도 Pages 서버 인증 코드(`_worker.js`)와 전체 경로 라우팅(`_routes.json`)이 포함됩니다. 서버는 Cloudflare Access JWT의 서명·발급자·AUD·만료와 허용 이메일을 검증한 뒤 파일을 제공합니다. HTML뿐 아니라 `/site.json`, JavaScript, 이미지, PDF도 같은 검사를 거칩니다. 인증 누락·위조·만료·비허용 이메일·인증 공개키 조회 실패 시 403으로 차단합니다. 응답은 `private, no-store`로 설정합니다. Cloudflare Cache Rules로 이를 덮어쓰지 마세요.

로그인은 Cloudflare Access가 담당합니다. Access가 연결되지 않은 주소는 로그인 화면 대신 403을 반환합니다. 배포 후 시크릿 창에서 운영·미리보기·커스텀 도메인의 `/`, `/site.json`, 첨부파일 주소를 확인하세요. 허용 계정은 열람 가능하고 미허용 계정은 차단되어야 합니다. 실제 계정의 로그인과 정책 동작은 로컬 테스트로 확인할 수 없습니다.

로컬 `docs dev`에는 인증이 적용되지 않습니다. `deploy` 설정 없는 `docs build`는 기존처럼 일반 정적 사이트를 만듭니다. 보호된 빌드도 일반 정적 호스팅에 복사하면 서버 인증이 실행되지 않으므로 반드시 Pages Functions로 배포하세요. 탭별 권한은 제공하지 않으며 모든 허용 사용자는 사이트 전체를 읽습니다.

이메일 목록 변경은 다시 배포해야 반영됩니다. 과거 배포에는 당시 목록이 남으므로 퇴사자 등의 접근을 회수할 때는 모든 관련 Access 정책에서 제거하고 활성 세션을 취소하며, 필요하면 이전 배포도 삭제하세요. 롤백하면 이전 인증 목록도 돌아오므로 정책을 함께 확인하세요.

공식 참고: [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [서버에서 JWT 검증](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [전체 요청을 처리하는 Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/), [라우팅과 Fail closed](https://developers.cloudflare.com/pages/functions/routing/), [pages.dev Access 설정 주의사항](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain).

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
