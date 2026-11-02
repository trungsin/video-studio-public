import { isEditorial } from "@/lib/channel-config";
import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/current";
import { listIdeas } from "@/lib/data";
import { parseEditorialMetrics, pillarSignals, readEditorialMetrics, saveEditorialMetrics } from "@/lib/editorial-metrics";

export async function GET() {
  const { profile } = await currentProfile();
  if (!profile || !isEditorial(profile.slug)) return NextResponse.json({ error: "Chỉ áp dụng cho profile biên tập (EDITORIAL_PROFILE)" }, { status: 404 });
  const entries = readEditorialMetrics(profile.slug);
  return NextResponse.json({ entries, signals: pillarSignals(entries, listIdeas(profile.slug)) });
}

export async function POST(req: Request) {
  const { profile } = await currentProfile();
  if (!profile || !isEditorial(profile.slug)) return NextResponse.json({ error: "Chỉ áp dụng cho profile biên tập (EDITORIAL_PROFILE)" }, { status: 404 });
  try {
    const imported = parseEditorialMetrics(await req.json(), profile.slug);
    const entries = saveEditorialMetrics(profile.slug, imported);
    return NextResponse.json({ imported: imported.length, entries, signals: pillarSignals(entries, listIdeas(profile.slug)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
