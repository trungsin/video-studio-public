import type { Channel } from "@/lib/types";
import { zernioEnvForProfile, zernioKeyName } from "@/lib/zernio-connect";

const LABEL: Record<string, string> = { threads: "Threads", instagram: "Instagram (qua Zernio)", tiktok: "TikTok" };

/** Nối tài khoản qua Zernio (Threads...). Mỗi lần bấm tạo URL OAuth mới; Zernio gói Free: 2 tài khoản miễn phí. */
export default function ZernioConnect({ slug, profileName, sample, channels, zc, platform, msg }: { slug: string; profileName?: string; sample?: boolean; channels: Channel[]; zc?: string; platform?: string; msg?: string }) {
  const has = Boolean(zernioEnvForProfile(slug).ZERNIO_API_KEY);
  const ch = channels.find((c) => c.platform === "threads");
  return (
    <div className="card p-4 text-xs" id="zernio">
      <div className="text-sm font-semibold">Threads <span className="ml-1 font-normal text-slate-400">qua Zernio · tài khoản thứ 2 miễn phí</span></div>
      <div className="mt-1 text-slate-500">
        {zernioKeyName(slug)}: <b className={has ? "text-emerald-700" : "text-amber-700"}>{has ? "đã đặt" : "chưa đặt"}</b>
        {" · "}Kênh Threads: <b>{ch?.accountId ? `${ch.handle || "đã nối"} (${ch.accountId.slice(0, 8)}…)` : "chưa nối"}</b>
      </div>
      {sample ? (
        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-800">Profile <b>{profileName || slug}</b> là MẪU: không nối tài khoản thật.</div>
      ) : has ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a href={`/api/zernio/connect?platform=threads&profile=${encodeURIComponent(slug)}`} className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-black">{ch?.accountId ? "Nối lại Threads" : "Kết nối Threads"} cho {profileName || slug}</a>
          <span className="text-slate-400">Đăng nhập Threads (bằng Instagram của kênh), cho phép; Zernio đưa bạn về đây.</span>
        </div>
      ) : null}
      {zc && (
        <div className={`mt-2 rounded-md px-3 py-2 ${zc === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {zc === "ok" ? `Đã nối ${LABEL[platform || ""] || platform}` : `Nối ${LABEL[platform || ""] || platform || "Zernio"} lỗi`}{msg ? `: ${msg}` : ""}
        </div>
      )}
    </div>
  );
}
