import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createAppJwt, syncHarnessInstallation } from "../sync/github-app.mjs";

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
}

test("설치된 빈 레포에 하네스 스킬 Draft PR을 만들어요", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls = [];
  const result = await syncHarnessInstallation({
    installationId: 7,
    config: {
      appId: "Iv1.test",
      privateKey: privateKey.export({ type: "pkcs1", format: "pem" }),
      sourceRepository: "team-framework/framework-collaboration-harness"
    },
    sourceRoot: process.cwd(),
    now: () => Date.parse("2026-08-15T00:00:00.000Z"),
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname + new URL(url).search;
      calls.push({ path, options });
      if (path === "/app/installations/7/access_tokens") return json({ token: "installation-token" }, 201);
      if (path === "/installation/repositories?per_page=100&page=1") return json({ repositories: [
        { full_name: "team-framework/framework-collaboration-harness", name: "framework-collaboration-harness", default_branch: "main" },
        { full_name: "team-framework/new-empty-repository", name: "new-empty-repository", default_branch: "main" }
      ] });
      if (path.startsWith("/repos/team-framework/new-empty-repository/pulls?")) return json([]);
      if (path === "/repos/team-framework/new-empty-repository/git/ref/heads/main") return json({ object: { sha: "base-commit" } });
      if (path === "/repos/team-framework/new-empty-repository/git/commits/base-commit") return json({ tree: { sha: "base-tree" } });
      if (path === "/repos/team-framework/new-empty-repository/git/trees/base-tree?recursive=1") return json({ tree: [] });
      if (path === "/repos/team-framework/new-empty-repository/git/trees") return json({ sha: "sync-tree" }, 201);
      if (path === "/repos/team-framework/new-empty-repository/git/commits") return json({ sha: "sync-commit" }, 201);
      if (path === "/repos/team-framework/new-empty-repository/git/refs") return json({}, 201);
      if (path === "/repos/team-framework/new-empty-repository/pulls") return json({ html_url: "https://github.com/team-framework/new-empty-repository/pull/1" }, 201);
      throw new Error(`예상하지 않은 GitHub 요청: ${options.method || "GET"} ${path}`);
    }
  });

  assert.deepEqual(result, [{
    repository: "team-framework/new-empty-repository",
    status: "pr_created",
    detail: "https://github.com/team-framework/new-empty-repository/pull/1"
  }]);
  const treeRequest = calls.find((call) => call.path.endsWith("/git/trees") && call.options.method === "POST");
  const tree = JSON.parse(treeRequest.options.body);
  assert.ok(tree.tree.some((file) => file.path === ".codex/skills/issue/SKILL.md"));
  assert.ok(tree.tree.some((file) => file.path === ".claude/skills/pull-request/SKILL.md"));
  const pullRequest = calls.find((call) => call.path.endsWith("/pulls") && call.options.method === "POST");
  assert.deepEqual(JSON.parse(pullRequest.options.body), {
    title: "chore: collaboration-harness-sync",
    head: "harness-sync/framework-collaboration",
    base: "main",
    draft: true,
    body: "Framework Collaboration Harness 변경을 동기화했어요."
  });
});

test("GitHub App JWT는 짧은 유효 기간으로 만들어요", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = createAppJwt({
    appId: "Iv1.test",
    privateKey: privateKey.export({ type: "pkcs1", format: "pem" }),
    now: () => Date.parse("2026-08-15T00:00:00.000Z")
  });
  const [, payload] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.iss, "Iv1.test");
  assert.equal(claims.exp - claims.iat, 600);
});
