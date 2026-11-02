import Link from "next/link";
import { notFound } from "next/navigation";
import VideoEditor from "@/components/VideoEditor";
import { castOf } from "@/lib/cast";
import { getProfile, getVideo } from "@/lib/data";
import { imageFallbackFor, imageProviderFor } from "@/lib/image-provider";
import { archiveMap } from "@/lib/thumbs";

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const v = getVideo((await params).id);
  if (!v) notFound();
  const p = getProfile(v.profile);
  return (
    <div className="space-y-4">
      <Link href="/san-xuat" className="text-xs text-slate-500">‹ Sản xuất</Link>
      <VideoEditor initial={v} channels={(p?.channels || []).map((c) => ({ platform: c.platform, connected: c.connected }))} dryRun={process.env.PUBLISH_DRY_RUN === "1"}
        cast={{ characters: castOf(p).characters.map((x) => ({ id: x.id, name: x.name, thumb: x.refs[0] })), settings: castOf(p).settings.map((x) => ({ id: x.id, name: x.name, thumb: x.refs[0] })) }}
        imageProvider={(() => { const ip = imageProviderFor(p); const fb = ip ? imageFallbackFor(ip) : []; return ip ? `${ip}${fb.length ? ` (dự phòng: ${fb.join(", ")})` : ""}` : ""; })()}
        videoProvider={process.env.VIDEO_PROVIDER || ""} archive={archiveMap(v)} />
    </div>
  );
}
