export const POINTS_HISTORY_DAYS = 60;
const DAY_MS = 86_400_000;

// Never expire an obligation to a viewer, active standings, or undated legacy data.
export function prunePointsHistory(data, now = Date.now()) {
  const cutoff = now - POINTS_HISTORY_DAYS * DAY_MS;
  let changed = false;
  for (const [field, dateField] of [["weeklyHistory", "endsAt"], ["sessionHistory", "endedAt"], ["ledger", "createdAt"]]) {
    const entries = data[field] || [];
    const retained = entries.filter((entry) => {
      if (entry.status === "active" || entry.rewards?.some((reward) => reward.reward?.trim() && !reward.fulfilled)) return true;
      const endedAt = Date.parse(entry[dateField]);
      return !Number.isFinite(endedAt) || endedAt >= cutoff;
    });
    if (retained.length !== entries.length) { data[field] = retained; changed = true; }
  }
  return changed;
}

export function nextPointsMaintenance(data, now = Date.now()) {
  const deadlines = [];
  for (const season of Object.values(data.weeklyChannels || {})) {
    if (Object.keys(season.participants || {}).length || season.rewards?.length) {
      const end = Date.parse(season.endsAt);
      if (Number.isFinite(end)) deadlines.push(end);
    }
  }
  for (const [field, dateField] of [["weeklyHistory", "endsAt"], ["sessionHistory", "endedAt"], ["ledger", "createdAt"]]) {
    for (const entry of data[field] || []) {
      if (entry.status === "active" || entry.rewards?.some((reward) => reward.reward?.trim() && !reward.fulfilled)) continue;
      const end = Date.parse(entry[dateField]);
      if (Number.isFinite(end)) deadlines.push(end + POINTS_HISTORY_DAYS * DAY_MS + 1);
    }
  }
  if (!deadlines.length) return null;
  // Coalesce expiry into daily maintenance rather than waking for each ledger row.
  const due = Math.min(...deadlines);
  return Math.max(now + 1000, Math.ceil(due / DAY_MS) * DAY_MS);
}
