import { checkInstagram, IG_REQUIRED_SCOPES } from "@/lib/meta-check";
import { directOwner } from "@/lib/owner";

const MSG: Record<string, string> = {
  ok: "Đã gắn Instagram cho profile này.",
  sample: "Profile MẪU không được nhận kết nối Instagram thật.",
  owned_elsewhere: "Instagram trực tiếp đang thuộc profile khác. Tích ô chuyển nếu thật sự muốn.",
  no_profile: "Chưa chọn profile hợp lệ.",
  error: "Lỗi.",
};

/** Thẻ Instagram (API trực tiếp qua Page token). Kiểm tra Graph chỉ chạy khi mở /profile?ig=check. Không hiện token. */
export default async function InstagramConnect({ slug, profileName, sample, ig, msg }: { slug: string; profileName?: string; sample?: boolean; ig?: string; msg?: string }) {
  const igId = process.env.IG_USER_ID;
  const owner = igId ? directOwner("instagram") : undefined;
  const tokenSrc = process.env.IG_ACCESS_TOKEN ? "IG_ACCESS_TOKEN" : process.env.FB_PAGE_TOKEN ? "FB_PAGE_TOKEN" : "";
  const c = ig === "check" && !sample ? await checkInstagram(fetch) : null;
  const elsewhere = owner && owner !== slug ? owner : undefined;
  return (
    <div className="card p-4 text-xs" id="instagram">
      <div className="text-sm font-semibold">Instagram Reels <span className="ml-1 font-normal text-slate-400">API trực tiếp qua Page Facebook · miễn phí</span></div>
      <div className="mt-1 text-slate-500">
        IG_USER_ID: <b className={igId ? "text-emerald-700" : "text-slate-500"}>{igId ? "đã đặt" : "chưa đặt"}</b>
        {" · "}Token: <b>{tokenSrc || "chưa có"}</b>
        {owner ? <> · thuộc profile <b className="font-mono">{owner}</b></> : null}
      </div>
      {sample ? (
        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-800">Profile <b>{profileName || slug}</b> là MẪU: không kết nối Instagram thật.</div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a href="/profile?ig=check#instagram" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50">Kiểm tra Instagram</a>
          <span className="text-slate-400">Đọc Page + quyền token (không đăng gì). Cần quyền: {IG_REQUIRED_SCOPES.join(", ")}.</span>
        </div>
      )}
      {c && (
        <div className={`mt-2 rounded-md px-3 py-2 ${c.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {c.error ? <div>{c.error}</div> : null}
          {c.page ? <div>Page: <b>{c.page.name}</b> <span className="font-mono">({c.page.id})</span> · app {c.appName || c.appId} · token {c.tokenType} {c.tokenValid ? "hợp lệ" : "KHÔNG hợp lệ"}</div> : null}
          <div>Instagram liên kết với Page: {c.ig ? <b>@{c.ig.username} <span className="font-mono">({c.ig.id})</span></b> : <b>chưa có</b>}</div>
          <div>Quyền thiếu: {c.missing.length ? <b>{c.missing.join(", ")}</b> : "không"}</div>
          {c.ok ? (
            <form method="post" action="/api/instagram/connect" className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="profile" value={slug} />
              <button type="submit" className="rounded-lg bg-pink-600 px-3 py-1.5 font-medium text-white hover:bg-pink-700">Gắn @{c.ig!.username} cho profile {profileName || slug}</button>
              {elsewhere ? <label className="flex items-center gap-1"><input type="checkbox" name="move" value="1" required /> Chuyển từ profile &quot;{elsewhere}&quot;</label> : null}
            </form>
          ) : null}
        </div>
      )}
      {ig && ig !== "check" && (
        <div className={`mt-2 rounded-md px-3 py-2 ${ig === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{MSG[ig] || MSG.error}{msg ? ` ${msg}` : ""}</div>
      )}
      {ig === "check" && msg ? <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-amber-800">{msg}</div> : null}
    </div>
  );
}
