import fs from "node:fs";
import path from "node:path";

/** Nạp .env đơn giản (không ghi đè biến đã có, không in giá trị). */
export function loadEnv(file = path.resolve(".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  process.env.DATA_DIR ||= path.resolve("data");
  process.env.MEDIA_DIR ||= path.resolve("media");
}
