import { loadEnv } from "../scripts/load-env";

loadEnv();
// DATA_DIR/MEDIA_DIR are bound on module load, so load .env before loading the planner.

async function main() {
  if (process.env.EDITORIAL_SCHEDULE_ENABLED !== "1") {
    console.log("Editorial scheduling disabled (EDITORIAL_SCHEDULE_ENABLED != 1)");
    return;
  }
  const { editorialScheduleTick } = await import("../lib/editorial-schedule");
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    try {
      const result = editorialScheduleTick();
      console.log(`[editorial] ${result.config.enabled && !result.config.paused ? "active" : "paused/off"}: ${result.proposals.length} reservations; ${result.blockers.join("; ") || "no blockers"}`);
    } catch (err) {
      console.error("[editorial]", (err as Error).message);
    } finally { busy = false; }
  };
  tick();
  if (process.argv.includes("--watch")) setInterval(tick, 60_000);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
