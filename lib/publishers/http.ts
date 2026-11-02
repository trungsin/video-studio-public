import fs from "node:fs";
import { Readable } from "node:stream";
import type { PublishCtx } from "./types";

export const DEFAULT_GRAPH_VERSION = "v26.0";

export function realCtx(): PublishCtx {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    env: process.env,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (l) => console.log(l),
    dryRun: false,
  };
}

/** Mô tả body dạng stream để dry-run in ra mà không đọc file */
export const streamInfo = new WeakMap<object, string>();

/** Body stream từ file (không nạp cả file vào RAM). Dùng kèm `duplex: "half"`. */
export function fileStream(file: string, start = 0, end?: number): ReadableStream<Uint8Array> {
  const node = fs.createReadStream(file, { start, end });
  const web = Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;
  const size = fs.statSync(file).size;
  const last = end ?? size - 1;
  streamInfo.set(web, `<file ${file} bytes ${start}-${last} (${last - start + 1} B)>`);
  return web;
}

export const STREAM_INIT = { duplex: "half" } as unknown as RequestInit;

export function num(env: Record<string, string | undefined>, k: string, d: number) {
  const v = Number(env[k]);
  return Number.isFinite(v) && env[k] !== "" && env[k] != null ? v : d;
}

/** Đọc JSON an toàn (Graph trả lỗi dạng JSON; đôi khi rỗng hoặc text). */
export async function readJson(r: Response): Promise<any> {
  const t = await r.text();
  if (!t) return {};
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; }
}

/** Gom thông báo lỗi Graph/rupload thành câu dễ hiểu (không chứa token). */
export function graphError(step: string, status: number, j: any): string {
  const e = j?.error || j?.debug_info;
  if (e) {
    const bits = [e.message, e.error_user_msg, e.type, e.code != null ? `code ${e.code}` : "", e.error_subcode ? `sub ${e.error_subcode}` : "", e.fbtrace_id ? `trace ${e.fbtrace_id}` : ""].filter(Boolean);
    return redact(`${step}: HTTP ${status} - ${bits.join(" | ")}`);
  }
  return redact(`${step}: HTTP ${status}${j?.raw ? ` - ${j.raw}` : ""}`);
}

/** Xoá token khỏi chuỗi log/lỗi. */
export function redact(s: string): string {
  return s
    .replace(/(access_token=)[^&\s"']+/gi, "$1<redacted>")
    .replace(/((?:authorization|Authorization)["']?\s*[:=]\s*["']?(?:Bearer|OAuth)\s+)[^\s"',}]+/g, "$1<redacted>");
}
