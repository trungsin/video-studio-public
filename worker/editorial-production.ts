import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../scripts/load-env";

loadEnv();

async function main() {
  // DATA_DIR/MEDIA_DIR are captured during module initialization; load .env first for CLI runs.
  const { MEDIA_DIR } = await import("../lib/data");
  const { productionTick } = await import("../lib/editorial-production");
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const lock = path.join(MEDIA_DIR, "editorial-production.lock");
  try {
    const pid = Number(fs.readFileSync(lock, "utf8"));
    if (pid && pid !== process.pid) {
      try { process.kill(pid, 0); console.log(`Sản xuất biên tập đang chạy (pid ${pid})`); return; }
      catch { fs.unlinkSync(lock); }
    }
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); }
  catch { console.log("Sản xuất biên tập đã có tiến trình khác"); return; }
  const release = () => {
    try { if (Number(fs.readFileSync(lock, "utf8")) === process.pid) fs.unlinkSync(lock); } catch { /* already removed */ }
  };
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await productionTick();
      if (result.action !== "idle" && result.action !== "disabled") console.log(`[editorial-production] ${result.action} ${result.id || ""}`);
    } catch (error) { console.error("[editorial-production]", error); }
    finally { busy = false; }
  };
  await tick();
  if (process.argv.includes("--watch")) setInterval(tick, 30_000);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
