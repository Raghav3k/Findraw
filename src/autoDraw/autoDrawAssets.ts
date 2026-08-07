import arcRaidersCatalog from "./arcRaidersCatalog.json";
import clashOfClansCatalog from "./clashOfClansCatalog.json";
import clashRoyaleCatalog from "./clashRoyaleCatalog.json";
import deadlockCatalog from "./deadlockCatalog.json";
import dota2Catalog from "./dota2Catalog.json";
import genshinCatalog from "./genshinCatalog.json";
import leagueOfLegendsCatalog from "./leagueOfLegendsCatalog.json";
import rainbowSixCatalog from "./rainbowSixCatalog.json";
import valorantCatalog from "./valorantCatalog.json";

export type AutoDrawStage = {
  label: string;
  obscurity: number;
  reveal: number;
};

export type AutoDrawRevealZone = {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  /** Positive values keep identity-defining regions covered for longer. */
  revealBias: number;
};

export type AutoDrawAsset = {
  aliases?: string[];
  answer: string;
  category: string;
  difficulty: "Easy" | "Medium" | "Hard";
  id: string;
  imageUrl: string;
  subjectBounds: { x: number; y: number; width: number; height: number };
  /** Contextual clue map authored when the signature sketch asset is generated. */
  revealZones: AutoDrawRevealZone[];
  stages: AutoDrawStage[];
};

export const AUTO_DRAW_OBSCURITY_LEVELS = [93, 86, 79, 72, 65, 58, 50, 43, 36, 30, 24, 18, 12, 8, 5, 3, 1, 0] as const;

const stages = (): AutoDrawStage[] => [
  ...AUTO_DRAW_OBSCURITY_LEVELS.map((obscurity) => ({
    label: obscurity === 0 ? "Maximum clarity" : `${obscurity}% obscured`,
    obscurity,
    reveal: 1 - obscurity / 100,
  })),
  { label: "Full sketch", obscurity: 0, reveal: 1 },
];

const DEFAULT_BOUNDS = { x: 0, y: 0, width: 1, height: 1 };
const DEFAULT_REVEAL_ZONES: AutoDrawRevealZone[] = [
  { x: 0.5, y: 0.2, radiusX: 0.2, radiusY: 0.15, revealBias: 0.3 },
  { x: 0.5, y: 0.5, radiusX: 0.25, radiusY: 0.2, revealBias: 0.1 },
  { x: 0.5, y: 0.8, radiusX: 0.2, radiusY: 0.15, revealBias: -0.1 },
];

function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

const sectionFolderOverrides: Record<string, string> = {
  "clash-royale:otherModes": "other-modes",
  "clash-royale:towerTroops": "tower-troops",
};

type CatalogItem = {
  id?: string;
  answer: string;
  aliases?: string[];
  file: string;
  category?: string;
  difficulty?: "Easy" | "Medium" | "Hard";
  bounds?: { x: number; y: number; width: number; height: number };
};

type GameCatalog = Record<string, CatalogItem[]>;

const gameMeta: Array<{ gameFolder: string; title: string; catalog: GameCatalog }> = [
  { gameFolder: "valorant", title: "Valorant", catalog: valorantCatalog as unknown as GameCatalog },
  { gameFolder: "clash-royale", title: "Clash Royale", catalog: clashRoyaleCatalog as unknown as GameCatalog },
  { gameFolder: "genshin", title: "Genshin Impact", catalog: genshinCatalog as unknown as GameCatalog },
  { gameFolder: "deadlock", title: "Deadlock", catalog: deadlockCatalog as unknown as GameCatalog },
  { gameFolder: "dota-2", title: "Dota 2", catalog: dota2Catalog as unknown as GameCatalog },
  { gameFolder: "league-of-legends", title: "League of Legends", catalog: leagueOfLegendsCatalog as unknown as GameCatalog },
  { gameFolder: "rainbow-six", title: "Rainbow Six Siege", catalog: rainbowSixCatalog as unknown as GameCatalog },
  { gameFolder: "clash-of-clans", title: "Clash of Clans", catalog: clashOfClansCatalog as unknown as GameCatalog },
  { gameFolder: "arc-raiders", title: "Arc Raiders", catalog: arcRaidersCatalog as unknown as GameCatalog },
];

function formatSectionTitle(key: string): string {
  const kebab = camelToKebab(key);
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function processCatalog(
  gameFolder: string,
  gameTitle: string,
  catalog: GameCatalog
): AutoDrawAsset[] {
  const assets: AutoDrawAsset[] = [];

  for (const [sectionKey, items] of Object.entries(catalog)) {
    if (!Array.isArray(items)) continue;
    const folderName = sectionFolderOverrides[`${gameFolder}:${sectionKey}`] ?? camelToKebab(sectionKey);

    // Skip experimental sources bucket in Valorant
    if (gameFolder === "valorant" && (sectionKey === "sources" || folderName === "sources")) {
      continue;
    }

    const sectionTitle = formatSectionTitle(sectionKey);
    const categoryName = `${gameTitle} ${sectionTitle}`;

    for (const item of items) {
      if (!item || !item.file || !item.answer) continue;

      const imageUrl = `/auto-draw/${gameFolder}/${folderName}/${item.file}`;
      const id = item.id || `${gameFolder}-${folderName}-${item.answer}`.replace(/[^a-z0-9]+/g, "-");

      assets.push({
        aliases: item.aliases ?? [],
        answer: item.answer.trim().toLowerCase(),
        category: categoryName,
        difficulty: item.difficulty || "Medium",
        id,
        imageUrl,
        subjectBounds: item.bounds ?? DEFAULT_BOUNDS,
        revealZones: DEFAULT_REVEAL_ZONES,
        stages: stages(),
      });
    }
  }

  return assets;
}

export const AUTO_DRAW_ASSETS: AutoDrawAsset[] = gameMeta.flatMap(({ gameFolder, title, catalog }) =>
  processCatalog(gameFolder, title, catalog)
);
