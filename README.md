# Safibook

> 기존 저장소의 Markdown 폴더를 설정 파일 하나로 연결하는 npm 패키지입니다. Node.js 20.19 이상이 필요합니다. 현재 0.1.0 구현 기준이며 npm 레지스트리에는 아직 게시하지 않았습니다.

상단 탭, 폴더별 문서 탐색, 목차, 한국어 전체 검색, 검색 위치 이동, 문서 및 지정 섹션 안에서 찾기 기능을 제공합니다. React/Vue 등 사용자 프로젝트의 프레임워크에 의존하지 않으며, 사이트 소스는 패키지 안에 있습니다.

## 설치와 시작

게시 전에는 패키지 저장소에서 `npm ci && npm pack`으로 만든 tgz를 문서 저장소에 설치합니다.

```bash
npm install -D /path/to/safience-una-safibook-0.1.0.tgz
npx docs init
npm run docs:dev
npm run docs:build
```

Yarn도 같은 패키지를 사용할 수 있습니다.

```bash
yarn add -D /path/to/safience-una-safibook-0.1.0.tgz
yarn safibook init
yarn docs:dev
yarn docs:build
```

npm 게시 후에는 설치 경로 대신 `@safience-una/safibook`을 사용합니다. `docs`라는 실행 파일이 다른 의존성과 겹치면 동일한 CLI인 `safibook`을 사용하세요. 생성되는 스크립트는 충돌을 줄이기 위해 `safibook`을 사용합니다.

`init`은 기존 설정, 문서, 프로젝트 스크립트를 덮어쓰지 않습니다. 설정이 없으면 `docs/README.md`, `docs.config.ts`를 만들고 `docs:dev`, `docs:build` 스크립트를 추가합니다. `.gitignore`에는 생성물과 `node_modules`를 등록합니다. 이미 문서 폴더가 있다면 설정 파일의 경로만 연결하고 생성된 시작 문서는 필요에 따라 제거하세요.

## 설정

```ts
// docs.config.ts
export default {
  title: '팀 문서',
  tabs: [
    { title: '정책서', dir: './pharma', slug: 'pharma' },
    { title: '프론트엔드', dir: './fe', slug: 'fe' },
    { title: '백엔드', dir: './be', slug: 'be' },
  ],
};
```

선택적으로 `import { defineConfig } from '@safience-una/safibook'`을 사용하면 타입 도움을 받을 수 있습니다. `.ts`, `.mjs`, `.js` 설정을 지원합니다. 설정 파일은 Node에서 실행되므로 신뢰할 수 있는 저장소에서 사용하세요.

- `dir`: 설정 파일 기준의 전용 하위 폴더. 저장소 루트 또는 외부 폴더는 허용하지 않습니다.
- `slug`: 고유한 영문 소문자·숫자·하이픈. 문서 URL의 일부입니다.
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
| `docs build --config ./config/docs.config.ts` | 설정 파일 지정 (dev, ai에도 적용) |
| `docs ai --file docs/guide.md --instruction "변경 요청"` | 표준 문서 양식과 AI 편집 작업 지침을 stdout에 출력 |

빌드는 자체 생성 표시가 있는 출력 폴더만 교체합니다. 문서 변환에 실패하면 이전 성공 결과를 유지합니다. 출력에는 문서 HTML과 검색용 본문이 포함되므로 소스가 비공개라면 결과물도 비공개로 배포해야 합니다.

## 검색과 문서 작성

`⌘/Ctrl K` 또는 상단 검색 버튼으로 모든 탭의 제목·본문·표·코드를 검색합니다. 공백으로 나눈 단어를 모두 포함하는 섹션을 찾으며 제목에 일치하는 결과를 먼저 표시합니다. 한국어 Unicode 정규화와 영문 대소문자 구분 없는 부분 일치를 지원합니다. 형태소 분석·오타 교정 검색은 포함하지 않습니다.

결과를 선택하면 해당 문서와 제목 위치로 이동하며 일치하는 글자를 표시합니다. 문서 상단 검색창 또는 다음과 같은 섹션 검색창에서 이전·다음 버튼, Enter / Shift+Enter로 이동합니다. 검색은 현재 선택한 한 영역에 적용됩니다. 섹션 검색은 내용의 표시·숨김이 아니라 일치 위치를 강조하고 이동하는 기능입니다.

```markdown
:::search 정책 검색
## 환불 정책

| 조건 | 처리 |
| --- | --- |
| 결제 취소 | 정산 내역 확인 후 환불 |
:::
```

표준 Markdown, 코드 블록, 표, 상대 `.md` 링크, 한국어 제목 앵커, 이미지와 PDF 첨부를 지원합니다. 연결된 PNG/JPEG/GIF/WebP/AVIF/ICO/PDF만 복사하며 문서 폴더 밖 첨부는 빌드 오류로 처리합니다. 로컬 파일 링크는 현재 문서 기준 상대 경로를 사용하세요. 한 문서의 여러 검색 영역을 나란히 구성할 수 있으며 중첩 검색 영역은 사용하지 마세요.

제목은 자동으로 목차에 표시됩니다. 중복 제목에는 `-1`, `-2`가 붙습니다. Markdown 링크가 존재하지 않는 문서 파일을 가리키면 빌드를 중단합니다. 대상 제목 앵커의 존재 여부는 별도로 검사하지 않습니다.

실행 가능한 HTML, MDX, YAML frontmatter 메타데이터, 확장 Markdown 플러그인은 현재 지원하지 않습니다. 원시 HTML은 실행하지 않고 텍스트로 표시하며 결과 HTML을 정제합니다. 외부 이미지·링크는 원래 URL을 유지합니다.

## AI로 정해진 양식에 맞추기

```bash
npx docs ai --file pharma/refund.md --instruction "현재 근거를 유지하고 환불 정책을 표로 정리" > /tmp/refund-prompt.txt
```

생성된 내용을 사용 중인 AI 코딩 도구에 전달하세요. 개요 → 사용 흐름 → 상세 기준 → 예외 → 관련 문서 순서의 양식과 기존 문서, 요청을 함께 제공합니다. 결과를 검토하여 Markdown에 반영한 다음 미리보기와 Git diff를 확인합니다.

이 명령은 API를 호출하거나 파일을 자동 수정하지 않습니다. AI 제공자·모델·인증 설정이 정해지지 않아 현재 버전은 도구에 전달할 작업 지침 생성까지 제공합니다. 출력에 기존 문서 전문이 포함되므로 공유 범위는 원본 문서와 동일하게 취급하세요.

## Cloudflare Pages 배포와 계정 제한

호스팅 계정 연결 및 Access 정책은 각 문서 프로젝트에서 설정합니다. 현재 저장소에는 실제 Cloudflare 프로젝트나 계정 정책이 연결되어 있지 않습니다.

1. GitHub에 문서, 설정, package.json과 lockfile을 올립니다. 패키지 tgz를 로컬 절대 경로로 설치한 상태라면 npm에 게시된 버전으로 교체하거나, tgz를 저장소에 넣고 `file:./vendor/…tgz` 상대 경로로 설치하세요.
2. Pages에 해당 Git 저장소를 연결합니다. 프레임워크는 None, 빌드 명령은 `npm run docs:build`, 출력 디렉터리는 `.docs-dist`, 프로덕션 브랜치는 `main`으로 설정합니다. Node 버전은 22 이상으로 지정합니다. Yarn 프로젝트는 해당 lockfile과 `yarn docs:build`를 사용합니다.
3. 커스텀 도메인을 쓸 경우 먼저 Pages에 연결한 후 Access를 설정합니다.
4. Pages의 **Enable access policy**를 활성화합니다. 이 기본 설정만으로 운영 주소가 보호되는 것은 아닙니다.
5. 만들어진 Access 애플리케이션의 호스트에서 와일드카드를 제거해 `<project>.pages.dev`를 보호합니다. Pages에서 access policy를 다시 활성화해 `*.<project>.pages.dev` 미리보기 정책도 별도로 만듭니다.
6. 커스텀 도메인은 Zero Trust에서 별도의 Self-hosted 애플리케이션으로 등록합니다. 각 호스트 전체에 허용 이메일·그룹 기반 Allow 정책을 적용하며 Bypass/Everyone 정책은 두지 않습니다.
7. 로그아웃 또는 시크릿 창에서 운영·미리보기·커스텀 도메인의 `/`, `/site.json`, `/assets/...`를 각각 확인합니다. 미허용 계정이 내용을 읽을 수 없어야 합니다. 민감 문서는 이 확인을 마친 뒤 배포합니다.

`main`에 병합하면 Pages의 Git 연동으로 다시 빌드합니다. 롤백은 Pages의 이전 정상 배포를 선택하거나 Git 변경을 되돌립니다. 브라우저 코드에는 인증 비밀키를 넣지 않습니다.

공식 근거: [정적 HTML 배포](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/), [미리보기 배포](https://developers.cloudflare.com/pages/configuration/preview-deployments/), [pages.dev·커스텀 도메인 Access 설정](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain).

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
