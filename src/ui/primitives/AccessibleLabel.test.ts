import { describe, expect, it } from "vitest";
import { setAccessibleLabel } from "./AccessibleLabel";

function fixture() {
	const spans: { id: string; parentElement: object; text: string; hidden: boolean; setText(value: string): void }[] = [];
	const parent = { createSpan: (options: { attr: { id: string; hidden: string } }) => {
		const span = { id: options.attr.id, parentElement: parent, text: "", hidden: options.attr.hidden === "", setText(value: string) { this.text = value; } };
		spans.push(span);
		return span;
	} };
	const attributes = new Map<string, string>([["title", "Finish task"], ["aria-label", "Finish task"], ["aria-pressed", "false"]]);
	const control = { parentElement: parent, setAttribute: (name: string, value: string) => attributes.set(name, value), removeAttribute: (name: string) => attributes.delete(name) };
	return { control: control as unknown as HTMLElement, attributes, spans };
}

describe("accessible control names without hover labels", () => {
	it("retains a resolvable name while removing both tooltip mechanisms", () => {
		const { control, attributes, spans } = fixture();
		setAccessibleLabel(control, "Finish the engagement task");
		expect(attributes.has("title")).toBe(false);
		expect(attributes.has("aria-label")).toBe(false);
		expect(attributes.get("aria-labelledby")).toBe(spans[0]?.id);
		expect(spans[0]?.text).toBe("Finish the engagement task");
		expect(spans[0]?.hidden).toBe(true);
		expect(attributes.get("aria-pressed")).toBe("false");
	});

	it("updates the existing name for modifier and toggle changes", () => {
		const { control, attributes, spans } = fixture();
		setAccessibleLabel(control, "Finish task");
		const id = attributes.get("aria-labelledby");
		setAccessibleLabel(control, "Reopen task");
		expect(spans).toHaveLength(1);
		expect(attributes.get("aria-labelledby")).toBe(id);
		expect(spans[0]?.text).toBe("Reopen task");
	});

	it("keeps controls in separate windows associated with their own labels", () => {
		const first = fixture(), second = fixture();
		setAccessibleLabel(first.control, "Open source");
		setAccessibleLabel(second.control, "Open source");
		expect(first.attributes.get("aria-labelledby")).not.toBe(second.attributes.get("aria-labelledby"));
		expect(first.spans[0]?.parentElement).toBe(first.control.parentElement);
		expect(second.spans[0]?.parentElement).toBe(second.control.parentElement);
	});
});
