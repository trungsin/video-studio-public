import fs from "node:fs";

type Env = Record<string, string | undefined>;
type YtKey = "YT_REFRESH_TOKEN" | "YT_TOKEN_CLIENT" | "YT_TOKEN_ISSUED_AT" | "YT_CHANNEL_ID";
const YT_KEYS: YtKey[] = ["YT_REFRESH_TOKEN", "YT_TOKEN_CLIENT", "YT_TOKEN_ISSUED_AT", "YT_CHANNEL_ID"];
const STORED_KEY = /^(?:YT_PROFILE|YT_(?:REFRESH_TOKEN|TOKEN_CLIENT|TOKEN_ISSUED_AT|CHANNEL_ID)(?:_PROFILE_[0-9A-F]+)?)$/;

/** Hex-encode the entire UTF-8 slug: punctuation and underscores cannot collide in env names. */
export function ytCredentialKey(slug: string, key: YtKey): string {
  return `${key}_PROFILE_${Buffer.from(slug, "utf8").toString("hex").toUpperCase()}`;
}

/** Read only credential keys from the mounted env file, not arbitrary application settings. */
function freshCredentials(env: Env): Env {
  if (!env.ENV_FILE) return env;
  let text: string;
  try { text = fs.readFileSync(env.ENV_FILE, "utf8"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      const fresh: Env = { ...env };
      for (const key of Object.keys(fresh)) if (STORED_KEY.test(key)) delete fresh[key];
      return fresh;
    }
    throw e;
  }
  const fresh: Env = { ...env };
  for (const key of Object.keys(fresh)) if (STORED_KEY.test(key)) delete fresh[key];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || !STORED_KEY.test(m[1])) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    fresh[m[1]] = value;
  }
  return fresh;
}

/** Resolve ONLY this profile's token; legacy global keys belong exclusively to YT_PROFILE. */
export function ytEnvForProfile(slug: string, env: Env = process.env): Env {
  const source = freshCredentials(env);
  const resolved: Env = { ...source };
  const suffix = `_PROFILE_${Buffer.from(slug, "utf8").toString("hex").toUpperCase()}`;
  for (const key of Object.keys(resolved)) {
    if (/^YT_(?:REFRESH_TOKEN|TOKEN_CLIENT|TOKEN_ISSUED_AT|CHANNEL_ID)_PROFILE_[0-9A-F]+$/.test(key) && !key.endsWith(suffix)) delete resolved[key];
  }
  const scoped = source[ytCredentialKey(slug, "YT_REFRESH_TOKEN")] !== undefined;
  for (const key of YT_KEYS) {
    resolved[key] = scoped ? source[ytCredentialKey(slug, key)] : source.YT_PROFILE === slug ? source[key] : undefined;
  }
  return resolved;
}

export function ytConnected(slug: string, env: Env = process.env): boolean {
  return Boolean(ytEnvForProfile(slug, env).YT_REFRESH_TOKEN);
}
