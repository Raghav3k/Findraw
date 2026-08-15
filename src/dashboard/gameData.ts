import { AUTO_DRAW_ASSETS } from "../autoDraw/autoDrawAssets";
import type { CategoryPickerDomain, CategoryPickerGroup, CategoryPickerSection } from "../ui/CategoryPickerWindow";
import artistWordsRaw from "./artistWords.json";
import { normalizeWordFeedbackStats, type FeedbackMode, type WordFeedbackMap } from "../feedback/wordFeedback";

export type RoundPrompt = {
  answer: string;
  aliases?: string[];
};

export type WordDifficulty = "easy" | "medium" | "hard";

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
  { id: "fortnite", label: "Fortnite", accent: "#8fb7e8" },
  { id: "minecraft", label: "Minecraft", accent: "#91bd74" },
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
  tooltip?: string;
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
  if (difficulty === "medium" || difficulty === "Medium") return "medium";
  if (difficulty === "hard" || difficulty === "Hard") return "hard";
  return "easy";
}

export const matchesSingleSelection = (category: string, token: string) => {
  if (token === "all") return true;
  if (token === category) return true;
  if (LEGACY_GENERAL_CATEGORIES.includes(token) && category.startsWith(`${token} `)) return true;
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
  if (selection === "random") return matchesSingleSelection(category, "domain:general");
  if (selection === "empty") return false;
  const tokens = selection.split(",").filter(Boolean);
  if (tokens.includes("all")) return true;
  return tokens.some((token) => matchesSingleSelection(category, token));
};

type NonGameMetadata = {
  group: "Culture" | "World" | "Everyday";
  icon: string;
  accent: string;
  description: string;
  label?: string;
};

const NON_GAME_METADATA: Record<string, NonGameMetadata> = {
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

const NON_GAME_PREFIX_METADATA: Array<{ prefix: string } & NonGameMetadata> = [
  { prefix: "Movies & TV", group: "Culture", icon: "movie", accent: "#7b9ac8", description: "Screen stories, franchises, and memorable props." },
  { prefix: "Anime & Manga", group: "Culture", icon: "animation", accent: "#cf8bc5", description: "Anime, manga, characters, and iconic series." },
  { prefix: "Cartoons", group: "Culture", icon: "theater_comedy", accent: "#d9a566", description: "Animated TV characters and cartoon classics." },
  { prefix: "Music", group: "Culture", icon: "music_note", accent: "#bb83c8", description: "Songs, performers, instruments, and music language." },
  { prefix: "Books & Stories", group: "Culture", icon: "auto_stories", accent: "#b68b62", description: "Stories, book titles, characters, and literary ideas." },
  { prefix: "Sports", group: "Culture", icon: "sports_soccer", accent: "#6ca2d1", description: "Sports, players, teams, gear, moves, and rules." },
  { prefix: "Mythology", group: "Culture", icon: "castle", accent: "#c79069", description: "Mythical creatures, heroes, artifacts, and legendary places." },
  { prefix: "Countries & Flags", group: "World", icon: "flag", accent: "#83a6d8", description: "Countries, flags, and recognizable national symbols." },
  { prefix: "Cities", group: "World", icon: "location_city", accent: "#90a879", description: "Famous cities and travel-friendly place names." },
  { prefix: "Animals", group: "World", icon: "pets", accent: "#df9a62", description: "Common animals, wildlife, and rarer species." },
  { prefix: "Ocean & Fish", group: "World", icon: "water", accent: "#64b5cf", description: "Sea animals, ocean life, and deep-sea oddities." },
  { prefix: "Places", group: "World", icon: "travel_explore", accent: "#80b58c", description: "Places, landmarks, and recognizable destinations." },
  { prefix: "Space", group: "World", icon: "rocket_launch", accent: "#777fbe", description: "Planets, spacecraft, astronomy, and deep-space ideas." },
  { prefix: "Nature", group: "World", icon: "forest", accent: "#76ad76", description: "Landscapes, weather, plants, and natural phenomena." },
  { prefix: "Weather", group: "World", icon: "thunderstorm", accent: "#7da8c2", description: "Weather, sky objects, and drawable atmosphere ideas." },
  { prefix: "Plants", group: "World", icon: "local_florist", accent: "#79aa73", description: "Common plants through unusual species." },
  { prefix: "Actions", group: "Everyday", icon: "directions_run", accent: "#cf9278", description: "Everyday actions and expressive poses." },
  { prefix: "Emotions", group: "Everyday", icon: "sentiment_satisfied", accent: "#d8b365", description: "Simple feelings through harder emotional states." },
  { prefix: "Clothing & Fashion", group: "Everyday", icon: "checkroom", accent: "#b189c8", description: "Wearable items, outfits, and fashion details." },
  { prefix: "Home & Rooms", group: "Everyday", icon: "home", accent: "#a6a083", description: "Rooms, furniture, and household spaces." },
  { prefix: "School", group: "Everyday", icon: "school", accent: "#74a8b9", description: "School supplies, classroom life, and subjects." },
  { prefix: "Food", group: "Everyday", icon: "restaurant", accent: "#ed8b67", description: "Foods by region, type, and familiarity." },
  { prefix: "Jobs", group: "Everyday", icon: "badge", accent: "#d19a67", description: "Everyday jobs and specialist professions." },
  { prefix: "Technology", group: "Everyday", icon: "devices", accent: "#79a9b8", description: "Daily tech, parts, concepts, and advanced computing terms." },
  { prefix: "Work & Tech", group: "Everyday", icon: "devices", accent: "#79a9b8", description: "Jobs, daily devices, technical parts, and advanced tech." },
  { prefix: "Everyday Objects", group: "Everyday", icon: "inventory_2", accent: "#a6a083", description: "Household objects, tools, and daily-use items." },
];

function getNonGameMetadata(category: string): NonGameMetadata | null {
  const exact = NON_GAME_METADATA[category];
  if (exact) return exact;
  const prefix = NON_GAME_PREFIX_METADATA.find((item) => category === item.prefix || category.startsWith(`${item.prefix} `));
  if (!prefix) return null;
  const label = category === prefix.prefix ? category : category.slice(prefix.prefix.length).trim();
  return { ...prefix, label };
}

const DOMAIN_LABELS: Record<FindrawDomainId, string> = {
  games: "Games",
  world: "World",
  culture: "Culture",
  everyday: "Everyday",
};

const LEGACY_GENERAL_CATEGORIES = [
  "Animals",
  "Ocean & Fish",
  "Food",
  "Places",
  "Music",
  "Singers & Bands",
  "Books & Stories",
  "Movies & TV",
  "Sports",
  "Space",
  "Nature",
  "Jobs",
  "Technology",
  "Work & Tech",
  "Mythology",
  "Everyday Objects",
];

const GAME_SECTIONS = [
  { id: "shooters", label: "Shooters", games: ["valorant", "rainbow six siege", "arc raiders", "deadlock", "fortnite"] },
  { id: "strategy", label: "Strategy", games: ["league of legends", "dota 2", "clash royale", "clash of clans"] },
  { id: "sandbox", label: "Sandbox", games: ["minecraft"] },
  { id: "rpg", label: "RPG", games: ["genshin impact"] },
];

const GENERAL_SECTIONS = [
  {
    id: "entertainment",
    label: "Entertainment",
    groups: [
      { id: "movies-tv", label: "Movies & TV", categories: ["Movies & TV Marvel", "Movies & TV DC", "Movies & TV Star Wars", "Movies & TV Animation", "Movies & TV Popular Picks", "Movies & TV Props"] },
      { id: "anime-cartoons", label: "Anime & Cartoons", categories: ["Anime & Manga", "Cartoons"] },
      { id: "music", label: "Music", categories: ["Music Songs", "Music Singers & Bands", "Music Instruments", "Music Performance", "Music Theory"] },
      { id: "books-stories", label: "Books & Stories", categories: ["Books & Stories Fairy Tales", "Books & Stories Classic Books", "Books & Stories Characters", "Books & Stories Modern Stories"] },
      { id: "sports", label: "Sports", categories: ["Sports Types", "Sports Equipment", "Sports Players", "Sports Teams", "Sports Moves & Rules"] },
      { id: "myths-legends", label: "Myths & Legends", categories: ["Mythology Creatures", "Mythology Gods & Heroes", "Mythology Artifacts & Places"] },
    ],
  },
  {
    id: "world-nature",
    label: "World & Nature",
    groups: [
      { id: "countries-cities", label: "Countries & Cities", categories: ["Countries & Flags", "Cities"] },
      { id: "animals-life", label: "Animals & Sea Life", categories: ["Animals Common", "Animals Wildlife", "Animals Rare", "Ocean & Fish Sea Animals", "Ocean & Fish Ocean Creatures", "Ocean & Fish Deep Sea"] },
      { id: "places-landmarks", label: "Places & Landmarks", categories: ["Places Everyday", "Places Famous Landmarks", "Places World Landmarks"] },
      { id: "space", label: "Space", categories: ["Space Basics", "Space Exploration", "Space Deep Space"] },
      { id: "nature", label: "Nature", categories: ["Nature Landscapes", "Weather & Sky", "Plants Common", "Plants Unusual", "Nature Rare Phenomena"] },
    ],
  },
  {
    id: "daily-life",
    label: "Daily Life",
    groups: [
      { id: "actions-emotions", label: "Actions & Emotions", categories: ["Actions", "Emotions"] },
      { id: "home-clothing", label: "Home & Clothing", categories: ["Home & Rooms", "Clothing & Fashion"] },
      { id: "school", label: "School", categories: ["School Supplies", "School Life", "School Subjects"] },
      { id: "objects", label: "Everyday Objects", categories: ["Everyday Objects Household", "Everyday Objects Kitchen", "Everyday Objects Tools"] },
    ],
  },
  {
    id: "food-work",
    label: "Food & Work",
    groups: [
      { id: "regional-food", label: "Regional Food", categories: ["Food North America", "Food South America", "Food Europe", "Food Asia", "Food Middle East", "Food Africa", "Food Australia"] },
      { id: "food-types", label: "Food Types", categories: ["Food Snacks", "Food Breakfast & Cereal", "Food Fruits & Sweets", "Food Desserts", "Food Drinks", "Food Street Food", "Food Everyday Favorites"] },
      { id: "work-tech", label: "Work & Tech", categories: ["Work & Tech Everyday Jobs", "Work & Tech Specialist Jobs", "Work & Tech Everyday Tech", "Work & Tech Tech Parts", "Work & Tech Advanced Tech"] },
    ],
  },
];

function getDeckContextLabel(deckId: string): string | null {
  const gameMatch = GAME_TITLES.find((game) => deckId.toLowerCase().startsWith(game.id));
  if (gameMatch) return gameMatch.label;

  for (const section of GENERAL_SECTIONS) {
    for (const group of section.groups) {
      if (group.categories.includes(deckId)) return `${section.label} / ${group.label}`;
    }
  }

  return null;
}

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

  const metadata = getNonGameMetadata(category);
  if (!metadata) return null;
  return {
    id: category,
    label: metadata.label ?? category,
    description: metadata.description,
    domainId: metadata.group.toLowerCase() as FindrawDomainId,
    collectionId: category,
    collectionLabel: metadata.label ?? category,
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
  if (!selection || selection === "empty") return [];
  if (selection === "random") return ["domain:general"];
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
  if (collectionToken === "all") {
    return model.flatMap((domain) => domain.collections.flatMap((collection) => collection.decks.map((deck) => deck.id)));
  }
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

function getChildDeckIdsForParentToken(mode: FindrawModePool, token: string): string[] {
  const childDeckIds = getDeckIdsForCollectionToken(mode, token);
  return childDeckIds.length === 1 && childDeckIds[0] === token ? [] : childDeckIds;
}

export function isCategorySelectionOptionActive(selection: string, optionId: string, mode: FindrawModePool): boolean {
  const tokens = getSelectionTokens(selection);
  if (tokens.length === 0) return false;
  if (tokens.includes("all")) return true;
  if (tokens.includes(optionId)) return true;
  if (tokens.some((token) => matchesSingleSelection(optionId, token))) return true;

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
  if (globalAllSelected) {
    tokens = getDeckIdsForCollectionToken(mode, "all");
  }

  const selected = isCategorySelectionOptionActive(selection, optionId, mode);
  const childDeckIds = getChildDeckIdsForParentToken(mode, optionId);

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
  const tokens = getSelectionTokens(selection);
  const childDeckIds = getChildDeckIdsForParentToken(mode, chipId);
  if (childDeckIds.length > 0) {
    const nextTokens = tokens.filter((token) => token !== chipId && !childDeckIds.includes(token));
    return nextTokens.length > 0 ? [...new Set(nextTokens)].join(",") : emptySelection;
  }
  const nextTokens = tokens.filter((token) => token !== chipId);
  return nextTokens.length > 0 ? [...new Set(nextTokens)].join(",") : emptySelection;
}

export function getActiveSelectionChips(selection: string, mode: FindrawModePool): CategorySelectionChip[] {
  const tokens = getSelectionTokens(selection);
  if (tokens.length === 0) {
    return [{ id: "empty", label: "No decks selected", accent: "#e6a283", kind: "empty" }];
  }
  if (tokens.includes("all")) {
    return [{ id: "all", label: "Decks shuffled", accent: "#83c5e6", kind: "all", tooltip: "Every available deck" }];
  }

  const tokenSet = new Set(tokens);
  const compactChips: CategorySelectionChip[] = [];
  const consumedTokens = new Set<string>();
  const model = getCategoryModel(mode);

  for (const domainToken of ["domain:games", "domain:general"]) {
    const domainId = domainToken.slice(7);
    const domainDeckIds = getDeckIdsForCollectionToken(mode, domainToken);
    if (domainDeckIds.length === 0) continue;
    const selectedDeckIds = domainDeckIds.filter((deckId) => tokenSet.has(deckId));
    const coverage = selectedDeckIds.length / domainDeckIds.length;
    if (coverage < 0.72 || selectedDeckIds.length < 8) continue;

    const label = domainId === "games" ? "Games" : "General";
    const excludedDecks = domainDeckIds
      .filter((deckId) => !tokenSet.has(deckId))
      .map((deckId) => getDeckById(mode, deckId)?.label ?? deckId);
    const tooltip = excludedDecks.length
      ? `${selectedDeckIds.length}/${domainDeckIds.length} decks selected. Excluded: ${excludedDecks.slice(0, 6).join(", ")}${excludedDecks.length > 6 ? `, +${excludedDecks.length - 6} more` : ""}`
      : `${selectedDeckIds.length}/${domainDeckIds.length} decks selected`;

    compactChips.push({
      id: domainToken,
      label,
      accent: model
        .find((domain) => domainToken === "domain:games" ? domain.id === "games" : domain.id !== "games")
        ?.collections[0]?.accent ?? "#83c5e6",
      kind: "domain",
      tooltip,
    });
    selectedDeckIds.forEach((deckId) => consumedTokens.add(deckId));
  }

  const visibleTokens = tokens.filter((token) => !consumedTokens.has(token));
  const tokenChips = visibleTokens.map((token): CategorySelectionChip => {
    const domain = getDomainByToken(mode, token);
    if (domain) {
      return {
        id: token,
        label: domain.label,
        accent: domain.accent,
        kind: "domain",
        tooltip: `Every ${domain.label} deck`,
      };
    }

    const collection = getCollectionByToken(mode, token);
    if (collection) {
      return {
        id: token,
        label: collection.label,
        accent: collection.accent,
        kind: "collection",
        tooltip: getDeckContextLabel(token) ?? `${collection.label} deck`,
      };
    }

    const deck = getDeckById(mode, token);
    if (deck) {
      return {
        id: token,
        label: deck.label,
        accent: deck.accent,
        kind: "deck",
        tooltip: getDeckContextLabel(deck.id) ?? deck.collectionLabel,
      };
    }

    return { id: token, label: token, accent: "#83c5e6", kind: "deck" };
  });

  return [...compactChips, ...tokenChips];
}

function buildCategoryDomains(pool: UnifiedAsset[]): CategoryPickerDomain[] {
  const model = buildFindrawDomains(pool);
  const gameGroups = GAME_TITLES.map((game) => {
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
  }).filter(Boolean) as CategoryPickerGroup[];

  const allGamesGroup: CategoryPickerGroup = {
    id: "featured",
    label: "Quick Mix",
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
  };

  const gameSections: CategoryPickerSection[] = [
    {
      id: "all",
      label: "All",
      groups: [allGamesGroup],
    },
    ...GAME_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      groups: gameGroups.filter((group) => section.games.includes(group.id)),
    })).filter((section) => section.groups.length > 0),
  ];

  const gamesDomain: CategoryPickerDomain = {
    id: "games",
    label: "Games",
    groups: gameSections.flatMap((section) => section.groups),
    sections: gameSections,
  };

  const generalDecks = model
    .flatMap((domain) => domain.collections.flatMap((collection) => collection.decks));

  const makeGeneralGroup = (group: typeof GENERAL_SECTIONS[number]["groups"][number]): CategoryPickerGroup | null => {
    const decks = group.categories
      .map((category) => generalDecks.find((deck) => deck.id === category))
      .filter(Boolean) as FindrawDeck[];
    if (!decks.length) return null;
    return {
      id: group.id,
      label: group.label,
      options: decks.map((deck) => ({
        id: deck.id,
        label: deck.label,
        description: deck.description,
        icon: deck.icon,
        accent: deck.accent,
        count: deck.promptCount,
      })),
    };
  };

  const generalCount = model
    .filter((domain) => domain.id !== "games")
    .flatMap((domain) => domain.collections.flatMap((collection) => collection.decks))
    .reduce((total, deck) => total + deck.promptCount, 0);

  const allGeneralGroup: CategoryPickerGroup = {
    id: "featured",
    label: "Quick Mix",
    options: [{
      id: "domain:general",
      label: "All General",
      description: "A mixed pool from entertainment, world, and lifestyle decks",
      icon: "category",
      accent: "#83c5e6",
      count: generalCount,
    }],
  };

  const generalSections: CategoryPickerSection[] = [
    {
      id: "all",
      label: "All",
      groups: [allGeneralGroup],
    },
    ...GENERAL_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      groups: section.groups
        .map(makeGeneralGroup)
        .filter(Boolean) as CategoryPickerGroup[],
    })).filter((section) => section.groups.length > 0),
  ];

  const generalDomain: CategoryPickerDomain = {
    id: "general",
    label: "General",
    groups: generalSections.flatMap((section) => section.groups),
    sections: generalSections,
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
        description: "A mixed pool from entertainment, world, and lifestyle decks.",
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

  const otherMeta = getNonGameMetadata(categoryId);
  if (otherMeta) {
    return {
      id: categoryId,
      name: otherMeta.label ?? categoryId,
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

const getAssetPromptKey = (asset: UnifiedAsset) => `${asset.category}:${asset.answer.toLocaleLowerCase("en")}`;

function toCategoryPrompt(asset: UnifiedAsset): CategoryPrompt {
  return {
    answer: asset.answer,
    aliases: asset.aliases,
    categoryId: asset.category,
    difficulty: asset.difficulty,
  };
}

function pickWeightedDifficulty(pool: UnifiedAsset[], recentKeys: string[]): WordDifficulty {
  const availableDifficulties = new Set(pool.map((asset) => asset.difficulty));
  const recent = new Set(recentKeys.slice(-6));
  const recentPrompts = pool.filter((asset) => recent.has(getAssetPromptKey(asset)));
  const recentHardCount = recentPrompts.filter((asset) => asset.difficulty === "hard").length;
  const lastPrompt = pool.find((asset) => getAssetPromptKey(asset) === recentKeys.at(-1));

  let hardWeight = 0.16;
  if (recentPrompts.length >= 5 && recentHardCount === 0) hardWeight = 0.2;
  if (recentHardCount >= 1) hardWeight = 0.08;
  if (recentHardCount >= 2 || lastPrompt?.difficulty === "hard") hardWeight = 0;

  const weights: Array<{ difficulty: WordDifficulty; weight: number }> = [
    { difficulty: "easy" as WordDifficulty, weight: 0.48 },
    { difficulty: "medium" as WordDifficulty, weight: 0.36 },
    { difficulty: "hard" as WordDifficulty, weight: hardWeight },
  ].filter((item) => availableDifficulties.has(item.difficulty) && item.weight > 0);

  if (weights.length === 0) return pool[0]?.difficulty ?? "easy";

  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of weights) {
    roll -= item.weight;
    if (roll <= 0) return item.difficulty;
  }
  return weights[weights.length - 1].difficulty;
}

type PromptPickOptions = {
  feedback?: WordFeedbackMap;
  mode?: FeedbackMode;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function getFeedbackWeight(asset: UnifiedAsset, options?: PromptPickOptions): number {
  const storedStats = options?.feedback?.[getAssetPromptKey(asset)];
  if (!storedStats) return 1;
  const stats = normalizeWordFeedbackStats(storedStats);
  if (stats.submitted + stats.skipped < 2) return 1;

  const positive = stats.veryGood * 1.15;
  const negativeMultiplier = options?.mode === "room" ? 1.45 : options?.mode === "autoDraw" ? 1.05 : 1.22;
  const skipReasonPenalty =
    stats.notInterested * 0.22 +
    stats.notFun * negativeMultiplier +
    stats.unrecognized * (negativeMultiplier + 0.35);
  const negative = stats.bad * negativeMultiplier + stats.mid * 0.18 + skipReasonPenalty + stats.skipped * 0.32;
  const confidence = clamp((stats.submitted + stats.skipped) / 10, 0.18, 1);
  const rawScore = (positive - negative) / Math.max(4, stats.submitted + stats.skipped + 3);
  const difficultyDamping = asset.difficulty === "easy" ? 0.45 : asset.difficulty === "medium" ? 0.85 : 1;

  return clamp(1 + rawScore * confidence * difficultyDamping, 0.35, 1.35);
}

function pickWeightedAsset(choices: UnifiedAsset[], options?: PromptPickOptions): UnifiedAsset {
  const weighted = choices.map((asset) => ({
    asset,
    weight: getFeedbackWeight(asset, options),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * Math.max(0.001, total);
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.asset;
  }
  return choices[choices.length - 1];
}

export function pickBalancedPrompts(pool: UnifiedAsset[], recentKeys: string[], count: number, options?: PromptPickOptions): CategoryPrompt[] {
  const picked: CategoryPrompt[] = [];
  const workingRecentKeys = [...recentKeys];

  for (let index = 0; index < count; index += 1) {
    const recent = new Set(workingRecentKeys.slice(-32));
    const pickedKeys = new Set(picked.map(getPromptKey));
    const available = pool.filter((asset) => !recent.has(getAssetPromptKey(asset)) && !pickedKeys.has(getAssetPromptKey(asset)));
    const fallback = pool.filter((asset) => !pickedKeys.has(getAssetPromptKey(asset)));
    const choices = available.length > 0 ? available : fallback.length > 0 ? fallback : pool;
    if (choices.length === 0) break;

    const preferredDifficulty = pickWeightedDifficulty(choices, workingRecentKeys);
    const preferredChoices = choices.filter((asset) => asset.difficulty === preferredDifficulty);
    const finalChoices = preferredChoices.length > 0 ? preferredChoices : choices;
    const asset = pickWeightedAsset(finalChoices, options);
    const prompt = toCategoryPrompt(asset);

    picked.push(prompt);
    workingRecentKeys.push(getPromptKey(prompt));
  }

  return picked;
}

export function pickNextPrompt(
  selection: CategorySelection,
  recentKeys: string[],
  options?: PromptPickOptions,
): CategoryPrompt {
  const matchingAssets = UNIFIED_ASSETS.filter((a) => matchesCategorySelection(a.category, selection));
  const choices = pickBalancedPrompts(matchingAssets, recentKeys, 1, options);
  
  if (choices.length === 0) {
    return { answer: "Error: No words found", categoryId: "random" };
  }

  return choices[0];
}
