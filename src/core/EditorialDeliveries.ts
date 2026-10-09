import { isDate } from "./planning/RevisionPlan";

export interface EditorialDelivery {
	id: string;
	bookFolder: string;
	title: string;
	reviewer: string;
	role: string;
	received: string | null;
	due: string | null;
	/** Vault note path, not a copy of the source document. */
	source: string;
	files: string[];
	batchIds: string[];
}
export interface EditorialDeliveryStore { version: 1; deliveries: EditorialDelivery[] }
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(string).filter(Boolean))] : [];
export function normalizeEditorialDeliveries(raw: unknown): EditorialDeliveryStore {
	const result: EditorialDeliveryStore = { version: 1, deliveries: [] };
	const input = record(raw);
	if (!Array.isArray(input?.deliveries)) return result;
	const ids = new Set<string>();
	for (const value of input.deliveries) {
		const row = record(value);
		if (!row) continue;
		const id = string(row.id), bookFolder = string(row.bookFolder).replace(/\/$/, ""), title = string(row.title);
		if (!id || !bookFolder || !title || ids.has(id)) continue;
		ids.add(id);
		result.deliveries.push({ id, bookFolder, title, reviewer: string(row.reviewer), role: string(row.role), source: string(row.source), received: isDate(row.received) ? row.received : null, due: isDate(row.due) ? row.due : null, files: strings(row.files), batchIds: strings(row.batchIds) });
	}
	return result;
}
/** A source belongs to one delivery; reject accidental reassignment. */
export function updateDelivery(store: EditorialDeliveryStore, delivery: EditorialDelivery): EditorialDeliveryStore {
	const normalized = normalizeEditorialDeliveries({ deliveries: [delivery] }).deliveries[0];
	if (!normalized) throw new Error("A title and active book are required.");
	for (const other of store.deliveries.filter((item) => item.id !== normalized.id)) {
		if (other.files.some((path) => normalized.files.includes(path)) || other.batchIds.some((id) => normalized.batchIds.includes(id))) throw new Error(`A selected source already belongs to “${other.title}”. Unlink it there first.`);
	}
	return { version: 1, deliveries: [...store.deliveries.filter((item) => item.id !== normalized.id), normalized] };
}
/** One imported piece of feedback: a review batch or an Editorialism file. */
export type DeliverySource = { kind: "batch"; id: string } | { kind: "file"; path: string };
export interface DeliveryLinkRequest {
	bookFolder: string;
	reviewer: string;
	/** Display label for the reviewer's role ("Developmental editor"), or "". */
	role: string;
	/** True for an AI's own review: that is not an editor's handoff, so it joins no delivery. */
	isAi: boolean;
	source: DeliverySource;
	/** Local date, YYYY-MM-DD. */
	today: string;
	/** Id for a delivery this import starts. */
	newId: string;
}
export interface DeliveryLinkPlan { delivery: EditorialDelivery; created: boolean }
const ROLE_TITLES: Record<string, string> = {
	"developmental editor": "Developmental review",
	"line editor": "Line edit",
	"copy editor": "Copy edit",
	"beta reader": "Beta read",
	"sensitivity reader": "Sensitivity read",
	editor: "Editorial review",
};
/** "Developmental editor" -> "Developmental review"; unknown roles -> "<Role> review"; none -> "Editorial review". */
export function deliveryTitleForRole(role: string): string {
	const key = role.trim().toLocaleLowerCase();
	return ROLE_TITLES[key] ?? (key ? `${role.trim()} review` : "Editorial review");
}
/** A delivery with no return deadline stops collecting imports this long after it was received. */
export const OPEN_DELIVERY_DAYS = 45;
const sameName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
function daysBefore(day: string, days: number): string {
	const date = new Date(`${day}T12:00:00`);
	date.setDate(date.getDate() - days);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** Still collecting this reviewer's feedback: its deadline has not passed, or it has none and arrived recently. */
export function isDeliveryOpen(delivery: EditorialDelivery, today: string): boolean {
	if (delivery.due) return delivery.due >= today;
	return !delivery.received || delivery.received >= daysBefore(today, OPEN_DELIVERY_DAYS);
}
/**
 * Where an import belongs: the reviewer's open delivery in this book, or a new
 * delivery for them received today (title from their role, no deadline yet).
 * Null when there is nothing to link: no reviewer, an AI's own review, or the
 * source is already in a delivery.
 */
export function planDeliveryLink(store: EditorialDeliveryStore, request: DeliveryLinkRequest): DeliveryLinkPlan | null {
	const reviewer = request.reviewer.trim();
	const bookFolder = request.bookFolder.replace(/\/$/, "");
	if (!reviewer || !bookFolder || request.isAi) return null;
	const { source } = request;
	const holds = (delivery: EditorialDelivery): boolean => source.kind === "batch" ? delivery.batchIds.includes(source.id) : delivery.files.includes(source.path);
	if (store.deliveries.some(holds)) return null;
	const add = (delivery: EditorialDelivery): EditorialDelivery => source.kind === "batch"
		? { ...delivery, batchIds: [...delivery.batchIds, source.id] }
		: { ...delivery, files: [...delivery.files, source.path] };
	const open = store.deliveries
		.filter((delivery) => delivery.bookFolder === bookFolder && sameName(delivery.reviewer, reviewer) && isDeliveryOpen(delivery, request.today))
		.sort((a, b) => (b.received ?? "").localeCompare(a.received ?? ""));
	if (open[0]) return { delivery: add(open[0]), created: false };
	const role = request.role.trim();
	return {
		delivery: add({ id: request.newId, bookFolder, title: deliveryTitleForRole(role), reviewer, role, received: request.today, due: null, source: "", files: [], batchIds: [] }),
		created: true,
	};
}
export function deliveryDate(value: string | null): string {
	return value && isDate(value) ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Unknown";
}
export function deliveryCaption(delivery: EditorialDelivery): string {
	return `${delivery.reviewer || "Unattributed"}${delivery.role ? ` · ${delivery.role}` : ""} · ${delivery.title}`;
}
