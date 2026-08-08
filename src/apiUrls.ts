const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");

export const hasApiBaseUrl = Boolean(API_BASE_URL);

export function apiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

export function twitchAuthStartUrl(returnTo?: string): string {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  return apiUrl(`/auth/twitch/start${query}`);
}
