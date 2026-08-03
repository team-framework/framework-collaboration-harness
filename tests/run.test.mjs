import assert from "node:assert/strict";
import test from "node:test";
import { dailySummary } from "../alerts/run.mjs";

test("일일 요약에 Open PR, 방치 이슈, 막힌 작업의 GitHub 링크를 넣어요", () => {
  const message = dailySummary({
    now: new Date("2026-08-03T00:00:00.000Z"),
    pullRequests: [{
      repository: "team-framework/innolive-client",
      number: 50,
      title: "fix: 알림 링크 추가/#50",
      url: "https://github.com/team-framework/innolive-client/pull/50",
      isDraft: false
    }],
    issues: [
      {
        repository: "team-framework/innolive-server",
        number: 69,
        title: "feat: 팀 요약 개선",
        url: "https://github.com/team-framework/innolive-server/issues/69",
        assignedAt: "2026-07-31T00:00:00.000Z"
      },
      {
        repository: "team-framework/innolive-ai",
        number: 12,
        title: "fix: 상태 확인",
        url: "https://github.com/team-framework/innolive-ai/issues/12",
        assignedAt: "2026-08-01T12:00:00.000Z"
      }
    ],
    alerts: [{
      message: "리뷰 요청 뒤 5시간째 응답이 없어요.",
      url: "https://github.com/team-framework/innolive-client/pull/50"
    }]
  });

  assert.match(message, /\[team-framework\/innolive-client#50: fix: 알림 링크 추가\/#50\]\(<https:\/\/github.com\/team-framework\/innolive-client\/pull\/50>\)/);
  assert.match(message, /\*\*48시간 이상 이슈 · 심각 \(1개\)\*\*/);
  assert.match(message, /\*\*24~48시간 이슈 · 경고 \(1개\)\*\*/);
  assert.match(message, /\[리뷰 요청 뒤 5시간째 응답이 없어요\.\]\(<https:\/\/github.com\/team-framework\/innolive-client\/pull\/50>\)/);
});
