import { NextResponse } from "next/server";
import { type ScriptGraph, validateGraph } from "@/lib/graph";
import { loadCanvas, writeGraph } from "@/lib/graph-store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = loadCanvas((await params).id);
  return c ? NextResponse.json(c) : NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
}

/** Lưu bố cục + dữ liệu nút (chỉ ghi data/graphs/<id>.json, không đụng video/idea). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const c = loadCanvas(id);
  if (!c) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 2_000_000) return NextResponse.json({ error: "Đồ thị quá lớn" }, { status: 413 });
  const { graph } = JSON.parse(raw) as { graph: ScriptGraph };
  const err = validateGraph(graph);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  writeGraph({ ...graph, version: 1, id: c.ctx.graphId, profile: c.ctx.profile, ideaId: c.ctx.ideaId, videoId: c.ctx.videoId, sourceHash: graph.sourceHash ?? c.graph.sourceHash });
  return NextResponse.json({ ok: true });
}
