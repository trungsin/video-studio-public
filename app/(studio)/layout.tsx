import Sidebar from "@/components/Sidebar";
import { currentProfile } from "@/lib/current";
import { getSchedule, listIdeas, listVideos, localDate } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const { profile, profiles } = await currentProfile();
  const slug = profile?.slug;
  const videos = listVideos();
  const today = localDate();
  const sched = getSchedule().filter((e) => e.profile === slug);
  const counts = {
    today: sched.filter((e) => e.date === today).length,
    schedule: sched.length,
    ideas: listIdeas(slug).filter((i) => ["idea", "script"].includes(i.status)).length,
    production: videos.filter((v) => v.profile === slug).length,
  };
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        current={slug || null}
        counts={counts}
        profiles={profiles.map((p) => ({ slug: p.slug, name: p.name, initials: p.initials, sample: p.sample, videos: videos.filter((v) => v.profile === p.slug).length }))}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
