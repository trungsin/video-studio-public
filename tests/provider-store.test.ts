import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { upsertEnv } from "../lib/envfile";
import { cleanProvider, deleteCustomProvider, listCustomProviders, maskKey, providerKey, providerKeyEnv, upsertCustomProvider } from "../lib/provider-store";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "prov-"));
const base = { id: "cliproxy-gpt", kind: "openai", baseUrl: "http://cliproxyapi:8317/v1/", model: "gpt-image-2" };

describe("provider ảnh tự thêm", () => {
  it("chuẩn hoá và từ chối dữ liệu xấu", () => {
    const p = cleanProvider({ ...base, size: "1024x1536", maxRefs: "4" });
    assert.equal(p.baseUrl, "http://cliproxyapi:8317/v1");
    assert.equal(p.label, "cliproxy-gpt");
    assert.equal(p.maxRefs, 4);
    assert.throws(() => cleanProvider({ ...base, id: "gemini" }), /trùng/);
    assert.throws(() => cleanProvider({ ...base, id: "--ref /etc" }), /ID/);
    assert.throws(() => cleanProvider({ ...base, baseUrl: "file:///etc/passwd" }), /http/);
    assert.throws(() => cleanProvider({ ...base, kind: "shell" }), /Kiểu API/);
    assert.throws(() => cleanProvider({ ...base, model: "" }), /model/);
    assert.throws(() => cleanProvider({ ...base, size: "big" }), /Kích thước/);
  });
  it("lưu, sửa, xoá trong file JSON", () => {
    const file = path.join(tmp(), "image-providers.json");
    upsertCustomProvider(cleanProvider(base), file);
    upsertCustomProvider(cleanProvider({ ...base, model: "gpt-image-1.5" }), file);
    assert.deepEqual(listCustomProviders(file).map((p) => p.model), ["gpt-image-1.5"]);
    assert.equal(deleteCustomProvider("cliproxy-gpt", file), true);
    assert.equal(deleteCustomProvider("cliproxy-gpt", file), false);
    assert.deepEqual(listCustomProviders(file), []);
  });
  it("khoá đọc từ file env (mới hơn process.env), che khi hiển thị", () => {
    const dir = tmp(), env = path.join(dir, ".env");
    fs.writeFileSync(env, "A=1\n");
    upsertEnv(env, { [providerKeyEnv("cliproxy-gpt")]: "sk-secret-abcd" });
    assert.equal(providerKeyEnv("cliproxy-gpt"), "IMAGE_PROVIDER_KEY__CLIPROXY_GPT");
    assert.equal(providerKey("cliproxy-gpt", { ENV_FILE: env, IMAGE_PROVIDER_KEY__CLIPROXY_GPT: "old" }), "sk-secret-abcd");
    assert.equal(maskKey("sk-secret-abcd"), "sk-…abcd");
  });
  it("upsertEnv ghi xuyên symlink, không thay symlink bằng file", () => {
    const dir = tmp(), real = path.join(dir, "real.env"), link = path.join(dir, ".env");
    fs.writeFileSync(real, "A=1\n"); fs.symlinkSync(real, link);
    upsertEnv(link, { B: "2" });
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(real, "utf8"), "A=1\nB=2\n");
  });
});
