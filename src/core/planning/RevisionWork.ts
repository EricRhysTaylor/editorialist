import type { Editorialism } from "../../models/Editorialism";
import type { PendingEditsSession } from "../../models/PendingEditSegment";
import type { ReviewSession } from "../../models/ReviewSuggestion";
import { splitFieldLines } from "../PendingEditsSegments";
import { estimateEditorialismEffort, type EffortParams } from "../EffortEstimate";
import type { WorkCandidate } from "./RevisionPlan";

export function pendingWork(session: PendingEditsSession): WorkCandidate[] {
	return session.scenes.flatMap((scene) => splitFieldLines(scene.rawField).filter((line) => line.trim()).map((line) => ({
		kind: "pending", path: scene.scenePath, locator: line.trim(), title: line.trim(), detail: scene.sceneTitle, complete: false, deferred: false,
	})));
}
export function directiveWork(document: Editorialism, params: EffortParams): WorkCandidate[] {
	return document.sections.flatMap((section) => section.items.map((item) => ({
		kind: "directive", path: document.filePath,
		// Status and line position can change without changing the instruction.
		locator: JSON.stringify([section.heading, item.text, item.scope?.raw ?? ""]),
		title: item.text, detail: [document.title, document.reviewer, item.scope?.raw].filter(Boolean).join(" · "),
		complete: item.status === "done", deferred: item.status === "deferred", line: item.lineIndex,
		suggestedMinutes: estimateEditorialismEffort({ ...document, sections: [{ ...section, items: [{ ...item, status: "open" }] }] }, params).totalMinutes,
	})));
}
export function batchWork(session: ReviewSession): WorkCandidate[] {
	const ids = new Set([...session.suggestions, ...session.memos].map((item) => item.source.batchId).filter((id): id is string => Boolean(id)));
	return [...ids].map((id) => {
		const suggestions = session.suggestions.filter((item) => item.source.batchId === id);
		const memos = session.memos.filter((item) => item.source.batchId === id);
		const remaining = suggestions.filter((item) => !["accepted", "rejected", "rewritten"].includes(item.status));
		return { kind: "batch", path: session.notePath, locator: id,
			title: `Review ${session.notePath.split("/").pop()?.replace(/\.md$/i, "") ?? session.notePath}`,
			detail: `${[...new Set([...suggestions, ...memos].map((item) => item.contributor.displayName))].join(", ")} · ${remaining.length} suggestions remaining · ${memos.length} notes`,
			// Memos have no general completion decision; finish their planned session explicitly.
			complete: remaining.length === 0 && memos.length === 0,
			deferred: remaining.some((item) => item.status === "deferred"),
		};
	});
}
