import { guardPublish } from "../owner";
import type { Channel, Platform, Profile, PublishResult } from "../types";
import { zernioEnvForProfile, zernioKeyName } from "../zernio-connect";
import { zernioDedicated } from "../channel-config";
import { directEnvForProfile } from "../profile-env";
import { dryrun, wrapDry } from "./dryrun";
import { facebook } from "./facebook";
import { instagram } from "./instagram";
import { realCtx } from "./http";
import { tiktok } from "./tiktok";
import type { PublishJob, Publisher } from "./types";
import { youtube } from "./youtube";
import { zernio, zernioCtxForProfile } from "./zernio";

export const DIRECT: Publisher[] = [facebook, instagram, youtube, tiktok];

/** Chọn adapter thật: kênh via=direct (nếu có adapter) > Zernio (có accountId) > adapter trực tiếp bất kỳ đã cấu hình. */
export function pickReal(platform: Platform, channel?: Channel, env: Record<string, string | undefined> = process.env, slug?: string): Publisher | null {
  const directEnv = directEnvForProfile(platform, slug, env);
  const direct = DIRECT.find((d) => d.supports(platform) && d.configured(directEnv));
  if (channel?.via === "direct") return direct || null;
  const configured = zernio.configured(zernioEnvForProfile(slug, env));
  if (zernioDedicated(slug, env) && channel?.via === "zernio") return configured ? zernio : null;
  if (configured && channel?.accountId) return zernio;
  return direct || (configured ? zernio : null);
}

/**
 * PUBLISH_DRY_RUN=1: mô phỏng adapter mà bản thật sẽ dùng; nếu chưa cấu hình gì thì mô phỏng
 * adapter trực tiếp của nền tảng (via=zernio thì mô phỏng Zernio).
 */
export function pickPublisher(platform: Platform, channel?: Channel, env: Record<string, string | undefined> = process.env, slug?: string): Publisher | null {
  if (zernioDedicated(slug, env) && channel?.via === "zernio" && !zernio.configured(zernioEnvForProfile(slug, env))) return null;
  if (dryrun.configured(env)) {
    const real = pickReal(platform, channel, env, slug);
    const fallback = channel?.via === "zernio" ? zernio : DIRECT.find((d) => d.supports(platform)) || zernio;
    return wrapDry(real || fallback, directEnvForProfile(platform, slug, env));
  }
  return pickReal(platform, channel, env, slug);
}

/**
 * opts.live=true: đăng thật cho riêng lần gọi này dù PUBLISH_DRY_RUN=1 (dùng cho lệnh đăng thử có duyệt và scheduler tự động).
 */
export async function publishTo(job: PublishJob, channel?: Channel, profile?: Pick<Profile, "slug" | "sample"> | null, opts: { live?: boolean } = {}): Promise<PublishResult> {
  const at = new Date().toISOString();
  const env = opts.live ? { ...process.env, PUBLISH_DRY_RUN: "0" } : process.env;
  const dry = dryrun.configured(env);
  const publishEnv = directEnvForProfile(job.platform, profile?.slug, env);
  const zernioEnv = zernioEnvForProfile(profile?.slug, env);
  if (zernioDedicated(profile?.slug, env) && channel?.via === "zernio" && !zernio.configured(zernioEnv)) {
    return { platform: job.platform, ok: false, error: `Chưa cấu hình ${zernioKeyName(profile?.slug)}`, at, via: "none" };
  }
  const real = pickReal(job.platform, channel, publishEnv, profile?.slug);
  const target = real || (dry ? (channel?.via === "zernio" ? zernio : DIRECT.find((d) => d.supports(job.platform)) || zernio) : null);
  if (!target) return { platform: job.platform, ok: false, error: `Chưa cấu hình adapter đăng cho ${job.platform} (${zernioKeyName(profile?.slug)} hoặc khoá API trực tiếp)`, at, via: "none" };
  const blocked = guardPublish(job.platform, profile, DIRECT.includes(target), publishEnv);
  if (blocked) return { platform: job.platform, ok: false, error: blocked, at, via: dry ? `dry-run:${target.name}` : target.name };
  const pub = dry ? wrapDry(target, publishEnv) : target;
  try {
    const r = await pub.publish({ ...job, accountId: channel?.accountId || job.accountId }, target === zernio && !dry ? zernioCtxForProfile(profile?.slug) : !dry && DIRECT.includes(target) ? { ...realCtx(), env: publishEnv } : undefined);
    return { ...r, at, via: pub.name };
  } catch (e) {
    return { platform: job.platform, ok: false, error: (e as Error).message, at, via: pub.name };
  }
}

export type { PublishJob, Publisher };
