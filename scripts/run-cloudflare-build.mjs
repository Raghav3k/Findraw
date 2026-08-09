import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.production" });

const assetBaseUrl = (process.env.VITE_ASSET_BASE_URL || "").trim();

if (!assetBaseUrl) {
  console.error("Missing VITE_ASSET_BASE_URL. Cloudflare Pages builds skip the local public/ assets, so production needs the R2 Public Development URL.");
  process.exit(1);
}

if (assetBaseUrl.includes("cloudflarestorage.com")) {
  console.error("VITE_ASSET_BASE_URL must be the R2 Public Development URL, not the S3 API cloudflarestorage.com URL.");
  process.exit(1);
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) process.exit(result.status || 1);
};

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
run(pnpm, ["exec", "tsc"]);
run(pnpm, ["exec", "vite", "build"], {
  env: { ...process.env, FINDRAW_SKIP_PUBLIC: "1" },
});
run("node", ["scripts/write-cloudflare-pages-files.mjs"]);
