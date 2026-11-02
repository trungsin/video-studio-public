/**
 * Tạo dữ liệu MẪU (profile giả định "Bếp Nhà Mây" + ý tưởng + lịch) để UI không trống.
 *   npx tsx scripts/seed.ts          # chỉ tạo nếu chưa có profile mẫu
 *   npx tsx scripts/seed.ts --reset  # xoá dữ liệu mẫu cũ (sample:true) rồi tạo lại theo ngày hôm nay
 */
import fs from "node:fs";
import path from "node:path";
import { addDays, DATA_DIR, getSchedule, listIdeas, listVideos, localDate, nowIso, saveIdea, saveProfile, saveSchedule, saveVideo } from "../lib/data";
import type { Idea, Profile, ScheduleEntry, Video } from "../lib/types";

const SLUG = "mau-bep-nha-may";
const reset = process.argv.includes("--reset");
if (fs.existsSync(path.join(DATA_DIR, "profiles", `${SLUG}.json`)) && !reset) {
  console.log("Đã có profile mẫu, bỏ qua (dùng --reset để tạo lại)."); process.exit(0);
}
if (reset) {
  for (const i of listIdeas()) if (i.sample) fs.unlinkSync(path.join(DATA_DIR, "ideas", `${i.id}.json`));
  for (const v of listVideos()) if (v.sample) fs.unlinkSync(path.join(DATA_DIR, "videos", `${v.id}.json`));
  saveSchedule(getSchedule().filter((e) => e.profile !== SLUG));
}

let n = 0;
const item = (label: string, value: string) => ({ id: `s${++n}`, label, value });

const profile: Profile = {
  slug: SLUG,
  name: "Bếp Nhà Mây (mẫu)",
  initials: "BM",
  sample: true,
  tagline: "Profile MẪU minh hoạ — không phải người thật",
  updatedAt: nowIso(),
  channels: [
    { platform: "facebook", handle: "@bepnhamay.sample", name: "Bếp Nhà Mây (mẫu)", connected: true, via: "zernio" },
    { platform: "instagram", handle: "@bepnhamay.sample", name: "Bếp Nhà Mây", connected: true, via: "zernio" },
    { platform: "tiktok", handle: "@bepnhamay.sample", name: "Bếp Nhà Mây", connected: true, via: "zernio" },
    { platform: "youtube", handle: "@bepnhamay.sample", name: "Bếp Nhà Mây", connected: false, via: "direct" },
    { platform: "threads", handle: "@bepnhamay.sample", name: "Bếp Nhà Mây", connected: false, via: "zernio" },
    { platform: "telegram", handle: "@bepnhamay_sample", name: "Bếp Nhà Mây", connected: false, via: "zernio" },
  ],
  tts: { engine: "vieneu", voice: "Ngọc Huyền", rate: "+0%" },
  slotTimes: { sang: "06:30", trua: "11:30", chieu: "17:30", toi: "20:30" },
  cast: {
    characters: [{
      id: "char-may",
      name: "Mây (nhân vật hư cấu)",
      description: "a fictional Vietnamese woman about 30 years old, warm friendly smile, shoulder-length straight black hair with soft side-swept bangs, oval face, light natural makeup, small gold stud earrings, cream-white short-sleeve blouse under a mustard-yellow cotton apron",
      refs: ["assets/mau-bep-nha-may/char-may-portrait.jpg", "assets/mau-bep-nha-may/char-may-kitchen.jpg"],
    }],
    settings: [{
      id: "set-bep-may",
      name: "Bếp nhà Mây (Sài Gòn)",
      description: "a cozy small Saigon apartment kitchen: light wooden countertop, white square tiled backsplash, open light-wood shelves with white ceramic bowls, potted green herbs, a sage-green louvered wooden shutter on a cream wall, warm soft daylight",
      refs: ["assets/mau-bep-nha-may/set-bep-may.jpg"],
    }],
  },
  sections: {
    info: [
      item("Tổng quan", "Kênh nấu ăn gia đình giả định: món nhanh dưới 20 phút cho người bận rộn, giọng kể ấm áp, thực tế."),
      item("Vai trò", "Người nấu chính trong nhà, chia sẻ mẹo bếp và thực đơn tuần (nhân vật minh hoạ)."),
      item("Khán giả", "Người đi làm 25-40 tuổi, ở thành phố, muốn ăn nhà nhưng ít thời gian."),
      item("Trụ nội dung", "Món 15 phút · Đi chợ thông minh · Mẹo bếp · Thực đơn tuần"),
      item("Không làm", "Không bịa số liệu dinh dưỡng, không hứa công dụng chữa bệnh, không chê thương hiệu khác."),
    ],
    voice: [
      item("Tính cách", "Gần gũi, vui vẻ, nói như kể chuyện với bạn thân. VD: \"Tối nay nhà mình ăn gì đây ta?\""),
      item("Xưng hô", "Xưng \"mình\", gọi người xem là \"cả nhà\" hoặc \"bạn\"."),
      item("Hook", "Mở bằng câu hỏi hoặc tình huống quen: \"Mười lăm phút có kịp nấu bữa tối không?\""),
      item("Độ dài câu", "Câu ngắn 5-15 từ, nhịp nhanh, mỗi cảnh một ý."),
      item("Kết", "Chốt bằng mẹo nhỏ + lời mời lưu video / theo dõi kênh."),
    ],
    ttsNotes: [
      item("Giọng", "Ngọc Huyền (VieNeu-TTS local, dự phòng edge-tts Hoài My)."),
      item("Nhạc", "Nhạc nền nhẹ tự tổng hợp, giảm âm khi có lời đọc."),
    ],
    colors: [
      { id: "c1", label: "Cam đất", value: "màu chính, nền tiêu đề", hex: "#C2410C" },
      { id: "c2", label: "Kem", value: "nền sáng", hex: "#FFF4E0" },
      { id: "c3", label: "Vàng nghệ", value: "màu nhấn chữ đang đọc", hex: "#FACC15" },
      { id: "c4", label: "Xanh lá", value: "rau, sự tươi", hex: "#15803D" },
    ],
    hashtags: ["#bepnhamay", "#monngon15phut", "#nauannhanh", "#comnha", "#meobep"],
  },
};
saveProfile(profile);

const today = localDate();
const ago = (d: number) => new Date(Date.now() - d * 86400e3).toISOString();
const hist = (steps: Idea["status"][], days: number): Idea["history"] =>
  steps.map((s, k) => ({ at: ago(days - k * 0.5), from: k ? steps[k - 1] : null, to: s, note: "dữ liệu mẫu" }));

type Seed = { title: string; hook: string; pillar: string; status: Idea["status"]; days: number; script?: Idea["script"] };
const S = (scenes: [string, string, string][], caption: string): Idea["script"] => ({
  scenes: scenes.map(([title, narration, visual]) => ({ title, narration, visual })), caption, hashtags: ["#bepnhamay", "#monngon15phut", "#comnha"], cta: "Lưu lại và theo dõi kênh",
});
const seeds: Seed[] = [
  { title: "Trứng chiên lá lốt 10 phút", hook: "Mười phút có kịp một món đưa cơm không?", pillar: "Món 15 phút", status: "scheduled", days: 9, script: S([
    ["Mười phút, một món", "Mười phút có kịp nấu một món đưa cơm không? Thử cùng mình nhé.", "Chảo nóng, trứng và lá lốt trên thớt"],
    ["Chuẩn bị", "Ba quả trứng, một nắm lá lốt thái nhỏ, chút hành tím và nước mắm.", "Nguyên liệu bày trên mặt bếp gỗ"],
    ["Đánh trứng", "Đánh tan trứng với lá lốt, nêm nhẹ, đừng đánh quá lâu để trứng còn xốp.", "Cận tay đánh trứng trong bát"],
    ["Chiên lửa vừa", "Chiên lửa vừa, lật một lần là đủ, mép vàng giòn là được.", "Trứng vàng trong chảo"],
    ["Mẹo nhỏ", "Mẹo nhỏ: thêm một thìa nước lọc vào trứng, món sẽ mềm hơn. Lưu lại để tối nay làm nha!", "Đĩa trứng chiên cạnh bát cơm"],
  ], "Trứng chiên lá lốt 10 phút, thơm nức cả nhà 🍳") },
  { title: "Canh chua cá 15 phút cho ngày nóng", hook: "Trời nóng thế này, ăn gì cho mát?", pillar: "Món 15 phút", status: "legal", days: 6, script: S([
    ["Ngày nóng ăn gì?", "Trời nóng thế này, một bát canh chua là đủ mát cả bữa.", "Bát canh chua bốc khói nhẹ"],
    ["Nấu nhanh", "Nước sôi, cho me, cà chua, rồi đến cá. Mười lăm phút là xong.", "Nồi canh trên bếp"],
    ["Theo dõi kênh", "Theo dõi Bếp Nhà Mây để có thực đơn mát cả tuần nhé.", "Mâm cơm gia đình"],
  ], "Canh chua cá 15 phút cho ngày nắng") },
  { title: "Đi chợ 200 nghìn cho cả tuần", hook: "Hai trăm nghìn đi chợ được những gì?", pillar: "Đi chợ thông minh", status: "mow", days: 5, script: S([
    ["200 nghìn đi chợ", "Hai trăm nghìn đi chợ được những gì cho cả tuần? Mình liệt kê nhé.", "Giỏ đi chợ đầy rau"],
    ["Danh sách", "Trứng, đậu, rau theo mùa, một ít thịt. Mua theo thực đơn, không mua theo hứng.", "Danh sách viết tay"],
    ["Kết", "Bạn thử chưa? Bình luận số tiền đi chợ của nhà bạn nhé.", "Tủ lạnh gọn gàng"],
  ], "Đi chợ thông minh: 200k cho cả tuần") },
  { title: "Ba cách bảo quản rau tươi lâu", hook: "Rau mua về hai hôm đã héo?", pillar: "Mẹo bếp", status: "mow", days: 4, script: S([
    ["Rau héo nhanh?", "Rau mua về hai hôm đã héo? Ba cách này giúp rau tươi lâu hơn.", "Rau xanh trong rổ"],
    ["Cách một", "Lau khô rồi bọc giấy, cho vào hộp kín.", "Rau bọc giấy ăn"],
    ["Lưu lại", "Lưu lại để dùng dần nha cả nhà.", "Hộp rau trong tủ lạnh"],
  ], "3 cách giữ rau tươi lâu") },
  { title: "Thực đơn tuần cho nhà ba người", hook: "Tuần này ăn gì? Mình lên sẵn rồi.", pillar: "Thực đơn tuần", status: "script", days: 3, script: S([
    ["Tuần này ăn gì?", "Tuần này ăn gì? Mình lên sẵn thực đơn bảy ngày cho nhà ba người.", "Lịch tuần dán trên tủ lạnh"],
    ["Theo dõi", "Theo dõi để nhận thực đơn mỗi chủ nhật.", "Mâm cơm"],
  ], "Thực đơn tuần cho nhà 3 người") },
  { title: "Cơm chiên thập cẩm từ cơm nguội", hook: "Cơm nguội đừng bỏ!", pillar: "Món 15 phút", status: "idea", days: 2 },
  { title: "Nước chấm chua ngọt chuẩn vị", hook: "Một công thức nước chấm dùng cho mười món", pillar: "Mẹo bếp", status: "idea", days: 1 },
  { title: "Mì xào bò trong 12 phút", hook: "Đói bụng mà lười? Thử món này.", pillar: "Món 15 phút", status: "published", days: 12, script: S([
    ["12 phút mì xào", "Đói bụng mà lười? Mì xào bò mười hai phút là xong.", "Đĩa mì xào"],
  ], "Mì xào bò 12 phút") },
];

const flow: Idea["status"][] = ["idea", "script", "mow", "legal", "production", "ready", "scheduled", "published"];
const ideas: Idea[] = seeds.map((s, k) => ({
  id: `idea-sample-${k + 1}`, profile: SLUG, title: s.title, hook: s.hook, pillar: s.pillar, angle: "", sample: true,
  characterId: "char-may", settingId: "set-bep-may",
  status: s.status, script: s.script, history: hist(flow.slice(0, flow.indexOf(s.status) + 1), s.days), createdAt: ago(s.days), updatedAt: nowIso(),
}));

// video cho ý tưởng đã qua Legal
const mkVideo = (i: Idea, status: Video["status"]): Video => ({
  id: `vid-sample-${i.id.split("-").pop()}`, ideaId: i.id, profile: SLUG, title: i.title, status, sample: true,
  scenes: (i.script?.scenes || []).map((s) => ({ ...s })), caption: i.script?.caption || i.title, hashtags: i.script?.hashtags || [],
  tts: profile.tts, music: "synth", render: { state: "idle" }, createdAt: i.createdAt, updatedAt: nowIso(),
});
const ready = ideas[0], published = ideas[7];
const v1 = mkVideo(ready, "todo"); ready.videoId = v1.id;
const v2 = mkVideo(published, "published"); published.videoId = v2.id;
v2.render = { state: "idle" };
// Video giới thiệu kênh với nhân vật + bối cảnh cố định (ảnh mẫu trong data/assets, sinh bằng FLUX.1 schnell + Kontext)
const IMG = "assets/mau-bep-nha-may/scenes";
const intro: Idea = {
  id: "idea-sample-9", profile: SLUG, title: "Chào cả nhà, mình là Mây", hook: "Giới thiệu kênh", pillar: "Giới thiệu", angle: "", sample: true,
  characterId: "char-may", settingId: "set-bep-may", status: "production",
  script: S([
    ["Chào cả nhà!", "Chào cả nhà, mình là Mây, chủ căn bếp nhỏ ở Sài Gòn này.", "She waves cheerfully holding a black frying pan"],
    ["Căn bếp của Mây", "Đây là góc bếp nhà mình, nhỏ thôi nhưng sáng nào cũng ngập nắng.", "The empty kitchen, no people"],
    ["Món nhanh 15 phút", "Mỗi ngày mình chia sẻ một món nhanh dưới mười lăm phút cho người bận rộn.", "She stands behind the wooden counter smiling"],
    ["Nấu thật, ăn thật", "Toàn món nhà nấu, nguyên liệu dễ mua ở chợ gần nhà.", "Close-up portrait, warm smile"],
    ["Tối nay ăn gì?", "Bí món thì cứ hỏi Mây nhé, mình gợi ý liền!", "Close-up of her laughing face"],
    ["Theo dõi Bếp Nhà Mây", "Theo dõi kênh để không bỏ lỡ món mới mỗi ngày nha!", "Medium close-up, friendly smile to camera"],
  ], "Chào cả nhà, mình là Mây 👋 Món nhanh 15 phút mỗi ngày tại Bếp Nhà Mây (kênh mẫu)"),
  history: hist(["idea", "script", "mow", "legal", "production"], 1), createdAt: ago(1), updatedAt: nowIso(),
};
const v3 = mkVideo(intro, "todo");
v3.id = "vid-sample-9"; intro.videoId = v3.id;
v3.characterId = "char-may"; v3.settingId = "set-bep-may";
const files = ["01-chao", "02-goc-bep", "03-ben-quay", "04-chan-dung", "05-can-mat", "06-cta"];
v3.scenes = v3.scenes.map((sc, k) => ({ ...sc, image: `${IMG}/${files[k]}.jpg`, motion: "kenburns" }));
ideas.push(intro);

// Video có chuyển động: 3 clip image-to-video của Mây + 1 ảnh tĩnh Ken Burns (cảnh type "clip" trộn với ảnh)
const CLIP = "assets/mau-bep-nha-may/clips";
const motion: Idea = {
  id: "idea-sample-10", profile: SLUG, title: "Trứng chiên 1 phút cùng Mây", hook: "Một phút có món đưa cơm", pillar: "Món 15 phút", angle: "", sample: true,
  characterId: "char-may", settingId: "set-bep-may", status: "production",
  script: S([
    ["Trứng chiên 1 phút", "Chào cả nhà, Mây đây! Hôm nay mình làm trứng chiên một phút nha.", "She waves holding a frying pan"],
    ["", "Đập hai quả trứng, thêm chút nước mắm, đánh thật đều tay cho trứng bông.", "She cracks an egg and whisks in a white bowl"],
    ["", "Chiên lửa vừa, mép vàng là trượt ra đĩa. Thơm phức luôn!", "She slides the omelette onto a plate and shows it"],
    ["", "Lưu lại để tối nay làm thử, và theo dõi Bếp Nhà Mây nha!", "Medium close-up, friendly smile to camera"],
  ], "Trứng chiên 1 phút 🍳 nhanh gọn cho bữa tối (kênh mẫu)"),
  history: hist(["idea", "script", "mow", "legal", "production"], 0.5), createdAt: ago(0.5), updatedAt: nowIso(),
};
const v4 = mkVideo(motion, "todo");
v4.id = "vid-sample-10"; motion.videoId = v4.id;
v4.characterId = "char-may"; v4.settingId = "set-bep-may";
v4.musicVol = 0.14; v4.crossfade = 0.4; v4.captionY = 0.62; v4.titleY = 200; v4.maxSlow = 1.35;
const src = [`${CLIP}/may-01-chao.mp4`, `${CLIP}/may-03-danh-trung.mp4`, `${CLIP}/may-05-trung-chien-v2.mp4`];
v4.scenes = v4.scenes.map((sc, k) => (k < 3 ? { ...sc, clip: src[k] } : { ...sc, image: `${IMG}/06-cta.jpg`, motion: "kenburns" }));
ideas.push(motion);
ideas.forEach(saveIdea);
[v1, v2, v3, v4].forEach(saveVideo);

const entries = getSchedule();
const E = (d: number, slot: ScheduleEntry["slot"], i: Idea, status: ScheduleEntry["status"] = "planned"): ScheduleEntry => ({
  id: `slot-sample-${d}-${slot}`, profile: SLUG, date: addDays(today, d), slot, time: profile.slotTimes[slot], ideaId: i.id, videoId: i.videoId,
  platforms: ["facebook", "tiktok", "instagram"], status,
});
entries.push(
  E(0, "trua", ideas[2]), E(0, "toi", ideas[3]), E(1, "sang", ideas[1]), E(2, "toi", ideas[4]),
  E(3, "trua", ready), E(-2, "toi", published, "published"),
);
saveSchedule(entries);
console.log(`Seed xong: profile ${SLUG}, ${ideas.length} ý tưởng, 4 video, ${entries.length} khung lịch (mẫu).`);
