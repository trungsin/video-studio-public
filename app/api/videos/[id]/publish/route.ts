import { NextResponse } from "next/server";
import { publishVideo } from "@/lib/publish";
import type { Platform } from "@/lib/types";

/** Đăng ngay (bỏ qua lịch). Body: {platforms: ["facebook","tiktok",...]} */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { platforms } = (await req.json()) as { platforms: Platform[] };
  if (!platforms?.length) return NextResponse.json({ error: "Chọn ít nhất một nền tảng" }, { status: 400 });
  try {
    const results = await publishVideo((await params).id, platforms);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
