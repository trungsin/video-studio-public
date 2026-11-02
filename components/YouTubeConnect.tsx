import { ytEnvForProfile } from "@/lib/youtube-credentials";
import { loopbackRedirect, redirectUriFor, sameHost, YT_DESKTOP_PATH, ytClientConfigured, ytDesktopConfigured, ytTokenInfo } from "@/lib/youtube-oauth";

const MSG: Record<string, string> = {
  ok: "Đã kết nối YouTube.",
  denied: "Bạn đã huỷ ở màn hình Google, chưa kết nối.",
  no_client: "Chưa có YT_CLIENT_ID / YT_CLIENT_SECRET (client Web) trong .env.",
  no_desktop_client: "Chưa có YT_DESKTOP_CLIENT_ID / YT_DESKTOP_CLIENT_SECRET (client Desktop app) trong .env.",
  need_https: "Client Web chỉ chạy qua HTTPS. Dùng cách Desktop app bên dưới (không cần HTTPS).",
  no_profile: "Chưa chọn profile hợp lệ.",
  sample: "Profile MẪU không được nhận kết nối YouTube thật. Chọn profile thật ở góc trên rồi kết nối.",
  error: "Kết nối YouTube lỗi.",
};

const fmt = (d: Date) => d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });

/** Thẻ "Kết nối YouTube" (server component). Không hiển thị bất kỳ secret nào, chỉ trạng thái đã/chưa đặt. */
export default function YouTubeConnect({ slug, profileName, sample, origin, yt, msg, channel, connectedName }: { slug: string; profileName?: string; sample?: boolean; origin: string; yt?: string; msg?: string; channel?: string; connectedName?: string }) {
  const web = ytClientConfigured();
  const desk = ytDesktopConfigured();
  const profileEnv = ytEnvForProfile(slug);
  const token = Boolean(profileEnv.YT_REFRESH_TOKEN);
  const info = ytTokenInfo(profileEnv);
  const via = profileEnv.YT_TOKEN_CLIENT;
  const redirectUri = redirectUriFor(origin);
  const target = redirectUri ? new URL(redirectUri).origin : "";
  const elsewhere = Boolean(redirectUri && !sameHost(origin, redirectUri));
  const loop = loopbackRedirect();
  const ok = yt === "ok" && token;
  const label = token ? "Kết nối lại YouTube" : "Kết nối YouTube";
  const blocked = Boolean(sample);
  const chId = token ? profileEnv.YT_CHANNEL_ID : undefined;
  return (
    <div className="card p-4 text-xs" id="youtube">
      <div className="space-y-1">
        <div className="text-sm font-semibold">Kết nối YouTube <span className="ml-1 font-normal text-slate-400">API trực tiếp · miễn phí</span></div>
        <div className="text-slate-500">
          Client Desktop app: <b className={desk ? "text-emerald-700" : "text-amber-700"}>{desk ? "đã đặt" : "chưa đặt"}</b>
          {" · "}Client Web: <b className={web ? "text-emerald-700" : "text-slate-500"}>{web ? "đã đặt" : "chưa đặt"}</b>
          {" · "}Refresh token: <b className={token ? (info.expired ? "text-amber-700" : "text-emerald-700") : "text-slate-500"}>{token ? (info.expired ? "có thể đã hết hạn" : "đã có") : "chưa có"}</b>
          {token && via ? <> (client {via})</> : null}
          {connectedName && token ? <> · Kênh: <b>{connectedName}</b></> : null}
          {" · "}Quyền riêng tư khi đăng: <b>{process.env.YT_PRIVACY || "private"}</b>
        </div>
        <div className={`mt-1 rounded-md px-2 py-1.5 ${blocked ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>
          {blocked ? <>Profile <b>{profileName || slug}</b> là profile MẪU nên không thể kết nối YouTube thật. Chọn profile thật ở góc trên.</>
            : <>Sẽ kết nối cho profile: <b>{profileName || slug}</b> <span className="font-mono">({slug})</span>.
              {chId ? <> Kênh đã kết nối: <span className="font-mono">{chId}</span>.</> : null}</>}
        </div>
        {token && info.issuedAt && (
          <div className={info.expired ? "text-amber-700" : "text-slate-400"}>
            Cấp lúc {fmt(info.issuedAt)}
            {info.expiresAt ? <> · app OAuth ở chế độ Testing nên Google thu hồi sau 7 ngày (~{fmt(info.expiresAt)}). {info.expired ? "Bấm kết nối lại." : ""}</> : <> · app OAuth ở chế độ Production (YT_OAUTH_TESTING=0): token không tự hết hạn sau 7 ngày.</>}
          </div>
        )}
      </div>

      {/* Cách 1: Desktop app + loopback, không cần HTTPS */}
      <div className="mt-3 rounded-md border border-slate-200 p-3">
        <div className="font-medium">Cách 1 · Desktop app (không cần HTTPS)</div>
        {desk ? (
          <>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-slate-500">
              <li>Bấm <b>Mở Google để cấp quyền</b> (tab mới), chọn tài khoản/kênh, bấm Cho phép.</li>
              <li>Google chuyển tới <span className="font-mono">{loop}?state=…&code=…</span>. Trang báo &quot;không kết nối được&quot; là <b>bình thường</b>.</li>
              <li>Copy <b>toàn bộ địa chỉ</b> trên thanh trình duyệt của tab đó, dán vào ô dưới rồi bấm Hoàn tất (trong 30 phút).</li>
            </ol>
            <form method="get" action={`${YT_DESKTOP_PATH}/start`} target="_blank" className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="profile" value={slug} />
              <button type="submit" disabled={blocked} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:bg-slate-300">Mở Google để cấp quyền</button>
            </form>
            <form method="post" action={`${YT_DESKTOP_PATH}/finish`} className="mt-2 flex flex-wrap items-center gap-2">
              <input name="pasted" type="text" required autoComplete="off" spellCheck={false} placeholder={`${loop}?state=…&code=…`} className="min-w-[280px] flex-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs" />
              <button type="submit" disabled={blocked} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-900 disabled:bg-slate-300">Hoàn tất kết nối</button>
            </form>
          </>
        ) : (
          <div className="mt-1 text-slate-500">{MSG.no_desktop_client} Tạo OAuth client loại <b>Desktop app</b> trong Google Cloud Console, đặt 2 biến này vào .env rồi khởi động lại app.</div>
        )}
      </div>

      {/* Cách 2: Web application, chỉ khi có HTTPS */}
      {(web || redirectUri) && (
        <div className="mt-2 rounded-md border border-slate-200 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">Cách 2 · Web application (cần HTTPS)</div>
              <div className="text-slate-400">Redirect URI: <span className="font-mono">{redirectUri || "— cần HTTPS —"}</span></div>
              {elsewhere && <div className="text-slate-500">Bấm nút sẽ chuyển sang <span className="font-mono">{target}</span> (có thể phải đăng nhập app lại một lần ở địa chỉ đó).</div>}
            </div>
            {web && redirectUri && !blocked ? (
              <form method="get" action="/api/youtube/oauth/start" className="shrink-0 space-y-1 text-right">
                <input type="hidden" name="profile" value={slug} />
                <button type="submit" className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700">{label}</button>
              </form>
            ) : (
              <span className="shrink-0 rounded-lg bg-slate-200 px-3 py-2 text-xs font-medium text-slate-500" title={!web ? MSG.no_client : MSG.need_https}>{label}</span>
            )}
          </div>
        </div>
      )}

      {yt && (
        <div className={`mt-3 rounded-md px-3 py-2 ${ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {yt === "ok" && !token ? MSG.error : MSG[yt] || MSG.error}{ok && channel ? ` Kênh: ${channel}.` : ""}{msg ? ` ${msg}` : ""}
        </div>
      )}
    </div>
  );
}
