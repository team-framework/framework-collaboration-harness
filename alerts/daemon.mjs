import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { run } from "./run.mjs";

const intervalMinutes = Number(process.env.ALERT_INTERVAL_MINUTES || 60);
const summaryStatePath = process.env.SUMMARY_STATE_PATH || ".runtime/summary-state.json";
const kst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function loadSummaryDate() { try { return JSON.parse(await readFile(summaryStatePath, "utf8")).lastSummaryDate || null; } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function saveSummaryDate(date) { await mkdir(dirname(summaryStatePath), { recursive: true }); await writeFile(`${summaryStatePath}.tmp`, JSON.stringify({ lastSummaryDate: date }), { mode: 0o600 }); await rename(`${summaryStatePath}.tmp`, summaryStatePath); }

export async function startDaemon({ now = () => Date.now(), sleep = wait } = {}) {
  let nextAlertAt = 0;
  let lastSummaryDate = await loadSummaryDate();
  while (true) {
    try {
      if (now() >= nextAlertAt) { await run(); nextAlertAt = now() + intervalMinutes * 60 * 1_000; }
      const parts = Object.fromEntries(kst.formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
      const today = `${parts.year}-${parts.month}-${parts.day}`;
      if (parts.hour === "09" && lastSummaryDate !== today) { await run({ summary: true }); await saveSummaryDate(today); lastSummaryDate = today; }
    } catch (error) { console.error(`협업 알림 실행에 실패했어요: ${error.message}`); }
    await sleep(60_000);
  }
}

if (import.meta.main) await startDaemon();
