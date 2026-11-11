import type { EditorialistPluginData } from "../models/ContributorProfile";

interface RestoreHost {
	flush(): Promise<void>;
	snapshot(): EditorialistPluginData;
	load(data: EditorialistPluginData): void;
	save(): Promise<void>;
}

export class BackupRestoreSaveError extends Error {}

/** Restore the prior in-memory state on save failure, unless another edit has since changed it. */
export async function restoreBackupData(host: RestoreHost, data: EditorialistPluginData): Promise<void> {
	await host.flush();
	const previous = structuredClone(host.snapshot());
	host.load(data);
	const restoring = JSON.stringify(host.snapshot());
	try {
		await host.save();
	} catch (error) {
		if (JSON.stringify(host.snapshot()) !== restoring) {
			throw new BackupRestoreSaveError("The backup could not be saved and other work changed during the restore. Restart Editorialist and check your saved work before trying again.");
		}
		host.load(previous);
		throw new BackupRestoreSaveError("The backup could not be saved. The previous in-memory data was restored; restart Editorialist and check your saved work before trying again.");
	}
}
