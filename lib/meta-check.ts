import { DEFAULT_GRAPH_VERSION, readJson } from "./publishers/http";

type Env = Record<string, string | undefined>;
/** Quyền tối thiểu để đăng Reels qua Instagram API with Facebook Login (Page token). */
export const IG_REQUIRED_SCOPES = ["instagram_basic", "instagram_content_publish", "pages_read_engagement", "pages_show_list"];

export interface InstagramCheck {
  ok: boolean;
  error?: string;
  tokenSource?: "IG_ACCESS_TOKEN" | "FB_PAGE_TOKEN";
  tokenType?: string;
  tokenValid?: boolean;
  appId?: string;
  appName?: string;
  page?: { id: string; name?: string };
  ig?: { id: string; username?: string; name?: string };
  scopes: string[];
  missing: string[];
}

/**
 * Kiểm tra (chỉ đọc) Page đã liên kết tài khoản Instagram Professional chưa và token có đủ quyền đăng Reels chưa.
 * Không bao giờ trả/ghi token; thông báo lỗi Graph chỉ gồm message/code.
 */
export async function checkInstagram(f: typeof fetch, env: Env = process.env): Promise<InstagramCheck> {
  const token = env.IG_ACCESS_TOKEN || env.FB_PAGE_TOKEN;
  const tokenSource = env.IG_ACCESS_TOKEN ? "IG_ACCESS_TOKEN" : "FB_PAGE_TOKEN";
  const page = env.FB_PAGE_ID;
  const base = `https://graph.facebook.com/${env.IG_GRAPH_VERSION || env.FB_GRAPH_VERSION || DEFAULT_GRAPH_VERSION}`;
  const out: InstagramCheck = { ok: false, scopes: [], missing: [...IG_REQUIRED_SCOPES], tokenSource };
  if (!token || !page) return { ...out, error: "Thiếu FB_PAGE_ID / FB_PAGE_TOKEN trong .env" };
  const auth = { authorization: `Bearer ${token}` };
  const gerr = (j: any, status: number) => [j?.error?.message, j?.error?.code && `code ${j.error.code}`].filter(Boolean).join(" · ") || `HTTP ${status}`;
  try {
    const r1 = await f(`${base}/${encodeURIComponent(page)}?fields=id,name,instagram_business_account{id,username,name}`, { headers: auth });
    const j1 = await readJson(r1);
    if (!r1.ok || j1.error) return { ...out, error: `Đọc Page: ${gerr(j1, r1.status)}` };
    out.page = { id: String(j1.id), name: j1.name };
    const iba = j1.instagram_business_account;
    if (iba?.id) out.ig = { id: String(iba.id), username: iba.username, name: iba.name };

    const r2 = await f(`${base}/debug_token?input_token=${encodeURIComponent(token)}`, { headers: auth });
    const j2 = await readJson(r2);
    const d = j2?.data;
    if (!r2.ok || !d) return { ...out, error: `debug_token: ${gerr(j2, r2.status)}` };
    out.tokenType = d.type; out.tokenValid = Boolean(d.is_valid); out.appId = d.app_id ? String(d.app_id) : undefined; out.appName = d.application;
    out.scopes = Array.isArray(d.scopes) ? d.scopes.map(String) : [];
    out.missing = IG_REQUIRED_SCOPES.filter((s) => !out.scopes.includes(s));
    out.ok = Boolean(out.ig && out.tokenValid && out.missing.length === 0);
    return out;
  } catch (e) {
    return { ...out, error: `Lỗi mạng: ${(e as Error).message}` };
  }
}
