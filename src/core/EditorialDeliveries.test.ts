import { describe, expect, it } from "vitest";
import { deliveryTitleForRole, isDeliveryOpen, normalizeEditorialDeliveries, planDeliveryLink, updateDelivery, type DeliveryLinkRequest, type EditorialDelivery } from "./EditorialDeliveries";
import { migratePluginData } from "../services/PluginDataMigration";
const delivery: EditorialDelivery = { id: "round-1", title: "Developmental edit", bookFolder: "Book", reviewer: "Marla", role: "Developmental editor", received: "2026-09-12", due: "2026-10-03", source: "Letter.md", files: ["Agenda.md"], batchIds: ["batch-1"] };
describe("Editorial deliveries", () => {
	it("preserves a handoff linking both formats through plugin migration", () => {
		const store = { version: 1 as const, deliveries: [delivery] };
		expect(migratePluginData({ version: 1, editorialDeliveries: store }).editorialDeliveries).toEqual(store);
	});
	it("does not invent received dates from modified timestamps", () => {
		const result = normalizeEditorialDeliveries({ deliveries: [{ ...delivery, received: undefined, due: "2026-02-30", updatedAt: Date.now() }] });
		expect(result.deliveries[0]).toMatchObject({ received: null, due: null });
	});
	it("prevents linking either format to two deliveries", () => {
		const store = { version: 1 as const, deliveries: [delivery] };
		expect(() => updateDelivery(store, { ...delivery, id: "round-2", batchIds: [] })).toThrow("already belongs");
		expect(() => updateDelivery(store, { ...delivery, id: "round-2", files: [] })).toThrow("already belongs");
		expect(store.deliveries).toEqual([delivery]);
	});
	it("updates dates without losing links and allows explicit unlinking", () => {
		const store = updateDelivery({ version: 1, deliveries: [delivery] }, { ...delivery, due: "2026-10-10" });
		expect(store.deliveries[0]).toEqual({ ...delivery, due: "2026-10-10" });
		const unlinked = updateDelivery(store, { ...delivery, files: [], batchIds: [] });
		expect(updateDelivery(unlinked, { ...delivery, id: "round-2" }).deliveries).toHaveLength(2);
	});
	it("normalizes malformed records and duplicate source links", () => {
		expect(normalizeEditorialDeliveries(null).deliveries).toEqual([]);
		expect(normalizeEditorialDeliveries({ deliveries: [null, {}, { ...delivery, files: ["Agenda.md", "Agenda.md", null] }, delivery] }).deliveries).toEqual([delivery]);
	});
});
describe("Linking an import to a delivery", () => {
	const store = (...deliveries: EditorialDelivery[]) => ({ version: 1 as const, deliveries });
	const open: EditorialDelivery = { ...delivery, id: "open", reviewer: "Morgan Lee", received: "2026-10-05", due: "2026-10-19", files: [], batchIds: [] };
	const request = (overrides: Partial<DeliveryLinkRequest> = {}): DeliveryLinkRequest => ({ bookFolder: "Book", reviewer: "Morgan Lee", role: "Developmental editor", isAi: false, source: { kind: "batch", id: "batch-9" }, today: "2026-10-08", newId: "new", ...overrides });
	it("joins the reviewer's open delivery, batches and Editorialism files alike", () => {
		expect(planDeliveryLink(store(open), request())).toEqual({ delivery: { ...open, batchIds: ["batch-9"] }, created: false });
		expect(planDeliveryLink(store(open), request({ source: { kind: "file", path: "Editorialist/Book/Agenda.md" } }))?.delivery.files).toEqual(["Editorialist/Book/Agenda.md"]);
	});
	it("matches the reviewer by name, ignoring case and spacing", () => {
		expect(planDeliveryLink(store(open), request({ reviewer: " morgan lee " }))?.created).toBe(false);
	});
	it("starts a delivery received today when the reviewer has none open", () => {
		expect(planDeliveryLink(store(), request())).toEqual({
			delivery: { id: "new", bookFolder: "Book", title: "Developmental review", reviewer: "Morgan Lee", role: "Developmental editor", received: "2026-10-08", due: null, source: "", files: [], batchIds: ["batch-9"] },
			created: true,
		});
	});
	it("starts a new delivery once the old one's deadline has passed, or in another book", () => {
		expect(planDeliveryLink(store({ ...open, due: "2026-10-07" }), request())?.created).toBe(true);
		expect(planDeliveryLink(store({ ...open, bookFolder: "Other" }), request())?.created).toBe(true);
	});
	it("keeps a delivery without a deadline open for a while after it arrived", () => {
		expect(isDeliveryOpen({ ...open, due: null, received: "2026-09-01" }, "2026-10-08")).toBe(true);
		expect(isDeliveryOpen({ ...open, due: null, received: "2026-08-01" }, "2026-10-08")).toBe(false);
		expect(isDeliveryOpen({ ...open, due: null, received: null }, "2026-10-08")).toBe(true);
	});
	it("prefers the most recently received open delivery", () => {
		const older = { ...open, id: "older", received: "2026-09-30" };
		expect(planDeliveryLink(store(older, open), request())?.delivery.id).toBe("open");
	});
	it("links nothing without a reviewer, for an AI's own review, or twice", () => {
		expect(planDeliveryLink(store(open), request({ reviewer: "" }))).toBeNull();
		expect(planDeliveryLink(store(open), request({ isAi: true }))).toBeNull();
		expect(planDeliveryLink(store({ ...open, batchIds: ["batch-9"] }), request())).toBeNull();
	});
	it("titles a new delivery from the reviewer's role", () => {
		expect(deliveryTitleForRole("Developmental editor")).toBe("Developmental review");
		expect(deliveryTitleForRole("Copy editor")).toBe("Copy edit");
		expect(deliveryTitleForRole("Beta reader")).toBe("Beta read");
		expect(deliveryTitleForRole("Agent")).toBe("Agent review");
		expect(deliveryTitleForRole("")).toBe("Editorial review");
	});
});
