import { isEditorial } from "@/lib/channel-config";
import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current";
import { getIdea, nowIso, saveIdea } from "@/lib/data";
import { approvedEvidence, braveLeads, evidenceDigest, fetchPrimaryHtml, parseEvidenceDraft, quoteFound, quoteHasValue, sourceUrl } from "@/lib/idea-research";
import { invalidateEditorial } from "@/lib/editorial-production";
import type { Idea } from "@/lib/types";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

async function selectedIdea(params: Params["params"]): Promise<Idea | null> {
  const { profile } = await currentProfile();
  if (!profile || !isEditorial(profile.slug)) return null;
  const idea = getIdea((await params).id);
  return idea?.profile === profile.slug ? idea : null;
}

export async function GET(_req: Request, { params }: Params) {
  const idea = await selectedIdea(params);
  return idea ? NextResponse.json({ evidence: idea.evidence || null, approved: !!approvedEvidence(idea), searchAvailable: !!process.env.BRAVE_SEARCH_API_KEY }) : NextResponse.json({ error: "Không tìm thấy ý tưởng trong kênh hiện tại" }, { status: 404 });
}

export async function PUT(req: Request, { params }: Params) {
  const idea = await selectedIdea(params);
  if (!idea) return NextResponse.json({ error: "Không tìm thấy ý tưởng trong kênh hiện tại" }, { status: 404 });
  if (idea.status === "published") return NextResponse.json({ error: "Bài đã đăng: không thể sửa bằng chứng lịch sử" }, { status: 409 });
  try {
    const body = await req.json();
    if ((idea.evidence?.digest || null) !== (body.expectedDigest ?? null)) return NextResponse.json({ error: "Bằng chứng đã thay đổi, tải lại trước khi lưu" }, { status: 409 });
    const draft = parseEvidenceDraft(body.draft);
    const digest = evidenceDigest(draft);
    if (digest === idea.evidence?.digest) return NextResponse.json({ evidence: idea.evidence, approved: !!approvedEvidence(idea) });
    if (idea.script || idea.review || idea.videoId) invalidateEditorial(idea, `Nguồn đổi sang ${digest.slice(0, 12)}; cần duyệt lại`);
    idea.evidence = { draft, digest };
    idea.history.push({ at: nowIso(), from: idea.status, to: idea.status, note: `Bản nháp bằng chứng ${digest.slice(0, 12)}; cần duyệt` });
    saveIdea(idea);
    return NextResponse.json({ evidence: idea.evidence, approved: false });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(req: Request, { params }: Params) {
  const idea = await selectedIdea(params);
  if (!idea) return NextResponse.json({ error: "Không tìm thấy ý tưởng trong kênh hiện tại" }, { status: 404 });
  try {
    const body = await req.json();
    if (body.action === "search") {
      const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : `${idea.title} ${idea.plan?.sources || ""}`;
      if (query.length > 500) throw new Error("Từ khóa tìm kiếm quá dài");
      const leads = await braveLeads(query);
      return NextResponse.json({ leads: leads || [], searchAvailable: leads !== null, note: leads === null ? "Chưa có Brave Search key; nhập URL và trích dẫn thủ công." : "Đây chỉ là gợi ý tìm kiếm, không phải bằng chứng." });
    }
    if (body.action === "inspect") {
      if (typeof body.url !== "string") throw new Error("Thiếu URL nguồn");
      sourceUrl(body.url);
      const page = await fetchPrimaryHtml(body.url);
      const quote = typeof body.quote === "string" ? body.quote.trim() : "";
      return NextResponse.json({ url: page.url, quoteFound: !!quote && quoteFound(page.text, quote), excerpt: quote ? (quoteFound(page.text, quote) ? page.text.slice(Math.max(0, page.text.indexOf(quote) - 120), page.text.indexOf(quote) + quote.length + 120) : "") : page.text.slice(0, 1200), note: "Trích đoạn HTML sơ cấp; hãy đối chiếu ngữ cảnh, đơn vị và điều kiện trước khi duyệt." });
    }
    if (body.action === "reject") {
      if (idea.status === "published") return NextResponse.json({ error: "Bài đã đăng: không thể thu hồi bằng chứng lịch sử" }, { status: 409 });
      if (!idea.evidence || body.digest !== idea.evidence.digest) return NextResponse.json({ error: "Bản nháp đã thay đổi" }, { status: 409 });
      if (approvedEvidence(idea) && (idea.script || idea.review || idea.videoId)) invalidateEditorial(idea, "Bằng chứng bị từ chối; cần duyệt lại");
      idea.evidence = { draft: idea.evidence.draft, digest: idea.evidence.digest };
      idea.history.push({ at: nowIso(), from: idea.status, to: idea.status, note: `Từ chối bằng chứng ${idea.evidence.digest.slice(0, 12)}` });
      saveIdea(idea);
      return NextResponse.json({ evidence: idea.evidence, approved: false });
    }
    if (body.action !== "approve") throw new Error("Thao tác không hợp lệ");
    if (idea.status === "published") return NextResponse.json({ error: "Bài đã đăng: không thể thay đổi duyệt nguồn" }, { status: 409 });
    const evidence = idea.evidence;
    if (!evidence || body.digest !== evidence.digest || evidenceDigest(evidence.draft) !== evidence.digest) return NextResponse.json({ error: "Bản nháp đã thay đổi; cần tải lại" }, { status: 409 });
    if (!quoteHasValue(evidence.draft.quote, evidence.draft.value)) throw new Error("Trích dẫn nguyên văn phải chứa đúng con số cần duyệt");
    const page = await fetchPrimaryHtml(evidence.draft.url);
    if (!quoteFound(page.text, evidence.draft.quote)) throw new Error("Không tìm thấy trích dẫn nguyên văn trên trang nguồn; cần nghiên cứu thủ công");
    // Redirects are allowed only after each target passes public-address checks; record the final citation URL.
    if (page.url !== evidence.draft.url) throw new Error("Nguồn chuyển địa chỉ; cập nhật URL cuối rồi duyệt lại");
    const latest = getIdea(idea.id);
    if (!latest?.evidence || latest.evidence.digest !== evidence.digest || evidenceDigest(latest.evidence.draft) !== evidence.digest || latest.evidence.approved?.digest !== evidence.approved?.digest) return NextResponse.json({ error: "Bản nháp thay đổi khi đang kiểm nguồn; tải lại" }, { status: 409 });
    latest.evidence.approved = { digest: evidence.digest, at: nowIso(), by: "admin" }; // Middleware authenticates the sole admin session.
    latest.history.push({ at: nowIso(), from: latest.status, to: latest.status, note: `Admin duyệt bằng chứng ${evidence.digest.slice(0, 12)}`, by: "admin" });
    saveIdea(latest);
    return NextResponse.json({ evidence: latest.evidence, approved: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
