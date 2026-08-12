import { createActivityDeliveryQueue } from "./activity-delivery-queue.mjs";
import { loadActivityConfig } from "./config.mjs";
import { ACTIVITY_COLORS, formatGitHubActivity } from "./github-activity.mjs";

const GITHUB_API_URL = "https://api.github.com";
const PAGE_SIZE = 100;
const DISCORD_SYNC_INTERVAL_MILLISECONDS = 1_100;

function required(value, name) {
  const text = value?.trim();
  if (!text) throw new Error(`${name} 환경변수가 필요해요.`);
  return text;
}

function clean(value) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

function truncate(value, maximum) {
  const text = clean(value);
  if (text.length <= maximum) return text;
  return `${text.slice(0, maximum - 1).trimEnd()}…`;
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function githubPage({ token, path, page, fetchImpl }) {
  const url = new URL(path, `${GITHUB_API_URL}/`);
  url.searchParams.set("per_page", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  const response = await fetchImpl(url, { headers: githubHeaders(token) });
  if (!response.ok) throw new Error(`GitHub PR 기록 조회에 실패했어요: ${response.status}`);
  const result = await response.json();
  if (!Array.isArray(result)) throw new Error("GitHub PR 기록 응답이 배열이 아니에요.");
  return result;
}

async function githubAll({ token, path, fetchImpl }) {
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const current = await githubPage({ token, path, page, fetchImpl });
    items.push(...current);
    if (current.length < PAGE_SIZE) return items;
  }
  throw new Error("GitHub PR 기록이 10,000개를 넘어 동기화를 중단했어요.");
}

function repositoryPayload(repository) {
  return { full_name: repository, html_url: `https://github.com/${repository}` };
}

function pullRequestPayload({ repository, pullRequest, sender, action, extra = {} }) {
  return {
    action,
    repository: repositoryPayload(repository),
    sender: sender || pullRequest.user,
    pull_request: pullRequest,
    ...extra
  };
}

function pullRequestCommitActivity({ repository, pullRequest, commit }) {
  const actor = clean(commit.author?.login || commit.commit?.author?.name || pullRequest.user?.login || "github");
  const sha = clean(commit.sha);
  const message = truncate(commit.commit?.message?.split("\n")[0], 500) || "커밋 메시지가 없어요.";
  return {
    repository,
    actor,
    event: "pull_request_commit",
    action: "created",
    summary: truncate(`${actor} · PR: ${pullRequest.title} · 커밋을 추가했어요`, 256),
    detail: `\`${sha.slice(0, 7)}\` ${message}`,
    url: commit.html_url || `${pullRequest.html_url}/commits/${sha}`,
    color: ACTIVITY_COLORS.synchronized,
    occurredAt: commit.commit?.author?.date || commit.commit?.committer?.date || null,
    pullRequest: {
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.html_url,
      state: pullRequest.state,
      merged: false,
      terminal: false
    }
  };
}

function historyItem(id, activity) {
  return { id, activity, occurredAt: activity.occurredAt || "1970-01-01T00:00:00.000Z" };
}

async function pullRequestHistory({ token, repository, pullRequest, fetchImpl }) {
  const [commits, issueComments, reviews, reviewComments] = await Promise.all([
    githubAll({ token, path: `repos/${repository}/pulls/${pullRequest.number}/commits`, fetchImpl }),
    githubAll({ token, path: `repos/${repository}/issues/${pullRequest.number}/comments`, fetchImpl }),
    githubAll({ token, path: `repos/${repository}/pulls/${pullRequest.number}/reviews`, fetchImpl }),
    githubAll({ token, path: `repos/${repository}/pulls/${pullRequest.number}/comments`, fetchImpl })
  ]);
  const prefix = `open-pr-sync:${repository}#${pullRequest.number}`;
  const items = [historyItem(
    `${prefix}:opened:${pullRequest.id}`,
    formatGitHubActivity("pull_request", pullRequestPayload({ repository, pullRequest, action: "opened" }))
  )];

  for (const commit of commits) {
    items.push(historyItem(`${prefix}:commit:${commit.sha}`, pullRequestCommitActivity({ repository, pullRequest, commit })));
  }
  for (const comment of issueComments) {
    items.push(historyItem(`${prefix}:issue-comment:${comment.id}`, formatGitHubActivity("issue_comment", {
      action: "created",
      repository: repositoryPayload(repository),
      sender: comment.user,
      issue: { ...pullRequest, pull_request: { url: pullRequest.url } },
      comment
    })));
  }
  for (const review of reviews.filter((review) => {
    const state = clean(review.state).toLowerCase();
    return state !== "pending" && !(state === "commented" && !clean(review.body));
  })) {
    items.push(historyItem(`${prefix}:review:${review.id}`, formatGitHubActivity("pull_request_review", pullRequestPayload({
      repository,
      pullRequest,
      sender: review.user,
      action: "submitted",
      extra: { review }
    }))));
  }
  for (const comment of reviewComments) {
    items.push(historyItem(`${prefix}:review-comment:${comment.id}`, formatGitHubActivity("pull_request_review_comment", pullRequestPayload({
      repository,
      pullRequest,
      sender: comment.user,
      action: "created",
      extra: { comment }
    }))));
  }
  const [opened, ...history] = items;
  history.sort((left, right) => new Date(left.occurredAt) - new Date(right.occurredAt) || left.id.localeCompare(right.id));
  return [opened, ...history];
}

export async function collectOpenPullRequestHistory({ token, repositories, fetchImpl = fetch }) {
  const githubToken = required(token, "GITHUB_TOKEN");
  const pullRequests = [];
  const items = [];
  for (const repository of repositories) {
    const repositoryPullRequests = await githubAll({
      token: githubToken,
      path: `repos/${repository}/pulls?state=open&sort=created&direction=asc`,
      fetchImpl
    });
    for (const pullRequest of repositoryPullRequests) {
      pullRequests.push({ repository, number: pullRequest.number, title: pullRequest.title, url: pullRequest.html_url });
      items.push(...await pullRequestHistory({ token: githubToken, repository, pullRequest, fetchImpl }));
    }
  }
  return { pullRequests, items };
}

export async function syncOpenPullRequests({
  config,
  fetchImpl = fetch,
  deliveryQueue,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
} = {}) {
  const { pullRequests, items } = await collectOpenPullRequestHistory({
    token: config.githubToken,
    repositories: config.repositories,
    fetchImpl
  });
  const queue = deliveryQueue || createActivityDeliveryQueue({ config, fetchImpl });
  let accepted = 0;
  let duplicates = 0;
  for (const item of items) {
    const result = await queue.enqueue({ deliveryId: item.id, activity: item.activity });
    if (result === "accepted") accepted += 1;
    else duplicates += 1;
    await queue.drain();
    if (result === "accepted") await wait(DISCORD_SYNC_INTERVAL_MILLISECONDS);
  }
  return { pullRequests: pullRequests.length, activities: items.length, accepted, duplicates };
}

if (import.meta.main) {
  const result = await syncOpenPullRequests({ config: loadActivityConfig(process.env) });
  console.log(`Open PR ${result.pullRequests}개에서 활동 ${result.activities}개를 동기화했어요. 새 전송 ${result.accepted}개, 중복 ${result.duplicates}개.`);
}
