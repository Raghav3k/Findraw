import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const autoDrawRoot = path.join(repoRoot, "public", "auto-draw");
const catalogRoot = path.join(repoRoot, "src", "autoDraw");
const assetExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

const games = [
  { folder: "arc-raiders", catalog: "arcRaidersCatalog.json" },
  { folder: "clash-of-clans", catalog: "clashOfClansCatalog.json" },
  { folder: "clash-royale", catalog: "clashRoyaleCatalog.json" },
  { folder: "deadlock", catalog: "deadlockCatalog.json" },
  { folder: "dota-2", catalog: "dota2Catalog.json" },
  { folder: "genshin", catalog: "genshinCatalog.json" },
  { folder: "league-of-legends", catalog: "leagueOfLegendsCatalog.json" },
  { folder: "rainbow-six", catalog: "rainbowSixCatalog.json" },
  { folder: "valorant", catalog: "valorantCatalog.json" },
];

function cleanAnswerFromFilename(filename) {
  let name = path.basename(filename, path.extname(filename));
  
  // Replace underscores and hyphens with spaces for processing
  let cleaned = name
    .replace(/[-_]nobg$/i, "")
    .replace(/[-_]no[-_]background$/i, "")
    .replace(/[-_]edited$/i, "")
    .replace(/[-_]portrait$/i, "")
    .replace(/[-_]sketch$/i, "")
    .replace(/[-_]source$/i, "")
    .replace(/[-_]render$/i, "")
    .replace(/[-_]4k$/i, "")
    .replace(/[-_]pose\d+$/i, "")
    .replace(/[-_]\d+$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase to spaces
    .replace(/[-_]+/g, " ")
    .trim();

  // If cleaning stripped everything, revert to basic filename
  if (!cleaned) {
    cleaned = name.replace(/[-_]+/g, " ").trim();
  }

  return cleaned.toLowerCase();
}

function camelToKebab(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function processGame(gameInfo) {
  const gameDirPath = path.join(autoDrawRoot, gameInfo.folder);
  if (!existsSync(gameDirPath)) {
    console.log(`Directory missing: ${gameDirPath}`);
    return;
  }

  const catalogFilePath = path.join(catalogRoot, gameInfo.catalog);
  let existingCatalogData = {};
  if (existsSync(catalogFilePath)) {
    try {
      existingCatalogData = JSON.parse(readFileSync(catalogFilePath, "utf8").replace(/^\uFEFF/, ""));
    } catch (e) {
      console.warn(`Could not parse ${gameInfo.catalog}, creating fresh.`);
    }
  }

  const resultCatalog = {};
  const entries = readdirSync(gameDirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const bucketName = entry.name;
    if (gameInfo.folder === "valorant" && bucketName === "sources") continue;
    const bucketDirPath = path.join(gameDirPath, bucketName);
    
    // Check if existing catalog has a key for this bucket
    // (could be camelCase in JSON or kebab-case)
    let matchingKey = Object.keys(existingCatalogData).find(
      (k) => k === bucketName || camelToKebab(k) === bucketName || k.toLowerCase() === bucketName.replace(/-/g, "").toLowerCase()
    ) || bucketName;

    const existingSectionList = Array.isArray(existingCatalogData[matchingKey]) ? existingCatalogData[matchingKey] : [];
    const existingMapByFile = new Map();
    for (const item of existingSectionList) {
      if (item && item.file) existingMapByFile.set(item.file, item);
    }

    const fileEntries = readdirSync(bucketDirPath, { withFileTypes: true });
    const sectionList = [];

    for (const fileEntry of fileEntries) {
      if (fileEntry.isDirectory()) {
        // Handle subdirectories like sketches/
        const subFiles = readdirSync(path.join(bucketDirPath, fileEntry.name), { withFileTypes: true });
        for (const subFile of subFiles) {
          if (!subFile.isFile() || !assetExtensions.has(path.extname(subFile.name).toLowerCase())) continue;
          const relativeFile = `${fileEntry.name}/${subFile.name}`;
          const existingItem = existingMapByFile.get(relativeFile) || existingMapByFile.get(subFile.name);
          const rawStem = path.basename(subFile.name, path.extname(subFile.name)).toLowerCase();
          const cleanAnswer = existingItem?.answer || cleanAnswerFromFilename(subFile.name);
          const existingAliases = Array.isArray(existingItem?.aliases) ? existingItem.aliases : [];
          const aliasesSet = new Set(existingAliases);
          if (rawStem !== cleanAnswer) aliasesSet.add(rawStem.replace(/[-_]+/g, " "));

          sectionList.push({
            id: existingItem?.id || `${gameInfo.folder}-${bucketName}-${rawStem}`.replace(/[^a-z0-9]+/g, "-"),
            answer: cleanAnswer,
            aliases: Array.from(aliasesSet).filter((a) => a !== cleanAnswer),
            file: relativeFile,
          });
        }
        continue;
      }

      if (!fileEntry.isFile() || !assetExtensions.has(path.extname(fileEntry.name).toLowerCase())) continue;

      const fileName = fileEntry.name;
      const existingItem = existingMapByFile.get(fileName);
      const rawStem = path.basename(fileName, path.extname(fileName)).toLowerCase();
      const cleanAnswer = existingItem?.answer || cleanAnswerFromFilename(fileName);
      const existingAliases = Array.isArray(existingItem?.aliases) ? existingItem.aliases : [];
      const aliasesSet = new Set(existingAliases);
      if (rawStem !== cleanAnswer) aliasesSet.add(rawStem.replace(/[-_]+/g, " "));

      sectionList.push({
        id: existingItem?.id || `${gameInfo.folder}-${bucketName}-${rawStem}`.replace(/[^a-z0-9]+/g, "-"),
        answer: cleanAnswer,
        aliases: Array.from(aliasesSet).filter((a) => a !== cleanAnswer),
        file: fileName,
      });
    }

    if (sectionList.length > 0) {
      resultCatalog[matchingKey] = sectionList;
    }
  }

  writeFileSync(catalogFilePath, JSON.stringify(resultCatalog, null, 2));
  console.log(`Updated ${gameInfo.catalog} with ${Object.values(resultCatalog).reduce((acc, l) => acc + l.length, 0)} items.`);
}

for (const game of games) {
  processGame(game);
}
console.log("Auto Draw Catalog generation completed.");
