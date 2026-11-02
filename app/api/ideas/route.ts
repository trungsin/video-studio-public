import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current";
import { listIdeas, newId, nowIso, saveIdea } from "@/lib/data";
import type { Idea } from "@/lib/types";

export async function GET() {
  const { profile } = await currentProfile();
  return NextResponse.json(listIdeas(profile?.slug));
}

export async function POST(req: Request) {
  const { profile } = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Chưa có profile" }, { status: 400 });
  const b = await req.json();
  if (!String(b.title || "").trim()) return NextResponse.json({ error: "Thiếu tiêu đề" }, { status: 400 });
  const i: Idea = {
    id: newId("idea"), profile: profile.slug, title: String(b.title).trim(), hook: b.hook || "", angle: b.angle || "", pillar: b.pillar || "",
    status: "idea", history: [{ at: nowIso(), from: null, to: "idea", note: "Tạo thủ công" }], createdAt: nowIso(), updatedAt: nowIso(),
  };
  saveIdea(i);
  return NextResponse.json(i);
}
