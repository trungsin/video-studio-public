import type { Metadata } from "next";
import LegalPage, { A, H2, UPDATED } from "@/components/LegalPage";
import { siteInfo } from "@/lib/channel-config";

export const dynamic = "force-dynamic";   // nội dung lấy từ SITE_* lúc chạy

export const metadata: Metadata = { title: "Chính sách quyền riêng tư / Privacy Policy · Video Studio" };

export default function PrivacyPage() {
  const site = siteInfo();
  return (
    <LegalPage title="Chính sách quyền riêng tư / Privacy Policy">
      <p className="text-xs text-slate-400">Cập nhật / Last updated: {UPDATED}</p>

      <H2>Tiếng Việt</H2>
      <p>Video Studio là công cụ cá nhân do {site.owner} tự vận hành để sản xuất và đăng video cho kênh <b>{site.channel}</b>. Ứng dụng không mở cho người dùng khác.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Ứng dụng dùng <b>YouTube API Services</b> chỉ để tải lên video của chính chủ kênh lên kênh YouTube của chủ kênh và đọc tên kênh để xác nhận kết nối.</li>
        <li>Khi chủ kênh cấp quyền, ứng dụng lưu <b>refresh token</b> của Google trên máy chủ riêng của chủ kênh (file cấu hình cục bộ, chỉ chủ sở hữu đọc được). Không lưu mật khẩu Google.</li>
        <li>Không thu thập dữ liệu của người xem hay người dùng khác. Không chia sẻ, không bán, không dùng dữ liệu cho quảng cáo.</li>
        <li>Có thể thu hồi quyền bất kỳ lúc nào tại <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>; khi đó token không còn dùng được và sẽ bị xoá khỏi máy chủ.</li>
        <li>Việc dùng dữ liệu từ Google API tuân theo <A href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</A>, gồm các yêu cầu Limited Use.</li>
      </ul>

      <H2>English</H2>
      <p>Video Studio is a personal-use tool operated by {site.owner} to produce and publish videos for the channel <b>{site.channel}</b>. It is not offered to other users.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>The app uses <b>YouTube API Services</b> only to upload the channel owner&apos;s own videos to the owner&apos;s YouTube channel and to read the channel name to confirm the connection.</li>
        <li>When the owner grants access, the app stores the Google <b>refresh token</b> locally on the owner&apos;s own server (a local configuration file readable only by the owner). Google passwords are never stored.</li>
        <li>No data about viewers or other users is collected. No data is shared, sold, or used for advertising.</li>
        <li>Access can be revoked at any time at <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>; the token then stops working and is deleted from the server.</li>
        <li>Use of information received from Google APIs adheres to the <A href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</A>, including the Limited Use requirements.</li>
      </ul>

      <H2>Google &amp; YouTube</H2>
      <p>
        Bằng việc dùng tính năng YouTube, bạn đồng ý với / By using the YouTube features you agree to the{" "}
        <A href="https://www.youtube.com/t/terms">YouTube Terms of Service</A>. Xem thêm / See also the{" "}
        <A href="https://policies.google.com/privacy">Google Privacy Policy</A>.
      </p>

      <H2>Liên hệ / Contact</H2>
      <p>Nhắn tin qua Trang Facebook / Message us via the Facebook Page: {site.fbPage ? <A href={site.fbPage}>{site.channel}</A> : site.channel}.</p>
    </LegalPage>
  );
}
