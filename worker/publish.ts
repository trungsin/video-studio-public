/**
 * Scheduler đăng bài: quét data/schedule.json, đăng các khung đến giờ.
 *   npx tsx worker/publish.ts          # chạy một lần (hợp với cron mỗi phút)
 *   npx tsx worker/publish.ts --watch  # vòng lặp mỗi 60s (dùng trong docker-compose)
 */
import fs from "node:fs";
import path from "node:path";

// nạp .env đơn giản (không ghi đè biến đã có)
const envFile = path.resolve(".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const { runDuePublishing } = await import("../lib/publish");
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    const stamp = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    try {
      const r = await runDuePublishing();
      console.log(`[${stamp}] due=${r.due} published=${r.published} failed=${r.failed}`);
    } catch (e) {
      console.error(`[${stamp}] lỗi:`, (e as Error).message);
    } finally { busy = false; }
  };
  await tick();
  if (process.argv.includes("--watch")) setInterval(tick, 60_000);
}
main();
