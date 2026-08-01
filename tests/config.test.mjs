import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../alerts/config.mjs";

const env = {
  GITHUB_TOKEN: "github-token",
  DISCORD_BOT_TOKEN: "discord-token",
  TARGET_REPOSITORIES: "team-framework/innolive-client, team-framework/innolive-server",
  DISCORD_RECIPIENTS_JSON: '[{"github":"chaeyn","userId":"123456789012345678","channelId":"234567890123456789"}]'
};

test("환경변수에서 수신자와 대상 저장소를 읽어요", () => {
  const config = loadConfig(env);
  assert.deepEqual(config.repositories, ["team-framework/innolive-client", "team-framework/innolive-server"]);
  assert.equal(config.recipients.get("chaeyn").channelId, "234567890123456789");
});

test("잘못된 Discord 수신자 ID는 거부해요", () => {
  assert.throws(() => loadConfig({ ...env, DISCORD_RECIPIENTS_JSON: '[{"github":"chaeyn","userId":"wrong","channelId":"234567890123456789"}]' }), /Discord ID/);
});
