import { isDate, localDate, resolvePlanSource, sourceKey, type PlanEntry, type RevisionPlan, type WorkCandidate, type WorkKind } from "./RevisionPlan";
import { normalizeContributorValue } from "../ContributorIdentity";
import type { ContributorProfile } from "../../models/ContributorProfile";
import type { EditorialDelivery } from "../EditorialDeliveries";
import { AUTHOR_PLAN_SCOPE } from "./AuthorPlan";

/**
 * A date the author and editor share. It has no status of its own: it is met
 * once everything due on it is finished or sent (see milestoneState).
 */
export interface ProjectMilestone { id: string; title: string; day: string }
/** A due date's source: a milestone's id, the engagement start, or none for a date of the item's own. */
export const ENGAGEMENT_START = "__start__";
/** The author's work. Its own due date, else its document's; done is the only status kept by hand. */
export interface EngagementTask { id: string; title: string; materialId: string | null; milestoneId: string | null; due?: string; done: boolean }
export interface FrozenSource { path: string; digest: string; copy: string; sceneId?: string }
export interface MaterialCheck {
	packetWordCount?: number;
	wordCount?: number;
	at: string;
	sourceDigest: string;
	exportDigest: string;
	exportPath: string;
	copy: string;
	sources: FrozenSource[];
	requirements: string[];
}
export interface MaterialUpload { at: string; filename: string; confirmation: string; check: MaterialCheck }
/**
 * A document of the engagement. Its status is its sends, the activity records
 * linked to it (see documentSends). Preparation evidence is read-only history.
 */
export interface ProjectMaterial {
	notes?: string;
	/** The author's ceiling for the linked document, in prose words. */
	wordLimit?: number;
	wordCount?: number;
	id: string;
	title: string;
	kind: "manuscript" | "document";
	required: boolean;
	/** The working note in the vault, which is not the file that gets sent. */
	source: string;
	exportPath: string;
	milestoneId: string | null;
	/** A due date of its own, used when milestoneId is null. */
	due?: string;
	requirements: string[];
	approvedDigest: string | null;
	frozenSources?: FrozenSource[];
	check: MaterialCheck | null;
	uploads: MaterialUpload[];
}
export interface ProjectEvent { at: string; text: string }
export interface EngagementRecord {
	id: string;
	day: string;
	kind: "sent" | "received" | "note";
	description: string;
	filenames: string;
	referencePath: string;
	archive?: { copy: string; digest: string };
	/** The document this record is about; a "sent" record is that document's send. */
	materialId?: string;
}
/**
 * Version 2 dropped the hand-kept statuses of milestones and documents (a
 * milestone is met by what is due on it, a document by being sent) and added
 * own due dates and sends. Version 1 data loads as version 2.
 */
export const EDITORIAL_PROJECT_VERSION = 2;
export interface EditorialProject {
	records: EngagementRecord[];
	/** Stable identity in the existing contributor directory; editor retains the saved name. */
	reviewerId?: string;
	version: typeof EDITORIAL_PROJECT_VERSION;
	id: string;
	title: string;
	editor: string;
	collaborationUrl: string;
	/** The author's pasted copy of the conversation that led to the engagement: quote, scope, dates. */
	agreement?: string;
	/** Historical date retained with earlier preparation evidence; never a scheduling gate. */
	readinessDate?: string;
	submissionDate: string;
	expectedReturn: string | null;
	actualReturn: string | null;
	questionsDays: number;
	deliveryId: string | null;
	milestones: ProjectMilestone[];
	materials: ProjectMaterial[];
	tasks: EngagementTask[];
	history: ProjectEvent[];
}
export function isProjectEditorProfile(profile: ContributorProfile): boolean {
	// Older imports can carry a human role on an AI identity. Do not offer those as people.
	return profile.kind === "human" && !profile.reviewerType.startsWith("ai-") && !profile.id.startsWith("contributor-ai-") && !profile.provider?.trim() && !profile.model?.trim();
}

export function projectEditor(project: EditorialProject, profiles: readonly ContributorProfile[]): { name: string; profile?: ContributorProfile; state: "linked" | "matched" | "unavailable" | "unlinked" } {
	if (project.reviewerId) {
		const profile = profiles.find((item) => item.id === project.reviewerId && isProjectEditorProfile(item));
		return profile ? { name: profile.displayName, profile, state: "linked" } : { name: project.editor, state: "unavailable" };
	}
	// Legacy names may suggest a unique existing human; saving makes that choice explicit.
	const name = normalizeContributorValue(project.editor);
	if (!name) return { name: project.editor, state: "unlinked" };
	const matches = profiles.filter((item) => isProjectEditorProfile(item) && [item.displayName, ...item.aliases].some((value) => normalizeContributorValue(value) === name));
	return matches.length === 1 ? { name: matches[0]!.displayName, profile: matches[0], state: "matched" } : { name: project.editor, state: "unlinked" };
}

// When the editor's feedback actually came back. Once the engagement is
// linked to a delivery, that is the delivery's received date: the delivery is
// the one record of returned feedback, the date scheduling and Today use.
// Before a delivery exists the engagement keeps its own.
export function engagementReturned(project: EditorialProject, deliveries: readonly EditorialDelivery[]): { date: string | null; delivery: EditorialDelivery | null } {
	const delivery = project.deliveryId ? deliveries.find((item) => item.id === project.deliveryId) ?? null : null;
	return delivery ? { date: delivery.received, delivery } : { date: project.actualReturn, delivery: null };
}

// Whether a delivery is from this engagement's editor, so an import can link
// itself to the engagement.
export function isEngagementDelivery(project: EditorialProject, delivery: EditorialDelivery, profiles: readonly ContributorProfile[]): boolean {
	const editor = projectEditor(project, profiles);
	const names = [editor.name, project.editor, ...(editor.profile?.aliases ?? [])].map(normalizeContributorValue).filter(Boolean);
	return names.includes(normalizeContributorValue(delivery.reviewer));
}

/** A pasted conversation, not a document store: enough for a long email thread. */
export const MAX_AGREEMENT_LENGTH = 50000;
export function shiftDate(day: string, offset: number): string {
	if (!isDate(day)) throw new Error("Choose a valid date.");
	return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
/** Compare local calendar dates using UTC day boundaries to avoid daylight saving drift. */
export function engagementStartCountdown(day: string, today = localDate(new Date())): string {
	if (!isDate(day) || !isDate(today)) throw new Error("Choose a valid date.");
	const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
	if (days === 0) return "Today";
	const count = Math.abs(days);
	return `${count} ${count === 1 ? "day" : "days"} ${days > 0 ? "away" : "ago"}`;
}
export function collaborationUrl(value: string): string {
	if (!value.trim()) return "";
	const url = new URL(value.trim());
	if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS collaboration link without credentials.");
	return url.href;
}
/** Starts with an empty author-owned schedule and reference register. */
export function createEditorialProject(editor: string, deadline: string, makeId: () => string): EditorialProject {
	if (!isDate(deadline)) throw new Error("Choose a valid engagement start date.");
	return { version: EDITORIAL_PROJECT_VERSION, id: makeId(), title: "Developmental edit", editor: editor.trim(), collaborationUrl: "", submissionDate: deadline, expectedReturn: null, actualReturn: null, questionsDays: 10, deliveryId: null, milestones: [], materials: [], tasks: [], history: [], records: [] };
}
/**
 * When an item is due, whether that date is the engagement start, which is a
 * promise to the editor, and, for a task, whether it is its document's date.
 */
export interface ItemDue { day: string; start: boolean; milestoneId: string | null; inherited?: true }
function ownDue(project: EditorialProject, item: { milestoneId: string | null; due?: string }): ItemDue | null {
	if (item.milestoneId === ENGAGEMENT_START) return { day: project.submissionDate, start: true, milestoneId: null };
	if (item.milestoneId) {
		const milestone = project.milestones.find((value) => value.id === item.milestoneId);
		return milestone ? { day: milestone.day, start: false, milestoneId: milestone.id } : null;
	}
	return item.due ? { day: item.due, start: false, milestoneId: null } : null;
}
export function documentDue(project: EditorialProject, material: ProjectMaterial): ItemDue | null {
	return ownDue(project, material);
}
/** A task is due on its own date, or else with its document. */
export function taskDue(project: EditorialProject, task: EngagementTask): ItemDue | null {
	const own = ownDue(project, task);
	if (own) return own;
	const document = task.materialId ? project.materials.find((item) => item.id === task.materialId) : undefined;
	const inherited = document ? ownDue(project, document) : null;
	return inherited ? { ...inherited, inherited: true } : null;
}
/**
 * The deadline an item's due date sets: a date due when the engagement starts
 * is a promise to the editor, aimed at the plan's cushion early; the author's
 * own dates are aimed at as set.
 */
export function dueDeadline(plan: Pick<RevisionPlan, "cushionDays">, project: EditorialProject, due: ItemDue): WorkDeadline {
	return candidateDeadline(plan, { due: due.day, path: project.id, ...(due.start ? {} : { ownTarget: true }) })!;
}
/** A document's sends, newest first. */
export function documentSends(project: EditorialProject, materialId: string): EngagementRecord[] {
	return [...project.records].reverse().filter((item) => item.kind === "sent" && item.materialId === materialId).sort((a, b) => b.day.localeCompare(a.day));
}
/**
 * A milestone is met once everything due on it is finished: its tasks done
 * and its documents sent. With nothing due on it, it is simply a date, met
 * once it has passed.
 */
export function milestoneState(project: EditorialProject, milestone: ProjectMilestone, today: string): { done: boolean; open: string[]; total: number } {
	const open: string[] = [];
	let total = 0;
	for (const material of project.materials) {
		if (material.milestoneId !== milestone.id) continue;
		total += 1;
		if (!documentSends(project, material.id).length) open.push(`${material.title} not sent`);
	}
	for (const task of project.tasks) {
		if (taskDue(project, task)?.milestoneId !== milestone.id) continue;
		total += 1;
		if (!task.done) open.push(task.title);
	}
	return { done: total ? !open.length : milestone.day < today, open, total };
}
/** Deleting a milestone leaves what was due on it due on the same day. */
export function removeMilestone(project: EditorialProject, id: string): void {
	const milestone = project.milestones.find((item) => item.id === id);
	if (!milestone) return;
	for (const item of [...project.materials, ...project.tasks]) {
		if (item.milestoneId !== id) continue;
		item.milestoneId = null; item.due = milestone.day;
	}
	project.milestones = project.milestones.filter((item) => item.id !== id);
}
/**
 * Deleting a document keeps its tasks, with the due date they had through it,
 * and keeps its sends in the activity records, no longer linked to it.
 */
export function removeDocument(project: EditorialProject, id: string): void {
	const document = project.materials.find((item) => item.id === id);
	if (!document) return;
	if (document.check || document.frozenSources?.length || document.uploads.length) throw new Error(`“${document.title}” holds earlier preparation records, so it is kept.`);
	for (const task of project.tasks) {
		if (task.materialId !== id) continue;
		if (!ownDue(project, task)) { task.milestoneId = document.milestoneId; if (document.due) task.due = document.due; }
		task.materialId = null;
	}
	for (const record of project.records) if (record.materialId === id) delete record.materialId;
	project.materials = project.materials.filter((item) => item.id !== id);
}
/**
 * Deleting a task also takes its sessions off the schedule, keeping the order
 * of what came after them, and takes it out of the open work progress
 * tracks, so a deleted task is never counted as finished.
 */
export function removeTask(plan: RevisionPlan, id: string): void {
	const project = plan.project;
	if (!project) return;
	const source = { kind: "preparation" as const, path: project.id, locator: id };
	project.tasks = project.tasks.filter((item) => item.id !== id);
	const removed = new Map(plan.entries.filter((entry) => sourceKey(entry.source) === sourceKey(source)).map((entry) => [entry.id, entry.afterId]));
	const before = (afterId: string | null): string | null => { let current = afterId; while (current && removed.has(current)) current = removed.get(current) ?? null; return current; };
	plan.entries = plan.entries.filter((entry) => !removed.has(entry.id));
	for (const entry of plan.entries) entry.afterId = before(entry.afterId);
	if (plan.progress) plan.progress.open = plan.progress.open.filter((item) => item.key !== sourceKey(source));
}
/** The vault document an engagement task works on, through its related reference. */
export function taskDocument(project: EditorialProject, taskId: string): string | null {
	const task = project.tasks.find((item) => item.id === taskId);
	return project.materials.find((item) => item.id === task?.materialId)?.source || null;
}
export function preparationWork(project: EditorialProject): WorkCandidate[] {
	return project.tasks.map((task) => {
		const due = taskDue(project, task);
		const milestone = due?.milestoneId ? project.milestones.find((item) => item.id === due.milestoneId) : undefined;
		return { kind: "preparation", path: project.id, locator: task.id, title: task.title, detail: [project.title, milestone?.title].filter(Boolean).join(" · "), ...(due ? { due: due.day } : {}), ...(due && !due.start ? { ownTarget: true } : {}), complete: task.done, deferred: false };
	});
}
/**
 * Work with a date of its own (a milestone, the engagement start, an editor's
 * return deadline) is due on that date; the plan's schedule deadline covers
 * only required work that has none. The more specific date wins, so changing
 * a task's target is never silently overruled by a date set elsewhere.
 */
export function workDeadline(plan: RevisionPlan, _kind: WorkKind, due: string | null | undefined, required = true): string | null {
	return due || (required ? plan.deadline : null);
}
/**
 * A promise to an editor, an engagement's start date or a delivery's return
 * deadline, is aimed at the plan's cushion of days early. The author's own
 * targets, goals, milestones and the schedule deadline, are aimed at as set,
 * since they are already early. The hard date never moves.
 */
export interface WorkDeadline {
	due: string;
	aim: string;
	/** Set when the date is the plan's schedule deadline rather than the work's own. */
	schedule?: true;
}
export function candidateDeadline(plan: Pick<RevisionPlan, "cushionDays">, candidate: Pick<WorkCandidate, "due" | "path" | "ownTarget">): WorkDeadline | null {
	if (!candidate.due) return null;
	return { due: candidate.due, aim: candidate.path === AUTHOR_PLAN_SCOPE || candidate.ownTarget ? candidate.due : shiftDate(candidate.due, -plan.cushionDays) };
}
/** The work's own date when it has one; otherwise, when required, the plan's schedule deadline (see workDeadline). */
export function entryWorkDeadline(plan: RevisionPlan, entry: Pick<PlanEntry, "source" | "required">, candidates: readonly WorkCandidate[]): WorkDeadline | null {
	const source = resolvePlanSource(entry.source, candidates);
	const own = source.state === "ready" ? candidateDeadline(plan, source.candidate) : null;
	if (own) return own;
	return entry.required && plan.deadline ? { due: plan.deadline, aim: plan.deadline, schedule: true } : null;
}
/** Where a piece of work stands against its aim and deadline on a given day. */
export function deadlineState(deadline: WorkDeadline, day: string): "on-track" | "cushion" | "late" {
	return day > deadline.due ? "late" : day > deadline.aim ? "cushion" : "on-track";
}
/** Days of the cushion spent once the aim has passed; null outside the cushion. */
export function cushionProgress(deadline: WorkDeadline, day: string): { used: number; total: number; left: number } | null {
	if (deadlineState(deadline, day) !== "cushion") return null;
	const span = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
	const total = span(deadline.aim, deadline.due), used = span(deadline.aim, day);
	return { used, total, left: total - used };
}
/**
 * The engagement's two stretches: the editor's, from the start date to their
 * return, then the author's question window after it. The return is the
 * recorded one when there is one, otherwise the expected date.
 */
export interface EngagementPhases { start: string; returned: string; questionsEnd: string; returnRecorded: boolean; phase: "before" | "editing" | "questions" | "done"; daysLeft: number }
export function engagementPhases(project: Pick<EditorialProject, "submissionDate" | "questionsDays" | "expectedReturn">, actualReturn: string | null, day: string): EngagementPhases | null {
	const returned = actualReturn ?? project.expectedReturn;
	if (!returned || returned < project.submissionDate) return null;
	const questionsEnd = shiftDate(returned, project.questionsDays);
	const span = (to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
	const phase = day < project.submissionDate ? "before" : day <= returned ? "editing" : day <= questionsEnd ? "questions" : "done";
	const daysLeft = phase === "before" ? span(project.submissionDate) : phase === "editing" ? span(returned) : phase === "questions" ? span(questionsEnd) : 0;
	return { start: project.submissionDate, returned, questionsEnd, returnRecorded: actualReturn !== null, phase, daysLeft };
}
export function recordProjectEvent(project: EditorialProject, text: string, at = new Date().toISOString()): void { project.history.push({ at, text }); }

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const str = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const texts = (value: unknown): string[] => [...new Set(list(value).map(str).filter(Boolean))];
const digest = (value: unknown): string | null => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
const stamp = (value: unknown): string => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
function unique<T extends { id: string }>(items: T[]): T[] { const ids = new Set<string>(); return items.filter((item) => item.id && !ids.has(item.id) && Boolean(ids.add(item.id))); }
function normalizeCheck(value: unknown): MaterialCheck | null {
	const data = record(value);
	if (!data || !stamp(data.at) || !digest(data.sourceDigest) || !digest(data.exportDigest) || !str(data.exportPath) || !str(data.copy)) return null;
	const sources = list(data.sources).flatMap((value): FrozenSource[] => { const item = record(value); return item && str(item.path) && digest(item.digest) && str(item.copy) ? [{ path: str(item.path), digest: digest(item.digest)!, copy: str(item.copy), ...(str(item.sceneId) ? { sceneId: str(item.sceneId) } : {}) }] : []; });
	if (!sources.length) return null;
	return { at: stamp(data.at), sourceDigest: digest(data.sourceDigest)!, exportDigest: digest(data.exportDigest)!, exportPath: str(data.exportPath), copy: str(data.copy), sources, requirements: texts(data.requirements), ...(typeof data.wordCount === "number" && Number.isInteger(data.wordCount) && data.wordCount > 0 ? { wordCount: data.wordCount } : {}), ...(typeof data.packetWordCount === "number" && Number.isInteger(data.packetWordCount) && data.packetWordCount > 0 ? { packetWordCount: data.packetWordCount } : {}) };
}
export function normalizeEditorialProject(raw: unknown): EditorialProject | undefined {
	if (raw === undefined || raw === null) return undefined;
	const data = record(raw);
	if (!data || (data.version !== 1 && data.version !== EDITORIAL_PROJECT_VERSION)) throw new Error("Unsupported editorial project version; update before saving.");
	if (!/^[\w-]{1,128}$/.test(str(data.id))) throw new Error("The editorial project identity is invalid.");
	if (!isDate(data.submissionDate)) throw new Error("The engagement needs a valid start date.");
	const due = (value: unknown): { due?: string } => isDate(value) ? { due: value } : {};
	const milestones = unique(list(data.milestones).flatMap((value): ProjectMilestone[] => { const item = record(value); return item && str(item.id) && str(item.title) && isDate(item.day) ? [{ id: str(item.id), title: str(item.title), day: item.day }] : []; }));
	const materials = unique(list(data.materials).flatMap((value): ProjectMaterial[] => {
		const item = record(value); if (!item || !str(item.id) || !str(item.title) || !["manuscript", "document"].includes(str(item.kind))) return [];
		const uploads = list(item.uploads).flatMap((value): MaterialUpload[] => { const upload = record(value), check = normalizeCheck(upload?.check); return upload && check && stamp(upload.at) && str(upload.filename) && str(upload.confirmation) ? [{ at: stamp(upload.at), filename: str(upload.filename), confirmation: str(upload.confirmation), check }] : []; });
		const frozenSources = list(item.frozenSources).flatMap((value): FrozenSource[] => { const source = record(value); return source && str(source.path) && digest(source.digest) && str(source.copy) ? [{ path: str(source.path), digest: digest(source.digest)!, copy: str(source.copy), ...(str(source.sceneId) ? { sceneId: str(source.sceneId) } : {}) }] : []; });
		return [{ ...(str(item.notes) ? { notes: str(item.notes) } : {}), id: str(item.id), title: str(item.title), kind: item.kind as ProjectMaterial["kind"], required: item.required !== false, source: str(item.source), exportPath: str(item.exportPath), milestoneId: str(item.milestoneId) || null, ...due(item.due), requirements: texts(item.requirements), approvedDigest: digest(item.approvedDigest), check: normalizeCheck(item.check), uploads, ...(item.frozenSources !== undefined ? { frozenSources } : {}), ...(typeof item.wordCount === "number" && Number.isInteger(item.wordCount) && item.wordCount > 0 ? { wordCount: item.wordCount } : {}), ...(typeof item.wordLimit === "number" && Number.isInteger(item.wordLimit) && item.wordLimit > 0 ? { wordLimit: item.wordLimit } : {}) }];
	}));
	const tasks = unique(list(data.tasks).flatMap((value): EngagementTask[] => { const item = record(value); return item && str(item.id) && str(item.title) ? [{ id: str(item.id), title: str(item.title), materialId: str(item.materialId) || null, milestoneId: str(item.milestoneId) || null, ...due(item.due), done: item.done === true }] : []; }));
	const records = normalizeEngagementRecords(data.records);
	const history = list(data.history).flatMap((value): ProjectEvent[] => { const item = record(value); return item && stamp(item.at) && str(item.text) ? [{ at: stamp(item.at), text: str(item.text) }] : []; });
	if (data.version === 1) carryVersion1Statuses(list(data.materials), materials, milestones, records, history, data.submissionDate);
	return { records, version: EDITORIAL_PROJECT_VERSION, id: str(data.id), title: str(data.title) || "Editorial project", editor: str(data.editor), ...(str(data.reviewerId) ? { reviewerId: str(data.reviewerId) } : {}), collaborationUrl: collaborationUrl(str(data.collaborationUrl)), ...(str(data.agreement) ? { agreement: str(data.agreement).slice(0, MAX_AGREEMENT_LENGTH) } : {}), ...(isDate(data.readinessDate) ? { readinessDate: data.readinessDate } : {}), submissionDate: data.submissionDate, expectedReturn: isDate(data.expectedReturn) ? data.expectedReturn : null, actualReturn: isDate(data.actualReturn) ? data.actualReturn : null, questionsDays: typeof data.questionsDays === "number" && Number.isFinite(data.questionsDays) ? Math.max(0, Math.min(365, Math.round(data.questionsDays))) : 10, deliveryId: str(data.deliveryId) || null, milestones, materials, tasks, history };
}

/**
 * Version 1 kept a document's status by hand, and an older preparation flow
 * recorded uploads on the document. Both become sends, so work an author
 * already finished does not come back as unsent and overdue: each upload is
 * a send on its own day with its copy, and a document marked done becomes one
 * send, dated when it was marked done (from its history) or else on its due
 * date, saying plainly that it was marked done in an earlier version.
 */
function carryVersion1Statuses(raw: unknown[], materials: ProjectMaterial[], milestones: ProjectMilestone[], records: EngagementRecord[], history: ProjectEvent[], start: string): void {
	for (const value of raw) {
		const item = record(value), material = materials.find((entry) => entry.id === str(item?.id));
		if (!item || !material) continue;
		material.uploads.forEach((upload, index) => {
			const day = upload.at.slice(0, 10);
			if (isDate(day)) records.push({ id: `upload-${material.id}-${index}`, day, kind: "sent", description: upload.confirmation || "Sent", filenames: upload.filename, referencePath: "", archive: { copy: upload.check.copy, digest: upload.check.exportDigest }, materialId: material.id });
		});
		if (item.completed !== true || records.some((entry) => entry.kind === "sent" && entry.materialId === material.id)) continue;
		const marked = [...history].reverse().find((event) => event.text === `${material.title}: completed`);
		const markedDay = marked ? localDate(new Date(marked.at)) : null;
		const day = markedDay && isDate(markedDay) ? markedDay : milestones.find((entry) => entry.id === material.milestoneId)?.day ?? start;
		records.push({ id: `done-${material.id}`, day, kind: "sent", description: "Marked done in an earlier version", filenames: "", referencePath: "", materialId: material.id });
	}
}

function normalizeEngagementRecords(raw: unknown): EngagementRecord[] {
	return unique(list(raw).map((value): EngagementRecord => {
		const item = record(value), archive = record(item?.archive);
		if (!item || !str(item.id) || !isDate(item.day) || !["sent", "received", "note"].includes(str(item.kind)) || !str(item.description)) throw new Error("An engagement record is invalid; repair it before saving.");
		if (item.archive !== undefined && (!archive || !str(archive.copy) || !digest(archive.digest))) throw new Error("An archived reference is invalid; repair it before saving.");
		return { id: str(item.id), day: item.day, kind: item.kind as EngagementRecord["kind"], description: str(item.description), filenames: str(item.filenames), referencePath: str(item.referencePath), ...(archive ? { archive: { copy: str(archive.copy), digest: digest(archive.digest)! } } : {}), ...(str(item.materialId) ? { materialId: str(item.materialId) } : {}) };
	}));
}
