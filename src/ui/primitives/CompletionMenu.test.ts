import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindCompletionMenu } from "./CompletionMenu";

interface Choice { title: string; checked: boolean; select: () => Promise<void> }
interface ShownMenu { choices: Choice[]; position?: { x: number; y: number }; document?: Document }
const state = vi.hoisted(() => ({ menus: [] as ShownMenu[], notices: [] as string[] }));
vi.mock("obsidian", () => ({
	Menu: class implements ShownMenu {
		choices: Choice[] = [];
		position?: { x: number; y: number };
		document?: Document;
		constructor() { state.menus.push(this); }
		addItem(build: (item: unknown) => void) {
			const choice: Choice = { title: "", checked: false, select: async () => {} };
			const item = {
				setTitle: (title: string) => { choice.title = title; return item; },
				setIcon: (_icon: string) => item,
				setChecked: (checked: boolean) => { choice.checked = checked; return item; },
				onClick: (select: () => Promise<void>) => { choice.select = select; return item; },
			};
			build(item); this.choices.push(choice); return this;
		}
		showAtPosition(position: { x: number; y: number }, document: Document) { this.position = position; this.document = document; }
	},
	Notice: class { constructor(message: string) { state.notices.push(message); } },
}));

function fixture(done = false, save = vi.fn<(next: boolean) => Promise<void>>().mockResolvedValue(undefined)) {
	const attributes = new Map<string, string>();
	const control = Object.assign(new EventTarget(), {
		disabled: false, isConnected: true, ownerDocument: {} as Document,
		setAttribute: (key: string, value: string) => attributes.set(key, value),
		getBoundingClientRect: () => ({ left: 12, bottom: 34 }),
		matches: (_selector: string): boolean => control.disabled,
	});
	bindCompletionMenu(control as unknown as HTMLButtonElement, done, save);
	const click = () => control.dispatchEvent(Object.assign(new Event("click", { cancelable: true }), { button: 0 }));
	return { control, attributes, save, click };
}

beforeEach(() => { state.menus.length = 0; state.notices.length = 0; });
describe("engagement completion menus", () => {
	it.each([false, true])("shows both choices without changing a %s completion state", (done) => {
		const { control, save, click, attributes } = fixture(done); click();
		const menu = state.menus[0]!;
		expect(menu.choices.map(({ title, checked }) => ({ title, checked }))).toEqual([{ title: "Open", checked: !done }, { title: "Done", checked: done }]);
		expect(save).not.toHaveBeenCalled();
		expect(attributes.get("aria-haspopup")).toBe("menu");
		expect(menu.position).toEqual({ x: 12, y: 34 });
		expect(menu.document).toBe(control.ownerDocument);
	});
	it("saves the chosen state once and blocks duplicate selections while saving", async () => {
		let finish!: () => void;
		const save = vi.fn<(next: boolean) => Promise<void>>(() => new Promise<void>((resolve) => { finish = resolve; }));
		const { control, click } = fixture(false, save); click();
		const select = state.menus[0]!.choices[1]!.select;
		const pending = select(); expect(control.disabled).toBe(true);
		await select(); expect(save).toHaveBeenCalledExactlyOnceWith(true);
		finish(); await pending; expect(control.disabled).toBe(false);
	});
	it("reopens completed items and does nothing when their current state is chosen", async () => {
		const { click, save } = fixture(true); click();
		await state.menus[0]!.choices[1]!.select(); expect(save).not.toHaveBeenCalled();
		await state.menus[0]!.choices[0]!.select(); expect(save).toHaveBeenCalledExactlyOnceWith(false);
	});
	it("reports a failed save and lets the author try again", async () => {
		const save = vi.fn<(next: boolean) => Promise<void>>().mockRejectedValue(new Error("Could not save engagement."));
		const { click, control } = fixture(false, save); click();
		await state.menus[0]!.choices[1]!.select();
		expect(state.notices).toEqual(["Could not save engagement."]);
		expect(control.disabled).toBe(false);
	});
	it("does not open a menu on a disabled circle", () => {
		const { control, click } = fixture(); control.disabled = true; click();
		expect(state.menus).toHaveLength(0);
	});
});
