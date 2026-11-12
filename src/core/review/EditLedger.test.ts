import { describe, expect, it } from "vitest";
import type { LiveEdit } from "./EditMatrix";
import { ledgerScenes, normalizeEditLedger, recordLiveEdits, renameLedgerNote, roundCounts, startNewRound, type EditLedgerBook } from "./EditLedger";

function edit(key: string, status: LiveEdit["status"], importedAt: number | null = 100, notePath = "Book/1 Opening.md"): LiveEdit {
	return { key, notePath, title: notePath.split("/").pop()!.replace(".md", ""), id: `review-1-${key}`, source: "copy", status, summary: key, viaWord: false, order: Number(key.replace(/\D/g, "")) || 0, batchId: "b1", importedAt };
}

const keys = (book: EditLedgerBook) => Object.keys(book.entries).sort();

describe("edit ledger", () => {
	it("records every edit in the blocks the first time, with its decision", () => {
		const { book, changed } = recordLiveEdits(undefined, [edit("e1", "accepted"), edit("e2", "pending")], 200);
		expect(changed).toBe(true);
		expect(keys(book)).toEqual(["e1", "e2"]);
		expect(recordLiveEdits(book, [edit("e1", "accepted"), edit("e2", "pending")], 300).changed).toBe(false);
	});

	it("keeps an edit's last state once its scene is cleaned", () => {
		const first = recordLiveEdits(undefined, [edit("e1", "accepted"), edit("e2", "rejected")], 200).book;
		const { book, changed } = recordLiveEdits(first, [], 300);
		expect(changed).toBe(true);
		expect(ledgerScenes(book)[0]!.dots.map((dot) => [dot.state, dot.live])).toEqual([["done", false], ["declined", false]]);
	});

	it("starts a new round empty of handled edits, keeping what is still to do", () => {
		const first = recordLiveEdits(undefined, [edit("e1", "accepted"), edit("e2", "pending"), edit("e3", "rejected")], 200).book;
		const next = startNewRound(first, 500, false);
		expect(next.startedAt).toBe(500);
		expect(keys(next)).toEqual(["e2"]);
		expect(next.rounds).toEqual([]);
		// The handled edits are still in their block, but they belong to the last round.
		const later = recordLiveEdits(next, [edit("e1", "accepted"), edit("e2", "accepted"), edit("e3", "rejected")], 600).book;
		expect(keys(later)).toEqual(["e2"]);
		expect(later.entries.e2!.status).toBe("accepted");
		// A pass imported during the round joins, decided or not.
		expect(keys(recordLiveEdits(later, [edit("e9", "accepted", 550)], 700).book)).toEqual(["e2", "e9"]);
	});

	it("drops open edits whose scene was cleaned when a round starts", () => {
		const first = recordLiveEdits(undefined, [edit("e1", "pending")], 200).book;
		const cleaned = recordLiveEdits(first, [], 300).book;
		expect(keys(startNewRound(cleaned, 400, false))).toEqual([]);
	});

	it("archives the round's totals before starting the next", () => {
		const first = recordLiveEdits(undefined, [edit("e1", "accepted"), edit("e2", "pending", 100, "Book/2 Harbor.md")], 200).book;
		const next = startNewRound(first, 500, true);
		expect(next.rounds).toEqual([{ startedAt: 0, endedAt: 500, scenes: 2, counts: roundCounts(first) }]);
		expect(next.rounds[0]!.counts.copy).toEqual({ open: 1, done: 1, declined: 0 });
	});

	it("follows a renamed scene", () => {
		const store = { version: 1 as const, books: { Book: recordLiveEdits(undefined, [{ ...edit("x", "pending"), key: "b1|Book/1 Opening.md|1" }], 200).book } };
		expect(renameLedgerNote(store, "Book/1 Opening.md", "Book/1 Dawn.md")).toBe(true);
		expect(store.books.Book.entries["b1|Book/1 Dawn.md|1"]?.notePath).toBe("Book/1 Dawn.md");
	});

	it("reads back what it saved and drops damaged entries", () => {
		const book = startNewRound(recordLiveEdits(undefined, [edit("e1", "accepted"), edit("e2", "pending")], 200).book, 500, true);
		const saved = JSON.parse(JSON.stringify({ version: 1, books: { Book: book } }));
		expect(normalizeEditLedger(saved)).toEqual({ version: 1, books: { Book: book } });
		saved.books.Book.entries.bad = { notePath: 3 };
		expect(Object.keys(normalizeEditLedger(saved).books.Book!.entries)).toEqual(["e2"]);
		expect(normalizeEditLedger({ version: 2 })).toEqual({ version: 1, books: {} });
	});

	it("reads an earlier record's Word edits as copy edits that came from Word", () => {
		const legacy = {
			version: 1,
			books: { Book: {
				startedAt: 0,
				entries: { w: { notePath: "Book/1 Opening.md", title: "1 Opening", id: "review-1-1", source: "word", status: "accepted", summary: "s", order: 1, live: true, seenAt: 1, updatedAt: 1 } },
				rounds: [{ startedAt: 0, endedAt: 9, scenes: 1, counts: { word: { open: 1, done: 2, declined: 0 }, copy: { open: 0, done: 3, declined: 1 } } }],
			} },
		};
		const book = normalizeEditLedger(legacy).books.Book!;
		expect(book.entries.w).toMatchObject({ source: "copy", viaWord: true });
		expect(book.rounds[0]!.counts.copy).toEqual({ open: 1, done: 5, declined: 1 });
	});
});
