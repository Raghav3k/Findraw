export const ASSET_BASE_URL = (import.meta.env.VITE_ASSET_BASE_URL || "").trim().replace(/\/+$/, "");

export function assetUrl(path: string): string {
  if (!ASSET_BASE_URL) return path;
  return `${ASSET_BASE_URL}/${path.replace(/^\/+/, "")}`;
}
