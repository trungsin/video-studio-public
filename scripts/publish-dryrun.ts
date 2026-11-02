/**
 * In ra đúng các request mà từng adapter sẽ gửi cho một video, KHÔNG gọi mạng, KHÔNG sửa data.
 *   npm run publish:dryrun -- vid-su-02                      # facebook, instagram, youtube, tiktok
 *   npm run publish:dryrun -- vid-su-02 facebook instagram    # chọn nền tảng
 *   npm run publish:dryrun -- vid-su-02 --zernio              # mô phỏng đường Zernio
 *   npm run publish:dryrun -- vid-su-02 tiktok --zernio --privacy=SELF_ONLY   # giả định đã chọn + xác nhận TikTok
 * Token luôn được thay bằng <TÊN_BIẾN>; ID (FB_PAGE_ID, IG_USER_ID) lấy từ .env nếu có.
 */
import fs from "node:fs";
import path from "node:path";

const envFile = path.resolve(".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const { getProfile, getVideo, MEDIA_DIR } = await import("../lib/data");
  const { buildCaption } = await import("../lib/publish");
  const { DIRECT } = await import("../lib/publishers/index");
  const { zernio } = await import("../lib/publishers/zernio");
  const { dryCtx } = await import("../lib/publishers/simulate");
  const { tiktokConsentValid } = await import("../lib/tiktok");
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith("--") && !["facebook", "instagram", "youtube", "tiktok"].includes(a));
  if (!id) { console.error("Cách dùng: npm run publish:dryrun -- <videoId> [facebook|instagram|youtube|tiktok ...] [--zernio]"); process.exit(2); }
  const v = getVideo(id);
  if (!v) { console.error(`Không thấy video ${id}`); process.exit(1); }
  if (!v.render.output) { console.error("Video chưa render"); process.exit(1); }
  const file = path.join(MEDIA_DIR, v.render.output);
  const p = getProfile(v.profile);
  const { caption, ai } = buildCaption(v, p);
  const plats = (args.filter((a) => ["facebook", "instagram", "youtube", "tiktok"].includes(a)) as ("facebook" | "instagram" | "youtube" | "tiktok")[]);
  const list = plats.length ? plats : (["facebook", "instagram", "youtube", "tiktok"] as const);
  console.log(`# ${v.id} "${v.title}" file=${file} aiDisclosure=${ai}\n# caption:\n${caption}\n`);
  let bad = 0;
  for (const plat of list) {
    const pub = args.includes("--zernio") ? zernio : DIRECT.find((d) => d.supports(plat))!;
    console.log(`\n=== ${plat} via ${pub.name} ===`);
    const ch = p?.channels.find((c) => c.platform === plat);
    const priv = args.find((a) => a.startsWith("--privacy="))?.slice(10);
    const tiktok = plat !== "tiktok" ? undefined : priv ? { ...(v.tiktok || {}), privacyLevel: priv, consentValid: true } : v.tiktok ? { ...v.tiktok, consentValid: tiktokConsentValid(v) } : undefined;
    const r = await pub.publish({ videoPath: file, title: v.title, caption, platform: plat, aiGenerated: ai, tiktok, durationSec: v.render.duration, accountId: ch?.accountId || "<ZERNIO_ACCOUNT_ID>" }, dryCtx()).catch((e: Error) => ({ ok: false, id: undefined, url: undefined, error: e.message }));
    console.log(`=> ${r.ok ? "OK" : "FAIL"} id=${r.id ?? "-"} url=${r.url ?? "-"}${r.error ? ` error=${r.error}` : ""}`);
    if (!r.ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}
main();
