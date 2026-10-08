#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { init } from "../src/init.js";
import { build } from "../src/build.js";
import { dev } from "../src/dev.js";
import { prepareAi } from "../src/ai.js";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      port: { type: "string", default: "4173" },
      file: { type: "string" },
      instruction: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...extra] = positionals;
  if (values.version) console.log("0.1.0");
  else if (values.help || !command)
    console.log(
      `Safibook — 저장소 기반 문서 사이트\n\n  docs init                 설정과 스크립트 생성\n  docs dev [--port 4173]    로컬 미리보기 및 자동 갱신\n  docs build                .docs-dist 정적 사이트 생성\n  docs ai --file <문서.md> --instruction "변경 요청"\n                            표준 양식과 AI 작업 지침을 stdout으로 출력\n\n옵션: --config <파일> (dev/build/ai), --help, --version\n동일 명령: safibook <명령>`,
    );
  else {
    if (extra.length) throw new Error(`알 수 없는 인자: ${extra.join(" ")}`);
    if (command === "init") {
      if (values.config)
        throw new Error("init은 --config 옵션을 지원하지 않습니다.");
      await init(process.cwd());
    } else if (command === "build")
      console.log(
        `빌드 완료: ${await build(await loadConfig(process.cwd(), values.config))}`,
      );
    else if (command === "ai")
      console.log(
        await prepareAi(
          await loadConfig(process.cwd(), values.config),
          values.file,
          values.instruction,
        ),
      );
    else if (command === "dev") {
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("port는 1~65535 정수여야 합니다.");
      const running = await dev(process.cwd(), values.config, port);
      for (const signal of ["SIGINT", "SIGTERM"])
        process.once(signal, async () => {
          await running.close();
          process.exit(0);
        });
    } else throw new Error(`알 수 없는 명령: ${command}`);
  }
} catch (error) {
  console.error(`Safibook: ${error.message}`);
  process.exitCode = 1;
}
