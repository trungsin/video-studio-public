import { isEditorial } from "@/lib/channel-config";
import { NextResponse } from "next/server";
import { getIdea, getProfile, getVideo, saveIdea, saveVideo, setIdeaStatus } from "@/lib/data";
import { approvedEvidence } from "@/lib/idea-research";
import { invalidateEditorial } from "@/lib/editorial-production";
import { analyze, graphToScenes, newSourceLines, scenesHash, type ScriptGraph, validateGraph } from "@/lib/graph";
import { loadCanvas, writeGraph } from "@/lib/graph-store";
import { invalidateRender } from "@/lib/workflow";

/** "Tạo kịch bản": đồ thị -> scenes của video (data/videos/<id>.json) hoặc idea.script. Chỉ ghi khi có thay đổi. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const c = loadCanvas(id);
  if (!c) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  const { graph, confirmQueued } = (await req.json()) as { graph: ScriptGraph; confirmQueued?: boolean };
  const err = validateGraph(graph);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const a = analyze(graph, { maxSec: c.ctx.maxSec });
  const scenes = graphToScenes(graph);
  if (!scenes.length) return NextResponse.json({ error: "Chưa có cảnh nào nối tới nút Video", analysis: a }, { status: 400 });
  if (!scenes.some((s) => s.narration.trim())) return NextResponse.json({ error: "Các cảnh chưa có lời đọc", analysis: a }, { status: 400 });
  const hash = scenesHash(scenes);
  const g: ScriptGraph = { ...graph, version: 1, id: c.ctx.graphId, profile: c.ctx.profile, ideaId: c.ctx.ideaId, videoId: c.ctx.videoId };
  if (c.ctx.videoId) {
    const v = getVideo(c.ctx.videoId)!;
    const idea = isEditorial(v.profile) ? getIdea(v.ideaId) : null;
    if (isEditorial(v.profile) && !idea) return NextResponse.json({ error: "Thiếu ý tưởng gốc" }, { status: 409 });
    if (isEditorial(v.profile) && !approvedEvidence(idea!)) return NextResponse.json({ error: "Chưa duyệt nguồn cho kịch bản" }, { status: 409 });
    const changed = scenesHash(v.scenes) !== hash;
    if (changed && v.render.state === "running") return NextResponse.json({ error: "Video đang render, đợi xong rồi ghi" }, { status: 409 });
    if (isEditorial(v.profile) && v.status === "published" && changed) return NextResponse.json({ error: "Video đã đăng, không thể sửa" }, { status: 409 });
    const queued = c.ctx.video?.inQueue;
    if (changed && queued && !confirmQueued) return NextResponse.json({ needConfirm: true, error: "Video đã render và đang trong hàng đợi đăng tự động. Ghi kịch bản mới sẽ đưa video về 'Đang làm' (rút khỏi hàng đợi) cho tới khi render lại và đánh dấu review." }, { status: 409 });
    const add = isEditorial(v.profile) ? [] : newSourceLines(g, v.sources || []);
    if (changed || add.length) {
      if (changed) {
        v.scenes = scenes;
        if (isEditorial(v.profile) && idea) {
          invalidateEditorial(idea, "Canvas đã thay đổi; cần duyệt kịch bản lại");
          idea.script = { scenes, caption: v.caption, hashtags: v.hashtags };
          saveIdea(idea);
          v.editorial = undefined;
          if (v.render.state === "done") v.render.state = "idle";
          v.status = "doing";
        } else invalidateRender(v);
      }
      if (add.length) v.sources = [...(v.sources || []), ...add];
      saveVideo(v);
    }
    writeGraph({ ...g, sourceHash: hash });
    return NextResponse.json({ ok: true, changed, target: "video", scenes: scenes.length, totalSec: a.totalSec, addedSources: add.length, status: v.status, needRender: changed, sourceHash: hash });
  }
  const i = getIdea(c.ctx.ideaId!)!;
  if (isEditorial(i.profile) && !approvedEvidence(i)) return NextResponse.json({ error: "Chưa duyệt nguồn cho kịch bản" }, { status: 409 });
  const changed = !i.script || scenesHash(i.script.scenes) !== hash;
  if (changed) {
    const p = getProfile(i.profile);
    if (isEditorial(i.profile) && i.script) invalidateEditorial(i, "Canvas đã thay đổi; cần duyệt kịch bản lại");
    i.script = { scenes, caption: i.script?.caption || i.title, hashtags: i.script?.hashtags || p?.sections.hashtags.slice(0, 4) || [], cta: i.script?.cta };
    if (i.status === "idea") setIdeaStatus(i, "script", "Dựng kịch bản từ canvas");
    saveIdea(i);
  }
  writeGraph({ ...g, sourceHash: hash });
  return NextResponse.json({ ok: true, changed, target: "idea", scenes: scenes.length, totalSec: a.totalSec, status: i.status, sourceHash: hash });
}
