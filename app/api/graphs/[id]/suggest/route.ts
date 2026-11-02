import { NextResponse } from "next/server";
import { getIdea, getProfile } from "@/lib/data";
import { scenesToGraph } from "@/lib/graph";
import { loadCanvas } from "@/lib/graph-store";
import { suggestScript } from "@/lib/suggest";

/** "Gợi ý": nháp hook/fact/cảnh từ ý tưởng (LLM nếu có; Gemini 402 -> báo rõ + nháp từ dữ liệu ý tưởng). Không ghi gì, client tự thay đồ thị. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = loadCanvas((await params).id);
  if (!c || !c.ctx.ideaId) return NextResponse.json({ error: "Không tìm thấy ý tưởng" }, { status: 404 });
  const i = getIdea(c.ctx.ideaId); const p = i && getProfile(i.profile);
  if (!i || !p) return NextResponse.json({ error: "Không tìm thấy ý tưởng/profile" }, { status: 404 });
  const s = await suggestScript(p, i);
  const g = scenesToGraph(s.scenes, {
    profile: p.slug, ideaId: i.id, videoId: c.ctx.videoId, title: c.ctx.title, facts: s.facts, characterRefs: c.ctx.characterRefs,
    idea: { title: i.title, hook: i.hook, angle: i.angle, series: i.plan?.series, eraName: i.plan?.eraName },
  });
  // An ở hook + CTA: dùng clip/ảnh có sẵn (không sinh mặt mới)
  const rev = [...c.ctx.an].reverse();
  const hookClip = rev.find((m) => m.kind === "clip" && /hook/i.test(m.ref));
  const ctaClip = rev.find((m) => m.kind === "clip" && /cta/i.test(m.ref));
  const img = c.ctx.an.find((m) => m.kind === "image");
  const sc = g.nodes.filter((n) => ["hook", "cta"].includes(n.type));
  for (const n of sc) {
    const clip = n.type === "hook" ? hookClip : ctaClip;
    const id = `${n.id}-an`;
    g.nodes.push({ id, type: "character", position: { x: n.position.x, y: n.position.y - 230 }, data: { characterId: c.ctx.characterId, name: c.ctx.characterName, ...(clip ? { clip: clip.ref } : {}), ...(img ? { image: img.ref } : {}) } });
    g.edges.push({ id: `e-${id}-${n.id}`, source: id, target: n.id, sourceHandle: "out", targetHandle: "visual" });
  }
  g.sourceHash = undefined;
  return NextResponse.json({ graph: g, source: s.source, message: s.message });
}
