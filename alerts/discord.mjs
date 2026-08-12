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

export function activityNotificationPayload({ repository, actor, event, summary, detail, url }) {
  const title = requireValue(summary, "summary");
  const targetUrl = requireValue(url, "url");
  return {
    embeds: [{
      color: 0x24292f,
      author: {
        name: `${requireValue(repository, "repository")} · ${requireValue(actor, "actor")}`,
        url: `https://github.com/${encodeURIComponent(actor)}`
      },
      title,
      url: targetUrl,
      ...(detail ? { description: detail } : {}),
      footer: { text: `GitHub · ${requireValue(event, "event")}` }
    }],
    allowed_mentions: { parse: [] }
  };
}

export async function discordApiRequest({ token, path, method = "GET", body, fetchImpl = fetch }) {
  const botToken = requireValue(token, "DISCORD_BOT_TOKEN");
  const response = await fetchImpl(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  if (!response.ok) {
    throw new Error(`Discord API 요청에 실패했어요: ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function sendDiscordMessage({ token, channelId, payload, fetchImpl = fetch }) {
  const channel = requireSnowflake(channelId, "DISCORD_CHANNEL_ID");
  return discordApiRequest({
    token,
    path: `/channels/${channel}/messages`,
    method: "POST",
    body: payload,
    fetchImpl
  });
}

export async function sendInteractionCallback({ interactionId, interactionToken, payload, fetchImpl = fetch }) {
  const id = requireSnowflake(interactionId, "DISCORD_INTERACTION_ID");
  const token = requireValue(interactionToken, "DISCORD_INTERACTION_TOKEN");
  const response = await fetchImpl(`${API_BASE_URL}/interactions/${id}/${token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Discord 명령 응답에 실패했어요: ${response.status}`);
  }
  return null;
}

export async function editInteractionResponse({ applicationId, interactionToken, content, fetchImpl = fetch }) {
  const application = requireSnowflake(applicationId, "DISCORD_APPLICATION_ID");
  const token = requireValue(interactionToken, "DISCORD_INTERACTION_TOKEN");
  const response = await fetchImpl(`${API_BASE_URL}/webhooks/${application}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: requireValue(content, "content"), allowed_mentions: { parse: [] } })
  });
  if (!response.ok) throw new Error(`Discord 명령 결과 수정에 실패했어요: ${response.status}`);
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
