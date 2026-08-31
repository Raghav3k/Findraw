const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
const productionApiBaseUrl = typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? window.location.origin
  : "";
const API_BASE_URL = productionApiBaseUrl || configuredApiBaseUrl;

// Authentication is an HttpOnly cookie. Retained only for local-server compatibility.
export const backendSessionKey = "";

export const hasApiBaseUrl = Boolean(API_BASE_URL);

export function apiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

export function apiWebSocketUrl(path: string): string | null {
  if (!API_BASE_URL) return null;
  const url = new URL(apiUrl(path));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function twitchAuthStartUrl(returnTo?: string, switchAccount = false): string {
  const query = new URLSearchParams();
  if (returnTo) query.set("returnTo", returnTo);
  if (switchAccount) query.set("switch", "1");
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiUrl(`/auth/twitch/start${suffix}`);
}
