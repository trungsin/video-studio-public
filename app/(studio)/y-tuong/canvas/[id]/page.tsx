import { notFound } from "next/navigation";
import ScriptCanvas from "@/components/canvas/ScriptCanvas";
import { loadCanvas } from "@/lib/graph-store";

export const dynamic = "force-dynamic";

export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) notFound();
  const c = loadCanvas(id);
  if (!c) notFound();
  return <ScriptCanvas key={c.ctx.graphId} initial={c.graph} ctx={c.ctx} />;
}
