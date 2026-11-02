import { cookies } from "next/headers";
import { listProfiles } from "./data";
import type { Profile } from "./types";

export const PROFILE_COOKIE = "vs_profile";

export async function currentProfile(): Promise<{ profile: Profile | null; profiles: Profile[] }> {
  const profiles = listProfiles();
  const want = (await cookies()).get(PROFILE_COOKIE)?.value;
  const profile = profiles.find((p) => p.slug === want) || profiles[0] || null;
  return { profile, profiles };
}
