import { zernioDedicated } from "@/lib/channel-config";
import { NextResponse } from "next/server";
import { getProfile, getVideo, saveVideo } from "@/lib/data";
import { DRY_TIKTOK_CREATOR_INFO } from "@/lib/publishers/simulate";
import { zernioCtxForProfile, zernioTikTokCreatorInfo } from "@/lib/publishers/zernio";
import { CONSENT_TEXT, CONSENT_TEXT_BRANDED, tiktokConsentValid, validateTikTokInput } from "@/lib/tiktok";
import type { TikTokPostSettings } from "@/lib/types";
import { zernioKeyName } from "@/lib/zernio-connect";

type P = { params: Promise<{ id: string }> };

/** GET: thông tin creator TikTok (qua Zernio, chỉ đọc) để chọn quyền riêng tư / tương tác. */
export async function GET(_: Request, { params }: P) {
  const v = getVideo((await params).id);
  if (!v) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  const ch = getProfile(v.profile)?.channels.find((c) => c.platform === "tiktok");
  const settings = { ...(v.tiktok || {}), consentValid: tiktokConsentValid(v) };
  const ctx = zernioCtxForProfile(v.profile);
  if (ctx.env.ZERNIO_API_KEY && ch?.accountId) {
    try {
      return NextResponse.json({ info: await zernioTikTokCreatorInfo(ch.accountId, ctx), settings });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message, settings }, { status: 502 });
    }
  }
  if (process.env.PUBLISH_DRY_RUN === "1" && (!zernioDedicated(v.profile) || ctx.env.ZERNIO_API_KEY)) return NextResponse.json({ info: DRY_TIKTOK_CREATOR_INFO, settings });
  return NextResponse.json({ error: !ctx.env.ZERNIO_API_KEY ? `Chưa cấu hình ${zernioKeyName(v.profile)}` : "Kênh TikTok chưa có accountId Zernio (bấm \"Tải lại\" ở Profile & kênh)", settings }, { status: 400 });
}

/** POST: lưu lựa chọn TikTok của người dùng; consent=true ghi nhận xác nhận cho bản render hiện tại. */
export async function POST(req: Request, { params }: P) {
  const v = getVideo((await params).id);
  if (!v) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  const b = (await req.json()) as Partial<TikTokPostSettings> & { consent?: boolean };
  const commercial = (["none", "brand_organic", "brand_content"] as const).find((x) => x === b.commercial) || "none";
  const t: TikTokPostSettings = {
    privacyLevel: typeof b.privacyLevel === "string" && b.privacyLevel ? b.privacyLevel : undefined,
    allowComment: b.allowComment === true,
    allowDuet: b.allowDuet === true,
    allowStitch: b.allowStitch === true,
    draft: b.draft === true,
    commercial,
    nickname: typeof b.nickname === "string" ? b.nickname.slice(0, 100) : undefined,
  };
  if (b.consent === true) {
    const err = validateTikTokInput(t);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    if (v.render.state !== "done" || !v.render.finishedAt) return NextResponse.json({ error: "Video chưa render xong, chưa thể xác nhận" }, { status: 400 });
    t.consentAt = new Date().toISOString();
    t.consentRender = v.render.finishedAt;
    t.consentText = commercial === "brand_content" ? CONSENT_TEXT_BRANDED : CONSENT_TEXT;
  }
  v.tiktok = t;
  saveVideo(v);
  return NextResponse.json({ settings: { ...t, consentValid: tiktokConsentValid(v) } });
}
