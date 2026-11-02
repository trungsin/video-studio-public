import fs from "node:fs";
import path from "node:path";

const KEY = /^[A-Z][A-Z0-9_]*$/;

/** Định dạng giá trị cho .env: giữ nguyên nếu an toàn, ngược lại bọc nháy kép. */
function fmt(v: string) {
  if (/[\r\n]/.test(v)) throw new Error("Giá trị .env không được chứa xuống dòng");
  return /^[A-Za-z0-9_./:@+\-=,~%]*$/.test(v) ? v : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Ghi/đổi các khoá trong file .env, giữ nguyên các dòng khác (comment, thứ tự).
 * - Sao lưu bản cũ sang <file>.bak (chmod 600) trước khi ghi.
 * - Ghi nguyên tử (tmp + rename), quyền 600.
 * Không bao giờ log giá trị. Trả về danh sách khoá đã đổi.
 */
export function upsertEnv(file: string, updates: Record<string, string>): string[] {
  for (const k of Object.keys(updates)) if (!KEY.test(k)) throw new Error(`Tên biến .env không hợp lệ: ${k}`);
  // .env có thể là symlink tới thư mục bí mật: ghi vào file đích, không thay symlink bằng file thường
  try { file = fs.realpathSync(file); } catch { /* chưa tồn tại */ }
  const exists = fs.existsSync(file);
  const old = exists ? fs.readFileSync(file, "utf8") : "";
  const lines = old.length ? old.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const done = new Set<string>();
  const out = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m || !(m[1] in updates)) return line;
    if (done.has(m[1])) return null; // bỏ dòng trùng
    done.add(m[1]);
    return `${m[1]}=${fmt(updates[m[1]])}`;
  }).filter((l): l is string => l !== null);
  for (const [k, v] of Object.entries(updates)) if (!done.has(k)) out.push(`${k}=${fmt(v)}`);
  if (exists) {
    const bak = `${file}.bak`;
    fs.writeFileSync(bak, old, { mode: 0o600 });
    fs.chmodSync(bak, 0o600);
  }
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, out.join("\n") + "\n", { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  return Object.keys(updates);
}
