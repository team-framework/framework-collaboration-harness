import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyHarnessFiles } from "../sync/apply.mjs";
import { selectTargets } from "../sync/discover.mjs";
import { renderSyncReport } from "../sync/report.mjs";

test("설치된 활성 레포만 동기화 대상으로 선택해요", () => {
  const targets = selectTargets([
    { full_name: "team-framework/framework-collaboration-harness", name: "framework-collaboration-harness", default_branch: "main" },
    { full_name: "team-framework/innolive-client", name: "innolive-client", default_branch: "main" },
    { full_name: "team-framework/archived", name: "archived", default_branch: "main", archived: true },
    { full_name: "team-framework/fork", name: "fork", default_branch: "main", fork: true },
    { full_name: "team-framework/empty", name: "empty", default_branch: null }
  ], { sourceRepository: "team-framework/framework-collaboration-harness" });

  assert.deepEqual(targets, [{
    repository: "team-framework/innolive-client",
    name: "innolive-client",
    baseBranch: "main"
  }]);
});

test("관리 대상 파일만 복사하고 대상 레포의 다른 파일은 유지해요", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-sync-"));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(join(source, ".codex", "skills", "issue"), { recursive: true });
  await mkdir(join(target, ".codex", "skills", "custom"), { recursive: true });
  await writeFile(join(source, ".codex", "skills", "issue", "SKILL.md"), "source skill\\n");
  await writeFile(join(target, ".codex", "skills", "custom", "SKILL.md"), "custom skill\\n");

  await applyHarnessFiles({
    sourceRoot: source,
    targetRoot: target,
    items: [{
      source: ".codex/skills/issue",
      destination: ".codex/skills/issue"
    }]
  });

  assert.equal(await readFile(join(target, ".codex", "skills", "issue", "SKILL.md"), "utf8"), "source skill\\n");
  assert.equal(await readFile(join(target, ".codex", "skills", "custom", "SKILL.md"), "utf8"), "custom skill\\n");
});

test("동기화 결과를 레포별 표로 만들어요", () => {
  const report = renderSyncReport([
    { repository: "team-framework/innolive-server", status: "existing_pr", detail: "#12" },
    { repository: "team-framework/innolive-client", status: "pr_created", detail: "#34" }
  ]);

  assert.match(report, /innolive-client/);
  assert.match(report, /Draft PR 생성/);
  assert.match(report, /기존 동기화 PR 대기/);
});
