import { NextResponse } from "next/server";
import { PROFILE_COOKIE } from "@/lib/current";
export async function POST(req: Request) {
  const { slug } = await req.json();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PROFILE_COOKIE, String(slug), { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
