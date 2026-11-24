import { saveDeploymentState } from "./deploy-state.js";
import { terminalPrompts } from "./deploy-setup.js";

export async function setupAssistant(config, { prompt, log = console.log } = {}) {
  const state = config.deploymentState;
  if (!state?.ready) throw new Error("먼저 npx doxen deploy로 비공개 사이트를 배포하세요. 수동 배포 설정은 README를 확인하세요.");
  log("Workers AI 무료 한도는 Workers Free 플랜에서만 초과 요청을 차단합니다. 유료 플랜으로 바꾸면 추가 과금될 수 있습니다. 문서 일부와 질문이 Cloudflare Workers AI로 전송됩니다.");
  const ui = prompt || await terminalPrompts();
  if (!await ui.confirm({ message: "이 Cloudflare 계정이 Workers Free 플랜이며 계속 무료 플랜을 유지할 것을 확인했나요?", default: false }))
    throw new Error("설정하지 않았습니다. Workers Free 플랜을 확인하세요.");
  await saveDeploymentState(config.root, { ...state, workersAiFree: true });
  log("설정을 저장했습니다. npx doxen deploy로 다시 배포하세요. 계정 플랜은 자동으로 확인하거나 변경하지 않습니다.");
}
