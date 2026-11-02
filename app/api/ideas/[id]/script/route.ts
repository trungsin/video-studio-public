import { isEditorial } from "@/lib/channel-config";
import { NextResponse } from "next/server";
import { approvedEvidence } from "@/lib/idea-research";
import { invalidateEditorial } from "@/lib/editorial-production";
import { getIdea, getProfile, saveIdea, setIdeaStatus } from "@/lib/data";
import { llmConfigured, writeScript } from "@/lib/llm";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const i = getIdea((await params).id);
  if (!i) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  const p = getProfile(i.profile);
  if (!p) return NextResponse.json({ error: "Không tìm thấy profile" }, { status: 404 });
  const { feedback } = await req.json().catch(() => ({}));
  const evidence = isEditorial(i.profile) ? approvedEvidence(i) : null;
  if (isEditorial(i.profile) && !evidence) return NextResponse.json({ error: "Chưa duyệt nguồn và số liệu" }, { status: 409 });
  try {
    const script = await writeScript(p, i, feedback || i.review?.mow?.note || i.review?.legal?.note);
    const current = getIdea(i.id);
    if (!current || (isEditorial(current.profile) && (approvedEvidence(current)?.digest !== evidence?.digest
      || current.updatedAt !== i.updatedAt || current.status === "published")))
      return NextResponse.json({ error: "Nguồn hoặc ý tưởng đã thay đổi trong lúc viết; thử lại" }, { status: 409 });
    if (isEditorial(current.profile) && current.script) invalidateEditorial(current, "Kịch bản đã viết lại");
    current.script = script;
    if (["idea", "script", "rejected"].includes(current.status)) setIdeaStatus(current, "script", llmConfigured() ? "AI viết kịch bản" : "Kịch bản mẫu (chưa cấu hình LLM)");
    saveIdea(current);
    return NextResponse.json(current);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
