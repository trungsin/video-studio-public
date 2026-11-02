import ActionButton from "@/components/ActionButton";
import AutoPublishPanel from "@/components/AutoPublishPanel";
import CastEditor from "@/components/CastEditor";
import SectionEditor from "@/components/SectionEditor";
import TtsSettings from "@/components/TtsSettings";
import ImageProviderSelect from "@/components/ImageProviderSelect";
import { imageProviderOptions } from "@/lib/image-provider";
import { listCustomProviders } from "@/lib/provider-store";
import InstagramConnect from "@/components/InstagramConnect";
import YouTubeConnect from "@/components/YouTubeConnect";
import ZernioConnect from "@/components/ZernioConnect";
import { headers } from "next/headers";
import { requestOrigin } from "@/lib/youtube-oauth";
import { currentProfile } from "@/lib/current";
import type { Platform } from "@/lib/types";

const PLAT: Record<Platform, { label: string; abbr: string; cls: string }> = {
  facebook: { label: "Facebook", abbr: "f", cls: "bg-blue-600" },
  instagram: { label: "Instagram", abbr: "IG", cls: "bg-pink-600" },
  telegram: { label: "Telegram", abbr: "TG", cls: "bg-sky-500" },
  threads: { label: "Threads", abbr: "@", cls: "bg-slate-900" },
  tiktok: { label: "TikTok", abbr: "TT", cls: "bg-black" },
  youtube: { label: "YouTube", abbr: "YT", cls: "bg-red-600" },
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ yt?: string; msg?: string; channel?: string; ig?: string; zc?: string; platform?: string }> }) {
  const sp = await searchParams;
  const { profile: p } = await currentProfile();
  const origin = requestOrigin(await headers());
  if (!p) return <div className="card p-6 text-sm">Chưa có profile.</div>;
  const connected = p.channels.filter((c) => c.connected).length;
  const upd = new Date(p.updatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <div className="kicker">Profile &amp; kênh</div>
          <h1 className="mt-1 text-2xl font-bold">{p.name} {p.sample && <span className="pill ml-2 bg-amber-100 align-middle text-amber-800">MẪU</span>}</h1>
          <p className="text-xs text-slate-500">Lưu ở data/profiles/{p.slug}.json · sửa lần cuối {upd}</p>
        </div>
      </header>

      <AutoPublishPanel profile={p.slug} compact />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Kênh đăng bài <span className="ml-1 text-xs font-normal text-slate-400">{connected}/{p.channels.length} đã kết nối</span></h2>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            Từ Zernio · chỉ đọc
            <ActionButton url={`/api/profiles/${p.slug}/sync-channels`} className="text-[11px] font-medium text-slate-700 hover:text-blue-700">⟳ Tải lại</ActionButton>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {p.channels.map((c) => {
            const m = PLAT[c.platform];
            return (
              <div key={c.platform} className="card p-3">
                <div className="flex items-start gap-2">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white ${m.cls}`}>{m.abbr}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold">{m.label}</span>
                      <span className={`pill ${c.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.connected ? "Đã kết nối" : "Chưa kết nối"}</span>
                    </div>
                    <div className="font-mono text-[10px] text-slate-500">{c.handle}</div>
                    <div className="truncate text-[10px] text-slate-500">{c.name}</div>
                    <div className="mt-1 text-[9px] text-slate-400">qua {c.via === "direct" ? "API trực tiếp" : "Zernio"}{c.accountId ? ` · ${c.accountId.slice(0, 8)}…` : ""}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <YouTubeConnect slug={p.slug} profileName={p.name} sample={p.sample} origin={origin} yt={sp.yt} msg={sp.yt ? sp.msg : undefined} channel={sp.channel} connectedName={p.channels.find((c) => c.platform === "youtube" && c.connected)?.name} />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <InstagramConnect slug={p.slug} profileName={p.name} sample={p.sample} ig={sp.ig} msg={sp.ig ? sp.msg : undefined} />
            <ZernioConnect slug={p.slug} profileName={p.name} sample={p.sample} channels={p.channels} zc={sp.zc} platform={sp.platform} msg={sp.zc ? sp.msg : undefined} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Giọng &amp; chân dung</h2>
        <div className="card flex items-center gap-2 px-4 py-3 text-xs">
          <span className="text-slate-500">File nguồn</span>
          <span className="rounded border border-slate-200 px-2 py-0.5 font-mono text-[11px]">voice/{p.slug}.md</span>
          <span className="rounded border border-slate-200 px-2 py-0.5 font-mono text-[11px]">profiles/{p.slug}.json</span>
        </div>
      </section>

      <CastEditor slug={p.slug} characters={p.cast?.characters || []} settings={p.cast?.settings || []} />

      <SectionEditor slug={p.slug} section="info" title="Thông tin chung" items={p.sections.info} layout="wide" />

      <div className="grid grid-cols-2 items-start gap-4">
        <SectionEditor slug={p.slug} section="voice" title="Giọng văn" items={p.sections.voice} />
        <div className="space-y-4">
          <SectionEditor slug={p.slug} section="ttsNotes" title="Giọng đọc TTS / ngữ điệu" items={p.sections.ttsNotes} />
          <TtsSettings slug={p.slug} tts={p.tts} slotTimes={p.slotTimes} />
          <ImageProviderSelect slug={p.slug} value={p.imageProvider || ""} envDefault={process.env.IMAGE_PROVIDER || ""}
            options={imageProviderOptions()}
            configured={{ gemini: !!process.env.GEMINI_API_KEY, quanlop: !!process.env.QUANLOP_IMAGE_API_KEY, openai: !!process.env.IMAGE_API_KEY, xai: !!(process.env.XAI_API_KEY || process.env.IMAGE_API_KEY), "hf-kontext": true,
              ...Object.fromEntries(listCustomProviders().map((c) => [c.id, true])) }} />
          <SectionEditor slug={p.slug} section="colors" title="Màu sắc" items={p.sections.colors} layout="colors" />
          <SectionEditor slug={p.slug} section="hashtags" title="Hashtag" hashtags={p.sections.hashtags} layout="chips" />
        </div>
      </div>
    </div>
  );
}
