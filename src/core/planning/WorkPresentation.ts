/** Keep source locators verbatim; only shorten the label shown in work lists. */
export function pendingWorkTitle(text: string): string {
	const match = text.trim().match(/^\[\[([^\]]+)\]\]\s*(?:[—–-]+\s*)?(.+)$/s);
	return match?.[2]?.trim() || text.trim();
}

export function planDayLabel(day: string): string {
	return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
