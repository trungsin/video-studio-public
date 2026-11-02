/** Trang công khai (privacy/terms/trang chủ) và chặn trang quản trị.  Chạy: npm test */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { isPublicPath } from "../lib/public-paths";

let middleware: (req: NextRequest) => Promise<Response>;
before(async () => {
  process.env.ADMIN_PASSWORD = "test-pw";
  process.env.SESSION_SECRET = "test-secret";
  middleware = (await import("../middleware")).middleware as any;
});
const req = (p: string, method = "GET") => new NextRequest(`http://127.0.0.1:3100${p}`, { method, headers: { host: "video-studio-box.tail6db48b.ts.net", "x-forwarded-proto": "https" } });

describe("public paths", () => {
  it("privacy/terms/welcome/login công khai; trang quản trị thì không", () => {
    for (const p of ["/privacy", "/terms", "/welcome", "/login", "/privacy/"]) assert.equal(isPublicPath(p), true, p);
    for (const p of ["/", "/profile", "/api/profiles/x/sync-channels", "/privacy-x", "/api/youtube/oauth/start"]) assert.equal(isPublicPath(p), false, p);
  });
});

describe("middleware khi chưa đăng nhập", () => {
  it("/privacy, /terms đi tiếp (không redirect)", async () => {
    for (const p of ["/privacy", "/terms"]) {
      const r = await middleware(req(p));
      assert.equal(r.headers.get("x-middleware-next"), "1", p);
    }
  });
  it("/ -> rewrite sang /welcome (trang chủ công khai)", async () => {
    const r = await middleware(req("/"));
    assert.match(r.headers.get("x-middleware-rewrite") || "", /\/welcome$/);
  });
  it("trang quản trị -> /login (https), API -> 401", async () => {
    const r = await middleware(req("/profile"));
    assert.equal(r.status, 307);
    assert.equal(r.headers.get("location"), "https://video-studio-box.tail6db48b.ts.net/login?next=%2Fprofile");
    const a = await middleware(req("/api/schedule"));
    assert.equal(a.status, 401);
  });
});
