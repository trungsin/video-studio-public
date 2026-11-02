import { NextResponse } from "next/server";
import { getProfile, saveProfile } from "@/lib/data";
import { zernioCtxForProfile, zernioListAccounts } from "@/lib/publishers/zernio";
import type { Platform } from "@/lib/types";
import { timingSafeEq } from "@/lib/youtube-oauth";
import { ZC_COOKIE, ZC_PATH } from "@/lib/zernio-connect";

export const dynamic = "force-dynamic";

function done(q: Record<string, string>) {
  const res = new NextResponse(null, { status: 303, headers: { Location: `/profile?${new URLSearchParams(q)}`, "cache-control": "no-store" } });
  res.cookies.set(ZC_COOKIE, "", { path: ZC_PATH, maxAge: 0 });
  return res;
}

/** Zernio chuyển về đây sau khi người dùng nối tài khoản. Xác minh nonce + accountId (đọc lại /accounts) rồi gắn vào kênh của profile. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const m = (req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${ZC_COOKIE}=([^;]+)`))?.[1] || "").match(/^([a-f0-9]{48})\.([a-z0-9][a-z0-9-_]{0,63})\.([a-z]+)$/);
  const n = url.searchParams.get("n") || "";
  if (!m || !n || !timingSafeEq(m[1], n) || m[2] !== url.searchParams.get("profile")) return done({ zc: "error", msg: "Phiên kết nối hết hạn hoặc không khớp. Bấm kết nối lại" });
  const slug = m[2], platform = m[3] as Platform;
  const err = url.searchParams.get("error");
  if (err) return done({ zc: "error", platform, msg: `${err}${url.searchParams.get("error_message") ? `: ${url.searchParams.get("error_message")}` : ""}`.slice(0, 200) });
  const accountId = url.searchParams.get("accountId") || "";
  const p = getProfile(slug);
  if (!p || p.sample) return done({ zc: "error", platform, msg: "Profile không hợp lệ" });
  try {
    const accounts = await zernioListAccounts(zernioCtxForProfile(p.slug));
    const user = url.searchParams.get("username");
    const acc = accountId ? accounts.find((a) => a._id === accountId && a.platform === platform)
      : accounts.find((a) => a.platform === platform && Boolean(user) && a.username === user);
    if (!acc) return done({ zc: "error", platform, msg: "Không thấy tài khoản vừa nối trên Zernio" });
    let ch = p.channels.find((c) => c.platform === platform);
    if (!ch) { ch = { platform, handle: "", name: "", connected: false }; p.channels.push(ch); }
    ch.via = "zernio"; ch.accountId = acc._id; ch.connected = acc.isActive !== false;
    if (acc.username) ch.handle = `@${String(acc.username).replace(/^@/, "")}`;
    if (acc.displayName) ch.name = acc.displayName;
    saveProfile(p);
    return done({ zc: "ok", platform, msg: ch.handle });
  } catch (e) {
    return done({ zc: "error", platform, msg: (e as Error).message.slice(0, 200) });
  }
}
