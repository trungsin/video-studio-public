import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { A } from "@/components/LegalPage";
import { siteInfo } from "@/lib/channel-config";

export const dynamic = "force-dynamic";   // nội dung lấy từ SITE_* lúc chạy
export const generateMetadata = (): Metadata => ({ title: `Video Studio · ${siteInfo().channel}` });

/** Trang chủ công khai (hiện ở "/" khi chưa đăng nhập). */
export default function WelcomePage() {
  const site = siteInfo();
  return (
    <LegalPage title={`Video Studio · ${site.channel}`}>
      <p>Công cụ cá nhân của {site.owner} để sản xuất và đăng {site.kindVi} cho kênh <b>{site.channel}</b> (Facebook, TikTok, YouTube). Ứng dụng dùng YouTube API Services chỉ để tải video của chính chủ kênh lên kênh của mình.</p>
      <p>A personal tool by {site.owner} for producing and publishing {site.kindEn} for the channel <b>{site.channel}</b>. It uses YouTube API Services only to upload the owner&apos;s own videos to the owner&apos;s channel.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li><Link href="/privacy" className="text-blue-700 underline">Chính sách quyền riêng tư / Privacy Policy</Link></li>
        <li><Link href="/terms" className="text-blue-700 underline">Điều khoản sử dụng / Terms of Service</Link></li>
        {site.fbPage && <li><A href={site.fbPage}>Trang Facebook / Facebook Page</A></li>}
      </ul>
      <p><Link href="/login" className="inline-block rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700">Đăng nhập quản trị / Admin login</Link></p>
    </LegalPage>
  );
}
