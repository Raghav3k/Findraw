import { apiUrl } from "../apiUrls";
import { secureFetch } from "../security/browserSecurity";

export type CommunityPackStatus = "published" | "quarantined" | "removed";
export type CommunityReportReason = "offensive" | "hate-or-harassment" | "sexual-content" | "spam" | "incorrect-tags" | "other";

export type CommunityPackWord = {
  answer: string;
  aliases?: string[];
};

export type CommunityPackTag = {
  key: string;
  label: string;
};

export type CommunityPack = {
  id: string;
  title: string;
  description: string;
  creatorName: string;
  tags: CommunityPackTag[];
  words: CommunityPackWord[];
  visibility: "unlisted";
  status: CommunityPackStatus;
  shareCode: string;
  reportCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CommunityPackInput = {
  title: string;
  description?: string;
  creatorName: string;
  tags: string[];
  words: CommunityPackWord[];
};

export class CommunityPackApiError extends Error {
  field?: string;
  status: number;

  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = "CommunityPackApiError";
    this.status = status;
    this.field = field;
  }
}

async function communityRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await secureFetch(path, init, Boolean(init?.method && init.method !== "GET"));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new CommunityPackApiError(body.error || "Community pack request failed.", response.status, body.field);
  return body as T;
}

export function createCommunityPack(input: CommunityPackInput) {
  return communityRequest<{ pack: CommunityPack; editToken: string }>("/api/community-packs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getCommunityPack(shareCode: string) {
  return communityRequest<{ pack: CommunityPack }>(`/api/community-packs/${encodeURIComponent(shareCode)}`);
}

export function updateCommunityPack(id: string, editToken: string, input: CommunityPackInput) {
  return communityRequest<{ pack: CommunityPack }>(`/api/community-packs/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${editToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function reportCommunityPack(id: string, input: { reason: CommunityReportReason; reporterKey: string; details?: string }) {
  return communityRequest<{ ok: true; duplicate: boolean; status: CommunityPackStatus }>(`/api/community-packs/${encodeURIComponent(id)}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
