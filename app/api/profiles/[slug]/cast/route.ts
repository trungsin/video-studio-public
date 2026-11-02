import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, getProfile, newId, saveProfile } from "@/lib/data";
import { runMediaGen } from "@/lib/gen";
import { providerArgs } from "@/lib/image-provider";
import type { CastRef, Profile } from "@/lib/types";

export const maxDuration = 400;
type Kind = "characters" | "settings";
const IMG = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function list(p: Profile, kind: Kind) {
  p.cast ||= { characters: [], settings: [] };
  return p.cast[kind];
}

/**
 * POST multipart: action=create|addRefs, kind=characters|settings, id?, name, description, files (nhiều)
 * POST json: {action:"generate", kind, id, prompt?}  -> sinh ảnh ref mới bằng IMAGE_PROVIDER (dùng ref hiện có làm tham chiếu)
 * PATCH json: {kind, id, name?, description?, removeRef?}
 * DELETE ?kind=&id=
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const p = getProfile((await params).slug);
  if (!p) return NextResponse.json({ error: "Không tìm thấy profile" }, { status: 404 });
  const dir = path.join("assets", p.slug);
  fs.mkdirSync(path.join(DATA_DIR, dir), { recursive: true });

  if ((req.headers.get("content-type") || "").includes("application/json")) {
    const b = await req.json();
    if (b.action !== "generate") return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 });
    const item = list(p, b.kind as Kind).find((x) => x.id === b.id);
    if (!item) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
    const prompt = b.prompt || (b.kind === "characters"
      ? `Photorealistic upper-body portrait of a fictional person (not a real or famous person): ${item.description}. Plain light background, soft daylight, looking at camera.`
      : `Photorealistic vertical photo of this place, no people: ${item.description}.`);
    const rel = path.join(dir, `${item.id}-${Date.now().toString(36)}.png`);
    try {
      const refs = item.refs.map((r) => path.join(DATA_DIR, r));
      await runMediaGen(["image", "--prompt", prompt, "--out", path.join(DATA_DIR, rel), ...refs.flatMap((r) => ["--ref", r]), ...providerArgs(p)]);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
    item.refs.push(rel);
    saveProfile(p);
    return NextResponse.json(item);
  }

  const form = await req.formData();
  const kind = String(form.get("kind")) as Kind;
  if (kind !== "characters" && kind !== "settings") return NextResponse.json({ error: "kind không hợp lệ" }, { status: 400 });
  const arr = list(p, kind);
  let item: CastRef | undefined;
  if (form.get("action") === "create") {
    const name = String(form.get("name") || "").trim();
    if (!name) return NextResponse.json({ error: "Thiếu tên" }, { status: 400 });
    item = { id: newId(kind === "characters" ? "char" : "set"), name, description: String(form.get("description") || "").trim(), refs: [] };
    arr.push(item);
  } else {
    item = arr.find((x) => x.id === form.get("id"));
    if (!item) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }
  for (const f of form.getAll("files")) {
    if (!(f instanceof File) || !f.size) continue;
    const ext = path.extname(f.name).toLowerCase();
    if (!IMG.has(ext)) return NextResponse.json({ error: "Chỉ nhận ảnh jpg/png/webp" }, { status: 400 });
    if (f.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Ảnh quá lớn (>15MB)" }, { status: 400 });
    const rel = path.join(dir, `${item.id}-${Date.now().toString(36)}${item.refs.length}${ext}`);
    fs.writeFileSync(path.join(DATA_DIR, rel), Buffer.from(await f.arrayBuffer()));
    item.refs.push(rel);
  }
  saveProfile(p);
  return NextResponse.json(item);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const p = getProfile((await params).slug);
  if (!p) return NextResponse.json({ error: "Không tìm thấy profile" }, { status: 404 });
  const b = await req.json();
  const item = list(p, b.kind as Kind).find((x) => x.id === b.id);
  if (!item) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  if (typeof b.name === "string") item.name = b.name;
  if (typeof b.description === "string") item.description = b.description;
  if (b.removeRef) item.refs = item.refs.filter((r) => r !== b.removeRef);
  if (b.makeFirst && item.refs.includes(b.makeFirst)) item.refs = [b.makeFirst, ...item.refs.filter((r) => r !== b.makeFirst)];
  saveProfile(p);
  return NextResponse.json(item);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const p = getProfile((await params).slug);
  if (!p) return NextResponse.json({ error: "Không tìm thấy profile" }, { status: 404 });
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind") as Kind;
  p.cast ||= { characters: [], settings: [] };
  p.cast[kind] = list(p, kind).filter((x) => x.id !== u.searchParams.get("id"));
  saveProfile(p);
  return NextResponse.json({ ok: true });
}
