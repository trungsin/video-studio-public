import { NextResponse } from "next/server";
import { listProfiles } from "@/lib/data";
import { deleteCustomProvider, providerKey, providerView, setProviderKey } from "@/lib/provider-store";

/** Xoá provider (chặn khi còn profile dùng) và xoá khoá API khỏi file env. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const used = listProfiles().filter((p) => p.imageProvider === id).map((p) => p.name);
  if (used.length) return NextResponse.json({ error: `Profile đang dùng: ${used.join(", ")}. Đổi provider ở trang Profile trước.` }, { status: 409 });
  if (!deleteCustomProvider(id)) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  if (providerKey(id)) setProviderKey(id, "");
  return NextResponse.json({ providers: providerView() });
}
