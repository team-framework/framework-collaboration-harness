import {
  CLOSE_PR_CHANNEL_CUSTOM_ID,
  discordApiRequest,
  editInteractionResponse,
  sendInteractionCallback
} from "./discord.mjs";

const ADMINISTRATOR_PERMISSION = 1n << 3n;
const MANAGE_CHANNELS_PERMISSION = 1n << 4n;
const MANAGED_CHANNEL_TOPIC_PREFIX = "[framework-github-pr:";

export function canClosePullRequestChannel(interaction) {
  try {
    const permissions = BigInt(interaction.member?.permissions || "0");
    return Boolean(permissions & (ADMINISTRATOR_PERMISSION | MANAGE_CHANNELS_PERMISSION));
  } catch {
    return false;
  }
}

async function respondEphemeral({ interaction, content, fetchImpl }) {
  return sendInteractionCallback({
    interactionId: interaction.id,
    interactionToken: interaction.token,
    payload: { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } },
    fetchImpl
  });
}

export async function handlePullRequestChannelInteraction({
  interaction,
  token,
  fetchImpl = fetch,
  logger = console
}) {
  if (interaction.type !== 3 || interaction.data?.custom_id !== CLOSE_PR_CHANNEL_CUSTOM_ID) return false;

  if (!canClosePullRequestChannel(interaction)) {
    await respondEphemeral({ interaction, content: "채널 관리 권한이 있는 사용자만 PR 채널을 닫을 수 있어요.", fetchImpl });
    return true;
  }

  let acknowledged = false;
  try {
    const channel = await discordApiRequest({ token, path: `/channels/${interaction.channel_id}`, fetchImpl });
    const managed = channel.topic?.startsWith(MANAGED_CHANNEL_TOPIC_PREFIX);
    const closed = channel.topic?.includes("· 상태: closed");
    if (!managed || !closed) {
      await respondEphemeral({ interaction, content: "닫힘 또는 병합 상태인 GitHub PR 채널만 삭제할 수 있어요.", fetchImpl });
      return true;
    }

    await respondEphemeral({ interaction, content: "PR 채널을 닫고 있어요.", fetchImpl });
    acknowledged = true;
    await discordApiRequest({ token, path: `/channels/${interaction.channel_id}`, method: "DELETE", fetchImpl });
  } catch (error) {
    logger.error(`PR 채널 삭제에 실패했어요: ${error.message}`);
    if (acknowledged) {
      await editInteractionResponse({
        applicationId: interaction.application_id,
        interactionToken: interaction.token,
        content: "PR 채널을 삭제하지 못했어요. 봇의 채널 관리 권한을 확인해 주세요.",
        fetchImpl
      });
    } else {
      await respondEphemeral({ interaction, content: "PR 채널을 삭제하지 못했어요.", fetchImpl });
    }
  }
  return true;
}
