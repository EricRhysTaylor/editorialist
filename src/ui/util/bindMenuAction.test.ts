import { describe, expect, it, vi } from "vitest";
import { bindMenuAction } from "./bindMenuAction";

function fixture(disabled = false) {
	const element = Object.assign(new EventTarget(), { matches: (selector: string) => selector === ":disabled" && disabled });
	const open = vi.fn();
	bindMenuAction(element as unknown as HTMLElement, open);
	const dispatch = (type: string, button = 0) => {
		const event = Object.assign(new Event(type, { cancelable: true }), { button });
		element.dispatchEvent(event);
		return event;
	};
	return { open, dispatch };
}

describe("status menu activation", () => {
	it("preserves focus on press and opens once after the full pointer gesture", () => {
		const { open, dispatch } = fixture();
		expect(dispatch("pointerdown").defaultPrevented).toBe(true);
		dispatch("mousedown");
		dispatch("pointerup");
		dispatch("mouseup");
		expect(open).not.toHaveBeenCalled();
		expect(dispatch("click").defaultPrevented).toBe(true);
		expect(open).toHaveBeenCalledTimes(1);
		dispatch("pointerdown");
		dispatch("click");
		expect(open).toHaveBeenCalledTimes(2);
	});
	it("supports keyboard and accessibility clicks without an earlier pointer press", () => {
		const { open, dispatch } = fixture();
		dispatch("click");
		expect(open).toHaveBeenCalledOnce();
	});
	it("does not open on a cancelled press, secondary button, or disabled control", () => {
		const { open, dispatch } = fixture();
		dispatch("pointerdown");
		dispatch("pointercancel");
		dispatch("pointerdown", 2);
		dispatch("click", 2);
		expect(open).not.toHaveBeenCalled();
		const disabled = fixture(true);
		disabled.dispatch("click");
		expect(disabled.open).not.toHaveBeenCalled();
	});
});
