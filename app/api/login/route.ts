import { NextResponse } from "next/server";
import { SESSION_COOKIE, safeNext, sessionToken, safeEqual } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const pw = String(form.get("password") || "");
  const expected = await sessionToken();
  if (!expected || !process.env.ADMIN_PASSWORD || !safeEqual(pw, process.env.ADMIN_PASSWORD)) {
    // Location tương đối: chạy đúng sau proxy/Tailscale/tunnel (req.url có thể là 0.0.0.0)
    const n = safeNext(String(form.get("next") || ""));
    return new NextResponse(null, { status: 303, headers: { Location: `/login?err=1${n !== "/" ? `&next=${encodeURIComponent(n)}` : ""}` } });
  }
  const res = new NextResponse(null, { status: 303, headers: { Location: safeNext(String(form.get("next") || "")) } });
  res.cookies.set(SESSION_COOKIE, expected, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
    secure: new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
  });
  return res;
}
