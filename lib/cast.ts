import type { CastRef, Profile } from "./types";

export function castOf(p: Profile | null | undefined) {
  return { characters: p?.cast?.characters || [], settings: p?.cast?.settings || [] };
}

/** Chọn nhân vật/bối cảnh theo id; không có id -> cái đầu tiên của profile. */
export function pickCast(p: Profile | null | undefined, characterId?: string, settingId?: string): { character?: CastRef; setting?: CastRef } {
  const c = castOf(p);
  return {
    character: c.characters.find((x) => x.id === characterId) || c.characters[0],
    setting: c.settings.find((x) => x.id === settingId) || c.settings[0],
  };
}

/** Prompt ảnh cho một cảnh: hành động + mô tả cố định nhân vật + bối cảnh (giống worker/media_gen.py build_prompt). */
export function scenePrompt(action: string, character?: CastRef, setting?: CastRef): string {
  const parts = [action];
  if (character?.description) parts.push(`Same recurring character in every scene: ${character.description}`);
  if (setting?.description) parts.push(`Same location in every scene: ${setting.description}`);
  return parts.filter(Boolean).map((x) => x.trim().replace(/\.$/, "") + ".").join(" ");
}
