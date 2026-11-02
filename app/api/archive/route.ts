import { execFile } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/data";
import { archiveLibrary } from "@/lib/graph-store";
import { archiveItems } from "@/lib/thumbs";

const py = (args: string[], timeout = 90_000) => new Promise<string>((ok, bad) =>
  execFile(process.env.PYTHON_BIN || "python3", [path.resolve("worker/archive.py"), ...args], { timeout, maxBuffer: 4 << 20, env: { ...process.env, DATA_DIR } },
    (err, stdout, stderr) => (err ? bad(new Error((stderr || err.message).toString().slice(-400))) : ok(stdout))));

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Tìm ảnh tư liệu: thư viện data/archive (luôn) + Wikimedia Commons (commons=1, đã lọc giấy phép PD/CC0/CC BY/CC BY-SA). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").trim().slice(0, 200);
  const toks = fold(q).split(/\s+/).filter(Boolean);
  const local = archiveLibrary().filter((a) => !toks.length || toks.every((t) => fold(`${a.id} ${a.label} ${a.title} ${a.author}`).includes(t)));
  let commons: unknown[] = []; let error: string | undefined;
  if (u.searchParams.get("commons") === "1" && q) {
    try { commons = JSON.parse((await py(["search", q, "--limit", "12", "--json"])).trim() || "[]"); } catch (e) { error = `Commons: ${(e as Error).message}`; }
  }
  return NextResponse.json({ local, commons, error });
}

/** Thêm một file Commons vào thư viện (tải + kiểm giấy phép + ghi index/CREDITS). */
export async function POST(req: Request) {
  const { topic, title } = (await req.json()) as { topic?: string; title?: string };
  if (!topic || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(topic)) return NextResponse.json({ error: "topic chỉ gồm a-z, 0-9, '-'" }, { status: 400 });
  if (!title || !/^File:/.test(title) || title.length > 300 || /[\n\r]/.test(title)) return NextResponse.json({ error: "title phải là 'File:…' trên Commons" }, { status: 400 });
  try {
    const it = JSON.parse(await py(["add", "--topic", topic, title]));
    const [view] = archiveItems({ archive: { items: [{ id: it.id }] } });
    return NextResponse.json({ item: view });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
