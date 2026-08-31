import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
copyFileSync("cloudflare/pages/worker.js", "dist/_worker.js");
writeFileSync("dist/_routes.json", JSON.stringify({ version: 1, include: ["/api/*", "/auth/*"], exclude: [] }));
writeFileSync("dist/_redirects", "/* /index.html 200\n", "utf8");
writeFileSync("dist/_headers", `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://challenges.cloudflare.com https://*.r2.dev; frame-src https://challenges.cloudflare.com https://player.twitch.tv https://www.twitch.tv; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`, "utf8");
