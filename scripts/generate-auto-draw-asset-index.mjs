import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const autoDrawRoot = path.join(repoRoot, "public", "auto-draw");
const catalogRoot = path.join(repoRoot, "src", "autoDraw");
const outputPath = path.join(repoRoot, "public", "auto-draw", "ASSET_INDEX.json");
const summaryPath = path.join(repoRoot, "public", "auto-draw", "ASSET_INDEX.md");
const assetExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const sectionFolderOverrides = new Map([
  ["clash-royale:otherModes", "other-modes"],
  ["clash-royale:towerTroops", "tower-troops"],
]);
const folderForSection = (gameFolder, section) => sectionFolderOverrides.get(`${gameFolder}:${section}`) ?? section;
const catalogGameFolders = new Map([
  ["arcRaidersCatalog.json", "arc-raiders"],
  ["clashRoyaleCatalog.json", "clash-royale"],
  ["deadlockCatalog.json", "deadlock"],
  ["dota2Catalog.json", "dota-2"],
  ["genshinCatalog.json", "genshin"],
  ["leagueOfLegendsCatalog.json", "league-of-legends"],
  ["rainbowSixCatalog.json", "rainbow-six"],
]);

const slash = (value) => value.split(path.sep).join("/");
const rel = (filePath) => slash(path.relative(repoRoot, filePath));
const publicUrl = (filePath) => `/${slash(path.relative(path.join(repoRoot, "public"), filePath))}`;
const sha1 = (filePath) => createHash("sha1").update(readFileSync(filePath)).digest("hex");
const slugFromName = (name) => path.basename(name, path.extname(name)).toLowerCase();

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else files.push(fullPath);
    }
  };
  visit(root);
  return files;
}

function collectFilesFromCatalogNode(node, gameFolder, section, refs) {
  if (Array.isArray(node)) {
    for (const item of node) collectFilesFromCatalogNode(item, gameFolder, section, refs);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.file === "string" && section) {
    const assetPath = `public/auto-draw/${gameFolder}/${folderForSection(gameFolder, section)}/${node.file}`;
    const reference = {
      answer: typeof node.answer === "string" ? node.answer : null,
      catalogId: typeof node.id === "string" ? node.id : null,
      game: gameFolder,
      section,
    };
    if (!refs.has(assetPath)) refs.set(assetPath, []);
    refs.get(assetPath).push(reference);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "file") continue;
    collectFilesFromCatalogNode(value, gameFolder, key, refs);
  }
}

function collectCatalogReferences() {
  const refs = new Map();
  for (const [catalogFile, gameFolder] of catalogGameFolders) {
    const fullPath = path.join(catalogRoot, catalogFile);
    if (!existsSync(fullPath)) continue;
    const data = JSON.parse(readFileSync(fullPath, "utf8").replace(/^\uFEFF/, ""));
    for (const [section, entries] of Object.entries(data)) {
      collectFilesFromCatalogNode(entries, gameFolder, section, refs);
    }
  }
  const autoDrawAssetsPath = path.join(catalogRoot, "autoDrawAssets.ts");
  if (existsSync(autoDrawAssetsPath)) {
    const source = readFileSync(autoDrawAssetsPath, "utf8");
    for (const match of source.matchAll(/imageUrl:\s*"([^"]+)"/g)) {
      const assetPath = `public${match[1]}`;
      if (!refs.has(assetPath)) refs.set(assetPath, []);
      refs.get(assetPath).push({ answer: null, catalogId: "autoDrawAssets.ts", game: null, section: null });
    }
  }
  return refs;
}

const catalogReferences = collectCatalogReferences();
const publicAssets = walkFiles(autoDrawRoot).filter((filePath) => assetExtensions.has(path.extname(filePath).toLowerCase()));
const rootArtifacts = readdirSync(repoRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.startsWith("devprojectsFindrawpublicauto-draw") && assetExtensions.has(path.extname(entry.name).toLowerCase()))
  .map((entry) => path.join(repoRoot, entry.name));

const canonicalByHash = new Map();
for (const filePath of publicAssets) {
  const hash = sha1(filePath);
  if (!canonicalByHash.has(hash)) canonicalByHash.set(hash, []);
  canonicalByHash.get(hash).push(filePath);
}

const assets = publicAssets.sort((a, b) => rel(a).localeCompare(rel(b))).map((filePath) => {
  const relativePath = rel(filePath);
  const parts = slash(path.relative(autoDrawRoot, filePath)).split("/");
  const stats = statSync(filePath);
  return {
    path: relativePath,
    publicUrl: publicUrl(filePath),
    game: parts[0] ?? null,
    bucket: parts.length > 2 ? parts[1] : null,
    filename: path.basename(filePath),
    slug: slugFromName(filePath),
    extension: path.extname(filePath).slice(1).toLowerCase(),
    bytes: stats.size,
    sha1: sha1(filePath),
    catalogReferences: catalogReferences.get(relativePath) ?? [],
  };
});

const duplicateRootArtifacts = rootArtifacts.sort((a, b) => rel(a).localeCompare(rel(b))).map((filePath) => {
  const hash = sha1(filePath);
  const canonicalMatches = (canonicalByHash.get(hash) ?? []).map((match) => rel(match));
  return {
    path: rel(filePath),
    filename: path.basename(filePath),
    bytes: statSync(filePath).size,
    sha1: hash,
    canonicalMatches,
    status: canonicalMatches.length > 0 ? "duplicate-root-import-artifact" : "unmatched-root-import-artifact",
  };
});

const byGame = assets.reduce((groups, asset) => {
  groups[asset.game] ??= { count: 0, buckets: {} };
  groups[asset.game].count += 1;
  if (asset.bucket) groups[asset.game].buckets[asset.bucket] = (groups[asset.game].buckets[asset.bucket] ?? 0) + 1;
  return groups;
}, {});

const missingCatalogReferences = [...catalogReferences.keys()]
  .filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)))
  .sort();

const assetsByGameAndFilename = new Map();
for (const asset of assets) {
  const key = `${asset.game}/${asset.filename.toLowerCase()}`;
  if (!assetsByGameAndFilename.has(key)) assetsByGameAndFilename.set(key, []);
  assetsByGameAndFilename.get(key).push(asset.path);
}
const relocationCandidates = missingCatalogReferences.map((expectedPath) => {
  const parts = slash(path.relative("public/auto-draw", expectedPath)).split("/");
  const game = parts[0] ?? null;
  const filename = path.basename(expectedPath).toLowerCase();
  const candidates = game ? assetsByGameAndFilename.get(`${game}/${filename}`) ?? [] : [];
  return { expectedPath, candidates };
}).filter((entry) => entry.candidates.length > 0);

const index = {
  generatedBy: "scripts/generate-auto-draw-asset-index.mjs",
  generatedAt: new Date().toISOString(),
  notes: [
    "This file indexes asset locations without moving or committing binary assets.",
    "duplicateRootArtifacts are malformed root-level import files. canonicalMatches lists identical files already in public/auto-draw.",
    "Regenerate after adding, moving, or deleting Auto Draw assets.",
  ],
  totals: {
    canonicalAssets: assets.length,
    duplicateRootArtifacts: duplicateRootArtifacts.length,
    duplicateRootArtifactsWithCanonicalMatch: duplicateRootArtifacts.filter((item) => item.canonicalMatches.length > 0).length,
    missingCatalogReferences: missingCatalogReferences.length,
    relocationCandidates: relocationCandidates.length,
  },
  byGame,
  missingCatalogReferences,
  relocationCandidates,
  duplicateRootArtifacts,
  assets,
};

writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`);

const summaryLines = [
  "# Auto Draw Asset Index",
  "",
  "Generated by `scripts/generate-auto-draw-asset-index.mjs`.",
  "",
  "This is the human-readable map for finding assets without committing the binary asset set. The full searchable index is `public/auto-draw/ASSET_INDEX.json`.",
  "",
  "## Totals",
  "",
  `- Canonical assets: ${index.totals.canonicalAssets}`,
  `- Root-level duplicate import artifacts: ${index.totals.duplicateRootArtifacts}`,
  `- Duplicate artifacts with canonical matches: ${index.totals.duplicateRootArtifactsWithCanonicalMatch}`,
  `- Missing catalog references: ${index.totals.missingCatalogReferences}`,
  `- Relocation candidates: ${index.totals.relocationCandidates}`,
  "",
  "## Folder Summary",
  "",
  "| Game/folder | Assets | Buckets |",
  "| --- | ---: | --- |",
  ...Object.entries(byGame).sort(([a], [b]) => a.localeCompare(b)).map(([game, value]) => {
    const buckets = Object.entries(value.buckets).sort(([a], [b]) => a.localeCompare(b)).map(([bucket, count]) => `${bucket} (${count})`).join(", ");
    return `| ${game} | ${value.count} | ${buckets || "-"} |`;
  }),
  "",
  "## Duplicate Root Artifacts",
  "",
  duplicateRootArtifacts.length
    ? "These root files are safe candidates for cleanup after review because they match canonical files by SHA-1 hash."
    : "No malformed root artifacts found.",
  "",
  ...duplicateRootArtifacts.slice(0, 120).map((item) => `- \`${item.path}\` -> ${item.canonicalMatches.map((match) => `\`${match}\``).join(", ") || "no canonical match"}`),
  duplicateRootArtifacts.length > 120 ? `- ...${duplicateRootArtifacts.length - 120} more entries in ASSET_INDEX.json` : "",
  "",
  "## Relocation Candidates",
  "",
  relocationCandidates.length
    ? "Catalogs expect these paths, and same-filename assets already exist elsewhere under the same game folder. Review before moving."
    : "No same-filename relocation candidates found.",
  "",
  ...relocationCandidates.slice(0, 80).map((item) => `- expected \`${item.expectedPath}\`; found ${item.candidates.map((candidate) => `\`${candidate}\``).join(", ")}`),
  relocationCandidates.length > 80 ? `- ...${relocationCandidates.length - 80} more entries in ASSET_INDEX.json` : "",
  "",
  "## Revert / Cleanup Notes",
  "",
  "- The index and generator are text files, so Git can revert them normally.",
  "- The asset binaries are still untracked; do not delete/move them without first saving a move manifest or intentionally committing them.",
  "- If you later clean duplicate root artifacts, use `duplicateRootArtifacts[].canonicalMatches` in the JSON to verify each file exists in its canonical location first.",
  "",
].filter(Boolean);

writeFileSync(summaryPath, `${summaryLines.join("\n")}\n`);
console.log(`Indexed ${assets.length} canonical assets and ${duplicateRootArtifacts.length} root artifacts.`);





