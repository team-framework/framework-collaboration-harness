import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_COLORS, formatGitHubActivity, shouldDeliverGitHubActivity } from "../alerts/github-activity.mjs";

function basePayload() {
  return {
    action: "created",
    repository: {
      full_name: "team-framework/innolive-client",
      html_url: "https://github.com/team-framework/innolive-client"
    },
    sender: { login: "chaeyn" }
  };
}

test("PR 일반 댓글을 issue_comment 단위로 만들어요", () => {
  const activity = formatGitHubActivity("issue_comment", {
    ...basePayload(),
    issue: {
      number: 10,
      title: "feat: 실시간 방송 추가",
      body: "실시간 방송 송출과 시청 흐름을 추가합니다.",
      html_url: "https://github.com/team-framework/innolive-client/pull/10",
      pull_request: { url: "https://api.github.com/pulls/10" }
    },
    comment: {
      body: "@everyone 이 부분을 확인해 주세요.",
      html_url: "https://github.com/team-framework/innolive-client/pull/10#issuecomment-1"
    }
  });

  assert.equal(activity.repository, "team-framework/innolive-client");
  assert.equal(activity.actor, "chaeyn");
  assert.match(activity.summary, /chaeyn · PR: feat: 실시간 방송 추가 · 일반 댓글/);
  assert.doesNotMatch(activity.summary, /PR #10/);
  assert.doesNotMatch(activity.detail, /실시간 방송 송출과 시청 흐름을 추가합니다/);
  assert.match(activity.detail, /@everyone/);
  assert.match(activity.url, /issuecomment-1$/);
  assert.equal(activity.color, ACTIVITY_COLORS.comment);
  assert.deepEqual(activity.pullRequest, {
    number: 10,
    title: "feat: 실시간 방송 추가",
    url: "https://github.com/team-framework/innolive-client/pull/10",
    state: "open",
    merged: false,
    terminal: false
  });
});

test("PR 활동 제목에 작업자와 PR명을, 설명에 PR 본문을 넣어요", () => {
  const activity = formatGitHubActivity("pull_request", {
    ...basePayload(),
    action: "opened",
    pull_request: {
      number: 11,
      title: "feat: 방송 대기실 추가",
      body: "방송 전 카메라와 마이크를 확인하는 대기실을 추가합니다.",
      html_url: "https://github.com/team-framework/innolive-client/pull/11"
    }
  });

  assert.equal(activity.summary, "chaeyn · PR: feat: 방송 대기실 추가 · 열었어요");
  assert.doesNotMatch(activity.summary, /PR #11/);
  assert.match(activity.detail, /PR 본문.*방송 전 카메라와 마이크를 확인하는 대기실을 추가합니다/s);
});

test("PR 코드 라인 댓글에 파일과 줄 번호를 넣어요", () => {
  const activity = formatGitHubActivity("pull_request_review_comment", {
    ...basePayload(),
    pull_request: {
      number: 20,
      title: "fix: 연결 복구",
      body: "네트워크가 변경되면 WebRTC 연결을 복구합니다.",
      html_url: "https://github.com/team-framework/innolive-client/pull/20"
    },
    comment: {
      path: "apps/web/src/connect.ts",
      line: 42,
      body: "이 조건에서는 early return이 필요해요.",
      html_url: "https://github.com/team-framework/innolive-client/pull/20#discussion_r1"
    }
  });

  assert.match(activity.summary, /chaeyn · PR: fix: 연결 복구/);
  assert.match(activity.summary, /코드 라인 댓글/);
  assert.doesNotMatch(activity.detail, /WebRTC 연결을 복구합니다/);
  assert.match(activity.detail, /apps\/web\/src\/connect\.ts:42/);
  assert.match(activity.detail, /early return/);
});

test("PR 리뷰 승인과 리뷰 스레드 해결을 구분해요", () => {
  const pullRequest = {
    number: 30,
    title: "feat: OAuth 추가",
    body: "Google OAuth 로그인을 연결합니다.",
    html_url: "https://github.com/team-framework/innolive-client/pull/30"
  };
  const review = formatGitHubActivity("pull_request_review", {
    ...basePayload(),
    action: "submitted",
    pull_request: pullRequest,
    review: { state: "approved", body: "좋습니다.", html_url: `${pullRequest.html_url}#pullrequestreview-1` }
  });
  const thread = formatGitHubActivity("pull_request_review_thread", {
    ...basePayload(),
    action: "resolved",
    pull_request: pullRequest,
    thread: { comments: [{ path: "Auth.swift", line: 7, html_url: `${pullRequest.html_url}#discussion_r2` }] }
  });

  assert.match(review.summary, /chaeyn · PR: feat: OAuth 추가/);
  assert.match(review.summary, /승인 리뷰를 남겼어요/);
  assert.equal(review.detail, null);
  assert.equal(review.color, ACTIVITY_COLORS.approved);
  assert.match(thread.summary, /리뷰 스레드를 해결했어요/);
  assert.doesNotMatch(thread.detail, /Google OAuth 로그인을 연결합니다/);
  assert.match(thread.detail, /Auth\.swift:7/);
});

test("승인 리뷰는 상태만, Request Changes는 내용까지 표시해요", () => {
  const pullRequest = {
    number: 31,
    title: "fix: 방송 종료 처리",
    body: "방송 종료 상태를 정리합니다.",
    html_url: "https://github.com/team-framework/innolive-client/pull/31"
  };
  const requestedChanges = formatGitHubActivity("pull_request_review", {
    ...basePayload(),
    action: "submitted",
    pull_request: pullRequest,
    review: { state: "changes_requested", body: "종료 후 세션 정리도 추가해 주세요.", html_url: `${pullRequest.html_url}#pullrequestreview-2` }
  });
  const emptyCommentReview = formatGitHubActivity("pull_request_review", {
    ...basePayload(),
    action: "submitted",
    pull_request: pullRequest,
    review: { state: "commented", body: null, html_url: `${pullRequest.html_url}#pullrequestreview-3` }
  });
  const dismissedReview = formatGitHubActivity("pull_request_review", {
    ...basePayload(),
    action: "dismissed",
    pull_request: pullRequest,
    review: { state: "changes_requested", body: "취소된 민감 리뷰", html_url: `${pullRequest.html_url}#pullrequestreview-4` }
  });

  assert.match(requestedChanges.summary, /변경을 요청했어요/);
  assert.match(requestedChanges.detail, /변경 요청 내용.*종료 후 세션 정리도 추가해 주세요/s);
  assert.doesNotMatch(requestedChanges.detail, /방송 종료 상태를 정리합니다/);
  assert.equal(requestedChanges.color, ACTIVITY_COLORS.changesRequested);
  assert.match(emptyCommentReview.detail, /리뷰 내용.*작성된 리뷰 내용이 없어요/s);
  assert.equal(dismissedReview.detail, null);
});

test("병합과 Close 활동을 구분하고 PR 채널 종료 대상으로 표시해요", () => {
  const pullRequest = {
    number: 50,
    title: "feat: 방송 통계 추가",
    body: "방송 통계를 추가합니다.",
    state: "closed",
    html_url: "https://github.com/team-framework/innolive-client/pull/50"
  };
  const merged = formatGitHubActivity("pull_request", {
    ...basePayload(),
    action: "closed",
    pull_request: { ...pullRequest, merged: true }
  });
  const closed = formatGitHubActivity("pull_request", {
    ...basePayload(),
    action: "closed",
    pull_request: { ...pullRequest, merged: false }
  });

  assert.match(merged.summary, /병합했어요/);
  assert.equal(merged.color, ACTIVITY_COLORS.merged);
  assert.equal(merged.pullRequest.terminal, true);
  assert.equal(merged.pullRequest.merged, true);
  assert.match(closed.summary, /종료했어요/);
  assert.equal(closed.color, ACTIVITY_COLORS.closed);
  assert.equal(closed.pullRequest.terminal, true);
});

test("삭제된 댓글의 본문은 Discord에 다시 보존하지 않아요", () => {
  const activity = formatGitHubActivity("issue_comment", {
    ...basePayload(),
    action: "deleted",
    issue: { number: 40, title: "fix: 비밀 제거", html_url: "https://github.com/team-framework/innolive-client/issues/40" },
    comment: { body: "삭제된 민감 정보", html_url: "https://github.com/team-framework/innolive-client/issues/40" }
  });

  assert.doesNotMatch(activity.detail, /민감 정보/);
  assert.match(activity.summary, /삭제했어요/);
});

test("push에 포함된 커밋을 한 활동 메시지에 표시해요", () => {
  const activity = formatGitHubActivity("push", {
    ...basePayload(),
    ref: "refs/heads/main",
    after: "1234567890abcdef",
    compare: "https://github.com/team-framework/innolive-client/compare/a...b",
    commits: [
      { id: "1234567890abcdef", message: "feat: 방송 추가\n\n본문" },
      { id: "abcdef1234567890", message: "test: 방송 테스트 추가" }
    ]
  });

  assert.match(activity.summary, /main.*2개 커밋/);
  assert.match(activity.detail, /1234567.*feat: 방송 추가/);
  assert.match(activity.detail, /abcdef1.*test: 방송 테스트 추가/);
});

test("새 webhook 이벤트도 안전한 기본 메시지로 전달해요", () => {
  const activity = formatGitHubActivity("future_event", { ...basePayload(), action: "changed" });
  assert.match(activity.summary, /future_event/);
  assert.equal(activity.url, "https://github.com/team-framework/innolive-client");
});

test("check_run은 알림을 보내지 않고 Deploy Discord Bot의 성공·실패만 Actions 알림으로 보내요", () => {
  assert.equal(shouldDeliverGitHubActivity("check_run", { ...basePayload(), check_run: { name: "Check deploy" } }), false);
  assert.equal(shouldDeliverGitHubActivity("workflow_job", { ...basePayload(), workflow_job: { name: "deploy", conclusion: "success" } }), false);
  assert.equal(shouldDeliverGitHubActivity("workflow_run", { ...basePayload(), workflow_run: { name: "Deploy Discord Bot", conclusion: "queued" } }), false);
  assert.equal(shouldDeliverGitHubActivity("workflow_run", { ...basePayload(), workflow_run: { name: "Deploy Discord Bot", conclusion: "success" } }), true);
  assert.equal(shouldDeliverGitHubActivity("workflow_run", { ...basePayload(), workflow_run: { name: "Deploy Discord Bot", conclusion: "failure" } }), true);
  assert.equal(shouldDeliverGitHubActivity("workflow_run", { ...basePayload(), workflow_run: { name: "Other workflow", conclusion: "failure" } }), false);
});

test("선택한 저장소 이벤트에 전용 요약을 만들어요", () => {
  const fork = formatGitHubActivity("fork", {
    ...basePayload(),
    forkee: {
      full_name: "chaeyn/innolive-client",
      html_url: "https://github.com/chaeyn/innolive-client"
    }
  });
  const wiki = formatGitHubActivity("gollum", {
    ...basePayload(),
    pages: [{ page_name: "운영-가이드", action: "edited", html_url: "https://github.com/team-framework/innolive-client/wiki/운영-가이드" }]
  });

  assert.match(fork.summary, /chaeyn\/innolive-client.*fork/);
  assert.match(wiki.summary, /Wiki 페이지 1개/);
  assert.match(wiki.detail, /운영-가이드/);
});
