import { spawnSync } from "node:child_process";

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
