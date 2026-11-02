import { NextResponse } from "next/server";
import { cleanProvider, listCustomProviders, providerView, setProviderKey, upsertCustomProvider } from "@/lib/provider-store";

export async function GET() {
  return NextResponse.json({ providers: providerView() });
}

/** Thêm/sửa provider. Body: cấu hình + apiKey (tuỳ chọn; trống = giữ khoá cũ) + clearKey (xoá khoá). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const p = cleanProvider(body);
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (/[\r\n]/.test(apiKey)) throw new Error("Khoá API không hợp lệ");
    if (body.create && listCustomProviders().some((x) => x.id === p.id)) throw new Error(`Đã có provider "${p.id}"`);
    upsertCustomProvider(p);
    if (apiKey) setProviderKey(p.id, apiKey);
    else if (body.clearKey) setProviderKey(p.id, "");
    return NextResponse.json({ providers: providerView() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
