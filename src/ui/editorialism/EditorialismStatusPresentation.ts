// Shared presentation for the five-state editorialism task status. Both the
// Editorialisms panel and the in-sweep Editorialisms card offer
// the same choices, so the menu order, labels, and icons live here
// rather than being duplicated per surface.

import type { EditorialismItemStatus } from "../../models/Editorialism";

export const STATUS_CYCLE: EditorialismItemStatus[] = [
	"open",
	"in-progress",
	"done",
	"deferred",
	"question",
];

export const STATUS_LABEL: Record<EditorialismItemStatus, string> = {
	"open": "Open",
	"in-progress": "In progress",
	"done": "Done",
	"deferred": "Deferred",
	"question": "Question",
};

export const STATUS_ICON: Record<EditorialismItemStatus, string> = {
	"open": "circle",
	"in-progress": "circle-dashed",
	"done": "check-circle-2",
	"deferred": "circle-slash",
	"question": "circle-help",
};
