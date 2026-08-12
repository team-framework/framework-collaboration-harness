import assert from "node:assert/strict";
import test from "node:test";
import { loadActivityConfig, loadConfig } from "../alerts/config.mjs";

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

const activityEnv = {
  DISCORD_BOT_TOKEN: "discord-token",
  GITHUB_ACTIVITY_REPOSITORIES: "team-framework/innolive-client,team-framework/framework-collaboration-harness",
  GITHUB_WEBHOOK_SECRET: "webhook-secret",
  DISCORD_ACTIVITY_CHANNELS_JSON: JSON.stringify({
    "team-framework/innolive-client": "123456789012345678",
    "team-framework/framework-collaboration-harness": "234567890123456789"
  })
};

test("실시간 GitHub 활동 설정을 지연 알림 설정과 별도로 읽어요", () => {
  const config = loadActivityConfig({ ...activityEnv, GITHUB_TOKEN: "read-only-token" });
  assert.deepEqual(config.repositories, [
    "team-framework/innolive-client",
    "team-framework/framework-collaboration-harness"
  ]);
  assert.equal(config.channels.get("team-framework/innolive-client"), "123456789012345678");
  assert.equal(config.githubToken, "read-only-token");
  assert.equal(config.webhookPort, 3006);
  assert.equal(config.webhookPath, "/github/webhooks");
});

test("활동 대상 저장소의 Discord 채널이 빠지면 거부해요", () => {
  assert.throws(() => loadActivityConfig({
    ...activityEnv,
    DISCORD_ACTIVITY_CHANNELS_JSON: '{"team-framework/innolive-client":"123456789012345678"}'
  }), /framework-collaboration-harness\.channelId/);
});
