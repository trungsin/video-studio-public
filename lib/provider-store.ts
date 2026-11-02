import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, listProfiles, writeJson } from "./data";
import { upsertEnv } from "./envfile";

/**
 * Provider ảnh tự thêm trên giao diện (trang "Provider AI").
 * Cấu hình (không bí mật) lưu ở data/image-providers.json; khoá API lưu trong file env
 * (IMAGE_PROVIDER_KEY__<ID>), worker/media_gen.py đọc cả hai mỗi lần sinh ảnh.
 */
export type CustomImageProvider = {
  id: string;
  label: string;
  /** openai = /images/generations + /images/edits (CLIProxyAPI, OpenAI, gateway); gemini = :generateContent */
  kind: "openai" | "gemini";
  baseUrl: string;
  model: string;
  size?: string;
  /** Số ảnh ref tối đa gửi kèm; 0 = chỉ prompt. Trống = mặc định của kind. */
  maxRefs?: number;
  note?: string;
  updatedAt?: string;
};

export const BUILTIN_IMAGE_PROVIDERS = ["gemini", "quanlop", "openai", "xai", "hf-kontext"] as const;
export const CUSTOM_KINDS = ["openai", "gemini"] as const;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const SIZE_RE = /^\d{3,4}x\d{3,4}$/;

export const providersFile = () => path.join(DATA_DIR, "image-providers.json");
export const providerKeyEnv = (id: string) => `IMAGE_PROVIDER_KEY__${id.toUpperCase().replace(/-/g, "_")}`;

export function listCustomProviders(file = providersFile()): CustomImageProvider[] {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { providers?: CustomImageProvider[] };
    return (j.providers || []).filter((p) => p && ID_RE.test(p.id) && (CUSTOM_KINDS as readonly string[]).includes(p.kind));
  } catch {
    return [];
  }
}

export const isCustomProvider = (id: string, file = providersFile()) => listCustomProviders(file).some((p) => p.id === id);

/** Kiểm tra + chuẩn hoá dữ liệu form. Ném lỗi tiếng Việt khi không hợp lệ. */
export function cleanProvider(input: Record<string, unknown>): CustomImageProvider {
  const id = String(input.id || "").trim().toLowerCase();
  if (!ID_RE.test(id)) throw new Error("ID chỉ gồm a-z, 0-9, dấu gạch ngang (2–31 ký tự)");
  if ((BUILTIN_IMAGE_PROVIDERS as readonly string[]).includes(id)) throw new Error(`ID "${id}" trùng provider có sẵn`);
  const kind = String(input.kind || "openai");
  if (!(CUSTOM_KINDS as readonly string[]).includes(kind)) throw new Error("Kiểu API phải là openai hoặc gemini");
  const baseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, "");
  let u: URL;
  try { u = new URL(baseUrl); } catch { throw new Error("Base URL không hợp lệ"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Base URL phải là http(s)");
  const model = String(input.model || "").trim();
  if (!model || model.length > 120 || /\s/.test(model)) throw new Error("Thiếu model (VD gpt-image-2)");
  const size = String(input.size || "").trim();
  if (size && !SIZE_RE.test(size)) throw new Error("Kích thước dạng 1024x1536");
  const rawRefs = input.maxRefs;
  const maxRefs = rawRefs === "" || rawRefs === undefined || rawRefs === null ? undefined : Number(rawRefs);
  if (maxRefs !== undefined && !(Number.isInteger(maxRefs) && maxRefs >= 0 && maxRefs <= 16)) throw new Error("Số ảnh ref 0–16");
  return {
    id, kind: kind as CustomImageProvider["kind"], baseUrl, model,
    label: String(input.label || "").trim().slice(0, 60) || id,
    ...(size ? { size } : {}),
    ...(maxRefs !== undefined ? { maxRefs } : {}),
    ...(input.note ? { note: String(input.note).trim().slice(0, 300) } : {}),
  };
}

function saveAll(list: CustomImageProvider[], file: string) {
  writeJson(file, { providers: list });
}

export function upsertCustomProvider(p: CustomImageProvider, file = providersFile()) {
  const list = listCustomProviders(file);
  const i = list.findIndex((x) => x.id === p.id);
  const next = { ...p, updatedAt: new Date().toISOString() };
  if (i >= 0) list[i] = next; else list.push(next);
  saveAll(list, file);
  return next;
}

export function deleteCustomProvider(id: string, file = providersFile()) {
  const list = listCustomProviders(file);
  if (!list.some((x) => x.id === id)) return false;
  saveAll(list.filter((x) => x.id !== id), file);
  return true;
}

const envFile = () => process.env.ENV_FILE || path.resolve(".env");

/** Đọc khoá hiện hành (file env mới nhất, rồi process.env). Chỉ dùng để biết đã có khoá hay chưa. */
export function providerKey(id: string, env: Record<string, string | undefined> = process.env): string {
  const name = providerKeyEnv(id);
  try {
    for (const line of fs.readFileSync(env.ENV_FILE || envFile(), "utf8").split(/\r?\n/).reverse()) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && m[1] === name) return m[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  } catch { /* không có file env */ }
  return env[name] || "";
}

/** Ghi khoá API vào file env (giữ dòng khác, sao lưu .bak) và cập nhật process.env cho các lần gọi sau. "" = xoá khoá. */
export function setProviderKey(id: string, key: string) {
  const name = providerKeyEnv(id);
  upsertEnv(envFile(), { [name]: key });
  if (key) process.env[name] = key; else delete process.env[name];
}

/** Hiển thị khoá dạng che: sk-…abcd */
export const maskKey = (k: string) => (!k ? "" : k.length <= 8 ? "••••" : `${k.slice(0, 3)}…${k.slice(-4)}`);

/** Dữ liệu cho giao diện: cấu hình + đã có khoá chưa (dạng che) + profile nào đang dùng. Không trả khoá thật. */
export function providerView() {
  const profiles = listProfiles();
  return listCustomProviders().map((p) => {
    const key = providerKey(p.id);
    return { ...p, hasKey: Boolean(key), keyMask: maskKey(key), usedBy: profiles.filter((x) => x.imageProvider === p.id).map((x) => x.slug) };
  });
}
export type ProviderView = ReturnType<typeof providerView>[number];
