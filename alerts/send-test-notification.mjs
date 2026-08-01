import { loadConfig } from "./config.mjs";
import { personalNotificationPayload, sendDiscordMessage } from "./discord.mjs";

const config = loadConfig(process.env);
const github = process.env.TEST_GITHUB_USER?.trim() || config.recipients.keys().next().value;
const recipient = config.recipients.get(github);
if (!recipient) throw new Error("TEST_GITHUB_USER에 해당하는 Discord 수신자가 없어요.");

const result = await sendDiscordMessage({
  token: config.discordToken,
  channelId: recipient.channelId,
  payload: personalNotificationPayload({
    userId: recipient.userId,
    message: "Framework Bot 테스트 알림이에요. 개인 채널과 멘션이 정상인지 확인해 주세요."
  })
});
console.log(`Discord 테스트 알림을 전송했어요. messageId: ${result.id}`);
