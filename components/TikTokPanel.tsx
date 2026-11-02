"use client";
import { useEffect, useState } from "react";
import { BRANDED_POLICY_URL, MUSIC_USAGE_URL, PRIVACY_LABEL } from "@/lib/tiktok";
import type { TikTokPostSettings } from "@/lib/types";

type Inter = { enabled?: boolean; label?: string } | null | undefined;
type Info = {
  dryRun?: boolean;
  creator?: { nickname?: string; isVerified?: boolean; canPostMore?: boolean };
  privacyLevels?: { value: string; label?: string }[];
  postingLimits?: { maxVideoDurationSec?: number; interactionSettings?: Record<string, Inter> };
};
type S = TikTokPostSettings & { consentValid?: boolean };

/** Mục TikTok (qua Zernio): người dùng tự chọn quyền riêng tư, tương tác, bản nháp và xác nhận trước khi đăng. */
export default function TikTokPanel({ videoId, caption, duration, renderDone, onReady }: { videoId: string; caption: string; duration?: number; renderDone: boolean; onReady: (ok: boolean) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState("");
  const [s, setS] = useState<S>({});
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr(""); setBusy(true);
    const r = await fetch(`/api/videos/${videoId}/tiktok`);
    const j = await r.json(); setBusy(false);
    if (j.settings) { setS(j.settings); onReady(Boolean(j.settings.consentValid)); }
    if (!r.ok) return setErr(j.error || "Lỗi tải thông tin TikTok");
    setInfo(j.info);
  }
  useEffect(() => { load(); }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // đổi bất kỳ lựa chọn nào thì phải xác nhận lại
  const set = (p: Partial<S>) => { setS({ ...s, ...p, consentValid: false }); setAgree(false); onReady(false); };
  const inter = info?.postingLimits?.interactionSettings || {};
  const dis = (k: string) => inter[k]?.enabled === false;
  const max = info?.postingLimits?.maxVideoDurationSec;
  const tooLong = Boolean(max && duration && duration > max);
  const branded = s.commercial === "brand_content";
  const privacyOk = Boolean(s.privacyLevel) && !(branded && s.privacyLevel === "SELF_ONLY");
  const canConfirm = renderDone && Boolean(info) && privacyOk && agree && info?.creator?.canPostMore !== false && !tooLong;

  async function confirm() {
    setBusy(true); setErr("");
    const r = await fetch(`/api/videos/${videoId}/tiktok`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...s, nickname: info?.creator?.nickname, consent: true }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) return setErr(j.error);
    setS(j.settings); onReady(Boolean(j.settings.consentValid));
  }

  return (
    <div className="mb-3 rounded border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <b>TikTok (qua Zernio)</b>
        <button className="text-[11px] underline" onClick={load} disabled={busy}>tải lại</button>
      </div>
      {info && (
        <p className="mb-2">Đăng lên tài khoản: <b>@{info.creator?.nickname || "?"}</b>{info.dryRun ? " · dữ liệu mô phỏng (dry run)" : ""}
          {info.creator?.canPostMore === false && <span className="text-rose-600"> · tài khoản đang không thể đăng thêm, thử lại sau</span>}
          {tooLong && <span className="text-rose-600"> · video {Math.round(duration!)}s dài hơn giới hạn {max}s</span>}</p>
      )}
      {err && <p className="mb-2 text-rose-600">{err}</p>}
      {info && <>
        <label className="mb-2 block">Ai được xem video này
          <select className="input mt-1 w-full" value={s.privacyLevel || ""} onChange={(e) => set({ privacyLevel: e.target.value || undefined })}>
            <option value="">— Chọn quyền riêng tư —</option>
            {(info.privacyLevels || []).map((p) => (
              <option key={p.value} value={p.value} disabled={branded && p.value === "SELF_ONLY"}>{PRIVACY_LABEL[p.value] || p.label || p.value}{branded && p.value === "SELF_ONLY" ? " (không dùng cho branded content)" : ""}</option>
            ))}
          </select>
        </label>
        <div className="mb-2 flex flex-wrap gap-3">
          {([["allowComment", "allow_comment", "Cho bình luận"], ["allowDuet", "allow_duet", "Cho Duet"], ["allowStitch", "allow_stitch", "Cho Stitch"]] as const).map(([k, ik, lb]) => (
            <label key={k} className={`flex items-center gap-1 ${dis(ik) ? "text-slate-400" : ""}`} title={dis(ik) ? "Đã tắt trong cài đặt tài khoản TikTok" : ""}>
              <input type="checkbox" disabled={dis(ik)} checked={Boolean(s[k]) && !dis(ik)} onChange={(e) => set({ [k]: e.target.checked })} />{lb}
            </label>
          ))}
        </div>
        <label className="mb-2 block">Tiết lộ nội dung thương mại
          <select className="input mt-1 w-full" value={s.commercial || "none"} onChange={(e) => set({ commercial: e.target.value as S["commercial"] })}>
            <option value="none">Không (nội dung thường)</option>
            <option value="brand_organic">Quảng bá thương hiệu của tôi (nhãn &quot;Promotional content&quot;)</option>
            <option value="brand_content">Nội dung có tài trợ (nhãn &quot;Paid partnership&quot;)</option>
          </select>
        </label>
        <label className="mb-2 flex items-center gap-1"><input type="checkbox" checked={Boolean(s.draft)} onChange={(e) => set({ draft: e.target.checked })} />Gửi bản nháp vào hộp thư TikTok (tự bấm Đăng trong app; tối đa 5 bản nháp/24h)</label>
        <p className="mb-2 text-slate-500">Nhãn &quot;AI-generated&quot; được bật theo cài đặt khai báo AI của video/profile.</p>
        <details className="mb-2"><summary className="cursor-pointer">Xem trước caption</summary>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans">{caption || "(trống)"}</pre>
          <p className="text-slate-500">Video xem trước ở khung Render phía trên. Dòng khai báo AI sẽ được thêm khi đăng nếu đang bật.</p>
        </details>
        {s.consentValid ? (
          <p className="text-emerald-700">✓ Đã xác nhận lúc {new Date(s.consentAt!).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · {PRIVACY_LABEL[s.privacyLevel || ""] || s.privacyLevel}{s.draft ? " · bản nháp" : ""}</p>
        ) : (
          <>
            <label className="mb-2 flex items-start gap-1">
              <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>Tôi đã xem lại video và caption, đồng ý đăng lên TikTok. Khi đăng, bạn đồng ý với{" "}
                {branded && <><a className="underline" href={BRANDED_POLICY_URL} target="_blank">Branded Content Policy</a> và </>}
                <a className="underline" href={MUSIC_USAGE_URL} target="_blank">Music Usage Confirmation</a> của TikTok.
                <br /><i>By posting, you agree to TikTok&apos;s {branded ? "Branded Content Policy and " : ""}Music Usage Confirmation.</i></span>
            </label>
            <button className="btn w-full justify-center" disabled={!canConfirm || busy} onClick={confirm}>Xác nhận cài đặt TikTok</button>
            {!s.privacyLevel && <p className="mt-1 text-amber-700">Cần chọn quyền riêng tư (không có mặc định).</p>}
            {s.consentAt && !s.consentValid && <p className="mt-1 text-amber-700">Video đã render lại hoặc cài đặt đã đổi: cần xác nhận lại.</p>}
          </>
        )}
      </>}
    </div>
  );
}
