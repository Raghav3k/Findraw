import { AUTO_DRAW_ASSETS } from "../autoDraw/autoDrawAssets";
import type { CategoryPickerDomain, CategoryPickerGroup } from "../ui/CategoryPickerWindow";
import artistWordsRaw from "./artistWords.json";

export type RoundPrompt = {
  answer: string;
  aliases?: string[];
};

export type WordDifficulty = "easy" | "hard";

export type CategoryPrompt = RoundPrompt & {
  categoryId: string;
  difficulty?: WordDifficulty;
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
export type FindrawModePool = "artist" | "autoDraw" | "room";

export const DEFAULT_WORD_SECONDS = 180;
export const MAX_CORRECT_GUESSERS = 100;

export const GAME_TITLES = [
  { id: "valorant", label: "Valorant", accent: "#e88f9a" },
  { id: "clash royale", label: "Clash Royale", accent: "#d9b66f" },
  { id: "genshin impact", label: "Genshin Impact", accent: "#8fc7dc" },
  { id: "dota 2", label: "Dota 2", accent: "#c98277" },
  { id: "league of legends", label: "League of Legends", accent: "#c6ad78" },
  { id: "deadlock", label: "Deadlock", accent: "#b4a0d6" },
  { id: "rainbow six siege", label: "Rainbow Six Siege", accent: "#8fa9d1" },
  { id: "clash of clans", label: "Clash of Clans", accent: "#d69b72" },
  { id: "arc raiders", label: "Arc Raiders", accent: "#8fbea1" },
];

export type UnifiedAsset = {
  id: string;
  answer: string;
  aliases: string[];
  category: string;
  difficulty: WordDifficulty;
};

type RawWordAsset = Omit<UnifiedAsset, "difficulty"> & {
  difficulty?: WordDifficulty | "medium" | "Easy" | "Medium" | "Hard";
};

export type FindrawDomainId = "games" | "world" | "culture" | "everyday";

export type FindrawPrompt = UnifiedAsset & {
  modes: FindrawModePool[];
  hasAutoDrawAsset: boolean;
};

export type FindrawDeck = {
  id: string;
  label: string;
  description: string;
  domainId: FindrawDomainId;
  collectionId: string;
  collectionLabel: string;
  icon: string;
  accent: string;
  promptCount: number;
};

export type FindrawCollection = {
  id: string;
  label: string;
  domainId: FindrawDomainId;
  accent: string;
  decks: FindrawDeck[];
};

export type FindrawDomain = {
  id: FindrawDomainId;
  label: string;
  collections: FindrawCollection[];
};

export type CategorySelectionChip = {
  id: string;
  label: string;
  accent: string;
  kind: "all" | "domain" | "collection" | "deck" | "empty";
};

export const UNIFIED_ASSETS: UnifiedAsset[] = [
  ...AUTO_DRAW_ASSETS.map((asset) => ({
    id: asset.id,
    answer: asset.answer,
    aliases: asset.aliases || [],
    category: asset.category,
    difficulty: normalizeDifficulty(asset.difficulty),
  })),
  ...(artistWordsRaw as RawWordAsset[]).map((asset) => ({
    id: asset.id,
    answer: asset.answer,
    aliases: asset.aliases || [],
    category: asset.category,
    difficulty: normalizeDifficulty(asset.difficulty),
  })),
];

const MODE_ASSET_POOLS: Record<FindrawModePool, UnifiedAsset[]> = {
  artist: UNIFIED_ASSETS,
  autoDraw: AUTO_DRAW_ASSETS.map((asset) => ({
    id: asset.id,
    answer: asset.answer,
    aliases: asset.aliases || [],
    category: asset.category,
    difficulty: normalizeDifficulty(asset.difficulty),
  })),
  // Room mode is not implemented yet. Start from the artist-safe drawing pool so
  // existing category selections keep working when the mode gets its first UI.
  room: UNIFIED_ASSETS,
};

function normalizeDifficulty(difficulty: RawWordAsset["difficulty"]): WordDifficulty {
  if (difficulty === "easy" || difficulty === "Easy") return "easy";
  if (difficulty === "hard" || difficulty === "medium" || difficulty === "Medium" || difficulty === "Hard") return "hard";
  return "easy";
}

export const matchesSingleSelection = (category: string, token: string) => {
  if (token === "all") return true;
  if (token === category) return true;
  if (token.startsWith("domain:")) {
    const domainQuery = token.slice(7);
    const deckInfo = getCategoryDeckInfo(category);
    if (!deckInfo) return false;
    if (domainQuery === "games") return deckInfo.domainId === "games";
    if (domainQuery === "general") return deckInfo.domainId !== "games";
    return deckInfo.domainId === domainQuery;
  }
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

const DOMAIN_LABELS: Record<FindrawDomainId, string> = {
  games: "Games",
  world: "World",
  culture: "Culture",
  everyday: "Everyday",
};

const categoryModelCache = new Map<FindrawModePool, FindrawDomain[]>();
const categoryDomainsCache = new Map<FindrawModePool, CategoryPickerDomain[]>();
const autoDrawAssetIds = new Set(AUTO_DRAW_ASSETS.map((asset) => asset.id));

function getCategoryDeckInfo(category: string): Omit<FindrawDeck, "promptCount"> | null {
  const gameMatch = GAME_TITLES.find((game) => category.toLowerCase().startsWith(game.id));
  if (gameMatch) {
    const cleanLabel = category.toLowerCase().startsWith(gameMatch.id)
      ? category.slice(gameMatch.id.length).trim() || category
      : category;
    return {
      id: category,
      label: cleanLabel,
      description: `${cleanLabel} deck`,
      domainId: "games",
      collectionId: gameMatch.id,
      collectionLabel: gameMatch.label,
      icon: "style",
      accent: gameMatch.accent,
    };
  }

  const metadata = NON_GAME_METADATA[category];
  if (!metadata) return null;
  return {
    id: category,
    label: category,
    description: metadata.description,
    domainId: metadata.group.toLowerCase() as FindrawDomainId,
    collectionId: category,
    collectionLabel: category,
    icon: metadata.icon,
    accent: metadata.accent,
  };
}

function getPromptModes(asset: UnifiedAsset): FindrawModePool[] {
  const hasAutoDrawAsset = autoDrawAssetIds.has(asset.id);
  return hasAutoDrawAsset ? ["artist", "autoDraw", "room"] : ["artist", "room"];
}

export function getPromptsForMode(mode: FindrawModePool): FindrawPrompt[] {
  return UNIFIED_ASSETS
    .map((asset) => ({
      ...asset,
      modes: getPromptModes(asset),
      hasAutoDrawAsset: autoDrawAssetIds.has(asset.id),
    }))
    .filter((prompt) => prompt.modes.includes(mode));
}

function buildFindrawDomains(pool: UnifiedAsset[]): FindrawDomain[] {
  const categories = [...new Set(pool.map(({ category }) => category))];
  const decks = categories
    .map((category) => {
      const info = getCategoryDeckInfo(category);
      if (!info) return null;
      return {
        ...info,
        promptCount: pool.filter((item) => item.category === category).length,
      };
    })
    .filter(Boolean) as FindrawDeck[];

  const domains: FindrawDomain[] = [];
  for (const domainId of Object.keys(DOMAIN_LABELS) as FindrawDomainId[]) {
    const domainDecks = decks.filter((deck) => deck.domainId === domainId);
    if (domainDecks.length === 0) continue;
    const collectionIds = [...new Set(domainDecks.map((deck) => deck.collectionId))];
    domains.push({
      id: domainId,
      label: DOMAIN_LABELS[domainId],
      collections: collectionIds.map((collectionId) => {
        const collectionDecks = domainDecks.filter((deck) => deck.collectionId === collectionId);
        return {
          id: collectionId,
          label: collectionDecks[0]?.collectionLabel ?? collectionId,
          domainId,
          accent: collectionDecks[0]?.accent ?? "#83c5e6",
          decks: collectionDecks,
        };
      }),
    });
  }
  return domains;
}

export function getCategoryModel(mode: FindrawModePool): FindrawDomain[] {
  const cached = categoryModelCache.get(mode);
  if (cached) return cached;
  const model = buildFindrawDomains(MODE_ASSET_POOLS[mode]);
  categoryModelCache.set(mode, model);
  return model;
}

function getDeckById(mode: FindrawModePool, deckId: string): FindrawDeck | null {
  return getCategoryModel(mode)
    .flatMap((domain) => domain.collections.flatMap((collection) => collection.decks))
    .find((deck) => deck.id === deckId) ?? null;
}

function getCollectionByToken(mode: FindrawModePool, collectionToken: string): FindrawCollection | null {
  const collections = getCategoryModel(mode).flatMap((domain) => domain.collections);
  if (collectionToken.startsWith("game:")) {
    const collectionId = collectionToken.slice(5);
    return collections.find((collection) => collection.domainId === "games" && collection.id === collectionId) ?? null;
  }
  return collections.find((collection) => collection.id === collectionToken) ?? null;
}

function getDomainByToken(mode: FindrawModePool, domainToken: string): { label: string; accent: string } | null {
  if (!domainToken.startsWith("domain:")) return null;
  const domainId = domainToken.slice(7);
  if (domainId === "games") {
    const gamesDomain = getCategoryModel(mode).find((domain) => domain.id === "games");
    if (!gamesDomain) return null;
    return { label: "Games", accent: gamesDomain.collections[0]?.accent ?? "#83c5e6" };
  }
  if (domainId === "general") {
    const generalCollections = getCategoryModel(mode)
      .filter((domain) => domain.id !== "games")
      .flatMap((domain) => domain.collections);
    if (!generalCollections.length) return null;
    return { label: "General", accent: "#83c5e6" };
  }
  const domain = getCategoryModel(mode).find((item) => item.id === domainId);
  if (!domain) return null;
  return { label: domain.label, accent: domain.collections[0]?.accent ?? "#83c5e6" };
}

export function getSelectionTokens(selection: string): string[] {
  if (!selection || selection === "empty" || selection === "random") return [];
  return selection.split(",").map((token) => token.trim()).filter(Boolean);
}

export function getCollectionTokenForDeck(mode: FindrawModePool, deckId: string): string | null {
  for (const domain of getCategoryModel(mode)) {
    for (const collection of domain.collections) {
      if (!collection.decks.some((deck) => deck.id === deckId)) continue;
      return domain.id === "games" ? `game:${collection.id}` : collection.id;
    }
  }
  return null;
}

function getDomainTokenForDeck(mode: FindrawModePool, deckId: string): string | null {
  for (const domain of getCategoryModel(mode)) {
    if (!domain.collections.some((collection) => collection.decks.some((deck) => deck.id === deckId))) continue;
    return domain.id === "games" ? "domain:games" : "domain:general";
  }
  return null;
}

export function getDeckIdsForCollectionToken(mode: FindrawModePool, collectionToken: string): string[] {
  const model = getCategoryModel(mode);
  if (collectionToken.startsWith("domain:")) {
    const domainId = collectionToken.slice(7);
    const domains = domainId === "general"
      ? model.filter((domain) => domain.id !== "games")
      : model.filter((domain) => domain.id === domainId);
    return domains.flatMap((domain) => domain.collections.flatMap((collection) => collection.decks.map((deck) => deck.id)));
  }
  if (collectionToken.startsWith("game:")) {
    const collectionId = collectionToken.slice(5);
    return model
      .find((domain) => domain.id === "games")
      ?.collections.find((collection) => collection.id === collectionId)
      ?.decks.map((deck) => deck.id) ?? [];
  }
  return model
    .flatMap((domain) => domain.collections)
    .find((collection) => collection.id === collectionToken)
    ?.decks.map((deck) => deck.id) ?? [];
}

export function isCategorySelectionOptionActive(selection: string, optionId: string, mode: FindrawModePool): boolean {
  if (selection === "random") return optionId === "random";
  const tokens = getSelectionTokens(selection);
  if (tokens.length === 0) return false;
  if (tokens.includes("all")) return true;
  if (tokens.includes(optionId)) return true;

  const optionDeckIds = getDeckIdsForCollectionToken(mode, optionId);
  if (optionDeckIds.length > 0 && optionDeckIds.every((deckId) => tokens.includes(deckId))) return true;

  const parentToken = getCollectionTokenForDeck(mode, optionId);
  if (parentToken && tokens.includes(parentToken)) return true;

  const domainToken = getDomainTokenForDeck(mode, optionId);
  return Boolean(domainToken && tokens.includes(domainToken));
}

export function toggleCategorySelectionOption(selection: string, optionId: string, mode: FindrawModePool, emptySelection = ""): string {
  if (optionId === "all") return "all";

  let tokens = getSelectionTokens(selection);
  const globalAllSelected = tokens.includes("all");
  if (tokens.includes("all")) tokens = [];

  const selected = globalAllSelected ? false : isCategorySelectionOptionActive(selection, optionId, mode);
  const childDeckIds = getDeckIdsForCollectionToken(mode, optionId);

  if (childDeckIds.length > 0) {
    tokens = tokens.filter((token) => token !== optionId && !childDeckIds.includes(token));
    if (!selected) tokens.push(optionId);
    return tokens.length > 0 ? tokens.join(",") : emptySelection;
  }

  const parentToken = getCollectionTokenForDeck(mode, optionId);
  const siblingDeckIds = parentToken ? getDeckIdsForCollectionToken(mode, parentToken) : [];

  if (parentToken && tokens.includes(parentToken)) {
    tokens = tokens.filter((token) => token !== parentToken);
    tokens.push(...siblingDeckIds.filter((deckId) => deckId !== optionId));
    return tokens.length > 0 ? [...new Set(tokens)].join(",") : emptySelection;
  }

  const domainToken = getDomainTokenForDeck(mode, optionId);
  const domainDeckIds = domainToken ? getDeckIdsForCollectionToken(mode, domainToken) : [];

  if (domainToken && tokens.includes(domainToken)) {
    tokens = tokens.filter((token) => token !== domainToken);
    tokens.push(...domainDeckIds.filter((deckId) => deckId !== optionId));
    return tokens.length > 0 ? [...new Set(tokens)].join(",") : emptySelection;
  }

  tokens = selected
    ? tokens.filter((token) => token !== optionId)
    : [...tokens, optionId];

  if (parentToken && siblingDeckIds.length > 0 && siblingDeckIds.every((deckId) => tokens.includes(deckId))) {
    tokens = tokens.filter((token) => !siblingDeckIds.includes(token));
    tokens.push(parentToken);
  }

  if (domainToken && domainDeckIds.length > 0 && domainDeckIds.every((deckId) => tokens.includes(deckId))) {
    tokens = tokens.filter((token) => !domainDeckIds.includes(token));
    tokens.push(domainToken);
  }

  return tokens.length > 0 ? [...new Set(tokens)].join(",") : emptySelection;
}

export function removeCategorySelectionChip(selection: string, chipId: string, mode: FindrawModePool, emptySelection = ""): string {
  if (chipId === "empty") return selection;
  if (chipId === "all") return emptySelection;
  if (isCategorySelectionOptionActive(selection, chipId, mode)) {
    return toggleCategorySelectionOption(selection, chipId, mode, emptySelection);
  }
  return selection;
}

export function getActiveSelectionChips(selection: string, mode: FindrawModePool): CategorySelectionChip[] {
  const tokens = getSelectionTokens(selection);
  if (tokens.length === 0) {
    return [{ id: "empty", label: "No decks selected", accent: "#e6a283", kind: "empty" }];
  }
  if (tokens.includes("all")) {
    return [{ id: "all", label: "All decks shuffled", accent: "#83c5e6", kind: "all" }];
  }

  return tokens.map((token): CategorySelectionChip => {
    const domain = getDomainByToken(mode, token);
    if (domain) {
      return {
        id: token,
        label: `All ${domain.label}`,
        accent: domain.accent,
        kind: "domain",
      };
    }

    const collection = getCollectionByToken(mode, token);
    if (collection) {
      return {
        id: token,
        label: `All ${collection.label}`,
        accent: collection.accent,
        kind: "collection",
      };
    }

    const deck = getDeckById(mode, token);
    if (deck) {
      return {
        id: token,
        label: deck.label,
        accent: deck.accent,
        kind: "deck",
      };
    }

    return { id: token, label: token, accent: "#83c5e6", kind: "deck" };
  });
}

function buildCategoryDomains(pool: UnifiedAsset[]): CategoryPickerDomain[] {
  const model = buildFindrawDomains(pool);
  const gamesDomain: CategoryPickerDomain = {
    id: "games",
    label: "Games",
    groups: [
      {
        id: "games",
        label: "Games",
        options: [{
          id: "domain:games",
          label: "All Games",
          description: "A mixed pool from every game deck",
          icon: "sports_esports",
          accent: "#83c5e6",
          count: model
            .find((domain) => domain.id === "games")
            ?.collections.flatMap((collection) => collection.decks)
            .reduce((total, deck) => total + deck.promptCount, 0) ?? 0,
        }],
      },
      ...GAME_TITLES.map((game) => {
      const gameCollection = model
        .find((domain) => domain.id === "games")
        ?.collections.find((collection) => collection.id === game.id);
      const gameCategories = gameCollection?.decks ?? [];
      const allGameAssetsCount = pool.filter((item) => matchesSingleSelection(item.category, `game:${game.id}`)).length;
      if (allGameAssetsCount === 0) return null;
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
          ...gameCategories.map((deck) => ({
            id: deck.id,
            label: deck.label,
            description: deck.description,
            icon: deck.icon,
            accent: deck.accent,
            count: deck.promptCount,
          })),
        ],
      };
      }).filter(Boolean) as CategoryPickerGroup[],
    ],
  };

  const generalGroups = (["world", "culture", "everyday"] as FindrawDomainId[]).flatMap((domainId) => {
    const domain = model.find((item) => item.id === domainId);
    const options = domain?.collections.flatMap((collection) => collection.decks.map((deck) => ({
      id: deck.id,
      label: deck.label,
      description: deck.description,
      icon: deck.icon,
      accent: deck.accent,
      count: deck.promptCount,
    }))) ?? [];
    if (options.length === 0) return [];
    return [{
      id: domainId,
      label: DOMAIN_LABELS[domainId],
      options,
    }];
  });

  const generalCount = model
    .filter((domain) => domain.id !== "games")
    .flatMap((domain) => domain.collections.flatMap((collection) => collection.decks))
    .reduce((total, deck) => total + deck.promptCount, 0);

  const generalDomain: CategoryPickerDomain = {
    id: "general",
    label: "General",
    groups: [
      {
        id: "general",
        label: "General",
        options: [{
          id: "domain:general",
          label: "All General",
          description: "A mixed pool from everyday, world, and culture decks",
          icon: "category",
          accent: "#83c5e6",
          count: generalCount,
        }],
      },
      ...generalGroups,
    ],
  };

  return [gamesDomain, generalDomain].filter((domain) => domain.groups.length > 0);
}

export function getCategoryDomains(mode: FindrawModePool): CategoryPickerDomain[] {
  const cached = categoryDomainsCache.get(mode);
  if (cached) return cached;
  const domains = buildCategoryDomains(MODE_ASSET_POOLS[mode]);
  categoryDomainsCache.set(mode, domains);
  return domains;
}

export const UNIFIED_DOMAINS: CategoryPickerDomain[] = getCategoryDomains("artist");

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

  if (categoryId.startsWith("domain:")) {
    const domainId = categoryId.slice(7);
    if (domainId === "games") {
      return {
        id: categoryId,
        name: "All Games",
        group: "Games",
        description: "A mixed pool from every game deck.",
        icon: "sports_esports",
        accent: "#83c5e6",
      };
    }
    if (domainId === "general") {
      return {
        id: categoryId,
        name: "All General",
        group: "Everyday",
        description: "A mixed pool from everyday, world, and culture decks.",
        icon: "category",
        accent: "#83c5e6",
      };
    }
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
    difficulty: asset.difficulty,
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
