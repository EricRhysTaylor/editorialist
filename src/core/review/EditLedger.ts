import type { ReviewStatus } from "../../models/ReviewSuggestion";
import { EDIT_SOURCES, EDIT_STATES, editState, type EditMatrixScene, type EditSource, type EditState, type LiveEdit } from "./EditMatrix";

/**
 * The book's record of edits for the current round. Review blocks lose their
 * edits when a scene is cleaned, so the record keeps each edit's last known
 * decision. The author starts a new round by clearing the record or by
 * archiving it, which keeps the round's totals: handled edits leave the grid,
 * edits still to do stay, and only passes imported after that join.
 */
export interface EditLedgerEntry {
	notePath: string;
	title: string;
	id: string;
	source: EditSource;
	status: ReviewStatus;
	summary: string;
	viaWord: boolean;
	order: number;
	live: boolean;
	seenAt: number;
	updatedAt: number;
}

export type EditCounts = Record<EditSource, Record<EditState, number>>;

export interface EditRound {
	startedAt: number;
	endedAt: number;
	scenes: number;
	counts: EditCounts;
}

export interface EditLedgerBook {
	// 0 for a book whose record predates any reset: every edit counts.
	startedAt: number;
	entries: Record<string, EditLedgerEntry>;
	rounds: EditRound[];
}

export interface EditLedgerStore {
	version: 1;
	books: Record<string, EditLedgerBook>;
}

const emptyBook = (): EditLedgerBook => ({ startedAt: 0, entries: {}, rounds: [] });

/**
 * Brings the record up to date with the edits now in the scenes. A known edit
 * takes its current state; an edit no longer in any block keeps its last one.
 * A new edit joins if it is still to do, or if its pass arrived during this
 * round; a decided edit from an earlier round stays out after a reset.
 */
export function recordLiveEdits(book: EditLedgerBook | undefined, live: readonly LiveEdit[], now: number): { book: EditLedgerBook; changed: boolean } {
	const current = book ?? emptyBook();
	const entries: Record<string, EditLedgerEntry> = {};
	let changed = !book;
	const seen = new Set<string>();
	for (const edit of live) {
		seen.add(edit.key);
		const known = current.entries[edit.key];
		const joins = known || editState(edit.status) === "open" || (edit.importedAt ?? 0) >= current.startedAt;
		if (!joins) continue;
		const next: EditLedgerEntry = {
			notePath: edit.notePath,
			title: edit.title,
			id: edit.id,
			source: edit.source,
			status: edit.status,
			summary: edit.summary,
			viaWord: edit.viaWord,
			order: edit.order,
			live: true,
			seenAt: known?.seenAt ?? now,
			updatedAt: now,
		};
		const same = known && known.live && (["notePath", "title", "id", "source", "status", "summary", "viaWord", "order"] as const).every((field) => known[field] === next[field]);
		entries[edit.key] = same ? known : next;
		if (!same) changed = true;
	}
	for (const [key, entry] of Object.entries(current.entries)) {
		if (seen.has(key)) continue;
		entries[key] = entry.live ? { ...entry, live: false, updatedAt: now } : entry;
		if (entry.live) changed = true;
	}
	return { book: { ...current, entries }, changed };
}

export function roundCounts(book: EditLedgerBook): EditCounts {
	const counts = Object.fromEntries(EDIT_SOURCES.map((source) => [source, Object.fromEntries(EDIT_STATES.map((state) => [state, 0]))])) as EditCounts;
	for (const entry of Object.values(book.entries)) counts[entry.source][editState(entry.status)]++;
	return counts;
}

/**
 * Starts a new round. Handled edits leave the record, and so do open edits
 * whose scene no longer holds them, since nothing is left to do there. With
 * `archive`, the finished round's totals are kept first.
 */
export function startNewRound(book: EditLedgerBook, now: number, archive: boolean): EditLedgerBook {
	const entries = Object.fromEntries(Object.entries(book.entries).filter(([, entry]) => entry.live && editState(entry.status) === "open"));
	const scenes = new Set(Object.values(book.entries).map((entry) => entry.notePath)).size;
	const rounds = archive && Object.keys(book.entries).length
		? [...book.rounds, { startedAt: book.startedAt, endedAt: now, scenes, counts: roundCounts(book) }]
		: book.rounds;
	return { startedAt: now, entries, rounds };
}

export function ledgerScenes(book: EditLedgerBook | undefined): EditMatrixScene[] {
	const scenes = new Map<string, EditMatrixScene & { order: Map<string, number> }>();
	for (const [key, entry] of Object.entries(book?.entries ?? {})) {
		const scene = scenes.get(entry.notePath) ?? { notePath: entry.notePath, title: entry.title, dots: [] as EditMatrixScene["dots"], order: new Map<string, number>() };
		scene.title = entry.title;
		scene.order.set(key, entry.order);
		scene.dots.push({ key, id: entry.id, source: entry.source, state: editState(entry.status), status: entry.status, summary: entry.summary, viaWord: entry.viaWord, live: entry.live });
		scenes.set(entry.notePath, scene);
	}
	return [...scenes.values()].map(({ order, ...scene }) => ({
		...scene,
		dots: scene.dots.sort((left, right) => (order.get(left.key) ?? 0) - (order.get(right.key) ?? 0)),
	}));
}

export function renameLedgerNote(store: EditLedgerStore, oldPath: string, newPath: string): boolean {
	let changed = false;
	for (const book of Object.values(store.books)) {
		for (const [key, entry] of Object.entries(book.entries)) {
			if (entry.notePath !== oldPath) continue;
			delete book.entries[key];
			book.entries[key.split(`|${oldPath}|`).join(`|${newPath}|`)] = { ...entry, notePath: newPath };
			changed = true;
		}
	}
	return changed;
}

const STATUSES: readonly ReviewStatus[] = ["pending", "accepted", "rejected", "deferred", "unresolved", "rewritten"];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

// Records saved before Word became how an edit arrived, rather than its kind,
// carry "word" as the source. A Word import is always a copy edit.
const LEGACY_WORD = "word";

function normalizeEntry(raw: unknown): EditLedgerEntry | null {
	if (!isRecord(raw) || typeof raw.notePath !== "string" || typeof raw.id !== "string") return null;
	const legacyWord = raw.source === LEGACY_WORD;
	const source = legacyWord ? "copy" : raw.source;
	if (!EDIT_SOURCES.includes(source as EditSource) || !STATUSES.includes(raw.status as ReviewStatus)) return null;
	return {
		notePath: raw.notePath,
		title: typeof raw.title === "string" ? raw.title : raw.notePath,
		id: raw.id,
		source: source as EditSource,
		status: raw.status as ReviewStatus,
		summary: typeof raw.summary === "string" ? raw.summary : "",
		viaWord: legacyWord || raw.viaWord === true,
		order: count(raw.order),
		live: raw.live === true,
		seenAt: count(raw.seenAt),
		updatedAt: count(raw.updatedAt),
	};
}

function normalizeRound(raw: unknown): EditRound | null {
	if (!isRecord(raw) || !isRecord(raw.counts)) return null;
	const rawCounts = raw.counts;
	const tally = (source: string, state: EditState): number => count(isRecord(rawCounts[source]) ? rawCounts[source][state] : 0);
	const counts = Object.fromEntries(EDIT_SOURCES.map((source) => [source, Object.fromEntries(EDIT_STATES.map((state) =>
		[state, tally(source, state) + (source === "copy" ? tally(LEGACY_WORD, state) : 0)]))])) as EditCounts;
	return { startedAt: count(raw.startedAt), endedAt: count(raw.endedAt), scenes: count(raw.scenes), counts };
}

export function normalizeEditLedger(raw: unknown): EditLedgerStore {
	const books: Record<string, EditLedgerBook> = {};
	if (isRecord(raw) && raw.version === 1 && isRecord(raw.books)) {
		for (const [name, rawBook] of Object.entries(raw.books)) {
			if (!isRecord(rawBook)) continue;
			const entries: Record<string, EditLedgerEntry> = {};
			for (const [key, rawEntry] of Object.entries(isRecord(rawBook.entries) ? rawBook.entries : {})) {
				const entry = normalizeEntry(rawEntry);
				if (entry) entries[key] = entry;
			}
			const rounds = (Array.isArray(rawBook.rounds) ? rawBook.rounds : []).map(normalizeRound).filter((round): round is EditRound => round !== null);
			books[name] = { startedAt: count(rawBook.startedAt), entries, rounds };
		}
	}
	return { version: 1, books };
}
