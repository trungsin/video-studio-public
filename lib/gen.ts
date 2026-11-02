import { execFile } from "node:child_process";
import path from "node:path";

/** Gọi worker/media_gen.py (đồng bộ). Trả {ok,out} hoặc ném lỗi kèm stderr. */
export function runMediaGen(args: string[], timeoutMs = 6 * 60_000, extraEnv: Record<string, string> = {}): Promise<{ ok: boolean; out: string | null }> {
  return new Promise((resolve, reject) => {
    execFile(process.env.PYTHON_BIN || "python3", [path.resolve("worker/media_gen.py"), ...args], { timeout: timeoutMs, env: { ...process.env, ...extraEnv }, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      const last = stdout.trim().split("\n").pop() || "";
      try {
        const j = JSON.parse(last);
        if (j.ok) return resolve(j);
        return reject(new Error("Chưa cấu hình IMAGE_PROVIDER / VIDEO_PROVIDER (xem README)"));
      } catch {
        reject(new Error((stderr || String(err || "lỗi media_gen")).trim().split("\n").slice(-3).join(" ")));
      }
    });
  });
}
