import type { EditorialistPluginData } from "../models/ContributorProfile";

export interface ManuscriptReassociation {
	oldFolder: string;
	newFolder: string;
	oldName: string;
	newName: string;
}

export function moveFolderPath(path: string, oldFolder: string, newFolder: string): string {
	return path === oldFolder || path.startsWith(`${oldFolder}/`) ? newFolder + path.slice(oldFolder.length) : path;
}

export function folderPlanKey(folder: string): string { return JSON.stringify(["folder", folder]); }

export function knownManuscriptFolders(data: EditorialistPluginData): string[] {
	const folders = new Set(Object.keys(data.settings.manuscriptNames?.folders ?? {}));
	const target = data.settings.manuscriptTarget;
	if (target?.kind === "folder" && target.path) folders.add(target.path);
	if (data.settings.bookFolderOverride) folders.add(data.settings.bookFolderOverride);
	for (const delivery of data.editorialDeliveries?.deliveries ?? []) folders.add(delivery.bookFolder);
	for (const entry of Object.values(data.sweepRegistry)) if (entry.activeBookSourceFolder) folders.add(entry.activeBookSourceFolder);
	for (const key of Object.keys(data.revisionPlans?.books ?? {})) {
		try { const value: unknown = JSON.parse(key); if (Array.isArray(value) && value[0] === "folder" && typeof value[1] === "string") folders.add(value[1]); } catch { /* Author-wide and legacy plan keys are not folder associations. */ }
	}
	return [...folders].filter(Boolean).sort();
}

export function manuscriptName(data: EditorialistPluginData, folder: string): string {
	const names = data.settings.manuscriptNames?.folders;
	return (names && Object.prototype.hasOwnProperty.call(names, folder) ? names[folder] : undefined) ?? Object.values(data.sweepRegistry).find((entry) => entry.activeBookSourceFolder === folder && entry.activeBookLabel)?.activeBookLabel ?? folder.split("/").pop() ?? folder;
}

/** Build a replacement without mutating the source. Existing destination records are never merged. */
export function reassociateManuscript(data: EditorialistPluginData, change: ManuscriptReassociation): EditorialistPluginData {
	const { oldFolder, newFolder, oldName, newName } = change;
	if (!oldFolder || !newFolder || !oldName.trim() || !newName.trim() || /[\r\n]/.test(newName)) throw new Error("Choose a folder and a manuscript name.");
	if (oldFolder !== newFolder && (newFolder.startsWith(`${oldFolder}/`) || oldFolder.startsWith(`${newFolder}/`))) throw new Error("Choose a replacement outside the original folder and its parents.");
	const affected = knownManuscriptFolders(data).filter((path) => moveFolderPath(path, oldFolder, newFolder) !== path);
	if (oldFolder !== newFolder) {
		const destinations = new Set(affected.map((path) => moveFolderPath(path, oldFolder, newFolder)));
		for (const index of [data.sceneReviewIndex, data.reviewDecisionIndex, data.reviewerSignalIndex, data.authorQueryDecisions]) {
			if (Object.keys(index).some((key) => key.startsWith(`${newFolder}/`))) throw new Error(`“${newFolder}” already has review history. Both sets are retained. Choose a different replacement folder.`);
		}
		for (const folder of knownManuscriptFolders(data)) {
			if (!affected.includes(folder) && (destinations.has(folder) || folder === newFolder || folder.startsWith(`${newFolder}/`))) throw new Error(`“${folder}” already has manuscript records. Both sets are retained. Choose a different replacement folder.`);
		}
	}
	if (oldName !== newName && knownManuscriptFolders(data).some((folder) => folder !== oldFolder && !affected.includes(folder) && manuscriptName(data, folder) === newName)) throw new Error(`Another manuscript already uses “${newName}”. Choose a distinct manuscript name.`);
	const next = structuredClone(data);
	const move = (path: string): string => moveFolderPath(path, oldFolder, newFolder);
	const changeLabel = (label: string | undefined): string | undefined => label === oldName ? newName : label;
	// Index keys begin with a path, followed by :: and a stable suggestion/query signature.
	const moveIndexKey = (key: string): string => {
		const boundary = key.indexOf("::");
		return boundary < 0 ? move(key) : move(key.slice(0, boundary)) + key.slice(boundary);
	};
	function remapIndex<T>(index: Record<string, T>, keyFor: (key: string) => string, update: (record: T, key: string) => void): Record<string, T> {
		const result = Object.create(null) as Record<string, T>;
		for (const [key, record] of Object.entries(index)) {
			const mapped = keyFor(key);
			if (Object.prototype.hasOwnProperty.call(result, mapped)) throw new Error(`Saved records overlap at “${mapped}”. Both sets are retained.`);
			update(record, mapped);
			result[mapped] = record;
		}
		return result;
	}
	next.sceneReviewIndex = remapIndex(next.sceneReviewIndex, move, (record, key) => { if (record.notePath === oldFolder || record.notePath.startsWith(`${oldFolder}/`)) record.bookLabel = changeLabel(record.bookLabel); record.notePath = key; });
	for (const name of ["reviewDecisionIndex", "reviewerSignalIndex", "authorQueryDecisions"] as const) {
		// The three index shapes share only the key field; retain every other field unchanged.
		const index = next[name];
		const mapped = remapIndex(index as Record<string, { key: string }>, moveIndexKey, (record, key) => { record.key = key; });
		Object.assign(next, { [name]: mapped });
	}
	for (const sweep of Object.values(next.sweepRegistry)) {
		if (sweep.activeBookSourceFolder && move(sweep.activeBookSourceFolder) !== sweep.activeBookSourceFolder || sweep.activeBookSourceFolder === oldFolder) sweep.activeBookLabel = changeLabel(sweep.activeBookLabel);
		if (sweep.activeBookSourceFolder) sweep.activeBookSourceFolder = move(sweep.activeBookSourceFolder);
		sweep.importedNotePaths = sweep.importedNotePaths.map(move);
		sweep.sceneOrder = sweep.sceneOrder.map(move);
		if (sweep.currentNotePath) sweep.currentNotePath = move(sweep.currentNotePath);
		if (sweep.editorialRevisionUpdatedNotePaths) sweep.editorialRevisionUpdatedNotePaths = sweep.editorialRevisionUpdatedNotePaths.map(move);
	}
	for (const delivery of next.editorialDeliveries?.deliveries ?? []) {
		delivery.bookFolder = move(delivery.bookFolder);
		delivery.source = move(delivery.source);
		delivery.files = delivery.files.map(move);
	}
	if (next.revisionPlans) {
		next.revisionPlans.books = remapIndex(next.revisionPlans.books, (key) => {
			for (const folder of affected) if (key === folderPlanKey(folder)) return folderPlanKey(move(folder));
			return key;
		}, (plan) => {
			for (const entry of plan.entries) entry.source.path = move(entry.source.path);
			for (const target of plan.targets ?? []) {
				if (target.file.startsWith(`${oldFolder}/`)) target.bookLabel = changeLabel(target.bookLabel) ?? "";
				target.file = move(target.file);
			}
			for (const record of plan.project?.records ?? []) record.referencePath = move(record.referencePath);
			for (const material of plan.project?.materials ?? []) { material.source = move(material.source); material.exportPath = move(material.exportPath); }
			// Frozen preparation evidence remains an exact historical witness.
			for (const work of [...plan.progress?.open ?? [], ...plan.progress?.done ?? []]) {
				try { const parts: unknown = JSON.parse(work.key); if (Array.isArray(parts) && typeof parts[1] === "string") { parts[1] = move(parts[1]); work.key = JSON.stringify(parts); } } catch { /* Preserve unknown historical key formats. */ }
			}
		});
	}
	const settings = next.settings;
	settings.bookFolderOverride = move(settings.bookFolderOverride);
	settings.cutFolderOverride = move(settings.cutFolderOverride);
	if (settings.manuscriptTarget) {
		if (["folder", "note"].includes(settings.manuscriptTarget.kind)) settings.manuscriptTarget.path = move(settings.manuscriptTarget.path);
		settings.manuscriptTarget.excludedFolders = settings.manuscriptTarget.excludedFolders.map(move);
	}
	const names = settings.manuscriptNames?.folders ?? {};
	settings.manuscriptNames = { version: 1, folders: remapIndex(names, move, () => {}) };
	if (knownManuscriptFolders(data).includes(oldFolder)) settings.manuscriptNames.folders[newFolder] = newName;
	return next;
}
