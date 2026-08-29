const FINDRAW_CHATTER_COLORS = [
  "#406F83", // notebook blue
  "#9A554D", // muted coral
  "#557258", // sage green
  "#765F88", // dusty violet
  "#806329", // warm ochre
  "#3F7470", // soft teal
  "#795B50", // pencil brown
  "#5F6688", // slate indigo
] as const;

export function getFindrawChatterColor(identity: string): string {
  let hash = 2166136261;
  for (const character of identity.trim().toLocaleLowerCase("en")) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return FINDRAW_CHATTER_COLORS[(hash >>> 0) % FINDRAW_CHATTER_COLORS.length];
}
