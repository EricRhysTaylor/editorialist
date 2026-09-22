import { describe, expect, it } from "vitest";
import { normalizeEditorialDeliveries, updateDelivery, type EditorialDelivery } from "./EditorialDeliveries";
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
