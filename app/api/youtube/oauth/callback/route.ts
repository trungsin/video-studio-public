import { NextResponse } from "next/server";
import { PROFILE_COOKIE } from "@/lib/current";
import { NO_CHANNEL_MSG, saveYtConnection } from "@/lib/youtube-connect";
import { exchangeCode, fetchMyChannel, redirectUriFor, requestOrigin, timingSafeEq, unpackState, YT_STATE_COOKIE, ytClientConfigured } from "@/lib/youtube-oauth";

export const dynamic = "force-dynamic";

function done(q: Record<string, string>, slug?: string) {
  const res = new NextResponse(null, { status: 303, headers: { Location: `/profile?${new URLSearchParams(q)}`, "cache-control": "no-store" } });
  res.cookies.set(YT_STATE_COOKIE, "", { path: "/api/youtube/oauth", maxAge: 0 });
  if (slug) res.cookies.set(PROFILE_COOKIE, slug, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return res;
}

/** Google chuyển về đây sau màn hình đồng ý. Không bao giờ log/hiện token. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const saved = unpackState(req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${YT_STATE_COOKIE}=([^;]+)`))?.[1]);
  const state = url.searchParams.get("state") || "";
  if (!saved || !state || !timingSafeEq(saved.state, state)) return done({ yt: "error", msg: "Phiên kết nối hết hạn hoặc không khớp (state). Bấm Kết nối YouTube lại" });
  const slug = saved.slug;
  const err = url.searchParams.get("error");
  if (err) return done({ yt: err === "access_denied" ? "denied" : "error", msg: err.slice(0, 100) }, slug);
  const code = url.searchParams.get("code");
  if (!code) return done({ yt: "error", msg: "Google không trả mã xác thực" }, slug);
  if (!ytClientConfigured()) return done({ yt: "no_client" }, slug);
  const redirectUri = redirectUriFor(requestOrigin(req.headers, req.url));
  if (!redirectUri) return done({ yt: "need_https" }, slug);

  try {
    const tok = await exchangeCode(fetch, process.env, code, redirectUri);
    const channel = await fetchMyChannel(fetch, tok.accessToken);
    if (!channel?.id?.trim()) return done({ yt: "error", msg: NO_CHANNEL_MSG }, slug);
    saveYtConnection(slug, "web", tok.refreshToken, channel);
    return done({ yt: "ok", channel: channel.title || "" }, slug);
  } catch (e) {
    return done({ yt: "error", msg: (e as Error).message.slice(0, 200) }, slug);
  }
}
