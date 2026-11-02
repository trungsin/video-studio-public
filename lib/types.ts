export type SlotKey = "sang" | "trua" | "chieu" | "toi";
export const SLOTS: { key: SlotKey; label: string; color: string }[] = [
  { key: "sang", label: "Sáng", color: "bg-amber-400" },
  { key: "trua", label: "Trưa", color: "bg-orange-500" },
  { key: "chieu", label: "Chiều", color: "bg-rose-500" },
  { key: "toi", label: "Tối", color: "bg-indigo-600" },
];

export type Platform = "facebook" | "instagram" | "tiktok" | "youtube" | "threads" | "telegram";

export interface Channel {
  platform: Platform;
  handle: string;
  name: string;
  connected: boolean;
  /** "zernio" = đăng qua Zernio (cần accountId), "direct" = API trực tiếp của nền tảng */
  via?: "zernio" | "direct";
  accountId?: string;
}

export interface Item {
  id: string;
  label: string;
  value: string;
  /** "voice/<slug>.md:14" — dòng nguồn trong file style guide, tự tính lại khi lưu */
  ref?: string;
}

export interface ColorItem extends Item {
  hex: string;
}

/** Nhân vật / bối cảnh cố định của kênh. refs = đường dẫn tương đối trong DATA_DIR (VD "assets/<slug>/char-1.jpg"), commit vào git. */
export interface CastRef {
  id: string;
  name: string;
  /** Mô tả cố định (tiếng Anh cho model ảnh dễ hiểu): khuôn mặt, tóc, trang phục / không gian, đồ vật, ánh sáng */
  description: string;
  refs: string[];
}

export interface Profile {
  slug: string;
  name: string;
  initials: string;
  sample?: boolean;
  tagline?: string;
  /** Nhãn kênh hiển thị trên video. Trống = handle tài khoản kết nối đầu tiên (có thể là ID trang), rồi tới name. */
  brand?: string;
  updatedAt: string;
  channels: Channel[];
  tts: { engine: "edge" | "vieneu"; voice: string; rate: string };
  slotTimes: Record<SlotKey, string>;
  cast?: { characters: CastRef[]; settings: CastRef[] };
  /** Khai báo nội dung AI khi đăng (mặc định bật). text = dòng tự thêm vào caption. */
  aiDisclosure?: { enabled?: boolean; text?: string };
  /** Provider ảnh AI riêng cho profile (ghi đè IMAGE_PROVIDER), VD "quanlop" | "gemini". Trống = theo .env */
  imageProvider?: string;
  sections: {
    info: Item[];
    voice: Item[];
    ttsNotes: Item[];
    colors: ColorItem[];
    hashtags: string[];
  };
}

export type IdeaStatus =
  | "idea" | "script" | "mow" | "legal" | "production" | "ready" | "scheduled" | "published" | "rejected";

export const STATUS_FLOW: IdeaStatus[] = ["idea", "script", "mow", "legal", "production", "ready", "scheduled", "published"];
export const STATUS_LABEL: Record<IdeaStatus, string> = {
  idea: "Ý tưởng",
  script: "Kịch bản",
  mow: "MOW chờ",
  legal: "Legal chờ",
  production: "Sản xuất",
  ready: "Sẵn sàng",
  scheduled: "Đã lên lịch",
  published: "Đã đăng",
  rejected: "Bị loại",
};

export interface Scene {
  title: string;
  narration: string;
  visual?: string; // mô tả hình ảnh / prompt ảnh AI
  image?: string; // đường dẫn tương đối trong MEDIA_DIR (ảnh hoặc clip)
  /** "kenburns" (mặc định, ảnh tĩnh zoom/pan) hoặc "video" (image-to-video qua VIDEO_PROVIDER nếu có) */
  motion?: "kenburns" | "video";
  /** Cảnh type "clip": video nguồn (tương đối MEDIA_DIR hoặc "assets/..." trong DATA_DIR), ưu tiên hơn image. Tiếng của clip bị tắt. */
  clip?: string;
  clipStart?: number;
  /** Ảnh tư liệu (data/archive, Wikimedia Commons PD/CC BY/CC BY-SA) dựng thành cảnh bởi worker/archive.py */
  archive?: SceneArchive;
  /** Thẻ số liệu vẽ đè (worker/render.py, mvlib/charts.py), VD {type:"kpi", values:[2601,1935], labels:[...], units:[" kg"," kg"]} */
  chart?: SceneChart;
}

export interface SceneChart { type: string; values?: number[]; labels?: string[]; units?: string[]; decs?: number[]; [k: string]: unknown }

export interface SceneArchive {
  items?: { id: string; label?: string; mode?: "frame" | "detail" | "pan" | "backdrop"; focus?: [number, number]; credit?: string }[];
  /** Tự tìm theo từ khoá (thư viện trước, thiếu thì tải từ Commons) khi chưa có items */
  query?: string;
  topic?: string;
  mode?: "frame" | "detail" | "pan" | "backdrop";
  n?: number;
}

export interface ArchiveCredit { id: string; title: string; author: string; license: string; licenseUrl?: string; page: string; attributionRequired: boolean }

export interface Script {
  scenes: Scene[];
  caption: string;
  hashtags: string[];
  cta?: string;
}

export interface HistoryEntry { at: string; from: IdeaStatus | null; to: IdeaStatus; note?: string; by?: string }

/** Thông tin từ kế hoạch nội dung (06-content-plan.md) gắn vào ý tưởng nhập từ kế hoạch */
export interface IdeaPlan { stt?: number; era?: string; eraName?: string; year?: string; main?: string; series?: string; viral?: number; caution?: string; cautionNote?: string; sources?: string; visual?: string; status?: string; priority?: string; postOrder?: number | null; scriptId?: string | null }

/** Trích nguyên văn từ trang nguồn sơ cấp; plan.sources chỉ là gợi ý tìm kiếm. */
export interface IdeaEvidenceDraft {
  value: number;
  unit: string;
  quote: string;
  url: string;
  publisher: string;
  location: string;
  conditions: string;
  caveat: string;
  publishedAt?: string;
}

export interface IdeaEvidence {
  draft: IdeaEvidenceDraft;
  digest: string;
  approved?: { digest: string; at: string; by: string };
}

export interface Idea {
  id: string;
  profile: string;
  title: string;
  hook?: string;
  angle?: string;
  pillar?: string;
  sample?: boolean;
  plan?: IdeaPlan;
  evidence?: IdeaEvidence;
  characterId?: string;
  settingId?: string;
  status: IdeaStatus;
  script?: Script;
  review?: { mow?: { ok: boolean; note?: string; at: string }; legal?: { ok: boolean; note?: string; at: string } };
  videoId?: string;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type VideoStatus = "todo" | "doing" | "review" | "done" | "published";
export const VIDEO_STATUS_LABEL: Record<VideoStatus, string> = {
  published: "Đã publish",
  done: "Đã xong",
  review: "Đang review",
  doing: "Đang làm",
  todo: "Chưa làm",
};

export interface PublishResult { platform: string; ok: boolean; id?: string; url?: string; error?: string; note?: string; at: string; via: string }

/** Cài đặt đăng TikTok (qua Zernio) do người dùng tự chọn trong app; không có giá trị mặc định cho privacy. */
export interface TikTokPostSettings {
  privacyLevel?: string;
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  /** Gửi vào Creator Inbox (bản nháp) thay vì đăng thẳng */
  draft?: boolean;
  commercial?: "none" | "brand_organic" | "brand_content";
  /** Thời điểm người dùng xác nhận đã xem video + đồng ý Music Usage Confirmation */
  consentAt?: string;
  /** render.finishedAt của bản video đã được xác nhận (render lại thì phải xác nhận lại) */
  consentRender?: string;
  consentText?: string;
  /** nickname TikTok hiển thị lúc xác nhận */
  nickname?: string;
}

export interface Video {
  id: string;
  ideaId: string;
  profile: string;
  title: string;
  status: VideoStatus;
  sample?: boolean;
  characterId?: string;
  settingId?: string;
  scenes: Scene[];
  caption: string;
  hashtags: string[];
  /** Nguồn đối chiếu (chuỗi "Tổ chức, 'tiêu đề': … : URL") và ghi chú kiểm chứng */
  sources?: string[];
  verifyNotes?: string;
  /** Dòng ghi công ảnh tư liệu (render tự điền), luôn kèm caption khi đăng */
  credits?: string;
  archiveCredits?: ArchiveCredit[];
  editorial?: { evidenceDigest: string; scriptDigest: string; renderId?: string };
  tts: { engine: "edge" | "vieneu"; voice: string; rate: string };
  music: "none" | "synth";
  musicVol?: number; // mặc định 0.20
  crossfade?: number; // giây, mặc định 0.35; 0 = cắt thẳng
  captionY?: number; // vị trí phụ đề theo tỉ lệ chiều cao (0.70 mặc định)
  titleY?: number; // px từ mép trên (330 mặc định)
  maxSlow?: number; // clip được làm chậm tối đa bao nhiêu lần để khớp lời (1.4 mặc định)
  render: {
    state: "idle" | "queued" | "running" | "done" | "error";
    progress?: number;
    log?: string[];
    output?: string; // tương đối trong MEDIA_DIR
    duration?: number;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
  };
  publish?: PublishResult[];
  /** Ghi đè khai báo AI cho riêng video này (mặc định theo profile / AI_DISCLOSURE) */
  aiDisclosure?: boolean;
  /** Dòng khai báo AI riêng cho video (VD chỉ nhân vật là AI, ảnh tư liệu là ảnh thật); mặc định theo profile */
  aiDisclosureText?: string;
  tiktok?: TikTokPostSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleEntry {
  id: string;
  profile: string;
  date: string; // YYYY-MM-DD (giờ địa phương)
  slot: SlotKey;
  time: string; // HH:mm
  ideaId?: string;
  videoId?: string;
  platforms: Platform[];
  status: "planned" | "publishing" | "published" | "failed";
  results?: PublishResult[];
  editorial?: { evidenceDigest: string; scriptDigest: string; renderId: string };
  note?: string;
  /** Khung do scheduler tự động tạo */
  auto?: boolean;
  startedAt?: string;
  finishedAt?: string;
  /** Nền tảng đang đăng dở (để phát hiện bị ngắt giữa chừng, tránh đăng trùng) */
  inflight?: string;
}
