import { isDate, resolvePlanSource, type PlanEntry, type RevisionPlan, type WorkCandidate, type WorkKind } from "./RevisionPlan";

export interface ProjectMilestone { id: string; title: string; day: string; done: boolean }
export interface PreparationTask { id: string; title: string; materialId: string | null; milestoneId: string | null; done: boolean }
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
export interface ProjectMaterial {
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
export interface EditorialProject {
	version: 1;
	id: string;
	title: string;
	editor: string;
	collaborationUrl: string;
	readinessDate: string;
	submissionDate: string;
	expectedReturn: string | null;
	actualReturn: string | null;
	questionsDays: number;
	deliveryId: string | null;
	milestones: ProjectMilestone[];
	materials: ProjectMaterial[];
	tasks: PreparationTask[];
	history: ProjectEvent[];
}
export interface MaterialObservation { sourceDigest: string | null; exportDigest: string | null; error: string | null; snapshotError?: string; packetWordCount?: number; sources: FrozenSource[] }
export type MaterialState = "missing" | "drafting" | "approved" | "checked" | "uploaded" | "recheck";
export const MATERIAL_STATE_LABELS: Record<MaterialState, string> = { missing: "Missing source", drafting: "Drafting", approved: "Author approved", checked: "Export checked", uploaded: "Uploaded", recheck: "Needs recheck" };

export function shiftDate(day: string, offset: number): string {
	if (!isDate(day)) throw new Error("Choose a valid submission date.");
	return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
export function collaborationUrl(value: string): string {
	if (!value.trim()) return "";
	const url = new URL(value.trim());
	if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS collaboration link without credentials.");
	return url.href;
}
/** Generic preset; manuscript text and the editor's requirements remain author-owned. */
export function createEditorialProject(editor: string, deadline: string, makeId: () => string): EditorialProject {
	const milestones = [
		["Series overview approved", -30], ["Query letter drafted", -21], ["Manuscript frozen", -14], ["Packet checked", -7],
	].map(([title, offset]) => ({ id: makeId(), title: String(title), day: shiftDate(deadline, Number(offset)), done: false }));
	const materials: ProjectMaterial[] = [
		{ id: makeId(), title: "Manuscript", kind: "manuscript", milestoneId: milestones[2]!.id, requirements: ["Title page and author name confirmed", "Complete scene order and intended frontmatter", "Word count reconciled with query letter", "Reader-facing headings; no scene IDs or filenames", "Internal feedback and planning annotations excluded", "Times New Roman, 12 pt, double spacing", "One-inch margins and paragraph indents", "Opened in Word and visually inspected"] },
		{ id: makeId(), title: "Series overview", kind: "document", milestoneId: milestones[0]!.id, requirements: ["Author rewrite approved", "Established story distinguished from exploratory plans", "Opened exported document and visually inspected"] },
		{ id: makeId(), title: "Query letter", kind: "document", milestoneId: milestones[1]!.id, requirements: ["Complete author-approved draft for editorial review", "Title, positioning and word count consistent with packet", "Opened exported document and visually inspected"] },
	].map((item) => ({ ...item, kind: item.kind as ProjectMaterial["kind"], required: true, source: "", exportPath: "", approvedDigest: null, check: null, uploads: [] }));
	const tasks: PreparationTask[] = materials.map((material) => ({ id: makeId(), title: `Prepare ${material.title.toLowerCase()}`, materialId: material.id, milestoneId: material.milestoneId, done: false }));
	tasks.push({ id: makeId(), title: "Inspect all exports and stage packet", materialId: null, milestoneId: milestones[3]!.id, done: false });
	tasks.push({ id: makeId(), title: "Upload and verify files in collaboration", materialId: null, milestoneId: null, done: false });
	return { version: 1, id: makeId(), title: "Developmental edit", editor: editor.trim(), collaborationUrl: "", submissionDate: deadline, readinessDate: shiftDate(deadline, -7), expectedReturn: null, actualReturn: null, questionsDays: 10, deliveryId: null, milestones, materials, tasks, history: [] };
}
export function materialState(material: ProjectMaterial, observed: MaterialObservation | undefined): MaterialState {
	if (!observed || observed.error || !observed.sourceDigest) return "missing";
	if (observed.snapshotError) return "recheck";
	const checked = material.check;
	const matches = checked && checked.sourceDigest === observed.sourceDigest && checked.exportDigest === observed.exportDigest && checked.exportPath === material.exportPath && checked.wordCount === material.wordCount && checked.packetWordCount === observed.packetWordCount && JSON.stringify(checked.requirements) === JSON.stringify(material.requirements);
	if (checked && !matches) return "recheck";
	if (material.approvedDigest !== observed.sourceDigest) return material.approvedDigest ? "recheck" : "drafting";
	if (!matches) return "approved";
	const upload = material.uploads.at(-1);
	return upload && upload.check.at === checked.at && upload.check.exportDigest === checked.exportDigest ? "uploaded" : "checked";
}
export function materialDue(project: EditorialProject, material: ProjectMaterial): string {
	const milestone = project.milestones.find((item) => item.id === material.milestoneId);
	return [project.readinessDate, project.submissionDate, milestone?.day].filter((day): day is string => Boolean(day)).sort()[0]!;
}
export function preparationWork(project: EditorialProject): WorkCandidate[] {
	return project.tasks.map((task) => {
		const milestone = project.milestones.find((item) => item.id === task.milestoneId);
		return { kind: "preparation", path: project.id, locator: task.id, title: task.title, detail: [project.title, milestone?.title].filter(Boolean).join(" · "), due: [project.submissionDate, task.milestoneId ? milestone?.day : null, task.materialId ? project.readinessDate : null].filter((day): day is string => Boolean(day)).sort()[0], complete: task.done, deferred: false };
	});
}
/** Deadline of an entry includes its milestone, even when manually scheduled. */
export function workDeadline(plan: RevisionPlan, kind: WorkKind, due: string | null | undefined, required = true): string | null {
	const project = plan.project;
	const manuscript = project?.materials.find((item) => item.kind === "manuscript" && item.required);
	const freeze = project?.milestones.find((item) => item.id === manuscript?.milestoneId)?.day;
	const preparing = required && kind !== "preparation" && project && !project.actualReturn;
	return [required ? plan.deadline : null, preparing ? freeze : null, preparing ? project.readinessDate : null, due].filter((day): day is string => Boolean(day)).sort()[0] ?? null;
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
	if (!isDate(data.submissionDate) || !isDate(data.readinessDate) || data.readinessDate > data.submissionDate) throw new Error("The project needs valid readiness and submission dates.");
	const milestones = unique(list(data.milestones).flatMap((value): ProjectMilestone[] => { const item = record(value); return item && str(item.id) && str(item.title) && isDate(item.day) ? [{ id: str(item.id), title: str(item.title), day: item.day, done: item.done === true }] : []; }));
	const materials = unique(list(data.materials).flatMap((value): ProjectMaterial[] => {
		const item = record(value); if (!item || !str(item.id) || !str(item.title) || !["manuscript", "document"].includes(str(item.kind))) return [];
		const uploads = list(item.uploads).flatMap((value): MaterialUpload[] => { const upload = record(value), check = normalizeCheck(upload?.check); return upload && check && stamp(upload.at) && str(upload.filename) && str(upload.confirmation) ? [{ at: stamp(upload.at), filename: str(upload.filename), confirmation: str(upload.confirmation), check }] : []; });
		const frozenSources = list(item.frozenSources).flatMap((value): FrozenSource[] => { const source = record(value); return source && str(source.path) && digest(source.digest) && str(source.copy) ? [{ path: str(source.path), digest: digest(source.digest)!, copy: str(source.copy), ...(str(source.sceneId) ? { sceneId: str(source.sceneId) } : {}) }] : []; });
		return [{ id: str(item.id), title: str(item.title), kind: item.kind as ProjectMaterial["kind"], required: item.required !== false, source: str(item.source), exportPath: str(item.exportPath), milestoneId: str(item.milestoneId) || null, requirements: texts(item.requirements), approvedDigest: digest(item.approvedDigest), check: normalizeCheck(item.check), uploads, ...(item.frozenSources !== undefined ? { frozenSources } : {}), ...(typeof item.wordCount === "number" && Number.isInteger(item.wordCount) && item.wordCount > 0 ? { wordCount: item.wordCount } : {}) }];
	}));
	const tasks = unique(list(data.tasks).flatMap((value): PreparationTask[] => { const item = record(value); return item && str(item.id) && str(item.title) ? [{ id: str(item.id), title: str(item.title), materialId: str(item.materialId) || null, milestoneId: str(item.milestoneId) || null, done: item.done === true }] : []; }));
	return { version: 1, id: str(data.id), title: str(data.title) || "Editorial project", editor: str(data.editor), collaborationUrl: collaborationUrl(str(data.collaborationUrl)), readinessDate: data.readinessDate, submissionDate: data.submissionDate, expectedReturn: isDate(data.expectedReturn) ? data.expectedReturn : null, actualReturn: isDate(data.actualReturn) ? data.actualReturn : null, questionsDays: typeof data.questionsDays === "number" && Number.isFinite(data.questionsDays) ? Math.max(0, Math.min(365, Math.round(data.questionsDays))) : 10, deliveryId: str(data.deliveryId) || null, milestones, materials, tasks, history: list(data.history).flatMap((value): ProjectEvent[] => { const item = record(value); return item && stamp(item.at) && str(item.text) ? [{ at: stamp(item.at), text: str(item.text) }] : []; }) };
}
