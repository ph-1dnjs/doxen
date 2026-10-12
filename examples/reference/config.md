# 설정 레퍼런스

## 탭 설정

`docs.config.ts`는 프로젝트 루트에 두세요. 경로는 설정 파일을 기준으로 해석합니다.

```ts
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

## color: 사이트 강조색

`docs.config.ts`에서 색상 하나를 지정하면 활성 탭, 문서 탐색과 링크, 컴포넌트의 포커스·호버, 인라인 코드와 검색 하이라이팅에 적용됩니다. 배경과 테두리는 해당 색상의 밝은 톤으로 자동 생성합니다.

```ts
color: '#7e22ce',
```

`#fff` 또는 `#ffffff` 형식의 HEX 색상을 사용하세요. `icon`을 생략하면 로고와 파비콘에도 같은 색상을 적용합니다. `color` 없이 `icon: '#eab308'`처럼 단일 색상을 지정해도 사이트 강조색에 반영됩니다. 둘 다 지정하면 사이트 강조색은 `color`를 따르고, 로고와 파비콘은 `icon`을 따릅니다. `icon` 객체만 지정하거나 색상 설정을 생략하면 기존 사이트 테마를 유지합니다.

## 아이콘 색상

색상 하나만 지정하면 밝은 배경색, 중간 톤 테두리, 진한 글자색을 자동으로 생성해 상단 로고와 파비콘에 적용합니다.

```ts
icon: '#eab308',
```

`icon.background`는 상단 로고와 파비콘의 배경색, `icon.color`는 글자색, `icon.border`는 상단 로고의 테두리 색상입니다. `#fff` 또는 `#ffffff` 형식의 HEX 색상을 사용하세요. 설정을 생략하면 배경색 `#edf8ff`, 글자색 `#467792`, 테두리 색상 `#bcdff8`이 적용됩니다. 각 색상을 개별적으로 변경할 수도 있습니다.

```ts
icon: { background: '#f3e8ff', color: '#7e22ce', border: '#c084fc' },
```

## CLI 명령

| 명령 | 설명 |
| --- | --- |
| `docs init` | 설정과 실행 스크립트 생성 |
| `docs dev` | 로컬 미리보기와 파일 변경 감지 |
| `docs build` | 정적 사이트 출력 |
| `docs deploy` | 첫 실행 안내에 따라 비공개 배포 설정 후 배포, 이후 같은 명령으로 갱신 |

로컬 서버의 기본 포트는 4173입니다. `--port 4200`으로 변경할 수 있습니다.
