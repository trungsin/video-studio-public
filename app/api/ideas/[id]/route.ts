import { isEditorial } from "@/lib/channel-config";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { approvedEvidence } from "@/lib/idea-research";
import { invalidateEditorial } from "@/lib/editorial-production";
import { DATA_DIR, getIdea, saveIdea } from "@/lib/data";
import { applyAction, type Action } from "@/lib/workflow";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const i = getIdea((await params).id);
  return i ? NextResponse.json(i) : NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const i = getIdea((await params).id);
  if (!i) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  const b = await req.json();
  try {
    if (b.action) return NextResponse.json(applyAction(i, b.action as Action, b.note));
    const changed = (["title", "hook", "angle", "characterId", "settingId"] as const).some((key) => typeof b[key] === "string" && b[key] !== i[key]);
    if (isEditorial(i.profile) && (b.script || changed)) {
      if (i.status === "published") return NextResponse.json({ error: "Bài đã đăng, không thể sửa kịch bản" }, { status: 409 });
      if (b.script && !approvedEvidence(i)) return NextResponse.json({ error: "Cần duyệt nguồn trước khi sửa kịch bản" }, { status: 409 });
      invalidateEditorial(i, "Nội dung đã sửa; cần duyệt lại");
    }
    for (const k of ["title", "hook", "angle", "pillar", "characterId", "settingId"] as const) if (typeof b[k] === "string") i[k] = b[k];
    if (b.script) {
      i.script = b.script;
      if (i.status === "idea") { i.history.push({ at: new Date().toISOString(), from: "idea", to: "script", note: "Sửa kịch bản tay" }); i.status = "script"; }
    }
    saveIdea(i);
    return NextResponse.json(i);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const i = getIdea(id);
  if (!i) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  fs.unlinkSync(path.join(DATA_DIR, "ideas", `${i.id}.json`));
  return NextResponse.json({ ok: true });
}
