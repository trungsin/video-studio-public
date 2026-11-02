import IdeaBoard, { type EraMeta, type SeriesMeta } from "@/components/canvas/IdeaBoard";
import { currentProfile } from "@/lib/current";
import { boardCards } from "@/lib/graph-store";

export const dynamic = "force-dynamic";

const ERAS: EraMeta[] = [
  { code: "E01", name: "Văn Lang – Âu Lạc", years: "~TK VII TCN – 179 TCN" },
  { code: "E02", name: "Bắc thuộc & khởi nghĩa", years: "179/111 TCN – 938" },
  { code: "E03", name: "Ngô – Đinh – Tiền Lê", years: "938 – 1009" },
  { code: "E04", name: "Nhà Lý", years: "1009 – 1225" },
  { code: "E05", name: "Nhà Trần", years: "1225 – 1400" },
  { code: "E06", name: "Nhà Hồ & thuộc Minh", years: "1400 – 1427" },
  { code: "E07", name: "Hậu Lê sơ", years: "1428 – 1527" },
  { code: "E08", name: "Mạc – Lê trung hưng – Trịnh Nguyễn", years: "1527 – 1788" },
  { code: "E09", name: "Tây Sơn", years: "1771 – 1802" },
  { code: "E10", name: "Nhà Nguyễn (đến 1945)", years: "1802 – 1945" },
  { code: "X", name: "Xuyên suốt nhiều thời", years: "tổng hợp" },
];
const SERIES: SeriesMeta[] = [
  { code: "BCB", name: "Bạn có biết?" }, { code: "STIAB", name: "Sự thật ít ai biết" }, { code: "NV", name: "Nhân vật" },
  { code: "TD", name: "Trận đánh 60 giây" }, { code: "NNNX", name: "Ngày này năm xưa" }, { code: "TT", name: "Truyền thuyết hay chính sử?" },
  { code: "TG", name: "Nguồn gốc tên gọi" }, { code: "NBS", name: "Nếu bạn sống ở thời…" }, { code: "SL", name: "Xưa và nay bằng số liệu" },
];

export default async function BoardPage() {
  const { profile } = await currentProfile();
  const cards = profile ? boardCards(profile.slug) : [];
  return <IdeaBoard cards={cards} eras={ERAS} series={SERIES} />;
}
