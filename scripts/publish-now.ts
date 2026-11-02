/**
 * Đăng ngay một video (bỏ qua lịch). Mặc định theo PUBLISH_DRY_RUN; --live để đăng THẬT riêng lần này.
 *   npx tsx scripts/publish-now.ts --video vid-su-11 [--platforms facebook,instagram,youtube,tiktok,threads] [--youtube-privacy public] [--live --yes]
 * Chỉ in id/link/lỗi (đã che token), không in secret.
 */
import { loadEnv } from "./load-env";

loadEnv();
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(`--${k}`);

async function main() {
  const { getProfile, getVideo } = await import("../lib/data");
  const { publishVideo } = await import("../lib/publish");
  const id = arg("video");
  if (!id) throw new Error("Thiếu --video");
  const v = getVideo(id);
  if (!v) throw new Error(`Không thấy ${id}`);
  const p = getProfile(v.profile);
  const platforms = (arg("platforms")?.split(",") || p?.channels.filter((c) => c.connected).map((c) => c.platform) || []) as any[];
  const live = flag("live");
  if (live && !flag("yes")) throw new Error("Đăng thật cần thêm --yes");
  const yp = arg("youtube-privacy") as any;
  console.log(`${live ? "ĐĂNG THẬT" : `dry-run=${process.env.PUBLISH_DRY_RUN === "1"}`} ${id} (${v.profile}) -> ${platforms.join(", ")}${yp ? ` · YouTube ${yp}` : ""}`);
  const res = await publishVideo(id, platforms, {
    live, youtubePrivacy: yp,
    onStart: (pl) => console.log(`… ${pl}`),
    onResult: (r) => console.log(`${r.ok ? "✓" : "✗"} ${r.platform} via ${r.via}${r.id ? ` id=${r.id}` : ""}${r.url ? ` ${r.url}` : ""}${r.note ? ` (${r.note})` : ""}${r.error ? ` LỖI: ${r.error}` : ""}`),
  });
  process.exitCode = res.every((r) => r.ok) ? 0 : 2;
}
main().catch((e) => { console.error("Lỗi:", (e as Error).message); process.exitCode = 1; });
