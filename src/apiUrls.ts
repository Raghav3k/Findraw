const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
const productionApiBaseUrl = typeof window !== "undefined" && window.location.hostname === "findraw.pages.dev"
  ? "https://findraw-backend.bonsaii.workers.dev"
  : "";
const API_BASE_URL = configuredApiBaseUrl || productionApiBaseUrl;
const SESSION_STORAGE_KEY = "findraw.backendSession.v1";

const createBackendSessionKey = () => {
  if (typeof window === "undefined") return "local";
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = typeof window.crypto?.randomUUID === "function"
      ? `${window.crypto.randomUUID()}-${window.crypto.randomUUID()}`
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return `temporary-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
};

export const backendSessionKey = createBackendSessionKey();

export const hasApiBaseUrl = Boolean(API_BASE_URL);

export function apiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

export function apiWebSocketUrl(path: string): string | null {
  if (!API_BASE_URL) return null;
  const url = new URL(apiUrl(path));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("client", backendSessionKey);
  return url.toString();
}

export function twitchAuthStartUrl(returnTo?: string, switchAccount = false): string {
  const query = new URLSearchParams();
  query.set("client", backendSessionKey);
  if (returnTo) query.set("returnTo", returnTo);
  if (switchAccount) query.set("switch", "1");
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiUrl(`/auth/twitch/start${suffix}`);
}
