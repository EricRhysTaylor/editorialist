import { describe, expect, it } from "vitest";
import { prepareEditorialismUpdate } from "./EditorialismUpdate";
const header = "---\ntype: editorialism\ntitle: Agenda\n---\n# Agenda\n## Arc\n";
describe("Editorialism update progress", () => {
	it("keeps completed, deferred and anchor progress when an old export is pasted", () => {
		const current = header + '- [x] Rewrite opening [scope:: 1]\n  - [x] 1 "The door opened."\n- [-] Clarify stakes\n';
		const incoming = current.replace(/\[x\]/g, "[ ]").replace("[-]", "[ ]");
		expect(prepareEditorialismUpdate(current, incoming).content).toBe(current);
	});
	it("reports changed instructions as additions and removals without transferring progress", () => {
		const result = prepareEditorialismUpdate(header + "- [x] Rewrite opening\n", header + "- [ ] Rewrite ending\n");
		expect(result.added).toEqual(["Rewrite ending"]);
		expect(result.removed).toEqual(["Rewrite opening"]);
		expect(result.content).toContain("[ ] Rewrite ending");
	});
	it("does not match identical text in a different scene", () => {
		const result = prepareEditorialismUpdate(header + "- [x] Tighten [scope:: 1]\n", header + "- [ ] Tighten [scope:: 2]\n");
		expect(result.content).toContain("[ ] Tighten");
	});
	it("keeps a recorded decision when the re-export omits it", () => {
		const current = header + "- [ ] Choose raspberries or blueberries [decision:: raspberries]\n";
		const incoming = header + "- [?] Choose raspberries or blueberries\n";
		expect(prepareEditorialismUpdate(current, incoming).content).toBe(current);
	});
});
