import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
// Vault roots that receive every dev build. The canonical demo vaults under
// Demo Vaults/ are deliberately absent: they ship pinned releases and are
// curated content, not test beds.
const TARGET_VAULTS = [
	"/Users/ericrhystaylor/Obsidian Vault Author",
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

	console.log(`[copy:dev] Copied plugin to ${TARGET_VAULTS.map((vault) => `"${path.basename(vault)}"`).join(" and ")}`);
}

await main();
