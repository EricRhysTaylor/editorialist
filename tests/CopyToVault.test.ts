import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyToVaults } from "../scripts/copy-to-vault.mjs";

const FILES = ["manifest.json", "main.js", "styles.css"];
const temps: string[] = [];

function tempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temps.push(dir);
	return dir;
}

function buildRoot(): string {
	const root = tempDir("editorialist-build-");
	for (const file of FILES) fs.writeFileSync(path.join(root, file), `built ${file}`);
	return root;
}

function vault(): string {
	const dir = tempDir("editorialist-vault-");
	fs.mkdirSync(path.join(dir, ".obsidian"));
	return dir;
}

afterEach(() => { for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("copy-to-vault", () => {
	it("copies the build into every present vault and skips a missing one", async () => {
		const root = buildRoot();
		const first = vault();
		const second = vault();
		const present = [first, second];
		const gone = path.join(tempDir("editorialist-gone-"), "Renamed Vault");

		const result = await copyToVaults({ root, vaults: [first, gone, second], files: FILES });

		expect(result.copied).toEqual(present);
		expect(result.missing).toEqual([gone]);
		for (const dir of present) {
			for (const file of FILES) {
				expect(fs.readFileSync(path.join(dir, ".obsidian/plugins/editorialist", file), "utf8")).toBe(`built ${file}`);
			}
		}
		// A missing vault is never created as a phantom.
		expect(fs.existsSync(gone)).toBe(false);
	});

	it("skips a folder that exists but is not a vault", async () => {
		const root = buildRoot();
		const notVault = tempDir("editorialist-notvault-");
		const real = vault();

		const result = await copyToVaults({ root, vaults: [notVault, real], files: FILES });

		expect(result.missing).toEqual([notVault]);
		expect(fs.existsSync(path.join(notVault, ".obsidian"))).toBe(false);
	});

	it("fails when no listed vault exists", async () => {
		const root = buildRoot();
		const gone = path.join(tempDir("editorialist-gone-"), "Nowhere");

		await expect(copyToVaults({ root, vaults: [gone], files: FILES })).rejects.toThrow(/None of the 1 vaults exist/);
	});
});
