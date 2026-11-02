import crypto from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Idea, IdeaEvidenceDraft } from "./types";

export const NCS_PILLARS = ["Trong nhà", "Đồ vật", "Trời", "Loài Việt Nam"] as const;

export function evidenceDigest(draft: IdeaEvidenceDraft): string {
  const { value, unit, quote, url, publisher, location, conditions, caveat, publishedAt } = draft;
  return crypto.createHash("sha256").update(JSON.stringify([value, unit, quote, url, publisher, location, conditions, caveat, publishedAt ?? null])).digest("hex");
}

export function approvedEvidence(idea: Idea): (IdeaEvidenceDraft & { digest: string }) | null {
  const evidence = idea.evidence;
  if (!evidence?.approved || !evidence.draft || evidence.digest !== evidence.approved.digest || evidenceDigest(evidence.draft) !== evidence.digest) return null;
  return { ...evidence.draft, digest: evidence.digest };
}

export function parseEvidenceDraft(raw: unknown): IdeaEvidenceDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Thiếu bản trích dẫn");
  const input = raw as Record<string, unknown>;
  const fields = ["unit", "quote", "url", "publisher", "location", "conditions", "caveat"] as const;
  const result = {} as IdeaEvidenceDraft;
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) throw new Error("Số liệu phải là số hữu hạn");
  result.value = input.value;
  for (const field of fields) {
    if (typeof input[field] !== "string" || !input[field].trim() || input[field].length > (field === "quote" ? 2000 : 500)) throw new Error(`Thiếu hoặc sai ${field}`);
    result[field] = input[field].trim();
  }
  if (input.publishedAt !== undefined && input.publishedAt !== "") {
    if (typeof input.publishedAt !== "string" || input.publishedAt.length > 100) throw new Error("Ngày/phiên bản không hợp lệ");
    result.publishedAt = input.publishedAt.trim();
  }
  sourceUrl(result.url);
  return result;
}

export function sourceUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("URL nguồn không hợp lệ"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || url.hostname.endsWith(".") || url.hostname.includes("%")) throw new Error("URL nguồn không an toàn");
  return url;
}

/** Reject all non-global addresses, including DNS answers, redirect targets and IPv4-mapped IPv6. */
export function publicAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113 || a === 192 && b === 0 && c === 2 || a === 192 && b === 0 && c === 0);
  }
  if (net.isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  if (lower.includes(".")) return false; // IPv4-mapped and mixed IPv6 forms must not bypass IPv4 rules.
  const first = Number.parseInt(lower.split(":")[0] || "0", 16);
  if (Number.isNaN(first) || first < 0x2000 || first > 0x3fff) return false;
  if (lower.startsWith("2001:db8:") || lower === "2001:db8::") return false;
  return true;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp|ndash|mdash);/gi, (_, entity: string) => {
    if (entity[0] === "#") { const n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10); return n <= 0x10ffff ? String.fromCodePoint(n) : " "; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—" } as Record<string, string>)[entity.toLowerCase()] || " ";
  });
}

export function htmlText(html: string): string {
  return decodeEntities(html.replace(/<\s*(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/gu, " ").trim();
}

export function quoteFound(body: string, quote: string): boolean {
  return body.normalize("NFC").replace(/\s+/gu, " ").includes(quote.normalize("NFC").replace(/\s+/gu, " ").trim());
}

export function quoteHasValue(quote: string, value: number): boolean {
  const matches = quote.match(/(?<![\d\p{L}])[-+]?\d[\d.,\s]*\d|(?<![\d\p{L}])[-+]?\d/gu) || [];
  return matches.some((token) => {
    const s = token.trim().replace(/\s/g, "");
    const variants = [s.replace(/,/g, "."), s.replace(/\./g, "").replace(",", "."), s.replace(/,/g, "")];
    return variants.some((v) => Number(v) === value);
  });
}

/** Resolves and pins a public IP for each hop; no proxy, automatic redirect or unbounded download. */
export async function fetchPrimaryHtml(raw: string): Promise<{ url: string; text: string }> {
  let url = sourceUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    let timer: NodeJS.Timeout | undefined;
    const records = await Promise.race([
      dns.lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Tra cứu DNS quá chậm")), 5000); }),
    ]).finally(() => clearTimeout(timer));
    if (!records.length || records.some((r) => !publicAddress(r.address))) throw new Error("Địa chỉ nguồn không công khai");
    const selected = records.find((r) => r.family === 4) || records[0];
    const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).request(url, {
        method: "GET", headers: { accept: "text/html", "accept-encoding": "identity", "user-agent": "VideoStudio-Research/1.0" },
        lookup: (_host, options, callback) => {
          const cb = typeof options === "function" ? options : callback;
          const opts = typeof options === "object" ? options : {};
          if (opts.all) cb(null, [{ address: selected.address, family: selected.family }]);
          else cb(null, selected.address, selected.family);
        },
        timeout: 7000, signal: AbortSignal.timeout(7000), servername: url.hostname,
      }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) { request.destroy(new Error("Trang nguồn vượt giới hạn 2 MB")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks) }));
        response.on("error", reject);
      });
      request.on("timeout", () => request.destroy(new Error("Nguồn phản hồi quá chậm")));
      request.on("error", reject);
      request.end();
    });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (hop === 3 || !result.headers.location) throw new Error("Nguồn chuyển hướng quá nhiều lần");
      url = sourceUrl(new URL(result.headers.location, url).href);
      continue;
    }
    if (result.status !== 200) throw new Error("Không đọc được trang nguồn; cần nghiên cứu thủ công");
    if (!/^text\/html(?:;|$)/i.test(result.headers["content-type"] || "") || result.headers["content-encoding"] && result.headers["content-encoding"] !== "identity") throw new Error("Nguồn không phải HTML đọc được; cần kiểm tra thủ công");
    const charset = /charset=([\w-]+)/i.exec(result.headers["content-type"] || "")?.[1] || "utf-8";
    let html: string;
    try { html = new TextDecoder(charset).decode(result.body); } catch { throw new Error("Bảng mã trang nguồn không hỗ trợ"); }
    return { url: url.href, text: htmlText(html).slice(0, 512 * 1024) };
  }
  throw new Error("Nguồn chuyển hướng quá nhiều lần");
}

export async function braveLeads(query: string): Promise<{ title: string; url: string; description: string }[] | null> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return null;
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query.slice(0, 180));
  endpoint.searchParams.set("count", "8");
  const response = await fetch(endpoint, { redirect: "error", signal: AbortSignal.timeout(7000), headers: { accept: "application/json", "x-subscription-token": key } });
  if (!response.ok) throw new Error("Không lấy được gợi ý tìm kiếm");
  const length = Number(response.headers.get("content-length"));
  if (length > 128 * 1024) throw new Error("Kết quả tìm kiếm quá lớn");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Không lấy được gợi ý tìm kiếm");
  let bytes = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 128 * 1024) { await reader.cancel(); throw new Error("Kết quả tìm kiếm quá lớn"); }
    parts.push(value);
  }
  const json = JSON.parse(new TextDecoder().decode(Buffer.concat(parts))) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (json.web?.results || []).flatMap((item) => {
    if (!item.url) return [];
    try { sourceUrl(item.url); } catch { return []; }
    return [{ title: String(item.title || "").slice(0, 200), url: item.url, description: String(item.description || "").slice(0, 400) }];
  });
}

export function normalizedQuestion(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Mechanism comparison deliberately errs toward review, not automatic acceptance of near duplicates. */
export function duplicateOf(candidate: { title: string; hook?: string; angle?: string }, ideas: Idea[]): Idea | null {
  const normalized = normalizedQuestion(candidate.title);
  if (!normalized) return ideas[0] || null;
  const tokens = (s: string) => new Set(normalizedQuestion(s).split(" ").filter((x) => x.length > 2));
  const similarity = (a: string, b: string) => {
    const x = tokens(a), y = tokens(b);
    return x.size && y.size ? [...x].filter((t) => y.has(t)).length / Math.min(x.size, y.size) : 0;
  };
  return ideas.find((i) => normalizedQuestion(i.title) === normalized || similarity(candidate.title, i.title) >= 0.8 ||
    candidate.angle && (similarity(candidate.angle, i.angle || i.plan?.main || "") >= 0.8) ||
    candidate.hook && similarity(candidate.hook, i.hook || "") >= 0.85) || null;
}

export function rotatedPillars(ideas: Idea[]): string[] {
  const prior = ideas.filter((i) => NCS_PILLARS.includes(i.pillar as typeof NCS_PILLARS[number]));
  const last = prior.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.pillar;
  const offset = last ? (NCS_PILLARS.indexOf(last as typeof NCS_PILLARS[number]) + 1) % NCS_PILLARS.length : 0;
  return [...NCS_PILLARS.slice(offset), ...NCS_PILLARS.slice(0, offset)];
}
