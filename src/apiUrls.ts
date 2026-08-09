const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
const productionApiBaseUrl = typeof window !== "undefined" && window.location.hostname === "findraw.pages.dev"
  ? "https://findraw-backend.bonsaii.workers.dev"
  : "";
const API_BASE_URL = configuredApiBaseUrl || productionApiBaseUrl;

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

export function twitchAuthStartUrl(returnTo?: string): string {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  return apiUrl(`/auth/twitch/start${query}`);
}
