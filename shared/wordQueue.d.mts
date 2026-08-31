type Word = { answer: string; aliases?: string[]; weight?: number };
export function pickWordChoices(packs: Array<{ id: string; words: Word[] }>, recentKeys?: string[], count?: number, shuffle?: boolean, random?: () => number): Array<Word & { categoryId: string }>;
