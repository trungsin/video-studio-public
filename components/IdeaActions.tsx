"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function IdeaActions({ id, status, hasScript, videoId, compact }: { id: string; status: string; hasScript: boolean; videoId?: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function req(url: string, body: unknown, method = "PATCH") {
    setBusy(true);
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) alert(j.error || "Lỗi"); else router.refresh();
  }
  const act = (action: string, ask?: string) => {
    const note = ask ? prompt(ask) : undefined;
    if (ask && note === null) return;
    return req(`/api/ideas/${id}`, { action, note: note || undefined });
  };
  const script = () => req(`/api/ideas/${id}/script`, {}, "POST");
  const B = ({ c, onClick, children }: { c: string; onClick: () => void; children: React.ReactNode }) => <button className={c} disabled={busy} onClick={onClick}>{children}</button>;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {busy && <span className="text-[11px] text-slate-400">Đang xử lý…</span>}
      {status === "idea" && <B c="btn-primary" onClick={script}>✨ AI viết kịch bản</B>}
      {status === "script" && <>
        <B c="btn" onClick={script}>↻ Viết lại</B>
        {hasScript && <B c="btn-primary" onClick={() => act("submit_mow")}>Gửi MOW duyệt</B>}
      </>}
      {status === "mow" && <>
        <B c="btn-danger" onClick={() => act("reject", "MOW trả lại: góp ý cần sửa?")}>✗ Trả lại</B>
        <B c="btn-primary" onClick={() => act("approve", "Ghi chú MOW (tuỳ chọn):")}>✓ MOW duyệt</B>
      </>}
      {status === "legal" && <>
        <B c="btn-danger" onClick={() => act("reject", "Legal trả lại: lý do?")}>✗ Trả lại</B>
        <B c="btn-primary" onClick={() => act("approve", "Ghi chú Legal (tuỳ chọn):")}>✓ Legal duyệt</B>
      </>}
      {(status === "production" || status === "ready" || status === "scheduled" || status === "published") && videoId && <Link className="btn" href={`/san-xuat/${videoId}`}>▶ Mở sản xuất</Link>}
      {status === "ready" && <Link className="btn-primary" href="/lich-dang">▦ Lên lịch</Link>}
      {status === "rejected" && <B c="btn" onClick={() => act("restore")}>Khôi phục</B>}
      {!compact && ["idea", "script"].includes(status) && <B c="btn-danger" onClick={() => act("reject", "Lý do loại (tuỳ chọn):")}>Loại</B>}
    </div>
  );
}
