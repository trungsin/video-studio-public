import { NextResponse } from "next/server";
import { runDuePublishing } from "@/lib/publish";

/** Cron/HTTP trigger: POST với cookie admin hoặc Authorization: Bearer CRON_SECRET */
export async function POST() {
  const logs: string[] = [];
  const r = await runDuePublishing(new Date(), 12, (s) => logs.push(s));
  return NextResponse.json({ ...r, logs });
}
