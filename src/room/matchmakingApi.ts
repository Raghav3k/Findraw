import { apiUrl, backendSessionKey } from "../apiUrls";
import { secureFetch } from "../security/browserSecurity";

export type PublicMatch = { code: string; playerCount: number; maxPlayers: number };

export async function findPublicMatch(input: { clientId: string; reconnectToken: string; name: string }): Promise<PublicMatch> {
  const response = await secureFetch("/api/matchmaking/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, group: "global" }),
  }, true);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "A public match could not be found.");
  return result as PublicMatch;
}
