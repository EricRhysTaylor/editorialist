import { Menu, setIcon } from "obsidian";
import { DOT_SOURCES, type DotSource, type EditDot, type EditMatrixScene, type EditState } from "../../core/review/EditMatrix";
import type { EditRound } from "../../core/review/EditLedger";
import { localDate } from "../../core/planning/RevisionPlan";
import { planDayLabel } from "../../core/planning/WorkPresentation";
import { compareSceneTitles } from "../panels/ReviewPanelIdleSections";
import { bindMenuAction } from "../util/bindMenuAction";
import { displayDirectiveText } from "../../core/DirectiveText";
import { bindDotPopover, type DotPopoverContent } from "./DotPopover";

const SOURCE_NAMES: Record<DotSource, string> = { copy: "Copy edit", editor: "Editorial pass", editorialism: "Editorialism", pending: "Pending edit" };
const STATE_NAMES: Record<EditState, string> = { open: "to do", done: "done", declined: "declined" };
const STATUS_NOTES: Partial<Record<EditDot["status"], string>> = { deferred: "deferred", unresolved: "passage not found", rewritten: "you rewrote it" };

export interface EditMatrixRound {
	scenes: readonly EditMatrixScene[];
	// 0 until the author first starts a new round.
	startedAt: number;
	rounds: readonly EditRound[];
}

export interface EditMatrixActions {
	open: (scene: EditMatrixScene, dot: EditDot) => void;
	newRound: (archive: boolean) => void;
	/** Opens the review launcher, where an editor's pass is brought in. */
	bringIn: () => void;
	/** Opens the Editorialism panel, where an agenda is started. */
	openAgendas: () => void;
	/** Lights a dot's scene up elsewhere while Shift is held over it; null puts it out. */
	spotlight: (edit: { scene: EditMatrixScene; dot: EditDot } | null) => void;
}

/**
 * One kind of work out of the round, as a panel for that kind shows it. A
 * subset draws nothing when it has no dots, since its panel says so in its
 * own way, and leaves rounds to the whole grid.
 */
export interface EditMatrixSubset {
	title: string;
	keep: (scene: EditMatrixScene, dot: EditDot) => boolean;
}

// Holding Shift over a dot lights its scene up wherever the scene is shown,
// without opening it. Shift can go down before or after the pointer arrives,
// so keys are heard only while the pointer is over the dot. Nothing is
// prevented, so Shift still reaches everything else.
function bindSpotlight(button: HTMLElement, scene: EditMatrixScene, dot: EditDot, actions: EditMatrixActions): void {
	let lit = false;
	let doc: Document | null = null;
	const set = (on: boolean) => {
		if (on === lit) return;
		lit = on;
		actions.spotlight(on ? { scene, dot } : null);
	};
	const leave = () => {
		doc?.removeEventListener("keydown", onKey);
		doc?.removeEventListener("keyup", onKey);
		doc = null;
		set(false);
	};
	// A grid redrawn under the pointer takes the dot away without a leave.
	const onKey = (event: KeyboardEvent) => (button.isConnected ? set(event.shiftKey) : leave());
	button.addEventListener("pointerenter", (event) => {
		doc = button.ownerDocument;
		doc.addEventListener("keydown", onKey);
		doc.addEventListener("keyup", onKey);
		set(event.shiftKey);
	});
	button.addEventListener("pointermove", (event) => set(event.shiftKey));
	button.addEventListener("pointerleave", leave);
}

const STATE_TITLES: Record<EditState, string> = { open: "To do", done: "Done", declined: "Declined" };

function kindLine(dot: EditDot): string {
	return [SOURCE_NAMES[dot.source], dot.viaWord ? "from Word" : dot.ai ? "AI" : null, STATE_NAMES[dot.state]].filter(Boolean).join(" · ");
}

function dotNotes(dot: EditDot): string[] {
	return [STATUS_NOTES[dot.status], dot.live ? null : "scene cleaned"].filter((note): note is string => Boolean(note));
}

// A directive's text as the author reads it, without the agenda's tracking
// code or emphasis marks.
function dotSummary(dot: EditDot): string {
	return dot.source === "editorialism" ? displayDirectiveText(dot.summary) : dot.summary;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** An edit in full beside its dot: what kind of work it is and where it
 * stands, the scene it belongs to, the edit itself, and what a click and
 * Shift do. */
function editPopover(scene: EditMatrixScene, dot: EditDot): DotPopoverContent {
	const notes = dotNotes(dot);
	const open = dot.source === "editorialism" ? "Click to open it in its agenda"
		: dot.source === "pending" ? "Click to review this scene's pending edits"
		: dot.live ? "Click to go to this edit" : "Click to open the scene";
	return {
		color: `is-${dot.source}`,
		kind: SOURCE_NAMES[dot.source],
		tag: dot.viaWord ? "From Word" : dot.ai ? "AI" : null,
		state: { text: STATE_TITLES[dot.state], tone: dot.state === "open" ? "accent" : "muted" },
		title: scene.title,
		summary: dotSummary(dot),
		note: notes.length ? capitalize(notes.join(" · ")) : null,
		hint: `${open} · Hold Shift to find the scene`,
	};
}

const day = (at: number): string => planDayLabel(localDate(new Date(at)));

function roundLine(round: EditRound): string {
	const states = Object.values(round.counts);
	const total = states.reduce((sum, state) => sum + state.open + state.done + state.declined, 0);
	const done = states.reduce((sum, state) => sum + state.done, 0);
	const span = round.startedAt ? `${day(round.startedAt)} – ${day(round.endedAt)}` : `Until ${day(round.endedAt)}`;
	return `${span} · ${total} ${total === 1 ? "edit" : "edits"}, ${done} done`;
}

/**
 * The round's edits as one dot each, scene by scene in story order. The
 * colour says what kind of work an edit is (a copy edit, an editorial pass's
 * edit, or an Editorialism directive), and a centre mark says a model made
 * it rather than a person; a hollow dot is still to do, a solid
 * one is done, a faint one was declined. Click a dot to open its scene at that
 * edit; hold Shift over it to light the scene up elsewhere. The menu starts
 * a new round, which clears the handled dots, or archives this round's totals
 * first. A subset draws one kind of work only, without the menu.
 */
export function renderEditMatrix(parent: HTMLElement, round: EditMatrixRound, actions: EditMatrixActions, subset?: EditMatrixSubset): void {
	const scenes = [...round.scenes]
		.map((scene) => (subset ? { ...scene, dots: scene.dots.filter((dot) => subset.keep(scene, dot)) } : scene))
		.filter((scene) => scene.dots.length)
		.sort((left, right) => compareSceneTitles(left.title, right.title));
	const dots = scenes.flatMap((scene) => scene.dots);
	// Pending edits are drawn but not counted: they are never handled within
	// a round, only gone, so the round's count is of its own edits. With no
	// edits of the round's own, the whole grid stays the tray that asks for
	// the first pass; the Pending edits panel draws them on their own.
	const pending = dots.filter((dot) => dot.source === "pending").length;
	const counted = dots.length - pending;
	if (subset ? !dots.length : !counted) {
		if (!subset) renderTray(parent, round, actions);
		return;
	}
	const card = parent.createDiv({ cls: "editorialist-panel__review-state editorialist-matrix" });
	const settled = dots.filter((dot) => dot.state !== "open").length;
	const tally = !counted ? `${pending} to do`
		: `${settled ? `${settled} of ${counted} handled` : `${counted} to do`}${pending ? ` · ${pending} pending` : ""}`;
	const head = card.createDiv({ cls: "editorialist-panel__review-state-header" });
	head.createSpan({ cls: "editorialist-panel__review-state-title", text: subset?.title ?? "All edits" });
	head.createSpan({ cls: "editorialist-panel__review-state-summary", text: tally });
	if (!subset) renderRoundsMenu(head, round, counted, settled, actions);
	if (round.startedAt) card.createDiv({ cls: "editorialist-matrix__since", text: `This round since ${day(round.startedAt)}` });

	const grid = card.createDiv({ cls: "editorialist-matrix__grid", attr: { role: "list", "aria-label": `${dots.length} edits in ${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"}` } });
	for (const scene of scenes) {
		const group = grid.createDiv({ cls: "editorialist-matrix__scene", attr: { role: "listitem", "aria-label": scene.title } });
		for (const dot of scene.dots) {
			// The label is for screen readers; sighted readers get the popover.
			const label = [scene.title, kindLine(dot), capitalize(dotNotes(dot).join(", ")), dotSummary(dot)].filter(Boolean).join(". ");
			const button = group.createEl("button", {
				cls: `editorialist-matrix__dot is-${dot.source} is-${dot.state}${dot.ai ? " is-ai" : ""}`,
				attr: { type: "button", "aria-label": label },
			});
			button.addEventListener("click", () => actions.open(scene, dot));
			bindDotPopover(button, () => editPopover(scene, dot));
			bindSpotlight(button, scene, dot, actions);
		}
	}

	const legend = card.createDiv({ cls: "editorialist-matrix__legend" });
	for (const source of DOT_SOURCES) {
		const mine = dots.filter((dot) => dot.source === source);
		if (!mine.length) continue;
		const left = mine.filter((dot) => dot.state === "open").length;
		const item = legend.createDiv({ cls: `editorialist-matrix__key is-${source}` });
		item.createSpan({ cls: "editorialist-matrix__swatch", attr: { "aria-hidden": "true" } });
		item.createSpan({ cls: "editorialist-matrix__key-name", text: SOURCE_NAMES[source] });
		const models = mine.filter((dot) => dot.ai).length;
		const byModel = !models ? "" : models === mine.length ? " · all AI" : ` · ${models} AI`;
		const status = left === mine.length ? `${left} to do` : left ? `${left} of ${mine.length} to do` : `all ${mine.length} handled`;
		item.createSpan({ cls: "editorialist-matrix__key-count", text: `${status}${byModel}` });
	}
	// Only the states the grid shows: a grid of pending edits, all to do,
	// has no use for done or declined.
	const key = card.createDiv({ cls: "editorialist-matrix__states", attr: { "aria-hidden": "true" } });
	for (const state of (["open", "done", "declined"] as const).filter((state) => dots.some((dot) => dot.state === state))) {
		const item = key.createSpan({ cls: "editorialist-matrix__state" });
		item.createSpan({ cls: `editorialist-matrix__dot is-sample is-${state}` });
		item.createSpan({ text: STATE_NAMES[state] });
	}
	if (dots.some((dot) => dot.ai)) {
		const item = key.createSpan({ cls: "editorialist-matrix__state" });
		item.createSpan({ cls: "editorialist-matrix__dot is-sample is-open is-ai" });
		item.createSpan({ text: "AI" });
	}
}

function renderRoundsMenu(head: HTMLElement, round: EditMatrixRound, total: number, settled: number, actions: EditMatrixActions): void {
	const more = head.createEl("button", { cls: "clickable-icon editorialist-matrix__menu", attr: { type: "button", "aria-label": "Rounds", "aria-haspopup": "menu" } });
	setIcon(more, "more-horizontal");
	bindMenuAction(more, () => {
		const menu = new Menu();
		if (total) {
			menu.addItem((item) => item.setTitle("Start a new round").setIcon("rotate-ccw").setDisabled(!settled).onClick(() => actions.newRound(false)));
			menu.addItem((item) => item.setTitle("Archive this round and start a new one").setIcon("archive").onClick(() => actions.newRound(true)));
		}
		if (round.rounds.length) {
			if (total) menu.addSeparator();
			menu.addItem((item) => item.setTitle("Earlier rounds").setIcon("history").setDisabled(true));
			for (const earlier of [...round.rounds].reverse()) menu.addItem((item) => item.setTitle(roundLine(earlier)).setDisabled(true));
		}
		const rect = more.getBoundingClientRect();
		menu.showAtPosition({ x: rect.right, y: rect.bottom + 4 }, more.ownerDocument);
	});
}

// Unlit grey dots, standing in for the edits to come.
const TRAY_DOTS = 27;

/**
 * No edits in this round: a tray of dots waiting to be filled, which asks for
 * the next pass instead of showing an empty grid. After a finished round it
 * says how that round went, so the next one starts from a result.
 */
function renderTray(parent: HTMLElement, round: EditMatrixRound, actions: EditMatrixActions): void {
	const card = parent.createDiv({ cls: "editorialist-panel__review-state editorialist-matrix editorialist-matrix--tray" });
	const head = card.createDiv({ cls: "editorialist-panel__review-state-header" });
	head.createSpan({ cls: "editorialist-panel__review-state-title", text: "All edits" });
	if (round.rounds.length) renderRoundsMenu(head, round, 0, 0, actions);

	const field = card.createDiv({ cls: "editorialist-matrix__tray-field", attr: { "aria-hidden": "true" } });
	for (let index = 0; index < TRAY_DOTS; index++) field.createSpan({ cls: "editorialist-matrix__tray-dot" });

	const last = round.rounds[round.rounds.length - 1];
	const again = Boolean(last || round.startedAt);
	card.createDiv({ cls: "editorialist-matrix__tray-title", text: again ? "Ready for the next round" : "Your first round starts here" });
	card.createEl("p", {
		cls: "editorialist-matrix__tray-text",
		text: again
			? "Bring in the next pass. Each edit lands here as a dot to work through."
			: "Bring in an editor's Word file or a copy edit, or start an Editorialism agenda. Each edit lands here as a dot.",
	});
	if (last) card.createDiv({ cls: "editorialist-matrix__tray-last", text: `Last round · ${roundLine(last)}` });
	else if (round.startedAt) card.createDiv({ cls: "editorialist-matrix__tray-last", text: `This round since ${day(round.startedAt)}` });

	const buttons = card.createDiv({ cls: "editorialist-matrix__tray-actions" });
	const bring = buttons.createEl("button", { cls: "mod-cta", text: "Bring in edits", attr: { type: "button" } });
	bring.addEventListener("click", () => actions.bringIn());
	const agendas = buttons.createEl("button", { text: "Start an agenda", attr: { type: "button" } });
	agendas.addEventListener("click", () => actions.openAgendas());
}
