"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IdeaEvidence, IdeaEvidenceDraft } from "@/lib/types";

const EMPTY: IdeaEvidenceDraft = { value: 0, unit: "", quote: "", url: "", publisher: "", location: "", conditions: "", caveat: "" };
const FIELDS: { key: keyof Omit<IdeaEvidenceDraft, "value">; label: string; placeholder: string }[] = [
  { key: "unit", label: "Đơn vị", placeholder: "VD: °C, km/h" },
  { key: "quote", label: "Trích dẫn nguyên văn (chứa con số)", placeholder: "Chép đúng câu từ trang nguồn, không dùng đoạn trích từ tìm kiếm" },
  { key: "url", label: "URL trang nguồn sơ cấp", placeholder: "https://..." },
  { key: "publisher", label: "Đơn vị công bố", placeholder: "Cơ quan khoa học / nhà xuất bản" },
  { key: "location", label: "Vị trí trên trang", placeholder: "Mục / bảng / dòng / tiêu đề" },
  { key: "conditions", label: "Điều kiện / mẫu đo", placeholder: "Đối tượng, phương pháp, nhiệt độ, phạm vi..." },
  { key: "caveat", label: "Giới hạn áp dụng", placeholder: "Lưu ý khi áp dụng cho bối cảnh Việt Nam" },
  { key: "publishedAt", label: "Ngày / phiên bản (nếu có)", placeholder: "Ngày công bố hoặc phiên bản" },
];

type Lead = { title: string; url: string; description: string };

export default function IdeaEvidenceEditor({ ideaId, initial, initiallyApproved, searchAvailable, hint }: { ideaId: string; initial?: IdeaEvidence; initiallyApproved: boolean; searchAvailable: boolean; hint?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<IdeaEvidenceDraft>(initial?.draft || EMPTY);
  const [evidence, setEvidence] = useState(initial);
  const [approved, setApproved] = useState(initiallyApproved);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState(hint || "");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [excerpt, setExcerpt] = useState("");

  async function request(method: "PUT" | "POST", payload: unknown) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/ideas/${ideaId}/evidence`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không thể xử lý nguồn");
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally { setBusy(false); }
  }

  async function save() {
    const result = await request("PUT", { draft: { ...draft, value: Number(draft.value) }, expectedDigest: evidence?.digest || null });
    if (!result) return;
    setEvidence(result.evidence); setDraft(result.evidence.draft); setApproved(result.approved); setDirty(false);
    setMessage("Đã lưu bản nháp. Phải duyệt lại sau khi thay đổi nội dung.");
    router.refresh();
  }

  async function approve() {
    if (!evidence || dirty) { setError("Lưu bản nháp hiện tại trước khi duyệt"); return; }
    const result = await request("POST", { action: "approve", digest: evidence.digest });
    if (!result) return;
    setEvidence(result.evidence); setApproved(result.approved);
    setMessage("Đã duyệt đúng bản trích dẫn này; thay đổi bất kỳ trường nào sẽ mất hiệu lực.");
    router.refresh();
  }

  async function reject() {
    if (!evidence || dirty) { setError("Lưu bản nháp hiện tại trước khi từ chối"); return; }
    const result = await request("POST", { action: "reject", digest: evidence.digest });
    if (!result) return;
    setEvidence(result.evidence); setApproved(false);
    setMessage("Đã từ chối bản trích dẫn; cần nghiên cứu hoặc sửa rồi duyệt lại.");
    router.refresh();
  }

  async function search() {
    const result = await request("POST", { action: "search", query });
    if (result) { setLeads(result.leads); setMessage(result.note); }
  }

  async function inspect() {
    const result = await request("POST", { action: "inspect", url: draft.url, quote: draft.quote });
    if (result) { setExcerpt(result.excerpt); setMessage(result.quoteFound ? "Đã tìm thấy câu trích trong trang HTML; vẫn cần đối chiếu ngữ cảnh và duyệt thủ công." : "Không tìm thấy câu trích trên trang; chưa thể duyệt."); }
  }

  return (
    <section className="card p-4 space-y-4" aria-label="Nghiên cứu và duyệt bằng chứng">
      <div>
        <h2 className="text-sm font-semibold">Một con số · một nguồn · người duyệt</h2>
        <p className="text-xs text-slate-500">Ghi chú nguồn trong kế hoạch chỉ là gợi ý tìm kiếm, chưa phải bằng chứng. Có thể nhập URL/trích dẫn thủ công, không cần khóa tìm kiếm.</p>
        <p className={`mt-2 rounded-md px-3 py-2 text-xs ${dirty || !approved ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`} role="status">
          {dirty ? "Bản đang sửa chưa được lưu; mọi thay đổi nguồn/số sẽ mất hiệu lực duyệt." : approved ? `Đã duyệt bản ${evidence?.digest.slice(0, 12)} bởi ${evidence?.approved?.by} · ${evidence?.approved?.at}` : evidence?.approved ? "Bằng chứng thay đổi: duyệt cũ đã hết hiệu lực." : "Cần nghiên cứu và duyệt bản bằng chứng cụ thể trước khi tự viết/render."}
        </p>
      </div>
      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <label className="block text-xs font-medium" htmlFor="source-search">Gợi ý tìm trang nguồn</label>
        <div className="flex gap-2"><input id="source-search" className="input flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chủ đề / phép đo cần tìm" /><button className="btn" disabled={busy || !searchAvailable} onClick={search}>Tìm bằng Brave</button></div>
        {!searchAvailable && <p className="text-xs text-amber-800">Chưa có BRAVE_SEARCH_API_KEY. Nhập nguồn thủ công ở dưới.</p>}
        {leads.length > 0 && <ul className="space-y-2 text-xs">{leads.map((lead) => <li key={lead.url} className="border-t border-slate-200 pt-2"><a href={lead.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{lead.title || lead.url}</a><p className="text-slate-500">{lead.description}</p><button className="text-blue-700 underline" onClick={() => { setDraft({ ...draft, url: lead.url }); setDirty(true); setExcerpt(""); }}>Dùng URL làm đầu mối (chưa kiểm chứng)</button></li>)}</ul>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium">Giá trị số<input className="input mt-1 w-full" type="number" step="any" value={draft.value} onChange={(e) => { setDraft({ ...draft, value: Number(e.target.value) }); setDirty(true); }} /></label>
        {FIELDS.map(({ key, label, placeholder }) => <label key={key} className={`text-xs font-medium ${["quote", "conditions", "caveat"].includes(key) ? "sm:col-span-2" : ""}`}>{label}{["quote", "conditions", "caveat"].includes(key) ? <textarea className="input mt-1 w-full" rows={2} placeholder={placeholder} value={draft[key] || ""} onChange={(e) => { setDraft({ ...draft, [key]: e.target.value }); setDirty(true); setExcerpt(""); }} /> : <input className="input mt-1 w-full" placeholder={placeholder} value={draft[key] || ""} onChange={(e) => { setDraft({ ...draft, [key]: e.target.value }); setDirty(true); setExcerpt(""); }} />}</label>)}
      </div>
      <div className="flex flex-wrap gap-2"><button className="btn" disabled={busy || !draft.url} onClick={inspect}>Đối chiếu HTML sơ cấp</button><button className="btn-primary" disabled={busy || !dirty && !!evidence} onClick={save}>Lưu bản nháp</button><button className="btn-primary" disabled={busy || !evidence || dirty || approved} onClick={approve}>Duyệt đúng phiên bản này</button><button className="btn-danger" disabled={busy || !evidence || dirty} onClick={reject}>Từ chối nguồn</button></div>
      {excerpt && <blockquote className="rounded-md border-l-2 border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">{excerpt}</blockquote>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      {message && <p className="text-xs text-slate-600" role="status">{message}</p>}
    </section>
  );
}
