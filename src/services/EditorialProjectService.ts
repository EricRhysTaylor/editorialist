import { TFile, TFolder, normalizePath, type App } from "obsidian";
import { getSceneIdForFile, isSceneNoteForScope, type ActiveBookScopeInfo } from "../core/VaultScope";
import { materialState, type EditorialProject, type FrozenSource, type MaterialCheck, type MaterialObservation, type ProjectMaterial } from "../core/planning/EditorialProject";
import { checkWordPackage } from "../core/planning/WordPackage";

export async function sha256(bytes: ArrayBuffer): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function textDigest(text: string): Promise<string> { return sha256(new TextEncoder().encode(text).buffer); }

/** Local evidence only. No manuscript mutation and no Reedsy network calls. */
export class EditorialProjectService {
	constructor(private readonly app: App, private readonly scope: () => ActiveBookScopeInfo, private readonly cutFolder: () => string, private readonly openText: (path: string) => string | null | undefined) {}
	private sourceFiles(material: ProjectMaterial): TFile[] {
		const scope = this.scope();
		if (!scope.sourceFolder) throw new Error("Select an active book before checking materials.");
		if (material.kind === "manuscript") {
			return this.app.vault.getMarkdownFiles().filter((file) => !file.path.startsWith("Editorialist/Submissions/") && isSceneNoteForScope(this.app, file, scope, this.cutFolder())).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
		}
		const file = this.app.vault.getAbstractFileByPath(normalizePath(material.source));
		if (!(file instanceof TFile) || file.extension !== "md") throw new Error("Link an existing vault note for this material.");
		return [file];
	}
	async observe(material: ProjectMaterial, project?: EditorialProject): Promise<MaterialObservation> {
		try {
			const files = this.sourceFiles(material);
			if (!files.length) throw new Error("No manuscript sources found in this book.");
			const sources: FrozenSource[] = [];
			for (const file of files) {
				const text = this.openText(file.path) ?? await this.app.vault.read(file);
				sources.push({ path: file.path, digest: await textDigest(text), copy: "", ...(getSceneIdForFile(this.app, file) ? { sceneId: getSceneIdForFile(this.app, file) } : {}) });
			}
			const sourceDigest = await textDigest(JSON.stringify(sources.map(({ path, digest, sceneId }) => ({ path, digest, sceneId }))));
			const file = this.app.vault.getAbstractFileByPath(normalizePath(material.exportPath));
			if (file instanceof TFile && file.stat.size > 64 * 1024 * 1024) throw new Error("The export exceeds the 64 MB inspection limit.");
			const exportDigest = file instanceof TFile ? await sha256(await this.app.vault.readBinary(file)) : null;
			const preserved = material.check?.sources ?? material.frozenSources ?? [];
			let snapshotError: string | undefined;
			for (const source of preserved) {
				const copy = this.app.vault.getAbstractFileByPath(source.copy);
				if (!(copy instanceof TFile) || await textDigest(await this.app.vault.read(copy)) !== source.digest) { snapshotError = "A preserved source snapshot is missing or changed. Approve and stage fresh copies."; break; }
			}
			if (material.check) {
				const copy = this.app.vault.getAbstractFileByPath(material.check.copy);
				if (!(copy instanceof TFile) || await sha256(await this.app.vault.readBinary(copy)) !== material.check.exportDigest) snapshotError = "The staged export copy is missing or changed. Check the export again.";
			}
			const packetWordCount = project?.materials.find((item) => item.kind === "manuscript")?.wordCount ?? (material.kind === "manuscript" ? material.wordCount : undefined);
			return { sourceDigest, exportDigest, error: null, sources, ...(snapshotError ? { snapshotError } : {}), ...(packetWordCount ? { packetWordCount } : {}) };
		} catch (error) { return { sourceDigest: null, exportDigest: null, error: error instanceof Error ? error.message : "Could not read this material.", sources: [] }; }
	}
	async observeProject(project: EditorialProject): Promise<Record<string, MaterialObservation>> {
		const entries = await Promise.all(project.materials.map(async (material) => [material.id, await this.observe(material, project)] as const));
		return Object.fromEntries(entries);
	}
	private async folder(path: string): Promise<void> {
		for (let index = 1; index <= path.split("/").length; index++) {
			const part = path.split("/").slice(0, index).join("/");
			const existing = this.app.vault.getAbstractFileByPath(part);
			if (!existing) await this.app.vault.createFolder(part);
			else if (!(existing instanceof TFolder)) throw new Error(`A file blocks submission storage: ${part}`);
		}
	}
	private async copySources(project: EditorialProject, observed: MaterialObservation): Promise<FrozenSource[]> {
		if (!/^[\w-]{1,128}$/.test(project.id)) throw new Error("The project identity is invalid. Reopen the project.");
		const base = normalizePath(`Editorialist/Submissions/${project.id}/${crypto.randomUUID()}`);
		const sources: FrozenSource[] = [];
		for (const source of observed.sources) {
			const file = this.app.vault.getAbstractFileByPath(source.path);
			if (!(file instanceof TFile)) throw new Error("A source disappeared while saving. Refresh and try again.");
			const text = this.openText(file.path) ?? await this.app.vault.read(file);
			if (await textDigest(text) !== source.digest) throw new Error("A source changed while saving. Refresh and try again.");
			const copy = normalizePath(`${base}/sources/${source.path}`);
			await this.folder(copy.slice(0, copy.lastIndexOf("/")));
			const saved = await this.app.vault.create(copy, text);
			if (await textDigest(await this.app.vault.read(saved)) !== source.digest) throw new Error("The saved snapshot could not be verified.");
			sources.push({ ...source, copy });
		}
		await this.app.vault.create(`${base}/manifest.json`, JSON.stringify({ version: 1, projectId: project.id, sourceDigest: observed.sourceDigest, sources }, null, 2));
		return sources;
	}
	async approve(project: EditorialProject, material: ProjectMaterial): Promise<{ digest: string; sources: FrozenSource[] }> {
		const observed = await this.observe(material);
		if (observed.error || !observed.sourceDigest) throw new Error(observed.error ?? "Link a source first.");
		const sources = await this.copySources(project, observed);
		const after = await this.observe(material);
		if (after.sourceDigest !== observed.sourceDigest) throw new Error("Sources changed during the snapshot. Refresh before approving.");
		return { digest: observed.sourceDigest, sources };
	}
	async check(project: EditorialProject, material: ProjectMaterial, confirmed: readonly string[]): Promise<MaterialCheck> {
		const observed = await this.observe(material);
		if (observed.error || !observed.sourceDigest || material.approvedDigest !== observed.sourceDigest) throw new Error("Approve the current source before checking its export.");
		if (!observed.exportDigest) throw new Error("Link an existing exported file in this vault.");
		if (!material.requirements.length || material.requirements.some((item) => !confirmed.includes(item))) throw new Error("Confirm every requirement after opening and inspecting this export.");
		if (material.kind === "manuscript" && (!material.wordCount || !Number.isInteger(material.wordCount) || material.wordCount < 1)) throw new Error("Record the final Word export’s word count in material details.");
		const file = this.app.vault.getAbstractFileByPath(normalizePath(material.exportPath));
		if (!(file instanceof TFile) || file.extension !== "docx") throw new Error("The submission export must be a Word (.docx) document.");
		const bytes = await this.app.vault.readBinary(file);
		checkWordPackage(bytes);
		if (await sha256(bytes) !== observed.exportDigest) throw new Error("The export changed during inspection. Refresh and check again.");
		const sources = await this.copySources(project, observed);
		const copy = normalizePath(`Editorialist/Submissions/${project.id}/${crypto.randomUUID()}/${file.name}`);
		await this.folder(copy.slice(0, copy.lastIndexOf("/")));
		const saved = await this.app.vault.createBinary(copy, bytes);
		if (await sha256(await this.app.vault.readBinary(saved)) !== observed.exportDigest) throw new Error("The staged export copy could not be verified.");
		const after = await this.observe(material);
		if (after.sourceDigest !== observed.sourceDigest || after.exportDigest !== observed.exportDigest) throw new Error("The source or export changed while staging. Refresh and check again.");
		const packetWordCount = project.materials.find((item) => item.kind === "manuscript")?.wordCount;
		const check: MaterialCheck = { at: new Date().toISOString(), sourceDigest: observed.sourceDigest, exportDigest: observed.exportDigest, exportPath: material.exportPath, copy, sources, requirements: [...material.requirements], ...(material.wordCount ? { wordCount: material.wordCount } : {}), ...(packetWordCount ? { packetWordCount } : {}) };
		await this.app.vault.create(`${copy}.manifest.json`, JSON.stringify({ version: 1, projectId: project.id, materialId: material.id, check }, null, 2));
		return check;
	}
	async verifyUpload(project: EditorialProject, material: ProjectMaterial): Promise<MaterialCheck> {
		const observed = await this.observe(material, project);
		if (observed.snapshotError) throw new Error(observed.snapshotError);
		if (!["checked", "uploaded"].includes(materialState(material, observed)) || !material.check) throw new Error("Check the current export before recording its upload.");
		const copy = this.app.vault.getAbstractFileByPath(material.check.copy);
		if (!(copy instanceof TFile) || await sha256(await this.app.vault.readBinary(copy)) !== material.check.exportDigest) throw new Error("The staged copy is missing or changed. Check the export again.");
		return structuredClone(material.check);
	}
}
