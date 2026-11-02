import path from "node:path";
import { DATA_DIR, getVideo, writeJson } from "./data";
import { NCS_PILLARS } from "./idea-research";
import type { Idea, Platform } from "./types";
import fs from "node:fs";

export interface EditorialMetric {
  videoId: string;
  platform: Platform;
  source: string; // Original export ID or public analytics URL, not an inferred metric.
  observedFrom: string;
  observedTo: string;
  views: number;
  comments: number;
  commentSamples?: string[];
}

const PLATFORMS: Platform[] = ["facebook", "instagram", "tiktok", "youtube", "threads", "telegram"];
const file = (profile: string) => path.join(DATA_DIR, "editorial-metrics", `${profile}.json`);

export function readEditorialMetrics(profile: string): EditorialMetric[] {
  try {
    const json = JSON.parse(fs.readFileSync(file(profile), "utf8"));
    return Array.isArray(json.entries) ? json.entries as EditorialMetric[] : [];
  } catch { return []; }
}

export function parseEditorialMetrics(raw: unknown, profile: string): EditorialMetric[] {
  if (!raw || typeof raw !== "object" || !("entries" in raw) || !Array.isArray(raw.entries)) throw new Error("Cần danh sách entries có nguồn gốc");
  const entries: unknown[] = raw.entries;
  if (!entries.length || entries.length > 500) throw new Error("Số lượng metrics phải từ 1 đến 500");
  return entries.map((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Metrics không hợp lệ");
    const m = input as Record<string, unknown>;
    const video = typeof m.videoId === "string" && /^[-\w]{1,64}$/.test(m.videoId) ? getVideo(m.videoId) : null;
    if (!video || video.profile !== profile) throw new Error("Video không thuộc profile hiện tại");
    if (!PLATFORMS.includes(m.platform as Platform)) throw new Error("Nền tảng không hợp lệ");
    const source = m.source, from = m.observedFrom, to = m.observedTo;
    if (typeof source !== "string" || !source.trim() || source.length > 300 || typeof from !== "string" || !from.trim() || from.length > 300 || typeof to !== "string" || !to.trim() || to.length > 300) throw new Error("Thiếu nguồn gốc và khoảng thời gian đo");
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(from) > Date.parse(to)) throw new Error("Khoảng thời gian đo không hợp lệ");
    const views = m.views, comments = m.comments;
    if (typeof views !== "number" || !Number.isSafeInteger(views) || views < 0 || typeof comments !== "number" || !Number.isSafeInteger(comments) || comments < 0) throw new Error("Số views/comments không hợp lệ");
    const samples = m.commentSamples;
    if (samples !== undefined && (!Array.isArray(samples) || samples.length > 30 || samples.some((s: unknown) => typeof s !== "string" || s.length > 500))) throw new Error("Mẫu bình luận không hợp lệ");
    return { videoId: video.id, platform: m.platform as Platform, source: source.trim(), observedFrom: from, observedTo: to, views, comments, ...(samples ? { commentSamples: samples as string[] } : {}) };
  });
}

export function saveEditorialMetrics(profile: string, imported: EditorialMetric[]): EditorialMetric[] {
  const stored = readEditorialMetrics(profile);
  for (const record of imported) {
    const idx = stored.findIndex((old) => old.videoId === record.videoId && old.platform === record.platform && old.source === record.source && old.observedFrom === record.observedFrom && old.observedTo === record.observedTo);
    if (idx === -1) stored.push(record);
    else stored[idx] = record;
  }
  writeJson(file(profile), { entries: stored });
  return stored;
}

/** No imported observations -> no signal. Counts are never substituted by guessed engagement. */
export function pillarSignals(metrics: EditorialMetric[], ideas: Idea[]): { pillar: string; videos: number; views: number; comments: number }[] {
  const ideasById = new Map(ideas.filter((idea) => idea.videoId).map((idea) => [idea.videoId!, idea]));
  return NCS_PILLARS.flatMap((pillar) => {
    const observed = metrics.filter((m) => ideasById.get(m.videoId)?.pillar === pillar);
    if (!observed.length) return [];
    return [{ pillar, videos: new Set(observed.map((m) => m.videoId)).size, views: observed.reduce((sum, m) => sum + m.views, 0), comments: observed.reduce((sum, m) => sum + m.comments, 0) }];
  });
}
