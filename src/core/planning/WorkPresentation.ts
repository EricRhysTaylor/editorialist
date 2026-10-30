/** Keep source locators verbatim; only shorten the label shown in work lists. */
export function pendingWorkTitle(text: string): string {
	const match = text.trim().match(/^\[\[([^\]]+)\]\]\s*(?:[—–-]+\s*)?(.+)$/s);
	return match?.[2]?.trim() || text.trim();
}

export function planDayLabel(day: string): string {
	return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const kindLabels = { pending: "Pending edit", batch: "Line edits", directive: "Editorialism", preparation: "Engagement task" } as const;
export const kindIcons = { pending: "pencil-line", batch: "messages-square", directive: "list-checks", preparation: "clipboard-list" } as const;
