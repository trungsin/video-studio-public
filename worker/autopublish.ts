/**
 * Worker đăng tự động theo data/autopublish.json (xem lib/autopublish.ts).
 *   npx tsx worker/autopublish.ts --watch   (nhịp 30s; scripts/vs-watchdog.sh giữ sống)
 *   npx tsx worker/autopublish.ts --once    (chạy 1 nhịp)  · --plan  (in khung sắp tới, không đăng)
 * Chỉ một tiến trình chạy cùng lúc (khóa /tmp/video-studio-autopublish.lock). Không in secret.
 */
import fs from "node:fs";
import { loadEnv } from "../scripts/load-env";

loadEnv();
const LOCK = process.env.AUTOPUBLISH_LOCK || "/tmp/video-studio-autopublish.lock";
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function main() {
  const ap = await import("../lib/autopublish");
  const log = (s: string) => {
    const line = `${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" })} ${s}`;
    console.log(line);
    const st = ap.readState();
    ap.writeState({ log: [...(st.log || []), line].slice(-60) });
  };
  if (process.argv.includes("--plan")) {
    for (const cfg of ap.loadAutoConfig()) {
      const p = ap.projectSlots(cfg);
      console.log(`${cfg.profile}: ${cfg.enabled ? "BẬT" : "tắt"} · ${ap.isLive(cfg) ? "ĐĂNG THẬT" : "dry-run"} · ${cfg.times.join(", ")} · ${cfg.platforms.join(", ")}`);
      for (const s of p.slots.slice(0, 12)) console.log(`  ${s.date} ${s.time}  ${s.video ? `${s.video.id}  ${s.video.title}` : "— hết hàng đợi —"}`);
      console.log(`  ${p.queued} khung có video; hết hàng: ${p.runsOut ? `${p.runsOut.date} ${p.runsOut.time}` : "> 14 ngày"}`);
    }
    return;
  }
  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, "utf8"));
    if (pid && pid !== process.pid && alive(pid)) { console.log(`autopublish đang chạy (pid ${pid}), thoát`); return; }
  }
  fs.writeFileSync(LOCK, String(process.pid));
  const release = () => { try { if (Number(fs.readFileSync(LOCK, "utf8")) === process.pid) fs.unlinkSync(LOCK); } catch { /* */ } };
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { log(`[autopublish] dừng (${sig})`); process.exit(0); });

  ap.recoverInterrupted(log);
  const cfgs = ap.loadAutoConfig();
  log(`[autopublish] khởi động pid ${process.pid}: ${cfgs.map((c) => `${c.profile} ${c.enabled ? c.times.join("/") : "tắt"} ${ap.isLive(c) ? "THẬT" : "dry-run"}`).join("; ") || "chưa có cấu hình"}`);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      ap.writeState({ heartbeat: new Date().toISOString(), pid: process.pid });
      await ap.autoTick(new Date(), { log });
    } catch (e) { log(`[autopublish] lỗi nhịp: ${(e as Error).message}`); } finally { busy = false; }
  };
  await tick();
  if (!process.argv.includes("--watch")) return;
  setInterval(tick, 30_000);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
