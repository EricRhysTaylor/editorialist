// Small text helpers the panels share for labels built from data. Each
// previously lived as an identical private copy in two UI files.

/** Upper-case the first character, leaving the rest as written. */
export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** "1 session", "3 sessions": a count with an English noun that takes a plain -s plural. */
export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
