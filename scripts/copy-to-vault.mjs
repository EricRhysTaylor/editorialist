import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
// Vault roots that receive every dev build: the same vaults Radial Timeline's
// dev build copies into (radial-timeline/esbuild.config.mjs), so Editorialist
// never lags RT in a demo or test vault, plus the Editorialist capture vault
// the wiki screenshots come from. Eric's instruction, November 10, 2026. Copying
// installs the files only; a vault that never enabled Editorialist keeps it off.
// Demo packages take an explicit list of content files, never .obsidian, so
// nothing here reaches a published download.
const TARGET_VAULTS = [
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
const FILES_TO_COPY = ["manifest.json", "main.js", "styles.css"];

async function main() {
	// A renamed or moved vault must fail the build. Creating the plugin folder
	// under a path that no longer is a vault builds a phantom vault and reports
	// a copy nobody will ever load.
	for (const vault of TARGET_VAULTS) {
		try {
			await access(path.join(vault, ".obsidian"));
		} catch {
			throw new Error(`[copy:dev] Not an Obsidian vault: ${vault} — update TARGET_VAULTS in scripts/copy-to-vault.mjs.`);
		}
	}

	for (const vault of TARGET_VAULTS) {
		const targetDir = path.join(vault, ".obsidian", "plugins", "editorialist");
		await mkdir(targetDir, { recursive: true });
		for (const fileName of FILES_TO_COPY) {
			await copyFile(path.join(ROOT, fileName), path.join(targetDir, fileName));
		}
	}

	console.log(`[copy:dev] Copied plugin to ${TARGET_VAULTS.length} vaults: ${TARGET_VAULTS.map((vault) => `"${path.basename(vault)}"`).join(", ")}`);
}

await main();
