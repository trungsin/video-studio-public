import { isEditorial } from "@/lib/channel-config";
import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current";
import { listIdeas, newId, nowIso, saveIdea } from "@/lib/data";
import { generateIdeas, llmConfigured } from "@/lib/llm";
import { duplicateOf, NCS_PILLARS, rotatedPillars } from "@/lib/idea-research";
import { pillarSignals, readEditorialMetrics } from "@/lib/editorial-metrics";
import type { Idea } from "@/lib/types";

export async function POST(req: Request) {
  const { profile } = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Chưa có profile" }, { status: 400 });
  const { count = 5, topic = "" } = await req.json().catch(() => ({}));
  try {
    const n = Math.min(Math.max(Number(count) || 5, 1), 10);
    const own = listIdeas(profile.slug);
    if (isEditorial(profile.slug)) {
      const order = rotatedPillars(own);
      const signals = pillarSignals(readEditorialMetrics(profile.slug), own);
      const priority = [...order].sort((a, b) => {
        const aSignal = signals.find((s) => s.pillar === a);
        const bSignal = signals.find((s) => s.pillar === b);
        return (bSignal ? (bSignal.views + bSignal.comments * 10) / bSignal.videos : -1) -
          (aSignal ? (aSignal.views + aSignal.comments * 10) / aSignal.videos : -1);
      });
      if (!llmConfigured()) return NextResponse.json({
        created: 0, llm: false, pillarOrder: priority, signals,
        researchQueue: priority.flatMap((pillar) => own.filter((i) => i.pillar === pillar && i.status === "idea" && !i.evidence?.approved).slice(0, 3).map((i) => ({ id: i.id, title: i.title, pillar }))),
        note: "Chưa cấu hình LLM; tiếp tục nghiên cứu backlog hiện có, không tạo ý tưởng mẫu.",
      });
      const gen = await generateIdeas(profile, n, `${String(topic).slice(0, 200)}. Chọn một trong các tuyến ${NCS_PILLARS.join(", ")}; câu hỏi kế cận nhưng khác cơ chế, không tự tạo số.`, own.map((i) => `${i.title} (${i.pillar}): ${i.angle || i.plan?.main || ""}`));
      const candidates: Idea[] = [];
      const duplicates: { title: string; existingId: string; existingTitle: string }[] = [];
      for (const g of gen) {
        if (!g || typeof g.title !== "string" || !g.title.trim() || !NCS_PILLARS.includes(g.pillar as typeof NCS_PILLARS[number])) continue;
        const similar = duplicateOf(g, [...own, ...candidates]);
        if (similar) { duplicates.push({ title: g.title, existingId: similar.id, existingTitle: similar.title }); continue; }
        const now = nowIso();
        candidates.push({
          id: newId("idea"), profile: profile.slug, title: g.title.trim().slice(0, 200),
          hook: String(g.hook || "").slice(0, 500), angle: String(g.angle || "").slice(0, 1000), pillar: g.pillar,
          status: "idea", history: [{ at: now, from: null, to: "idea", note: "AI đề xuất; cần nghiên cứu nguồn và duyệt số" }],
          createdAt: now, updatedAt: now,
        });
      }
      candidates.sort((a, b) => priority.indexOf(a.pillar!) - priority.indexOf(b.pillar!));
      candidates.forEach(saveIdea);
      return NextResponse.json({ created: candidates.length, llm: true, pillarOrder: priority, signals, duplicates, ideas: candidates.map(({ id, title, pillar }) => ({ id, title, pillar })) });
    }
    const existing = own.map((i) => i.title);
    const gen = await generateIdeas(profile, n, String(topic), existing);
    const created: Idea[] = gen.map((g) => ({
      id: newId("idea"), profile: profile.slug, title: g.title, hook: g.hook, angle: g.angle, pillar: g.pillar,
      sample: !llmConfigured() || undefined, status: "idea",
      history: [{ at: nowIso(), from: null, to: "idea", note: llmConfigured() ? `AI sinh (${process.env.LLM_MODEL})` : "Mẫu (chưa cấu hình LLM)" }],
      createdAt: nowIso(), updatedAt: nowIso(),
    }));
    created.forEach(saveIdea);
    return NextResponse.json({ created: created.length, llm: llmConfigured() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
