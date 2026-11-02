import "./channel-env";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { approvedEvidence, braveLeads, duplicateOf, evidenceDigest, fetchPrimaryHtml, htmlText, parseEvidenceDraft, publicAddress, quoteFound, quoteHasValue, rotatedPillars, sourceUrl } from "../lib/idea-research";
import type { Idea, IdeaEvidenceDraft } from "../lib/types";

const draft: IdeaEvidenceDraft = {
  value: 0.917, unit: "g/cm³", quote: "At 0°C, ice has a density of 0.917 g/cm³.",
  url: "https://example.org/density", publisher: "Viện đo lường", location: "Bảng 2, hàng băng", conditions: "Nước tinh khiết ở 0°C", caveat: "Không áp dụng trực tiếp cho nước biển", publishedAt: "2026-01",
};
const idea = (title: string, pillar = "Trong nhà", angle = ""): Idea => ({
  id: title, profile: "kenh-bien-tap", title, angle, pillar, status: "idea", history: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
});

const oldEnv = { ...process.env };
let temp = "";
before(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-editorial-evidence-")); process.env.DATA_DIR = temp; });
after(() => { for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]; Object.assign(process.env, oldEnv); fs.rmSync(temp, { recursive: true, force: true }); });

describe("evidence revision and primary citation", () => {
  it("accepts only an explicit approval of the exact revision; any citation/number/context change invalidates", () => {
    const digest = evidenceDigest(draft);
    const current: Idea = { ...idea("Băng nổi"), evidence: { draft, digest } };
    assert.equal(approvedEvidence(current), null);
    current.evidence = { draft, digest, approved: { digest, at: "2026-10-20T00:00:00Z", by: "admin" } };
    assert.deepEqual(approvedEvidence(current), { ...draft, digest });
    for (const field of ["value", "unit", "quote", "url", "publisher", "location", "conditions", "caveat", "publishedAt"] as const) {
      const changed = { ...draft, [field]: field === "value" ? 1 : `${draft[field]} edited` } as IdeaEvidenceDraft;
      assert.notEqual(evidenceDigest(changed), digest, field);
      assert.equal(approvedEvidence({ ...current, evidence: { ...current.evidence, draft: changed } }), null, field);
    }
  });
  it("requires bounded fields, original quote, numeric match and readable primary HTML", () => {
    assert.deepEqual(parseEvidenceDraft(draft), draft);
    assert.throws(() => parseEvidenceDraft({ ...draft, value: Infinity }), /hữu hạn/);
    assert.throws(() => parseEvidenceDraft({ ...draft, quote: "x".repeat(2001) }), /quote/);
    assert.throws(() => parseEvidenceDraft({ ...draft, unit: "" }), /unit/);
    const text = htmlText("<style>hidden 2</style><p>At 0°C, ice has a density of <b>0.917</b> g/cm&#179;.</p><script>fake 99</script>");
    assert.ok(quoteFound(text, "At 0°C, ice has a density of 0.917 g/cm³."));
    assert.ok(!quoteFound(text, "fake 99"));
    assert.ok(quoteHasValue(draft.quote, draft.value));
    assert.ok(!quoteHasValue("A result of 0.918 g/cm³", draft.value));
  });
  it("rejects unsafe addresses and URL schemes without connecting to the machine", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.18.0.1", "192.168.1.1", "100.100.100.100", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.equal(publicAddress(ip), false, ip);
    assert.equal(publicAddress("8.8.8.8"), true);
    assert.throws(() => sourceUrl("file:///etc/passwd"), /không an toàn/);
    assert.throws(() => sourceUrl("https://user:pass@example.org"), /không an toàn/);
    await assert.rejects(fetchPrimaryHtml("http://127.0.0.1/secret"), /không công khai/);
    await assert.rejects(fetchPrimaryHtml("http://169.254.169.254/latest/meta-data"), /không công khai/);
  });
  it("returns no search snippets or approvals when Brave key is absent", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    assert.equal(await braveLeads("density ice"), null);
    assert.equal(approvedEvidence({ ...idea("Nguồn"), plan: { sources: "Trusted university: 0.917" } }), null);
  });
});

describe("candidate and audience provenance", () => {
  it("detects a repeated question and its underlying mechanism against previous ideas", () => {
    const existing = [idea("Tại sao ly có đá không tràn?", "Trong nhà", "Đá nổi do khối lượng riêng thấp hơn nước")];
    assert.equal(duplicateOf({ title: "Tai sao ly co da khong tran" }, existing)?.id, existing[0].id);
    assert.equal(duplicateOf({ title: "Một câu hỏi mới về cầu vồng", angle: "Da noi do khoi luong rieng thap hon nuoc" }, existing)?.id, existing[0].id);
    assert.equal(duplicateOf({ title: "Ếch ngủ đông ở đâu" }, existing), null);
    assert.deepEqual(rotatedPillars(existing), ["Đồ vật", "Trời", "Loài Việt Nam", "Trong nhà"]);
  });
  it("requires source and real video attribution, and returns no signal with no import", async () => {
    fs.mkdirSync(path.join(temp, "videos"), { recursive: true });
    fs.writeFileSync(path.join(temp, "videos", "vid-test.json"), JSON.stringify({ id: "vid-test", ideaId: "idea-test", profile: "kenh-bien-tap" }));
    // DATA_DIR is captured when lib/data loads; import after assigning the isolated fixture directory.
    const { parseEditorialMetrics, pillarSignals } = await import("../lib/editorial-metrics");
    const data = { entries: [{ videoId: "vid-test", platform: "youtube", source: "export-123", observedFrom: "2026-10-01", observedTo: "2026-10-20", views: 24, comments: 3 }] };
    assert.deepEqual(pillarSignals([], []), []);
    assert.equal(parseEditorialMetrics(data, "kenh-bien-tap")[0].views, 24);
    assert.throws(() => parseEditorialMetrics({ entries: [{ ...data.entries[0], source: "" }] }, "kenh-bien-tap"), /nguồn gốc/);
    assert.throws(() => parseEditorialMetrics({ entries: [{ ...data.entries[0], videoId: "unknown" }] }, "kenh-bien-tap"), /Video/);
    assert.throws(() => parseEditorialMetrics({ entries: [{ ...data.entries[0], views: -1 }] }, "kenh-bien-tap"), /views/);
    assert.deepEqual(pillarSignals(parseEditorialMetrics(data, "kenh-bien-tap"), [{ ...idea("Đá"), videoId: "vid-test" }]), [{ pillar: "Trong nhà", videos: 1, views: 24, comments: 3 }]);
  });
});
