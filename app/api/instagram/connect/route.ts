import path from "node:path";
import { NextResponse } from "next/server";
import { getProfile, safeSlug, saveProfile } from "@/lib/data";
import { upsertEnv } from "@/lib/envfile";
import { checkInstagram } from "@/lib/meta-check";
import { connectGuard } from "@/lib/owner";
import { requestOrigin, sameHost } from "@/lib/youtube-oauth";

export const dynamic = "force-dynamic";
const back = (q: Record<string, string>) => new NextResponse(null, { status: 303, headers: { Location: `/profile?${new URLSearchParams(q)}#instagram`, "cache-control": "no-store" } });

/**
 * Gắn Instagram (API trực tiếp qua Page token) cho profile: kiểm tra lại Page có instagram_business_account + token đủ quyền,
 * rồi ghi IG_USER_ID, IG_PROFILE vào .env (không đụng token) và đặt kênh instagram via=direct. Chỉ admin (middleware).
 */
export async function POST(req: Request) {
  const o = req.headers.get("origin");
  if (o && o !== "null" && !sameHost(requestOrigin(req.headers, req.url), o)) return back({ ig: "error", msg: "Yêu cầu không đến từ app" });
  let form: FormData | null = null;
  try { form = await req.formData(); } catch { form = null; }
  let p = null;
  try { p = getProfile(safeSlug(String(form?.get("profile") || ""))); } catch { p = null; }
  const g = connectGuard("instagram", p, { hasToken: Boolean(process.env.IG_USER_ID), move: form?.get("move") === "1" });
  if (!g.ok) return back({ ig: g.code, ...(g.owner ? { owner: g.owner } : {}) });
  const c = await checkInstagram(fetch);
  if (!c.ok || !c.ig) return back({ ig: "check", msg: c.error || (c.ig ? `Token thiếu quyền: ${c.missing.join(", ")}` : "Page chưa liên kết tài khoản Instagram Professional") });
  const updates = { IG_USER_ID: c.ig.id, IG_PROFILE: p!.slug };
  upsertEnv(process.env.ENV_FILE || path.resolve(".env"), updates);
  Object.assign(process.env, updates);
  let ch = p!.channels.find((x) => x.platform === "instagram");
  if (!ch) { ch = { platform: "instagram", handle: "", name: "", connected: false }; p!.channels.push(ch); }
  ch.via = "direct"; ch.connected = true; delete ch.accountId;
  if (c.ig.username) ch.handle = `@${c.ig.username}`;
  ch.name = c.ig.name || c.ig.username || ch.name;
  saveProfile(p!);
  console.log(`[instagram] linked IG ${c.ig.id} to profile ${p!.slug}`);
  return back({ ig: "ok", msg: ch.handle });
}
