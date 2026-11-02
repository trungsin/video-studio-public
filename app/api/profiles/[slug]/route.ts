import { NextResponse } from "next/server";
import { getProfile, newId, saveProfile } from "@/lib/data";
import type { ColorItem, Item } from "@/lib/types";
import { validImageProvider } from "@/lib/image-provider";

type Body = { section: "info" | "voice" | "ttsNotes" | "colors" | "hashtags" | "meta"; op: "add" | "update" | "delete"; item: Partial<ColorItem> & Record<string, unknown> };

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const p = getProfile((await params).slug);
  return p ? NextResponse.json(p) : NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const p = getProfile((await params).slug);
  if (!p) return NextResponse.json({ error: "Không tìm thấy profile" }, { status: 404 });
  const { section, op, item } = (await req.json()) as Body;

  if (section === "meta") {
    // cập nhật tts / slotTimes / channels / name / brand
    for (const k of ["name", "initials", "tagline", "brand", "tts", "slotTimes", "channels"] as const) if (k in item) (p as any)[k] = item[k];
    if ("imageProvider" in item) {
      const v = item.imageProvider;
      if (v === "" || v === null) delete p.imageProvider;
      else if (validImageProvider(v)) p.imageProvider = v;
      else return NextResponse.json({ error: "imageProvider không hợp lệ" }, { status: 400 });
    }
  } else if (section === "hashtags") {
    const tag = String(item.value || item.id || "").trim().replace(/^#?/, "#");
    if (op === "add" && tag.length > 1 && !p.sections.hashtags.includes(tag)) p.sections.hashtags.push(tag);
    if (op === "delete") p.sections.hashtags = p.sections.hashtags.filter((h) => h !== item.id);
  } else if (["info", "voice", "ttsNotes", "colors"].includes(section)) {
    const list = p.sections[section] as (Item | ColorItem)[];
    const clean = { label: String(item.label || "").trim(), value: String(item.value || "").trim(), ...(section === "colors" ? { hex: String(item.hex || "#cccccc") } : {}) };
    if (op === "add") {
      if (!clean.label) return NextResponse.json({ error: "Thiếu nhãn" }, { status: 400 });
      list.push({ id: newId(section), ...clean } as ColorItem);
    } else {
      const idx = list.findIndex((x) => x.id === item.id);
      if (idx < 0) return NextResponse.json({ error: "Không tìm thấy mục" }, { status: 404 });
      if (op === "update") list[idx] = { ...list[idx], ...clean };
      else list.splice(idx, 1);
    }
  } else return NextResponse.json({ error: "section không hợp lệ" }, { status: 400 });

  saveProfile(p);
  return NextResponse.json(p);
}
