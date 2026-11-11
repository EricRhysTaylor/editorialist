/** Keep source locators verbatim; only shorten the label shown in work lists. */
export function pendingWorkTitle(text: string): string {
	const match = text.trim().match(/^\[\[([^\]]+)\]\]\s*(?:[—–-]+\s*)?(.+)$/s);
	return match?.[2]?.trim() || text.trim();
}

export function planDayLabel(day: string): string {
	return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "Aim Nov 20 · Due Dec 4"; just the due date when there is no cushion or the
 * deadline has passed. A date from the plan's schedule deadline says so, since
 * it is set in the plan, not on the work.
 */
export function deadlineLabel(deadline: { due: string; aim: string; schedule?: true }, late = false): string {
	if (deadline.schedule) return `Schedule deadline ${planDayLabel(deadline.due)}`;
	return deadline.aim < deadline.due && !late ? `Aim ${planDayLabel(deadline.aim)} · Due ${planDayLabel(deadline.due)}` : `Due ${planDayLabel(deadline.due)}`;
}

export const kindLabels = { pending: "Pending edit", batch: "Line edits", directive: "Editorialism", preparation: "Engagement task", response: "Response to editor" } as const;
export const kindIcons = { pending: "pencil-line", batch: "messages-square", directive: "list-checks", preparation: "clipboard-list", response: "mail" } as const;
