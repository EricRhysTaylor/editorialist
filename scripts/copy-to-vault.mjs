import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vault roots that receive every dev build: the same vaults Radial Timeline's
// dev build copies into (radial-timeline/esbuild.config.mjs), so Editorialist
// never lags RT in a demo or test vault, plus the Editorialist capture vault
// the wiki screenshots come from. Eric's instruction, November 10, 2026. Copying
// installs the files only; a vault that never enabled Editorialist keeps it off.
// Demo packages take an explicit list of content files, never .obsidian, so
// nothing here reaches a published download.
export const TARGET_VAULTS = [
	"/Users/ericrhystaylor/Obsidian Vault Author",
	"/Users/ericrhystaylor/Documents/Author Eric Rhys Taylor/Obsidian Vault Author timelapse",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/Test Vaults/Obsidian Vault New",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/Test Vaults/Obsidian Vault Fresh",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/Test Vaults/Obsidian Vault Sherlock Holmes",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Plugin/Test Vaults/Obsidian Vault Pride & Prejudice Demo",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Demo Vaults/Obsidian Vault Pride & Prejudice Demo",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Demo Vaults/Obsidian Vault Sherlock Holmes Demo",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Demo Vaults/Obsidian Vault The Faerie Queene Demo",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Demo Vaults/Obsidian Vault Odyssey Demo",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Demo Vaults/Obsidian Vault Miki Projects",
	"/Users/ericrhystaylor/Documents/Radial Timeline LLC/Demo Vaults/Testing Vaults/Scrivener Onboarding Test",
	"/Users/ericrhystaylor/Obsidian Capture/Editorialist Capture Vault",
];
export const FILES_TO_COPY = ["manifest.json", "main.js", "styles.css"];

async function isVault(vault) {
	try {
		await access(path.join(vault, ".obsidian"));
		return true;
	} catch {
		return false;
	}
}

/**
 * Copies the built plugin into every listed vault that exists. A renamed,
 * moved or not-yet-synced vault is skipped and named, never created: making the
 * plugin folder under a path that no longer is a vault would build a phantom
 * vault and report a copy nobody will ever load. One missing vault does not
 * keep the build from the others. If none of the vaults exist, that fails.
 */
export async function copyToVaults({ root, vaults = TARGET_VAULTS, files = FILES_TO_COPY }) {
	const copied = [];
	const missing = [];
	for (const vault of vaults) {
		if (!(await isVault(vault))) {
			missing.push(vault);
			continue;
		}
		const targetDir = path.join(vault, ".obsidian", "plugins", "editorialist");
		await mkdir(targetDir, { recursive: true });
		for (const fileName of files) {
			await copyFile(path.join(root, fileName), path.join(targetDir, fileName));
		}
		copied.push(vault);
	}
	if (copied.length === 0) {
		throw new Error(`[copy:dev] None of the ${vaults.length} vaults exist — update TARGET_VAULTS in scripts/copy-to-vault.mjs.`);
	}
	return { copied, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { copied, missing } = await copyToVaults({ root: process.cwd() });
	console.log(`[copy:dev] Copied plugin to ${copied.length} of ${TARGET_VAULTS.length} vaults: ${copied.map((vault) => `"${path.basename(vault)}"`).join(", ")}`);
	if (missing.length > 0) {
		console.warn(`[copy:dev] SKIPPED ${missing.length} missing vault${missing.length === 1 ? "" : "s"} (no .obsidian folder; not updated):`);
		for (const vault of missing) console.warn(`[copy:dev]   ${vault}`);
		console.warn("[copy:dev] If a vault was renamed or moved, update TARGET_VAULTS in scripts/copy-to-vault.mjs.");
	}
}
