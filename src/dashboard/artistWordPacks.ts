import type { CommunityPack } from "../community/communityPacksApi";
import builtinWordPacks from "../../shared/builtinWordPacks.json";
import { pickWordChoices } from "../../shared/wordQueue.mjs";
import { getWordFeedbackKey, normalizeWordFeedbackStats, type WordFeedbackMap } from "../feedback/wordFeedback";

export type ArtistPackKind = "general" | "game" | "community";
export type ArtistWordMixKind = ArtistPackKind | "mixed";

export type ArtistWord = {
  answer: string;
  aliases?: string[];
};

export type ArtistWordPack = {
  id: string;
  label: string;
  description: string;
  kind: ArtistPackKind;
  icon: string;
  accent: string;
  words: ArtistWord[];
  community?: {
    creatorName: string;
    reportCount: number;
    shareCode: string;
    tags: Array<{ key: string; label: string }>;
  };
};

export type ArtistWordMix = {
  kind: ArtistWordMixKind;
  packIds: string[];
};

export type ArtistPackPrompt = ArtistWord & {
  categoryId: string;
  difficulty: "easy";
};

export type WordMix = ArtistWordMix;
export type WordPack = ArtistWordPack;
export type WordMixPrompt = ArtistPackPrompt;
export type WordPackSnapshot = Pick<ArtistWordPack, "id" | "label" | "kind"> & { words: Array<ArtistWord & { weight?: number }> };

export const GENERAL_MIXED_PACK_ID = "general-mixed";
export const DEFAULT_ARTIST_WORD_MIX: ArtistWordMix = { kind: "general", packIds: [GENERAL_MIXED_PACK_ID] };

export const ARTIST_WORD_PACKS = builtinWordPacks as ArtistWordPack[];

export const ARTIST_GENERAL_PACKS = ARTIST_WORD_PACKS.filter((pack) => pack.kind === "general");
export const ARTIST_GAME_PACKS = ARTIST_WORD_PACKS.filter((pack) => pack.kind === "game");

const packById = new Map(ARTIST_WORD_PACKS.map((pack) => [pack.id, pack]));

export function communityPackToArtistPack(pack: CommunityPack): ArtistWordPack {
  return {
    id: `community-${pack.id}`,
    label: pack.title,
    description: pack.description || `${pack.words.length} community-created words.`,
    kind: "community",
    icon: "diversity_3",
    accent: "#d8c7e8",
    words: pack.words,
    community: {
      creatorName: pack.creatorName,
      reportCount: pack.reportCount,
      shareCode: pack.shareCode,
      tags: pack.tags,
    },
  };
}

export function normalizeArtistWordMix(mix?: Partial<ArtistWordMix> | null, communityPacks: CommunityPack[] = []): ArtistWordMix {
  const communityPackIds = new Set(communityPacks.filter((pack) => pack.status === "published").map((pack) => `community-${pack.id}`));
  let validIds = [...new Set(mix?.packIds ?? [])].filter((id) => id === GENERAL_MIXED_PACK_ID || communityPackIds.has(id) || packById.has(id));
  if (validIds.includes(GENERAL_MIXED_PACK_ID)) {
    validIds = validIds.filter((id) => id === GENERAL_MIXED_PACK_ID || packById.get(id)?.kind !== "general");
  }
  if (validIds.length === 0) return DEFAULT_ARTIST_WORD_MIX;
  const kinds = new Set<ArtistPackKind>(validIds.map((id) => (
    id === GENERAL_MIXED_PACK_ID ? "general" : communityPackIds.has(id) ? "community" : packById.get(id)?.kind ?? "general"
  )));
  return { kind: kinds.size === 1 ? [...kinds][0] : "mixed", packIds: validIds };
}

export function getArtistMixPacks(mix: ArtistWordMix, communityPacks: CommunityPack[] = []): ArtistWordPack[] {
  const normalized = normalizeArtistWordMix(mix, communityPacks);
  const communityById = new Map(communityPacks.map((pack) => [`community-${pack.id}`, communityPackToArtistPack(pack)]));
  const selected = normalized.packIds.flatMap((id) => (
    id === GENERAL_MIXED_PACK_ID ? ARTIST_GENERAL_PACKS : communityById.get(id) ?? packById.get(id) ?? []
  ));
  return [...new Map(selected.map((pack) => [pack.id, pack])).values()];
}

export const getWordMixPacks = getArtistMixPacks;

export function getArtistMixLabel(mix: ArtistWordMix, communityPacks: CommunityPack[] = []) {
  const normalized = normalizeArtistWordMix(mix, communityPacks);
  if (normalized.kind === "general" && normalized.packIds.includes(GENERAL_MIXED_PACK_ID)) return "All General";
  const labels = normalized.packIds.map((id) => id === GENERAL_MIXED_PACK_ID
    ? "All General"
    : communityPacks.find((pack) => `community-${pack.id}` === id)?.title ?? packById.get(id)?.label ?? "").filter(Boolean);
  if (labels.length <= 3) return labels.join(" + ");
  return `${labels.slice(0, 2).join(" + ")} + ${labels.length - 2} more`;
}

export function getArtistMixWordCount(mix: ArtistWordMix, communityPacks: CommunityPack[] = []) {
  return new Set(getArtistMixPacks(mix, communityPacks).flatMap((pack) => pack.words.map((word) => word.answer.toLocaleLowerCase("en")))).size;
}

export function getArtistMixSamples(mix: ArtistWordMix, count = 6, communityPacks: CommunityPack[] = []) {
  const packs = getArtistMixPacks(mix, communityPacks);
  const samples: ArtistWord[] = [];
  let index = 0;
  while (samples.length < count && packs.some((pack) => pack.words[index])) {
    packs.forEach((pack) => {
      const word = pack.words[index];
      if (word && samples.length < count && !samples.some((item) => item.answer === word.answer)) samples.push(word);
    });
    index += 1;
  }
  return samples;
}

export const getArtistPromptKey = (prompt: ArtistPackPrompt) => `${prompt.categoryId}:${prompt.answer.toLocaleLowerCase("en")}`;

export const getWordMixPromptKey = getArtistPromptKey;

export function getWordMixPackSnapshots(mix: ArtistWordMix, communityPacks: CommunityPack[] = [], feedback?: WordFeedbackMap): WordPackSnapshot[] {
  return getArtistMixPacks(mix, communityPacks).map(({ id, kind, label, words: packWords }) => ({
    id,
    kind,
    label,
    words: packWords.map((word) => ({ ...word, weight: getRoomFeedbackWeight(word, id, feedback) })),
  }));
}

function getRoomFeedbackWeight(word: ArtistWord, packId: string, feedback?: WordFeedbackMap) {
  const stored = feedback?.[getWordFeedbackKey({ answer: word.answer, categoryId: `pack-${packId}`, difficulty: "easy" })];
  if (!stored) return 1;
  const stats = normalizeWordFeedbackStats(stored);
  if (stats.submitted + stats.skipped < 2) return 1;
  const positive = stats.veryGood * 1.1;
  const negative = stats.bad * 1.45 + stats.notFun * 1.45 + stats.unrecognized * .55 + stats.skipped * .3 + stats.mid * .15;
  return Math.max(.35, Math.min(1.35, 1 + (positive - negative) / Math.max(6, stats.submitted + stats.skipped + 3)));
}

export function pickWordMixPrompts(
  mix: ArtistWordMix,
  recentKeys: string[],
  count: number,
  communityPacks: CommunityPack[] = [],
  feedback?: WordFeedbackMap,
): ArtistPackPrompt[] {
  return pickWordChoices(getWordMixPackSnapshots(mix, communityPacks, feedback), recentKeys, count)
    .map((prompt) => ({ ...prompt, difficulty: "easy" as const }));
}

export function pickArtistPrompt(mix: ArtistWordMix, recentKeys: string[], communityPacks: CommunityPack[] = []): ArtistPackPrompt {
  return pickWordMixPrompts(mix, recentKeys, 1, communityPacks)[0] ?? { answer: "Dog", categoryId: "pack-general-animals", difficulty: "easy" };
}
