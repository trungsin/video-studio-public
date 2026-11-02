import type { Visual } from "@/lib/thumbs";

const BADGE: Partial<Record<Visual["kind"], string>> = { clip: "▶", render: "▶" };

/** Ảnh đại diện 9:16 nhỏ cho danh sách (ảnh cảnh, ảnh tư liệu, poster clip/MP4, hoặc nhân vật kênh khi chưa có video). */
export default function Thumb({ v, className = "h-14 w-8" }: { v?: Visual | null; className?: string }) {
  if (!v || v.kind === "none" || !v.thumb) return <div className={`grid shrink-0 place-items-center rounded bg-slate-900 text-[9px] text-white ${className}`}>9:16</div>;
  const title = [v.label, v.credit].filter(Boolean).join("\n") || undefined;
  return (
    <div className={`relative shrink-0 overflow-hidden rounded bg-slate-200 ${className}`} title={title}>
      <img src={v.thumb} alt="" loading="lazy" className={`h-full w-full object-cover ${v.kind === "cast" ? "opacity-50 grayscale" : ""}`} />
      {v.kind === "archive" && <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[8px] leading-3 text-white">📷{v.count && v.count > 1 ? ` ${v.count}` : ""}</span>}
      {BADGE[v.kind] && <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-0.5 text-[8px] leading-3 text-white">{BADGE[v.kind]}</span>}
    </div>
  );
}
