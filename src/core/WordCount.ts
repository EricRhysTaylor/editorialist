import { maskNonProse } from "./TextMatching";

/**
 * Words a reader would count: prose only, so properties, hidden comments,
 * fenced blocks and headings are left out. Hyphenated and apostrophe words
 * count once.
 */
export function countProseWords(noteText: string): number {
	return maskNonProse(noteText).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}
