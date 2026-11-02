import { NextResponse } from "next/server";
import { mergeZernioAccounts } from "@/lib/channels";
import { getProfile, saveProfile } from "@/lib/data";
import { directOwner } from "@/lib/owner";
import { directEnvForProfile } from "@/lib/profile-env";
import { DIRECT } from "@/lib/publishers";
import { zernioCtxForProfile, zernioListAccounts } from "@/lib/publishers/zernio";
import type { Platform } from "@/lib/types";
import { zernioKeyName } from "@/lib/zernio-connect";

/** Đọc danh sách tài khoản đã kết nối trên Zernio và cập nhật thẻ kênh (chỉ đọc phía Zernio). Kênh via=direct giữ nguyên. */
export async function POST(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const p = getProfile((await params).slug);
  if (!p) return NextResponse.json({ error: "Không tìm thấy profile" }, { status: 404 });
  if (p.sample) return NextResponse.json({ error: "Profile mẫu không đồng bộ tài khoản Zernio thật" }, { status: 400 });
  const ctx = zernioCtxForProfile(p.slug);
  if (!ctx.env.ZERNIO_API_KEY) return NextResponse.json({ error: `Chưa cấu hình ${zernioKeyName(p.slug)}` }, { status: 400 });
  try {
    const accounts = await zernioListAccounts(ctx);
    // Nền tảng có adapter trực tiếp đã cấu hình và thuộc profile này (VD facebook qua Meta) giữ via=direct
    const direct = (["facebook", "instagram", "youtube", "tiktok"] as Platform[]).filter((pl) => {
      const env = directEnvForProfile(pl, p.slug);
      return DIRECT.some((d) => d.supports(pl) && d.configured(env)) && (pl === "youtube" || directOwner(pl, env) === p.slug);
    });
    const updated = mergeZernioAccounts(p.channels, accounts, direct);
    saveProfile(p);
    return NextResponse.json({ ok: true, count: accounts.length, updated });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
