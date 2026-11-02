import type { Metadata } from "next";
import LegalPage, { A, H2, UPDATED } from "@/components/LegalPage";
import { siteInfo } from "@/lib/channel-config";

export const dynamic = "force-dynamic";   // nội dung lấy từ SITE_* lúc chạy

export const metadata: Metadata = { title: "Điều khoản sử dụng / Terms of Service · Video Studio" };

export default function TermsPage() {
  const site = siteInfo();
  return (
    <LegalPage title="Điều khoản sử dụng / Terms of Service">
      <p className="text-xs text-slate-400">Cập nhật / Last updated: {UPDATED}</p>

      <H2>Tiếng Việt</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Video Studio là công cụ cá nhân của {site.owner}, chỉ dùng để sản xuất và đăng video cho kênh <b>{site.channel}</b>. Không cung cấp dịch vụ cho người khác và không thu phí.</li>
        <li>Nội dung video do chủ kênh chịu trách nhiệm. Video có dùng AI được khai báo theo quy định của từng nền tảng.</li>
        <li>Khi dùng tính năng YouTube, bạn đồng ý với <A href="https://www.youtube.com/t/terms">Điều khoản dịch vụ YouTube</A> và <A href="https://policies.google.com/privacy">Chính sách quyền riêng tư của Google</A>.</li>
        <li>Ứng dụng được cung cấp “nguyên trạng”, không có bảo đảm. Điều khoản có thể được cập nhật trên trang này.</li>
      </ul>

      <H2>English</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Video Studio is a personal tool by {site.owner}, used only to produce and publish videos for the channel <b>{site.channel}</b>. It is not offered as a service to others and is free of charge.</li>
        <li>The channel owner is responsible for all video content. AI-assisted videos are disclosed according to each platform&apos;s rules.</li>
        <li>By using the YouTube features you agree to the <A href="https://www.youtube.com/t/terms">YouTube Terms of Service</A> and the <A href="https://policies.google.com/privacy">Google Privacy Policy</A>.</li>
        <li>The app is provided “as is”, without warranty. These terms may be updated on this page.</li>
      </ul>

      <H2>Liên hệ / Contact</H2>
      <p>Trang Facebook / Facebook Page: {site.fbPage ? <A href={site.fbPage}>{site.channel}</A> : site.channel}. Xem thêm / See also: <A href="/privacy">Privacy Policy</A>.</p>
    </LegalPage>
  );
}
