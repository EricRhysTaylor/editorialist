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
export function deliveryDate(value: string | null): string {
	return value && isDate(value) ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Unknown";
}
export function deliveryCaption(delivery: EditorialDelivery): string {
	return `${delivery.reviewer || "Unattributed"}${delivery.role ? ` · ${delivery.role}` : ""} · ${delivery.title}`;
}
