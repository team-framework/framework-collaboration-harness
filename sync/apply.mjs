import { cp, lstat, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncItems } from "./manifest.mjs";

function containedPath(root, path) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(root, path);
  const relativePath = relative(absoluteRoot, absolutePath);

  if (relativePath.startsWith("..") || relativePath === "..") {
    throw new Error("동기화 경로가 루트 밖을 가리켜요: " + path);
  }

  return absolutePath;
}

export async function applyHarnessFiles({ sourceRoot, targetRoot, items = syncItems }) {
  const copied = [];

  for (const item of items) {
    const source = containedPath(sourceRoot, item.source);
    const destination = containedPath(targetRoot, item.destination);
    const sourceStat = await lstat(source);

    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: sourceStat.isDirectory(),
      force: true,
      errorOnExist: false
    });
    copied.push(item.destination);
  }

  return copied;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sourceRoot = argument("--source");
  const targetRoot = argument("--target");

  if (!sourceRoot || !targetRoot) {
    throw new Error("사용법: node sync/apply.mjs --source <source-root> --target <target-root>");
  }

  const copied = await applyHarnessFiles({ sourceRoot, targetRoot });
  console.log("동기화 파일 " + copied.length + "개를 적용했어요.");
}
