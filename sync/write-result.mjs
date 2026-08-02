import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = argument("--file");
  const repository = argument("--repository");
  const status = argument("--status");
  const detail = argument("--detail") || "";

  if (!file || !repository || !status) {
    throw new Error("사용법: node sync/write-result.mjs --file <file> --repository <owner/repo> --status <status> [--detail <text>]");
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ repository, status, detail }) + "\\n", { mode: 0o600 });
}
