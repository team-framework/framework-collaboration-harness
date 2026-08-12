import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_COLORS } from "../alerts/github-activity.mjs";
import { collectOpenPullRequestHistory, syncOpenPullRequests } from "../alerts/sync-open-prs.mjs";

const repository = "team-framework/framework-collaboration-harness";
const pullRequest = {
  id: 300,
  number: 3,
  title: "feat: PR별 Discord 채널",
  body: "PR별 채널을 추가합니다.",
  state: "open",
  html_url: `https://github.com/${repository}/pull/3`,
  url: `https://api.github.com/repos/${repository}/pulls/3`,
  user: { login: "chaeyn" },
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:05:00Z"
};

function githubFetch(url) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  let result;
  if (path === `/repos/${repository}/pulls`) result = [pullRequest];
  else if (path === `/repos/${repository}/pulls/3/commits`) result = [{
    sha: "1234567890abcdef",
    html_url: `${pullRequest.html_url}/commits/1234567890abcdef`,
    author: { login: "chaeyn" },
    commit: { message: "feat: 채널 생성", author: { date: "2026-08-12T00:01:00Z" } }
  }];
  else if (path === `/repos/${repository}/issues/3/comments`) result = [{
    id: 401,
    body: "일반 댓글입니다.",
    html_url: `${pullRequest.html_url}#issuecomment-401`,
    user: { login: "reviewer" },
    created_at: "2026-08-12T00:02:00Z"
  }];
  else if (path === `/repos/${repository}/pulls/3/reviews`) result = [{
    id: 501,
    state: "APPROVED",
    body: "좋습니다.",
    html_url: `${pullRequest.html_url}#pullrequestreview-501`,
    user: { login: "approver" },
    submitted_at: "2026-08-12T00:03:00Z"
  }, {
    id: 502,
    state: "CHANGES_REQUESTED",
    body: "오류 처리를 추가해 주세요.",
    html_url: `${pullRequest.html_url}#pullrequestreview-502`,
    user: { login: "reviewer" },
    submitted_at: "2026-08-12T00:04:00Z"
  }];
  else if (path === `/repos/${repository}/pulls/3/comments`) result = [{
    id: 601,
    body: "이 줄을 확인해 주세요.",
    path: "alerts/webhook-server.mjs",
    line: 42,
    html_url: `${pullRequest.html_url}#discussion_r601`,
    user: { login: "reviewer" },
    created_at: "2026-08-12T00:05:00Z"
  }];
  else throw new Error(`예상하지 않은 GitHub 요청: ${url}`);
  return Promise.resolve({ ok: true, json: async () => result });
}

test("현재 Open PR의 생성, 커밋, 댓글, 리뷰, 코드 라인 댓글을 시간순으로 수집해요", async () => {
  const result = await collectOpenPullRequestHistory({ token: "read-only-token", repositories: [repository], fetchImpl: githubFetch });

  assert.equal(result.pullRequests.length, 1);
  assert.equal(result.items.length, 6);
  assert.match(result.items[0].id, /opened/);
  assert.deepEqual(result.items.slice(1).map((item) => item.activity.event), [
    "pull_request_commit",
    "issue_comment",
    "pull_request_review",
    "pull_request_review",
    "pull_request_review_comment"
  ]);
  const approval = result.items.find((item) => item.activity.color === ACTIVITY_COLORS.approved).activity;
  const changesRequested = result.items.find((item) => item.activity.color === ACTIVITY_COLORS.changesRequested).activity;
  assert.equal(approval.detail, null);
  assert.match(changesRequested.detail, /오류 처리를 추가해 주세요/);
  assert.doesNotMatch(changesRequested.detail, /PR별 채널을 추가합니다/);
});

test("동기화 기록을 재실행 가능한 고정 delivery ID로 큐에 넣어요", async () => {
  const enqueued = [];
  let drains = 0;
  const result = await syncOpenPullRequests({
    config: { githubToken: "read-only-token", repositories: [repository] },
    fetchImpl: githubFetch,
    deliveryQueue: {
      async enqueue(item) { enqueued.push(item); return "accepted"; },
      async drain() { drains += 1; }
    },
    wait: async () => {}
  });

  assert.deepEqual(result, { pullRequests: 1, activities: 6, accepted: 6, duplicates: 0 });
  assert.equal(drains, 6);
  assert.equal(new Set(enqueued.map((item) => item.deliveryId)).size, 6);
  assert.ok(enqueued.every((item) => item.deliveryId.startsWith(`open-pr-sync:${repository}#3:`)));
});
