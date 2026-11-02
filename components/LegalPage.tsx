import Link from "next/link";
import { siteInfo } from "@/lib/channel-config";
export const UPDATED = "17/10/2026";

/** Khung trang công khai (privacy/terms/welcome), không dùng layout studio. */
export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  const site = siteInfo();
  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <main className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-slate-200 bg-white p-8 text-sm leading-relaxed text-slate-700 shadow-sm">
        <header className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Video Studio · {site.channel}</div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        </header>
        {children}
        <footer className="flex flex-wrap gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <Link href="/" className="hover:text-blue-700">Trang chủ / Home</Link>
          <Link href="/privacy" className="hover:text-blue-700">Chính sách quyền riêng tư / Privacy Policy</Link>
          <Link href="/terms" className="hover:text-blue-700">Điều khoản / Terms</Link>
          {site.fbPage && <a href={site.fbPage} className="hover:text-blue-700" rel="noopener">Liên hệ / Contact</a>}
        </footer>
      </main>
    </div>
  );
}

export const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="pt-2 text-base font-semibold text-slate-900">{children}</h2>;
export const A = ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href} className="text-blue-700 underline" rel="noopener">{children}</a>;
