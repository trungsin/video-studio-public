import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageFallbackFor, imageProviderFor, providerArgs, validImageProvider } from "../lib/image-provider";

describe("image provider theo profile/env", () => {
  it("profile ghi đè IMAGE_PROVIDER, giá trị lạ bị bỏ qua", () => {
    assert.equal(imageProviderFor({ imageProvider: "quanlop" }, { IMAGE_PROVIDER: "gemini" }), "quanlop");
    assert.equal(imageProviderFor({ imageProvider: "evil;rm" }, { IMAGE_PROVIDER: "gemini" }), "gemini");
    assert.equal(imageProviderFor(null, { IMAGE_BASE_URL: "x" }), "openai");
    assert.equal(imageProviderFor(undefined, {}), "");
  });
  it("dự phòng: quanlop -> gemini mặc định, IMAGE_FALLBACK ghi đè", () => {
    assert.deepEqual(imageFallbackFor("quanlop", {}), ["gemini"]);
    assert.deepEqual(imageFallbackFor("gemini", {}), []);
    assert.deepEqual(imageFallbackFor("gemini", { IMAGE_FALLBACK: "quanlop" }), ["quanlop"]);
    assert.deepEqual(imageFallbackFor("quanlop", { IMAGE_FALLBACK: "none" }), []);
  });
  it("tham số CLI chỉ khi profile chọn provider hợp lệ", () => {
    assert.deepEqual(providerArgs({ imageProvider: "quanlop" }), ["--provider", "quanlop"]);
    assert.deepEqual(providerArgs({ imageProvider: "--ref /etc/passwd" }), []);
    assert.deepEqual(providerArgs({}), []);
    assert.equal(validImageProvider("gemini"), true);
    assert.equal(validImageProvider(""), false);
  });
});
