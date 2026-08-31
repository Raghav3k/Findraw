const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function getWeeklyPeriod(value = Date.now()) {
  const date = new Date(value);
  const dayOffset = (date.getUTCDay() + 6) % 7;
  const startsAtMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - dayOffset);
  const endsAtMs = startsAtMs + WEEK_MS;
  return {
    weekId: new Date(startsAtMs).toISOString().slice(0, 10),
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
  };
}

export function normalizePlacementRewards(value) {
  const positions = new Set();
  return (Array.isArray(value) ? value : []).slice(0, 5).flatMap((entry) => {
    const position = Math.trunc(Number(entry?.position));
    const reward = String(entry?.reward || "").trim().replace(/\s+/g, " ").slice(0, 100);
    if (position < 1 || position > 5 || !reward || positions.has(position)) return [];
    positions.add(position);
    return [{ position, reward, fulfilled: Boolean(entry?.fulfilled) }];
  }).sort((first, second) => first.position - second.position);
}

export function weeklyStandings(participants, limit = 100) {
  return Object.entries(participants && typeof participants === "object" ? participants : {})
    .map(([userId, value]) => ({
      userId,
      displayName: String(value?.displayName || "Viewer"),
      score: Math.max(0, Math.trunc(Number(value?.score) || 0)),
    }))
    .sort((first, second) => second.score - first.score || first.displayName.localeCompare(second.displayName))
    .slice(0, limit);
}

export function publicWeeklySeason(season) {
  if (!season) return null;
  return {
    weekId: season.weekId,
    status: season.status === "completed" ? "completed" : "active",
    startsAt: season.startsAt,
    endsAt: season.endsAt,
    rewards: normalizePlacementRewards(season.rewards),
    standings: weeklyStandings(season.participants),
  };
}

export function ensureWeeklySeason(data, channelId, value = Date.now()) {
  data.weeklyChannels = data.weeklyChannels && typeof data.weeklyChannels === "object" ? data.weeklyChannels : {};
  data.weeklyHistory = Array.isArray(data.weeklyHistory) ? data.weeklyHistory : [];
  data.channels = data.channels && typeof data.channels === "object" ? data.channels : {};

  const period = getWeeklyPeriod(value);
  let season = data.weeklyChannels[channelId];
  if (season?.weekId !== period.weekId) {
    if (season) {
      season.status = "completed";
      season.rewards = normalizePlacementRewards(season.rewards);
      data.weeklyHistory.push(season);
    }
    const legacyParticipants = data.channels[channelId] && typeof data.channels[channelId] === "object"
      ? data.channels[channelId]
      : {};
    season = {
      channelId,
      weekId: period.weekId,
      status: "active",
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      rewards: [],
      participants: legacyParticipants,
    };
    data.weeklyChannels[channelId] = season;
    delete data.channels[channelId];
  }
  return season;
}

export function weeklyPointsSummary(data, channelId, value = Date.now()) {
  const current = ensureWeeklySeason(data, channelId, value);
  return {
    current: publicWeeklySeason(current),
    history: data.weeklyHistory
      .filter((season) => season.channelId === channelId)
      .reverse()
      .map(publicWeeklySeason),
  };
}

export function findWeeklySeason(data, channelId, weekId, value = Date.now()) {
  const current = ensureWeeklySeason(data, channelId, value);
  if (current.weekId === weekId) return current;
  return data.weeklyHistory.find((season) => season.channelId === channelId && season.weekId === weekId) || null;
}
