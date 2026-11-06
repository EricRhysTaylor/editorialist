export interface BookEngagement { title: string; editor: string }
/** One Radial Timeline book the author can review, with the engagement saved on its folder. */
export interface RadialBookChoice { id: string; title: string; folder: string; active: boolean; engagement: BookEngagement | null }

/** RT's own order. A book with no source folder has nothing to review. */
export function radialBookChoices(books: readonly { id: string; title: string; folder: string }[], activeId: string | null, engagementFor: (folder: string) => BookEngagement | null): RadialBookChoice[] {
	return books.filter((book) => book.folder).map((book) => ({ id: book.id, title: book.title, folder: book.folder, active: book.id === activeId, engagement: engagementFor(book.folder) }));
}

function engagementText(engagement: BookEngagement): string {
	return engagement.editor ? `${engagement.title} with ${engagement.editor}` : engagement.title;
}

export function bookChoiceLabel(choice: RadialBookChoice): string {
	return choice.engagement ? `${choice.title} · ${engagementText(choice.engagement)}` : choice.title;
}

/** Says where the engagement is when the chosen book has none. */
export function bookChoiceNote(choice: RadialBookChoice, choices: readonly RadialBookChoice[]): string {
	const engagement = choice.engagement ? `Editor engagement: ${engagementText(choice.engagement)}.` : engagementElsewhere(choices);
	return choice.active ? engagement : `${engagement} Radial Timeline switches to this book too.`;
}

function engagementElsewhere(choices: readonly RadialBookChoice[]): string {
	const others = choices.filter((choice) => choice.engagement);
	if (!others.length) return "No editor engagement yet.";
	if (others.length === 1) return `No editor engagement on this book. ${others[0]!.title} has one.`;
	return `No editor engagement on this book. ${others.length} other books have one.`;
}

function nameKey(name: string): string { return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }

/**
 * The RT book a missing saved folder most likely became, matched on its name.
 * Empty unless exactly one book matches: a wrong guess would move saved work.
 */
export function matchingBookFolder(saved: { path: string; name: string }, books: readonly { title: string; folder: string }[]): string {
	const lastPart = (path: string): string => path.split("/").pop() ?? "";
	const names = new Set([saved.name, lastPart(saved.path)].map(nameKey).filter(Boolean));
	const matches = books.filter((book) => book.folder && book.folder !== saved.path && [book.title, lastPart(book.folder)].some((name) => names.has(nameKey(name))));
	return matches.length === 1 ? matches[0]!.folder : "";
}
