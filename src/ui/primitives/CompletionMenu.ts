import { Menu, Notice } from "obsidian";
import { bindMenuAction } from "../util/bindMenuAction";

/** Choose completion explicitly; opening or dismissing the menu never saves. */
export function bindCompletionMenu(control: HTMLButtonElement, done: boolean, save: (next: boolean) => Promise<void>): void {
	control.setAttribute("aria-haspopup", "menu");
	bindMenuAction(control, () => {
		const menu = new Menu();
		for (const next of [false, true]) {
			menu.addItem((item) => item.setTitle(next ? "Done" : "Open").setIcon(next ? "check-circle-2" : "circle").setChecked(next === done).onClick(async () => {
				if (control.disabled || next === done) return;
				control.disabled = true;
				try { await save(next); }
				catch (error: unknown) { new Notice(error instanceof Error ? error.message : "Could not update status."); }
				finally { if (control.isConnected) control.disabled = false; }
			}));
		}
		const rect = control.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom }, control.ownerDocument);
	});
}
