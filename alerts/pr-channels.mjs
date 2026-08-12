import { discordApiRequest } from "./discord.mjs";

const TEXT_CHANNEL_TYPE = 0;
const TOPIC_MARKER_PREFIX = "framework-github-pr:";

function requirePullRequest(activity) {
  if (!activity.pullRequest?.number) throw new Error("PR 채널 활동에 pullRequest.number가 필요해요.");
  return activity.pullRequest;
}

export function pullRequestChannelKey(repository, number) {
  return `${repository}#${number}`;
}

export function pullRequestChannelName(repository, number) {
  const repositoryName = repository.split("/").at(-1) || "repository";
  const slug = repositoryName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "") || "repository";
  return `${slug}-pr-${number}`.slice(0, 100);
}

export function pullRequestChannelMarker(repository, number) {
  return `[${TOPIC_MARKER_PREFIX}${pullRequestChannelKey(repository, number)}]`;
}

export function pullRequestChannelTopic(activity) {
  const pullRequest = requirePullRequest(activity);
  const marker = pullRequestChannelMarker(activity.repository, pullRequest.number);
  return `${marker} ${pullRequest.title} · ${pullRequest.url} · 상태: ${pullRequest.state}`.slice(0, 1_024);
}

async function channelOrNull({ token, channelId, fetchImpl }) {
  try {
    return await discordApiRequest({ token, path: `/channels/${channelId}`, fetchImpl });
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

async function updateChannelTopic({ config, channel, activity, fetchImpl }) {
  const topic = pullRequestChannelTopic(activity);
  if (channel.topic === topic) return channel;
  return discordApiRequest({
    token: config.discordToken,
    path: `/channels/${channel.id}`,
    method: "PATCH",
    body: { topic },
    fetchImpl
  });
}

function rememberChannel(state, activity, channel) {
  const pullRequest = requirePullRequest(activity);
  const key = pullRequestChannelKey(activity.repository, pullRequest.number);
  state.prChannels ||= {};
  state.prChannels[key] = {
    channelId: channel.id,
    repository: activity.repository,
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    state: pullRequest.state
  };
  return channel.id;
}

export async function resolveActivityChannel({ config, activity, state, fetchImpl = fetch }) {
  if (!activity.pullRequest) {
    const channelId = config.channels.get(activity.repository);
    if (!channelId) throw new Error(`${activity.repository}의 Discord 활동 채널이 없어요.`);
    return channelId;
  }

  const pullRequest = requirePullRequest(activity);
  const key = pullRequestChannelKey(activity.repository, pullRequest.number);
  state.prChannels ||= {};
  const remembered = state.prChannels[key];
  if (remembered?.channelId) {
    const channel = await channelOrNull({ token: config.discordToken, channelId: remembered.channelId, fetchImpl });
    if (channel) {
      const updated = await updateChannelTopic({ config, channel, activity, fetchImpl });
      return rememberChannel(state, activity, updated);
    }
    delete state.prChannels[key];
  }

  const repositoryChannelId = config.channels.get(activity.repository);
  if (!repositoryChannelId) throw new Error(`${activity.repository}의 Discord 활동 채널이 없어요.`);
  const repositoryChannel = await discordApiRequest({
    token: config.discordToken,
    path: `/channels/${repositoryChannelId}`,
    fetchImpl
  });
  const channels = await discordApiRequest({
    token: config.discordToken,
    path: `/guilds/${repositoryChannel.guild_id}/channels`,
    fetchImpl
  });
  const marker = pullRequestChannelMarker(activity.repository, pullRequest.number);
  const discovered = channels.find((channel) => channel.type === TEXT_CHANNEL_TYPE && channel.parent_id === repositoryChannel.parent_id && channel.topic?.includes(marker));
  if (discovered) {
    const updated = await updateChannelTopic({ config, channel: discovered, activity, fetchImpl });
    return rememberChannel(state, activity, updated);
  }

  if (pullRequest.state === "closed" && !pullRequest.terminal) return null;

  const channel = await discordApiRequest({
    token: config.discordToken,
    path: `/guilds/${repositoryChannel.guild_id}/channels`,
    method: "POST",
    body: {
      name: pullRequestChannelName(activity.repository, pullRequest.number),
      type: TEXT_CHANNEL_TYPE,
      parent_id: repositoryChannel.parent_id,
      topic: pullRequestChannelTopic(activity)
    },
    fetchImpl
  });
  return rememberChannel(state, activity, channel);
}
