# 설정 레퍼런스

## 탭 설정

`docs.config.ts`는 프로젝트 루트에 두세요. 경로는 설정 파일을 기준으로 해석합니다.

```ts
export default {
  title: '팀 문서',
  tabs: [
    { title: '정책서', dir: './pharma', slug: 'pharma' },
    { title: '프론트엔드', dir: './fe', slug: 'fe' },
    { title: '백엔드', dir: './be', slug: 'be' },
  ],
};
```

## CLI 명령

| 명령 | 설명 |
| --- | --- |
| `docs init` | 설정과 실행 스크립트 생성 |
| `docs dev` | 로컬 미리보기와 파일 변경 감지 |
| `docs build` | 정적 사이트 출력 |

로컬 서버의 기본 포트는 4173입니다. `--port 4200`으로 변경할 수 있습니다.
