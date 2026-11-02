import { NextResponse } from "next/server";
import { getVideo } from "@/lib/data";
import { queueVideoRender } from "@/lib/editorial-production";

/** Đưa video vào hàng đợi render: chạy worker/render.py tách rời (detached), worker tự ghi tiến độ vào data/videos/<id>.json */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = getVideo((await params).id);
  if (!v) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  try {
    const pid = queueVideoRender(v);
    return NextResponse.json({ ok: true, pid });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ error: message }, { status: message === "Đang render" ? 409 : 400 });
  }
}
