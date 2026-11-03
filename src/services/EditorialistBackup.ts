// A backup of everything Editorialist keeps in data.json, written as a file
// the author can keep, and read back to restore. Notes are never in it: the
// review blocks, scenes and editorialisms live in the vault already.

import type { EditorialistPluginData } from "../models/ContributorProfile";
import { migratePluginData } from "./PluginDataMigration";

export const BACKUP_FORMAT = "editorialist-backup";
export const BACKUP_SCHEMA = 1;

export interface EditorialistBackupFile {
	format: typeof BACKUP_FORMAT;
	schema: typeof BACKUP_SCHEMA;
	savedAt: string;
	data: EditorialistPluginData;
}

export function serializeBackup(data: EditorialistPluginData, savedAt: Date): string {
	const file: EditorialistBackupFile = { format: BACKUP_FORMAT, schema: BACKUP_SCHEMA, savedAt: savedAt.toISOString(), data };
	return JSON.stringify(file, null, 2);
}

// The data a backup holds, brought up to the current version the same way
// data.json is on load. Throws with a message for the author when the file is
// not a backup this version can restore.
export function parseBackup(text: string): EditorialistPluginData {
	let file: unknown;
	try {
		file = JSON.parse(text);
	} catch {
		throw new Error("This file is not an Editorialist backup: it could not be read.");
	}
	const candidate = file as Partial<EditorialistBackupFile> | null;
	if (!candidate || typeof candidate !== "object" || candidate.format !== BACKUP_FORMAT) {
		throw new Error("This file is not an Editorialist backup. Earlier versions saved an export that cannot be restored.");
	}
	if (candidate.schema !== BACKUP_SCHEMA) {
		throw new Error("This backup was made by a newer Editorialist. Update Editorialist, then restore it.");
	}
	// Without its data a backup would restore as empty and erase everything.
	if (!candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) {
		throw new Error("This backup is damaged: it holds no Editorialist data.");
	}
	return migratePluginData(candidate.data);
}
