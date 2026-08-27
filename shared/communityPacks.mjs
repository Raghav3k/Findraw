export const COMMUNITY_PACK_LIMITS = Object.freeze({
  title: 60,
  description: 240,
  creatorName: 40,
  tagsPerPack: 8,
  tagLength: 32,
  wordsMin: 8,
  wordsMax: 100,
  wordLength: 60,
  aliasesPerWord: 5,
  reportDetails: 300,
});

export const COMMUNITY_REPORT_REASONS = Object.freeze([
  "offensive",
  "hate-or-harassment",
  "sexual-content",
  "spam",
  "incorrect-tags",
  "other",
]);

export const COMMUNITY_REPORT_QUARANTINE_THRESHOLD = 3;

const BASE_BLOCKED_PHRASES = [
  "child sexual",
  "hate speech",
  "nude celebrity",
  "porn",
  "pornographic",
  "racial slur",
  "sexual assault",
  "white supremacy",
];

export class CommunityPackValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "CommunityPackValidationError";
    this.field = field;
    this.status = 400;
  }
}

const cleanText = (value, limit) => String(value || "")
  .normalize("NFKC")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, limit);

export const normalizeCommunityKey = (value) => cleanText(value, 200)
  .toLocaleLowerCase("en")
  .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
  .trim()
  .replace(/\s+/g, " ");

const configuredBlockedPhrases = (value) => String(value || "")
  .split(",")
  .map((term) => normalizeCommunityKey(term))
  .filter(Boolean);

const assertSafeText = (entries, extraBlockedTerms) => {
  const blocked = [...BASE_BLOCKED_PHRASES.map(normalizeCommunityKey), ...configuredBlockedPhrases(extraBlockedTerms)];
  for (const entry of entries) {
    const normalized = ` ${normalizeCommunityKey(entry.value)} `;
    if (/https?:\/\/|www\./i.test(entry.value)) {
      throw new CommunityPackValidationError("Links are not allowed inside community packs.", entry.field);
    }
    if (blocked.some((phrase) => normalized.includes(` ${phrase} `))) {
      throw new CommunityPackValidationError("This pack needs different wording before it can be shared.", entry.field);
    }
  }
};

const normalizeTags = (input) => {
  if (!Array.isArray(input)) throw new CommunityPackValidationError("Tags must be a list.", "tags");
  const tags = [];
  const seen = new Set();
  for (const value of input) {
    const label = cleanText(value, COMMUNITY_PACK_LIMITS.tagLength);
    const key = normalizeCommunityKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tags.push({ key, label });
  }
  if (tags.length === 0) throw new CommunityPackValidationError("Add at least one useful tag.", "tags");
  if (tags.length > COMMUNITY_PACK_LIMITS.tagsPerPack) {
    throw new CommunityPackValidationError(`Use at most ${COMMUNITY_PACK_LIMITS.tagsPerPack} tags on one pack.`, "tags");
  }
  return tags;
};

const normalizeWords = (input) => {
  if (!Array.isArray(input)) throw new CommunityPackValidationError("Words must be a list.", "words");
  const words = [];
  const seen = new Set();
  for (const item of input) {
    const source = typeof item === "string" ? { answer: item } : item || {};
    const answer = cleanText(source.answer, COMMUNITY_PACK_LIMITS.wordLength);
    const answerKey = normalizeCommunityKey(answer);
    if (!answerKey || seen.has(answerKey)) continue;
    seen.add(answerKey);
    const aliases = [];
    const aliasKeys = new Set([answerKey]);
    for (const aliasValue of Array.isArray(source.aliases) ? source.aliases : []) {
      const alias = cleanText(aliasValue, COMMUNITY_PACK_LIMITS.wordLength);
      const aliasKey = normalizeCommunityKey(alias);
      if (!aliasKey || aliasKeys.has(aliasKey)) continue;
      aliasKeys.add(aliasKey);
      aliases.push(alias);
      if (aliases.length >= COMMUNITY_PACK_LIMITS.aliasesPerWord) break;
    }
    words.push(aliases.length ? { answer, aliases } : { answer });
  }
  if (words.length < COMMUNITY_PACK_LIMITS.wordsMin) {
    throw new CommunityPackValidationError(`Add at least ${COMMUNITY_PACK_LIMITS.wordsMin} different words.`, "words");
  }
  if (words.length > COMMUNITY_PACK_LIMITS.wordsMax) {
    throw new CommunityPackValidationError(`Use at most ${COMMUNITY_PACK_LIMITS.wordsMax} words in one pack.`, "words");
  }
  return words;
};

export function validateCommunityPackInput(input, { extraBlockedTerms = "" } = {}) {
  const title = cleanText(input?.title, COMMUNITY_PACK_LIMITS.title);
  const description = cleanText(input?.description, COMMUNITY_PACK_LIMITS.description);
  const creatorName = cleanText(input?.creatorName, COMMUNITY_PACK_LIMITS.creatorName);
  if (title.length < 3) throw new CommunityPackValidationError("The pack title must be at least 3 characters.", "title");
  if (!creatorName) throw new CommunityPackValidationError("Add a creator name.", "creatorName");
  const tags = normalizeTags(input?.tags);
  const words = normalizeWords(input?.words);
  assertSafeText([
    { field: "title", value: title },
    { field: "description", value: description },
    ...tags.map((tag) => ({ field: "tags", value: tag.label })),
    ...words.flatMap((word) => [
      { field: "words", value: word.answer },
      ...(word.aliases || []).map((alias) => ({ field: "words", value: alias })),
    ]),
  ], extraBlockedTerms);
  return { title, description, creatorName, tags, words };
}

export function validateCommunityReportInput(input) {
  const reason = cleanText(input?.reason, 40);
  if (!COMMUNITY_REPORT_REASONS.includes(reason)) {
    throw new CommunityPackValidationError("Choose a valid report reason.", "reason");
  }
  const reporterKey = cleanText(input?.reporterKey, 128);
  if (reporterKey.length < 12) throw new CommunityPackValidationError("A reporter key is required.", "reporterKey");
  const details = cleanText(input?.details, COMMUNITY_PACK_LIMITS.reportDetails);
  return { reason, reporterKey, details };
}

export function publicCommunityPack(pack) {
  if (!pack) return null;
  const { editTokenHash: _editTokenHash, reportKeys: _reportKeys, reports: _reports, ...safe } = pack;
  return safe;
}
