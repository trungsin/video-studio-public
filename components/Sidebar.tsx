"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type P = { slug: string; name: string; initials: string; videos: number; sample?: boolean };

const NAV = [
  { href: "/", label: "Hôm nay", icon: "☀", key: "today" },
  { href: "/lich-dang", label: "Lịch đăng", icon: "▦", key: "schedule" },
  { href: "/y-tuong", label: "Sổ ý tưởng", icon: "✎", key: "ideas" },
  { href: "/y-tuong/bang", label: "Bảng nối dây", icon: "⌗", key: "board" },
  { href: "/san-xuat", label: "Sản xuất", icon: "▶", key: "production" },
  { href: "/profile", label: "Profile & kênh", icon: "☺", key: "profile" },
  { href: "/provider", label: "Provider AI", icon: "⚙", key: "provider" },
] as const;

export default function Sidebar({ profiles, current, counts }: { profiles: P[]; current: string | null; counts: Record<string, number> }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const cur = profiles.find((p) => p.slug === current);

  async function pick(slug: string) {
    await fetch("/api/profile-select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) });
    setOpen(false);
    router.refresh();
  }

  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-xs text-white">▶</div>
        <div>
          <div className="text-sm font-semibold leading-tight">Xưởng video</div>
          <div className="text-[11px] text-slate-500">Sản xuất &amp; lịch đăng</div>
        </div>
      </div>
      <div className="relative px-3">
        <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2 py-2 text-left hover:bg-slate-50">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-100 text-[11px] font-semibold text-emerald-700">{cur?.initials || "?"}</span>
          <span className="flex-1">
            <span className="block text-xs font-semibold">{cur?.name || "Chưa có profile"}</span>
            <span className="block text-[10px] text-slate-500">{cur ? `${cur.videos} video${cur.sample ? " · mẫu" : ""}` : ""}</span>
          </span>
          <span className="text-slate-400">⌄</span>
        </button>
        {open && (
          <div className="absolute left-3 right-3 z-20 mt-1 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {profiles.map((p) => (
              <button key={p.slug} onClick={() => pick(p.slug)} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${p.slug === current ? "font-semibold" : ""}`}>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-[9px] text-emerald-700">{p.initials}</span>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <nav className="mt-4 space-y-0.5 px-3">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : n.href === "/y-tuong/bang" ? path.startsWith("/y-tuong/bang") || path.startsWith("/y-tuong/canvas") : path.startsWith(n.href) && !path.startsWith("/y-tuong/bang") && !path.startsWith("/y-tuong/canvas");
          const c = counts[n.key];
          return (
            <Link key={n.href} href={n.href} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${active ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}>
              <span className="w-4 text-center text-slate-400">{n.icon}</span>
              <span className="flex-1">{n.label}</span>
              {c ? (
                <span className={n.key === "today" ? "grid h-4 min-w-4 place-items-center rounded-full bg-blue-600 px-1 text-[10px] text-white" : "text-[10px] text-slate-400"}>{c}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex items-center justify-between border-t border-slate-100 px-4 py-3">
        <div>
          <div className="text-xs font-semibold">admin</div>
          <div className="text-[10px] text-slate-500">Truy cập từ xa</div>
        </div>
        <form action="/api/logout" method="post"><button className="text-[11px] text-slate-600 hover:text-slate-900">⇥ Đăng xuất</button></form>
      </div>
    </aside>
  );
}
