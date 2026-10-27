import { isDate, localDate, resolvePlanSource, type PlanEntry, type RevisionPlan, type WorkCandidate, type WorkKind } from "./RevisionPlan";
import { normalizeContributorValue } from "../ContributorIdentity";
import type { ContributorProfile } from "../../models/ContributorProfile";

export interface ProjectMilestone { id: string; title: string; day: string; done: boolean }
export interface EngagementTask { id: string; title: string; materialId: string | null; milestoneId: string | null; done: boolean }
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
/** Preparation evidence is read-only history; new items use title, notes and optional links. */
export interface ProjectMaterial {
	notes?: string;
	/** The author's ceiling for the linked document, in prose words. */
	wordLimit?: number;
	completed?: boolean;
	wordCount?: number;
	id: string;
	title: string;
	kind: "manuscript" | "document";
	required: boolean;
	source: string;
	exportPath: string;
	milestoneId: string | null;
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
}
export interface EditorialProject {
	records: EngagementRecord[];
	/** Stable identity in the existing contributor directory; editor retains the saved name. */
	reviewerId?: string;
	version: 1;
	id: string;
	title: string;
	editor: string;
	collaborationUrl: string;
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
	return { version: 1, id: makeId(), title: "Developmental edit", editor: editor.trim(), collaborationUrl: "", submissionDate: deadline, expectedReturn: null, actualReturn: null, questionsDays: 10, deliveryId: null, milestones: [], materials: [], tasks: [], history: [], records: [] };
}
export function materialDue(project: EditorialProject, material: ProjectMaterial): string | null {
	return project.milestones.find((item) => item.id === material.milestoneId)?.day ?? null;
}
/** The vault document an engagement task works on, through its related reference. */
export function taskDocument(project: EditorialProject, taskId: string): string | null {
	const task = project.tasks.find((item) => item.id === taskId);
	return project.materials.find((item) => item.id === task?.materialId)?.source || null;
}
export function preparationWork(project: EditorialProject): WorkCandidate[] {
	return project.tasks.map((task) => {
		const milestone = project.milestones.find((item) => item.id === task.milestoneId);
		const due = task.milestoneId === "__start__" ? project.submissionDate : milestone?.day;
		return { kind: "preparation", path: project.id, locator: task.id, title: task.title, detail: [project.title, milestone?.title].filter(Boolean).join(" · "), ...(due ? { due } : {}), complete: task.done, deferred: false };
	});
}
/** Only the author's explicit schedule deadline and the task's selected milestone constrain work. */
export function workDeadline(plan: RevisionPlan, _kind: WorkKind, due: string | null | undefined, required = true): string | null {
	return [required ? plan.deadline : null, due].filter((day): day is string => Boolean(day)).sort()[0] ?? null;
}
export function entryDeadline(plan: RevisionPlan, entry: Pick<PlanEntry, "source" | "required">, candidates: readonly WorkCandidate[]): string | null {
	const source = resolvePlanSource(entry.source, candidates);
	return workDeadline(plan, entry.source.kind, source.state === "ready" ? source.candidate.due : null, entry.required);
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
	if (!data || data.version !== 1) throw new Error("Unsupported editorial project version; update before saving.");
	if (!/^[\w-]{1,128}$/.test(str(data.id))) throw new Error("The editorial project identity is invalid.");
	if (!isDate(data.submissionDate)) throw new Error("The engagement needs a valid start date.");
	const milestones = unique(list(data.milestones).flatMap((value): ProjectMilestone[] => { const item = record(value); return item && str(item.id) && str(item.title) && isDate(item.day) ? [{ id: str(item.id), title: str(item.title), day: item.day, done: item.done === true }] : []; }));
	const materials = unique(list(data.materials).flatMap((value): ProjectMaterial[] => {
		const item = record(value); if (!item || !str(item.id) || !str(item.title) || !["manuscript", "document"].includes(str(item.kind))) return [];
		const uploads = list(item.uploads).flatMap((value): MaterialUpload[] => { const upload = record(value), check = normalizeCheck(upload?.check); return upload && check && stamp(upload.at) && str(upload.filename) && str(upload.confirmation) ? [{ at: stamp(upload.at), filename: str(upload.filename), confirmation: str(upload.confirmation), check }] : []; });
		const frozenSources = list(item.frozenSources).flatMap((value): FrozenSource[] => { const source = record(value); return source && str(source.path) && digest(source.digest) && str(source.copy) ? [{ path: str(source.path), digest: digest(source.digest)!, copy: str(source.copy), ...(str(source.sceneId) ? { sceneId: str(source.sceneId) } : {}) }] : []; });
		return [{ ...(str(item.notes) ? { notes: str(item.notes) } : {}), ...(item.completed === true ? { completed: true } : {}), id: str(item.id), title: str(item.title), kind: item.kind as ProjectMaterial["kind"], required: item.required !== false, source: str(item.source), exportPath: str(item.exportPath), milestoneId: str(item.milestoneId) || null, requirements: texts(item.requirements), approvedDigest: digest(item.approvedDigest), check: normalizeCheck(item.check), uploads, ...(item.frozenSources !== undefined ? { frozenSources } : {}), ...(typeof item.wordCount === "number" && Number.isInteger(item.wordCount) && item.wordCount > 0 ? { wordCount: item.wordCount } : {}), ...(typeof item.wordLimit === "number" && Number.isInteger(item.wordLimit) && item.wordLimit > 0 ? { wordLimit: item.wordLimit } : {}) }];
	}));
	const tasks = unique(list(data.tasks).flatMap((value): EngagementTask[] => { const item = record(value); return item && str(item.id) && str(item.title) ? [{ id: str(item.id), title: str(item.title), materialId: str(item.materialId) || null, milestoneId: str(item.milestoneId) || null, done: item.done === true }] : []; }));
	return { records: normalizeEngagementRecords(data.records), version: 1, id: str(data.id), title: str(data.title) || "Editorial project", editor: str(data.editor), ...(str(data.reviewerId) ? { reviewerId: str(data.reviewerId) } : {}), collaborationUrl: collaborationUrl(str(data.collaborationUrl)), ...(isDate(data.readinessDate) ? { readinessDate: data.readinessDate } : {}), submissionDate: data.submissionDate, expectedReturn: isDate(data.expectedReturn) ? data.expectedReturn : null, actualReturn: isDate(data.actualReturn) ? data.actualReturn : null, questionsDays: typeof data.questionsDays === "number" && Number.isFinite(data.questionsDays) ? Math.max(0, Math.min(365, Math.round(data.questionsDays))) : 10, deliveryId: str(data.deliveryId) || null, milestones, materials, tasks, history: list(data.history).flatMap((value): ProjectEvent[] => { const item = record(value); return item && stamp(item.at) && str(item.text) ? [{ at: stamp(item.at), text: str(item.text) }] : []; }) };
}

function normalizeEngagementRecords(raw: unknown): EngagementRecord[] {
	return unique(list(raw).map((value): EngagementRecord => {
		const item = record(value), archive = record(item?.archive);
		if (!item || !str(item.id) || !isDate(item.day) || !["sent", "received", "note"].includes(str(item.kind)) || !str(item.description)) throw new Error("An engagement record is invalid; repair it before saving.");
		if (item.archive !== undefined && (!archive || !str(archive.copy) || !digest(archive.digest))) throw new Error("An archived reference is invalid; repair it before saving.");
		return { id: str(item.id), day: item.day, kind: item.kind as EngagementRecord["kind"], description: str(item.description), filenames: str(item.filenames), referencePath: str(item.referencePath), ...(archive ? { archive: { copy: str(archive.copy), digest: digest(archive.digest)! } } : {}) };
	}));
}
