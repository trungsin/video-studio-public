/**
 * Ghi công ảnh tư liệu (CC BY / CC BY-SA) luôn đi kèm caption, kể cả khi Threads cắt còn 500 ký tự.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCaption } from "../lib/publish";
import { fitThreads } from "../lib/publishers/zernio";
import type { Video } from "../lib/types";

const cred = "📷 Ảnh tư liệu: dronepicr / Wikimedia Commons, CC BY 2.0; Phương Huy / Wikimedia Commons, CC BY-SA 4.0";
const vid = (o: Partial<Video> = {}) => ({ id: "v", ideaId: "i", profile: "p", title: "t", status: "review", scenes: [], caption: "Thân caption.\n🤖 Nhân vật An do AI tạo.", hashtags: ["#a", "#b"], tts: { engine: "edge", voice: "x", rate: "+0%" }, render: { state: "done" }, ...o }) as unknown as Video;

describe("ghi công ảnh tư liệu", () => {
  it("buildCaption chèn dòng credits trước hashtag, không lặp nếu caption đã có", () => {
    const { caption } = buildCaption(vid({ credits: cred }), null);
    const paras = caption.split("\n\n");
    assert.equal(paras[paras.length - 2], cred);
    assert.equal(paras[paras.length - 1], "#a #b");
    const again = buildCaption(vid({ credits: cred, caption: `Thân.\n\n${cred}` }), null).caption;
    assert.equal(again.split(cred).length - 1, 1);
    assert.ok(!buildCaption(vid(), null).caption.includes("📷"));
  });
  it("aiDisclosureText của video thay dòng AI của profile", () => {
    const p = { aiDisclosure: { enabled: true, text: "🤖 Hình ảnh và nhân vật An do AI tạo, chỉ để minh họa." } } as any;
    const line = "🤖 Chỉ nhân vật An do AI tạo; ảnh di tích là ảnh tư liệu thật.";
    const a = buildCaption(vid({ caption: `Thân.\n${line}`, aiDisclosureText: line }), p);
    assert.ok(a.ai); assert.ok(!a.caption.includes("Hình ảnh và nhân vật An")); assert.equal(a.caption.split(line).length - 1, 1);
    const b = buildCaption(vid({ caption: "Thân." }), p).caption;
    assert.ok(b.includes("Hình ảnh và nhân vật An do AI tạo"));
  });
  it("fitThreads cắt phần thân nhưng giữ nguyên dòng ghi công", () => {
    const long = `${"Cửu Đỉnh Huế là bộ chín vạc đồng. ".repeat(20)}\n\n${cred}\n\n#a #b`;
    const out = fitThreads(long);
    assert.ok([...out].length <= 500, String([...out].length));
    assert.ok(out.endsWith(cred));
    assert.ok(out.includes("…"));
  });
});
