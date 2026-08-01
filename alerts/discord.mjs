const API_BASE_URL = "https://discord.com/api/v10";

function requireValue(value, name) {
  if (!value?.trim()) throw new Error(`${name} 환경변수가 필요해요.`);
  return value.trim();
}

export function requireSnowflake(value, name) {
  const id = requireValue(value, name);
  if (!/^\d{17,20}$/.test(id)) throw new Error(`${name}은 Discord ID여야 해요.`);
  return id;
}

export function personalNotificationPayload({ userId, message }) {
  const recipient = requireSnowflake(userId, "DISCORD_USER_ID");
  const text = requireValue(message, "message");
  return {
    content: `<@${recipient}> ${text}`,
    allowed_mentions: { parse: [], users: [recipient] }
  };
}

export function teamSummaryPayload({ roleId, message }) {
  const role = requireSnowflake(roleId, "DISCORD_TEAM_ROLE_ID");
  const text = requireValue(message, "message");
  return {
    content: `<@&${role}> ${text}`,
    allowed_mentions: { parse: [], roles: [role] }
  };
}

export async function sendDiscordMessage({ token, channelId, payload, fetchImpl = fetch }) {
  const botToken = requireValue(token, "DISCORD_BOT_TOKEN");
  const channel = requireSnowflake(channelId, "DISCORD_CHANNEL_ID");
  const response = await fetchImpl(`${API_BASE_URL}/channels/${channel}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Discord 메시지 전송에 실패했어요: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

export async function sendPersonalNotification({ token, channelId, userId, message, fetchImpl }) {
  return sendDiscordMessage({
    token,
    channelId,
    payload: personalNotificationPayload({ userId, message }),
    fetchImpl
  });
}
