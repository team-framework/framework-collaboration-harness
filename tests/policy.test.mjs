import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAlerts } from "../alerts/policy.mjs";

const now = new Date("2026-08-01T12:00:00.000Z");
const issue = {
  repository: "team-framework/innolive-client",
  number: 10,
  url: "https://example.test/issues/10",
  assignees: ["chaeyn"],
  assignedAt: "2026-08-01T06:00:00.000Z"
};

test("할당 뒤 5시간 동안 브랜치가 없으면 담당자에게 알려요", () => {
  const alerts = evaluateAlerts({ now, issues: [issue], branches: [], pullRequests: [] });
  assert.equal(alerts[0].kind, "issue-no-branch");
  assert.deepEqual(alerts[0].recipients, ["chaeyn"]);
});

test("브랜치와 PR의 방치 상태를 각각 판별해요", () => {
  const alerts = evaluateAlerts({
    now,
    issues: [],
    branches: [
      {
        key: "team-framework/innolive-client:feat/example/#10",
        repository: "team-framework/innolive-client",
        name: "feat/example/#10",
        issueNumber: 10,
        assignees: ["chaeyn"],
        commitsAhead: 0,
        firstObservedAt: "2026-08-01T01:00:00.000Z",
        url: "https://example.test/tree"
      },
      {
        key: "team-framework/innolive-client:fix/example/#11",
        repository: "team-framework/innolive-client",
        name: "fix/example/#11",
        issueNumber: 11,
        assignees: ["chaeyn"],
        commitsAhead: 1,
        lastCommitAt: "2026-07-31T11:00:00.000Z",
        url: "https://example.test/tree"
      }
    ],
    pullRequests: []
  });
  assert.deepEqual(alerts.map((item) => item.kind), ["branch-no-commit", "branch-stalled"]);
});

test("Open PR의 리뷰·승인·변경 요청 방치를 판별해요", () => {
  const base = {
    repository: "team-framework/innolive-client",
    number: 20,
    url: "https://example.test/pull/20",
    author: "chaeyn",
    headRef: "feat/example/#20",
    isDraft: false,
    createdAt: "2026-08-01T09:00:00.000Z",
    reviewers: [],
    lastReviewRequestAt: null,
    lastReviewAt: null,
    lastApprovalAt: null,
    lastChangesRequestedAt: null,
    lastCommitAt: null
  };
  const noReviewer = evaluateAlerts({ now, issues: [], branches: [], pullRequests: [base] });
  assert.deepEqual(noReviewer, []);

  const waiting = evaluateAlerts({
    now,
    issues: [],
    branches: [],
    pullRequests: [{
      ...base,
      reviewers: ["jdw09"],
      lastReviewRequestAt: "2026-08-01T06:00:00.000Z",
      lastApprovalAt: "2026-08-01T10:00:00.000Z",
      lastChangesRequestedAt: "2026-08-01T06:00:00.000Z"
    }]
  });
  assert.deepEqual(waiting.map((item) => item.kind), ["pr-review-waiting", "pr-approved-not-merged", "pr-changes-not-updated"]);
});
