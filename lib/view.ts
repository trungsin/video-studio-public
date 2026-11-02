import type { Idea, ScheduleEntry, Video } from "./types";

export type CellState = "ready" | "pending" | "error" | "empty";
export const CELL_STYLE: Record<CellState, string> = {
  ready: "bg-emerald-100 border-emerald-300",
  pending: "bg-amber-50 border-amber-200",
  error: "bg-rose-100 border-rose-300",
  empty: "bg-white border-slate-200 border-dashed",
};
export const CELL_LABEL: Record<CellState, string> = { ready: "Sẵn sàng", pending: "Chờ duyệt", error: "Có lỗi", empty: "Trống" };

export function entryState(e: ScheduleEntry | undefined, ideas: Map<string, Idea>, videos: Map<string, Video>): CellState {
  if (!e) return "empty";
  if (e.status === "failed") return "error";
  const v = e.videoId ? videos.get(e.videoId) : undefined;
  if (v?.render.state === "error") return "error";
  if (e.status === "published") return "ready";
  const i = e.ideaId ? ideas.get(e.ideaId) : undefined;
  if (v?.render.state === "done" && (v.status === "done" || v.status === "published")) return "ready";
  if (i && ["ready", "scheduled", "published"].includes(i.status)) return "ready";
  return "pending";
}

export function stagePills(i?: Idea, v?: Video): { text: string; cls: string }[] {
  if (!i) return [];
  const pills: { text: string; cls: string }[] = [];
  const order = ["idea", "script", "mow", "legal", "production", "ready", "scheduled", "published"];
  const at = order.indexOf(i.status);
  if (i.status === "rejected") return [{ text: "Bị loại", cls: "bg-rose-100 text-rose-700" }];
  pills.push(at <= 2 ? { text: "MOW chờ", cls: "bg-amber-100 text-amber-800" } : { text: "MOW ✓", cls: "bg-emerald-50 text-emerald-700" });
  pills.push(at <= 3 ? { text: "Legal chưa rà", cls: "bg-slate-100 text-slate-600" } : { text: "Legal ✓", cls: "bg-emerald-50 text-emerald-700" });
  if (v) {
    const r = v.render.state;
    if (r === "error") pills.push({ text: "Render lỗi", cls: "bg-rose-100 text-rose-700" });
    else if (r === "running" || r === "queued") pills.push({ text: "Đang render", cls: "bg-blue-50 text-blue-700" });
    else if (r === "done") pills.push({ text: "Có video", cls: "bg-blue-50 text-blue-700" });
  }
  return pills;
}
