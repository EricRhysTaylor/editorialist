// A document's words against the author's limit: a bar that fills toward the
// limit and turns red past it. Used wherever the document's task appears.
export function renderWordLimit(parent: HTMLElement, words: number, limit: number): void {
	const over = words > limit;
	const block = parent.createDiv({ cls: "editorialist-word-limit", attr: { "data-over": String(over) } });
	block.createDiv({ cls: "editorialist-word-limit__label", text: `${words.toLocaleString()} / ${limit.toLocaleString()} words${over ? ` · ${(words - limit).toLocaleString()} over` : ""}` });
	const bar = block.createDiv({ cls: "editorialist-word-limit__bar", attr: { role: "img", "aria-label": over ? `${words - limit} words over the ${limit}-word limit` : `${words} of ${limit} words` } });
	bar.style.setProperty("--editorialist-word-share", `${Math.min(100, (words / limit) * 100)}%`);
	bar.createDiv({ cls: "editorialist-word-limit__fill" });
}
