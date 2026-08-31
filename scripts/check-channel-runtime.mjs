// Uses Wrangler's installed esbuild/Miniflare, isolated in-memory SQLite only.
// Usage: node scripts/check-channel-runtime.mjs /absolute/path/to/wrangler/package.json
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
const requireRuntime = createRequire(path.resolve(process.argv[2] || "node_modules/wrangler/package.json"));
const { build } = requireRuntime("esbuild");
const { Miniflare } = requireRuntime("miniflare");
const bundle = await build({ entryPoints: ["cloudflare/backend/src/index.js"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-09", durableObjects: { FINDRAW_CHANNEL: { className: "FindrawChannel", useSQLite: true } } });
try {
  const namespace = await runtime.getDurableObjectNamespace("FINDRAW_CHANNEL");
  const channel = namespace.get(namespace.idFromName("channel:111"));
  const call = async (action, payload = {}) => {
    const response = await channel.fetch("https://internal/channel", { method: "POST", body: JSON.stringify({ channelId: "111", ownerId: "test-owner", action, payload }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const api = (path, body) => call("api", { path, method: body ? "POST" : "GET", body });
  await call("import", { source: "test-owner", data: { channels: { "111": { viewer: { displayName: "Viewer", score: 100 } } } } });
  assert.equal((await call("leaderboard"))[0].score, 100);
  const results = await Promise.all(Array.from({ length: 10 }, () => api("/api/points/adjust", { userId: "viewer", displayName: "Viewer", delta: 1 })));
  assert.equal(results.length, 10);
  assert.equal((await call("leaderboard"))[0].score, 110, "real SQLite transactions preserve concurrent adjustments");
  await api("/api/artist-session/start", { name: "Runtime test", rewards: [{ position: 1, reward: "Gift a sub" }] });
  await api("/api/points/adjust", { userId: "viewer", displayName: "Renamed", delta: 5 });
  assert.equal((await api("/api/artist-session")).active.standings[0].score, 5);
  assert.equal((await call("weekly")).current.standings[0].score, 115);
  const ended = await api("/api/artist-session/end", {});
  await api("/api/artist-session/reward", { sessionId: ended.session.id, position: 1, fulfilled: true });
  assert.equal((await api("/api/artist-session")).history[0].rewards[0].fulfilled, true);
  console.log("Cloudflare SQLite runtime checks passed: migration, concurrent scoring, weekly/session totals, completion and reward fulfilment.");
} finally { await runtime.dispose(); }
