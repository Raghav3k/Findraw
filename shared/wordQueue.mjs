const normalizeGuess = (value) => String(value).normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en").replace(/&/g, " and ").replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim().replace(/\s+/g, " ");
const roomPromptKey = (prompt) => `${prompt.categoryId || "custom"}:${String(prompt.answer || "").toLowerCase()}`;
const clampNumber = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

export const pickWordChoices = (inputPacks, recentKeys = [], count = 3, shuffle = false, random = Math.random) => {
  const packs = (inputPacks || []).filter((pack) => pack.words?.length).map((pack) => ({ ...pack, words: pack.words.map((word) => ({ ...word, categoryId: `pack-${pack.id}` })) }));
  const picked = [];
  const workingRecent = [...recentKeys];
  while (picked.length < count && packs.length) {
    const recent = new Set(workingRecent.slice(-32));
    const recentPackIds = workingRecent.slice(-Math.max(4, packs.length * 2)).map((key) => key.split(":")[0]);
    const counts = new Map(packs.map((pack) => [pack.id, recentPackIds.filter((id) => id === `pack-${pack.id}`).length]));
    const minimumCount = Math.min(...counts.values());
    const balanced = packs.filter((pack) => counts.get(pack.id) === minimumCount);
    const pack = balanced[Math.floor(random() * balanced.length)] || packs[0];
    const pickedAnswers = new Set(picked.map((prompt) => normalizeGuess(prompt.answer)));
    const unused = pack.words.filter((word) => !recent.has(roomPromptKey(word)) && !pickedAnswers.has(normalizeGuess(word.answer)));
    const fallback = pack.words.filter((word) => !pickedAnswers.has(normalizeGuess(word.answer)));
    const choices = unused.length ? unused : fallback;
    if (!choices.length) {
      const anywhere = packs.flatMap((candidate) => candidate.words).filter((word) => !pickedAnswers.has(normalizeGuess(word.answer)));
      if (!anywhere.length) break;
      const word = anywhere[Math.floor(random() * anywhere.length)];
      picked.push(word);
      workingRecent.push(roomPromptKey(word));
      continue;
    }
    const weightedTotal = choices.reduce((sum, choice) => sum + clampNumber(choice.weight, .35, 1.35, 1), 0);
    let roll = random() * Math.max(.001, weightedTotal);
    let word = choices.at(-1);
    for (const choice of choices) {
      roll -= clampNumber(choice.weight, .35, 1.35, 1);
      if (roll <= 0) { word = choice; break; }
    }
    picked.push(word);
    workingRecent.push(roomPromptKey(word));
  }
  for (let index = shuffle ? picked.length - 1 : 0; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [picked[index], picked[swapIndex]] = [picked[swapIndex], picked[index]];
  }
  return picked;
};
