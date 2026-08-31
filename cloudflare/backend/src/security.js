import { SecurityError } from "../../../shared/security.mjs";
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = text => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
export const randomId = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export async function signClaim(secret, claim) {
  if (!secret) throw new SecurityError("Security configuration is incomplete.", 503);
  const body = b64(enc.encode(JSON.stringify(claim)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body))))}`;
}
export async function readClaim(secret, token, purpose) {
  try {
    if (!secret || typeof token !== "string" || token.length > 2048) return null;
    const parts = token.split("."); if (parts.length !== 2) return null;
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, unb64(parts[1]), enc.encode(parts[0]))) return null;
    const claim = JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    return claim.purpose === purpose && Number.isSafeInteger(claim.exp) && claim.exp > Date.now() ? claim : null;
  } catch { return null; }
}
export function cookieValue(request, name) {
  return (request.headers.get("Cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}
const local = request => ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
export const sessionCookieName = request => local(request) ? "findraw_session" : "__Host-findraw_session";
export function cookie(request, name, value, age) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${local(request) ? "" : "; Secure"}`;
}
export async function issueSession(request, env, sid = randomId()) {
  const token = await signClaim(env.SESSION_SECRET, { purpose: "session", sid, exp: Date.now() + 7 * 86400000 });
  return { sid, header: cookie(request, sessionCookieName(request), token, 7 * 86400) };
}
export async function readSession(request, env) {
  const claim = await readClaim(env.SESSION_SECRET, cookieValue(request, sessionCookieName(request)), "session");
  return claim && /^[A-Za-z0-9_-]{20,160}$/.test(claim.sid) ? claim.sid : null;
}
export function checkOrigin(request, env, required = false) {
  const origin = request.headers.get("Origin");
  const allowed = new Set([env.FRONTEND_URL, ...(env.ALLOWED_ORIGINS || "").split(",")].filter(Boolean).map(v => new URL(v).origin));
  if ((!origin && required) || (origin && !allowed.has(origin))) throw new SecurityError("This origin is not permitted.", 403);
}
export async function privateHash(env, value) {
  // HMAC (not unsalted IP hashes). Never put tokens, raw IPs or request bodies in logs.
  const token = await signClaim(env.SESSION_SECRET, { purpose: "abuse-key", value });
  return token.split(".")[1];
}
export async function edgeGate(request, env) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) throw new SecurityError("Trusted client address unavailable.", 503);
  const key = await privateHash(env, ip);
  if (!env.EDGE_LIMITER) throw new SecurityError("Abuse protection is not configured.", 503);
  if (!(await env.EDGE_LIMITER.limit({ key })).success) throw Object.assign(new SecurityError("Too many requests. Please wait.", 429), { ipHash: key });
  return key;
}
export async function verifyHuman(request, env, sid, token) {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) throw new SecurityError("Human verification is not configured.", 503);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get("CF-Connecting-IP") }),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true || body.hostname !== new URL(env.FRONTEND_URL).hostname || body.action !== "findraw_access") throw new SecurityError("Verification failed. Please try again.", 403);
  const proof = await signClaim(env.SESSION_SECRET, { purpose: "human", sid, exp: Date.now() + 30 * 60000 });
  return cookie(request, local(request) ? "findraw_human" : "__Host-findraw_human", proof, 1800);
}
export async function requireHuman(request, env, sid) {
  const proof = await readClaim(env.SESSION_SECRET, cookieValue(request, local(request) ? "findraw_human" : "__Host-findraw_human"), "human");
  if (proof?.sid !== sid) throw new SecurityError("Human verification required.", 403);
}

// Used only at admission, not on drawing packets. Each identity owns a small expiring record.
export class FindrawAdmission {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const { action, room, limit = 6, lease = room, connectionLimit = 8 } = await request.json();
    return this.state.storage.transaction(async storage => {
      const now = Date.now(); const data = await storage.get("limits") || { buckets: {}, rooms: {} };
      for (const [key, leases] of Object.entries(data.rooms)) {
        for (const [id, until] of Object.entries(leases)) if (until <= now) delete leases[id];
        if (!Object.keys(leases).length) delete data.rooms[key];
      }
      for (const [key, value] of Object.entries(data.buckets)) if (value.until <= now) delete data.buckets[key];
      if (action === "release") {
        if (data.rooms[room]) { delete data.rooms[room][lease]; if (!Object.keys(data.rooms[room]).length) delete data.rooms[room]; }
        await storage.put("limits", data); return Response.json({ ok: true });
      }
      const policies = { verify: [10, 60000], login: [6, 600000], create: [6, 3600000], matchmake: [20, 60000], content: [10, 3600000], report: [10, 3600000], upgrade: [20, 60000], write: [60, 60000] };
      const policy = policies[action]; if (!policy) return Response.json({ error: "Unknown admission action" }, { status: 400 });
      const bucket = data.buckets[action] || { count: 0, until: now + policy[1] };
      const connections = Object.values(data.rooms).reduce((count, leases) => count + Object.keys(leases).length, 0);
      const roomCount = Object.keys(data.rooms).filter(key => key !== "$live").length;
      if (bucket.count >= policy[0] || (room && ((!data.rooms[room] && room !== "$live" && roomCount >= limit) || (connections >= connectionLimit && !data.rooms[room]?.[lease])))) return Response.json({ error: "Admission limit reached. Please wait." }, { status: 429 });
      bucket.count++; data.buckets[action] = bucket;
      if (room) (data.rooms[room] ||= {})[lease] = now + 12 * 3600000;
      await storage.put("limits", data); await storage.setAlarm(now + 12 * 3600000 + 60000);
      return Response.json({ ok: true });
    });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}
export async function admission(env, key, action, room, limit, lease) {
  if (!env.FINDRAW_ADMISSION) throw new SecurityError("Admission protection is not configured.", 503);
  const stub = env.FINDRAW_ADMISSION.get(env.FINDRAW_ADMISSION.idFromName(key));
  const response = await stub.fetch(new Request("https://admission.internal/check", { method: "POST", body: JSON.stringify({ action, room, limit, lease, connectionLimit: key.startsWith("ip:") ? 64 : 8 }) }));
  if (!response.ok) throw new SecurityError("Too many attempts or concurrent rooms. Please wait.", 429);
}
export async function releaseAdmission(env, lease) {
  if (!lease || !env.FINDRAW_ADMISSION) return;
  await Promise.all(lease.keys.map(key => admission(env, key, "release", lease.room, undefined, lease.id)));
}

const violationSamples = new Map();
export function logSecurityViolation(context, status) {
  const key = `${context.ipHash || "unknown"}:${context.action}:${status}`;
  const now = Date.now(); let sample = violationSamples.get(key);
  if (!sample || sample.until <= now) sample = { count: 0, until: now + 60000 };
  sample.count++; violationSamples.set(key, sample);
  if (violationSamples.size > 1000) violationSamples.delete(violationSamples.keys().next().value);
  // Log powers of two, not every flood packet. No raw IPs, cookies, URLs or payloads.
  if ((sample.count & (sample.count - 1)) === 0) console.warn("[Security] rejected", { at: new Date(now).toISOString(), ...context, status, violations: sample.count });
}
export function loginErrorResponse(status = 400) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reconnect Twitch — Findraw</title><style>body{background:#e5eeea;color:#302e27;font:18px system-ui;padding:8vh 24px}main{max-width:520px;margin:auto;padding:32px;background:#fff3cf;border:1px solid #b8a787;border-radius:12px}a{display:inline-block;margin-top:12px;padding:12px 20px;background:#8fc9df;color:#302e27;border-radius:8px}</style><main><h1>Let's try connecting again</h1><p>The Twitch sign-in could not be completed. The link may have expired, or it was opened in a different browser.</p><p>Start a fresh sign-in from this browser. If it keeps failing, return to Findraw and try again later.</p><a href="/auth/twitch/start">Retry Twitch login</a> <a href="/">Back to Findraw</a></main></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff" } });
}
