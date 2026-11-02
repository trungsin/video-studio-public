import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../scripts/load-env";

loadEnv();

/**
 * Đẩy ảnh/video của profile có MYCDN_API_KEY__<SLUG> lên myCDN (xem lib/cdn.ts).
 *   tsx worker/cdn-sync.ts                  một lượt
 *   tsx worker/cdn-sync.ts --watch          render xong đẩy ngay + quét mỗi phút (service cdn-sync trong compose)
 *   tsx worker/cdn-sync.ts --dry-run        chỉ đếm file/dung lượng cần đẩy
 *   tsx worker/cdn-sync.ts --profile <slug> giới hạn một profile
 */
async function main() {
  // DATA_DIR/MEDIA_DIR được chốt khi nạp module: nạp .env trước.
  const { DATA_DIR, MEDIA_DIR } = await import("../lib/data");
  const { cdnKey, cdnProfiles, syncProfile, syncVideo } = await import("../lib/cdn");
  const argv = process.argv.slice(2);
  const only = argv.includes("--profile") ? argv[argv.indexOf("--profile") + 1] : undefined;
  const dryRun = argv.includes("--dry-run");
  if (only && !cdnKey(only)) throw new Error(`Thiếu MYCDN_API_KEY__ cho profile ${only}`);

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const lock = path.join(MEDIA_DIR, "cdn-sync.lock");
  if (!dryRun) {
    try {
      const pid = Number(fs.readFileSync(lock, "utf8"));
      if (pid && pid !== process.pid) {
        try { process.kill(pid, 0); console.log(`cdn-sync đang chạy (pid ${pid})`); return; }
        catch { fs.unlinkSync(lock); }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); }
    catch { console.log("cdn-sync đã có tiến trình khác"); return; }
    process.on("exit", () => {
      try { if (Number(fs.readFileSync(lock, "utf8")) === process.pid) fs.unlinkSync(lock); } catch { /* đã xoá */ }
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
  }

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const slug of only ? [only] : cdnProfiles()) {
        const r = await syncProfile(slug, { dryRun, log: (s) => console.log(`[cdn-sync] ${slug} ${s}`) });
        if (dryRun || r.uploaded || r.failed.length) {
          console.log(`[cdn-sync] ${slug}: ${dryRun ? "cần đẩy" : "đã đẩy"} ${r.uploaded} file (${(r.bytes / 1048576).toFixed(1)} MB), lỗi ${r.failed.length}, đang ghi dở ${r.pending}`);
        }
        if (r.failed.length) process.exitCode = 1;
      }
    } catch (error) { console.error("[cdn-sync]", error); process.exitCode = 1; }
    finally { busy = false; }
  };
  if (!argv.includes("--watch")) { await tick(); return; }

  // Render xong -> đẩy ngay, không đợi lượt quét (lượt quét đầu có thể kéo dài hàng giờ). Chuỗi riêng, tuần tự:
  // song song với lượt quét tối đa 2 upload; trùng file thì upload sau nhận 409/metadata có sẵn.
  let videos = Promise.resolve();
  const timers = new Map<string, NodeJS.Timeout>();
  const onVideo = (id: string) => {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      videos = videos.then(async () => {
        const r = await syncVideo(id, { log: (s) => console.log(`[cdn-sync] ${id} ${s}`) });
        if (r.uploaded || r.failed.length) console.log(`[cdn-sync] ${id}: render xong, đẩy ${r.uploaded} file, lỗi ${r.failed.length}`);
      }).catch((error) => console.error("[cdn-sync]", id, error));
    }, 2000));
  };
  fs.watch(path.join(DATA_DIR, "videos"), (_event, name) => {
    const m = name ? /^([\w-]+)\.json$/.exec(String(name)) : null;
    if (m) onVideo(m[1]);
  });
  void tick();
  setInterval(tick, 60_000);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
