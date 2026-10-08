# 설정 레퍼런스

## 탭 설정

`docs.config.ts`는 프로젝트 루트에 두세요. 경로는 설정 파일을 기준으로 해석합니다.

```ts
export default {
  title: '팀 문서',
  icon: { background: '#edf8ff', color: '#467792', border: '#bcdff8' },
  tabs: [
    { title: '정책서', dir: './pharma', slug: 'pharma' },
    { title: '프론트엔드', dir: './fe', slug: 'fe' },
    { title: '백엔드', dir: './be', slug: 'be' },
  ],
};
```

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

로컬 서버의 기본 포트는 4173입니다. `--port 4200`으로 변경할 수 있습니다.
