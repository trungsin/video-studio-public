import { NextResponse } from "next/server";
import path from "node:path";
import { MEDIA_DIR } from "@/lib/data";
import { runMediaGen } from "@/lib/gen";
import { isCustomProvider } from "@/lib/provider-store";
import { mediaUrl } from "@/lib/media-url";

export const maxDuration = 400;

const DEFAULT_PROMPT = "A cozy Vietnamese kitchen at morning light, a bowl of pho on a wooden table. Photorealistic vertical 9:16 photo, no text, no watermark.";

/** Sinh thử 1 ảnh bằng provider (không dự phòng) để kiểm tra base URL/khoá/model trước khi gán cho profile. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!isCustomProvider(id)) return NextResponse.json({ error: "Không tìm thấy provider" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { prompt?: string };
  const prompt = String(body.prompt || "").trim().slice(0, 2000) || DEFAULT_PROMPT;
  const rel = path.join("provider-test", `${id}-${Date.now().toString(36)}.png`);
  const t0 = Date.now();
  try {
    // IMAGE_FALLBACK=none: lỗi của provider này hiện ra, không bị che bởi provider dự phòng
    await runMediaGen(["image", "--prompt", prompt, "--out", path.join(MEDIA_DIR, rel), "--provider", id], 6 * 60_000, { IMAGE_FALLBACK: "none" });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, url: mediaUrl(rel), ms: Date.now() - t0 });
}
