import { AUTO_DRAW_ASSETS } from "../autoDraw/autoDrawAssets";
import type { CategoryPickerDomain, CategoryPickerGroup } from "../ui/CategoryPickerWindow";
import artistWordsRaw from "./artistWords.json";

export type RoundPrompt = {
  answer: string;
  aliases?: string[];
};

export type CategoryPrompt = RoundPrompt & {
  categoryId: string;
};

export type WordCategory = {
  id: string;
  name: string;
  group: "Games" | "Culture" | "World" | "Everyday";
  description: string;
  icon: string;
  accent: string;
};

export type CategorySelection = "random" | string;

export const DEFAULT_WORD_SECONDS = 180;
export const MAX_CORRECT_GUESSERS = 100;

export const GAME_TITLES = [
  { id: "valorant", label: "Valorant", accent: "#ff4655" },
  { id: "clash royale", label: "Clash Royale", accent: "#f5a623" },
  { id: "genshin impact", label: "Genshin Impact", accent: "#4eb5ff" },
  { id: "dota 2", label: "Dota 2", accent: "#e24a4a" },
  { id: "league of legends", label: "League of Legends", accent: "#c8aa6e" },
  { id: "deadlock", label: "Deadlock", accent: "#9b51e0" },
  { id: "rainbow six siege", label: "Rainbow Six Siege", accent: "#2f80ed" },
  { id: "clash of clans", label: "Clash of Clans", accent: "#ff9f43" },
  { id: "arc raiders", label: "Arc Raiders", accent: "#27ae60" },
];

export type UnifiedAsset = {
  id: string;
  answer: string;
  aliases: string[];
  category: string;
};

export const UNIFIED_ASSETS: UnifiedAsset[] = [
  ...AUTO_DRAW_ASSETS.map((asset) => ({
    id: asset.id,
    answer: asset.answer,
    aliases: asset.aliases || [],
    category: asset.category,
  })),
  ...(artistWordsRaw as UnifiedAsset[]),
];

export const matchesSingleSelection = (category: string, token: string) => {
  if (token === "all") return true;
  if (token === category) return true;
  if (token.startsWith("game:")) {
    const gameQuery = token.slice(5).toLowerCase();
    return category.toLowerCase().startsWith(gameQuery);
  }
  return false;
};

export const matchesCategorySelection = (category: string, selection: string) => {
  if (!selection || selection === "all") return true;
  if (selection === "empty") return false;
  const tokens = selection.split(",").filter(Boolean);
  if (tokens.includes("all")) return true;
  return tokens.some((token) => matchesSingleSelection(category, token));
};

const allCategories = [...new Set(UNIFIED_ASSETS.map(({ category }) => category))];

const NON_GAME_METADATA: Record<string, { group: "Culture" | "World" | "Everyday", icon: string, accent: string, description: string }> = {
  "Animals": { group: "World", icon: "pets", accent: "#df9a62", description: "Common wildlife through unusual species and adaptations." },
  "Ocean & Fish": { group: "World", icon: "water", accent: "#64b5cf", description: "Familiar sea life through rare deep-ocean species." },
  "Food": { group: "Everyday", icon: "restaurant", accent: "#ed8b67", description: "Iconic dishes through regional foods and culinary techniques." },
  "Places": { group: "World", icon: "travel_explore", accent: "#80b58c", description: "Recognizable destinations, landmarks, and geographic sites." },
  "Music": { group: "Culture", icon: "music_note", accent: "#bb83c8", description: "Instruments, performance language, and advanced musical ideas." },
  "Singers & Bands": { group: "Culture", icon: "mic_external_on", accent: "#e38fae", description: "Globally iconic performers through deeper music knowledge." },
  "Books & Stories": { group: "Culture", icon: "auto_stories", accent: "#b68b62", description: "Famous stories through literary characters and specialist titles." },
  "Movies & TV": { group: "Culture", icon: "movie", accent: "#7b9ac8", description: "Popular screen stories through props, locations, and production terms." },
  "Sports": { group: "Everyday", icon: "sports_soccer", accent: "#6ca2d1", description: "Popular sports through positions, techniques, and rule terms." },
  "Space": { group: "World", icon: "rocket_launch", accent: "#777fbe", description: "Planets and spacecraft through advanced astronomy." },
  "Nature": { group: "World", icon: "forest", accent: "#76ad76", description: "Familiar landscapes through specialist plants and phenomena." },
  "Jobs": { group: "Everyday", icon: "badge", accent: "#d19a67", description: "Familiar professions through specialized careers." },
  "Technology": { group: "Everyday", icon: "devices", accent: "#79a9b8", description: "Daily devices through components and technical concepts." },
  "Mythology": { group: "Culture", icon: "castle", accent: "#c79069", description: "Famous creatures and gods through legendary artifacts and places." },
  "Everyday Objects": { group: "Everyday", icon: "inventory_2", accent: "#a6a083", description: "Common household items through less-familiar tools and fittings." },
};

export const UNIFIED_DOMAINS: CategoryPickerDomain[] = [
  {
    id: "games",
    label: "Games",
    groups: GAME_TITLES.map((game) => {
      const gameCategories = allCategories.filter((c) => c.toLowerCase().startsWith(game.id));
      const hasAssets = UNIFIED_ASSETS.some((item) => matchesSingleSelection(item.category, `game:${game.id}`));
      if (!hasAssets) return null;
      const allGameAssetsCount = UNIFIED_ASSETS.filter((item) => matchesSingleSelection(item.category, `game:${game.id}`)).length;
      return {
        id: game.id,
        label: game.label,
        options: [
          {
            id: `game:${game.id}`,
            label: `All ${game.label}`,
            description: `Every ${game.label} deck`,
            icon: "sports_esports",
            accent: game.accent,
            count: allGameAssetsCount,
          },
          ...gameCategories.map((category) => {
            const cleanLabel = category.toLowerCase().startsWith(game.id)
              ? category.slice(game.id.length).trim() || category
              : category;
            const categoryAssetsCount = UNIFIED_ASSETS.filter((item) => item.category === category).length;
            return {
              id: category,
              label: cleanLabel,
              description: `${cleanLabel} deck`,
              icon: "style",
              accent: game.accent,
              count: categoryAssetsCount,
            };
          }),
        ],
      };
    }).filter(Boolean) as CategoryPickerGroup[],
  },
  ...["World", "Culture", "Everyday"].map((domainName) => ({
    id: domainName.toLowerCase(),
    label: domainName,
    groups: [
      {
        id: domainName,
        label: `All ${domainName}`,
        options: Object.entries(NON_GAME_METADATA)
          .filter(([_, meta]) => meta.group === domainName)
          .map(([category, meta]) => {
            const categoryAssetsCount = UNIFIED_ASSETS.filter((item) => item.category === category).length;
            return {
              id: category,
              label: category,
              description: meta.description,
              icon: meta.icon,
              accent: meta.accent,
              count: categoryAssetsCount,
            };
          })
      }
    ]
  }))
];

export const RANDOM_CATEGORY: WordCategory = {
  id: "random",
  name: "Random Mix",
  group: "Everyday",
  description: "A surprise category and word every round.",
  icon: "casino",
  accent: "#83c5e6",
};

export const getCategory = (categoryId: string): WordCategory | undefined => {
  if (categoryId === "random") return RANDOM_CATEGORY;
  
  if (categoryId.startsWith("game:")) {
    const gameId = categoryId.slice(5);
    const game = GAME_TITLES.find(g => g.id === gameId);
    if (!game) return undefined;
    return {
      id: categoryId,
      name: `All ${game.label}`,
      group: "Games",
      description: `Every ${game.label} deck`,
      icon: "sports_esports",
      accent: game.accent,
    };
  }

  const gameMatch = GAME_TITLES.find((g) => categoryId.toLowerCase().startsWith(g.id));
  if (gameMatch) {
    const cleanLabel = categoryId.slice(gameMatch.id.length).trim() || categoryId;
    return {
      id: categoryId,
      name: cleanLabel,
      group: "Games",
      description: `${cleanLabel} deck`,
      icon: "style",
      accent: gameMatch.accent,
    };
  }

  const otherMeta = NON_GAME_METADATA[categoryId];
  if (otherMeta) {
    return {
      id: categoryId,
      name: categoryId,
      group: otherMeta.group,
      description: otherMeta.description,
      icon: otherMeta.icon,
      accent: otherMeta.accent,
    };
  }

  return undefined;
};

export const getPromptKey = (prompt: CategoryPrompt) => `${prompt.categoryId}:${prompt.answer.toLocaleLowerCase("en")}`;

export const getCategoryWordCount = (category: WordCategory) => {
  // In the new system, we just count from UNIFIED_ASSETS
  return UNIFIED_ASSETS.filter((a) => matchesCategorySelection(a.category, category.id)).length;
};

export function pickNextPrompt(
  selection: CategorySelection,
  recentKeys: string[],
): CategoryPrompt {
  const matchingAssets = UNIFIED_ASSETS.filter((a) => matchesCategorySelection(a.category, selection));
  
  const pool = matchingAssets.map((asset) => ({
    answer: asset.answer,
    aliases: asset.aliases,
    categoryId: asset.category,
  }));

  const recent = new Set(recentKeys.slice(-24));
  const available = pool.filter((prompt) => !recent.has(getPromptKey(prompt)));
  const previousKey = recentKeys.at(-1);
  const fallback = pool.filter((prompt) => getPromptKey(prompt) !== previousKey);
  const choices = available.length > 0 ? available : fallback.length > 0 ? fallback : pool;
  
  if (choices.length === 0) {
    return { answer: "Error: No words found", categoryId: "random" };
  }
  
  return choices[Math.floor(Math.random() * choices.length)];
}
