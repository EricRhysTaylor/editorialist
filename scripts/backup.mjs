import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const messageInput = args.filter((arg) => arg !== "--dry-run").join(" ").trim();
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const backupStampPath = path.join(repoRoot, ".git", "editorialist-last-backup.json");
const PRIMARY_BRANCH = "main";

function safe(command) {
	try {
		return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

function run(command) {
	console.log(`\n[backup] ${command}`);

	if (dryRun) {
		return;
	}

	execSync(command, { stdio: "inherit" });
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function assertRemoteCanFastForward(branch, phase) {
	if (dryRun) {
		return;
	}

	execSync("git fetch origin", { stdio: "inherit" });
	const remoteRef = `origin/${branch}`;
	if (!safe(`git rev-parse --verify --quiet ${shellQuote(remoteRef)}`)) {
		throw new Error(`Remote tracking branch ${remoteRef} does not exist.`);
	}

	const counts = safe(`git rev-list --left-right --count ${shellQuote(`HEAD...${remoteRef}`)}`);
	const [aheadText = "0", behindText = "0"] = counts.split(/\s+/);
	const ahead = Number(aheadText);
	const behind = Number(behindText);
	if (behind > 0) {
		const state = ahead > 0 ? `diverged (${ahead} ahead, ${behind} behind)` : `behind by ${behind}`;
		throw new Error(
			`Refusing backup ${phase}: local ${branch} is ${state} relative to ${remoteRef}. ` +
			`Run "git pull --rebase origin ${branch}" and resolve conflicts first.`,
		);
	}
}

function ensureGitReady() {
	if (!safe("git --version")) {
		throw new Error("Git is not available in this environment.");
	}

	if (!safe("git rev-parse --is-inside-work-tree")) {
		throw new Error("This directory is not inside a git repository.");
	}

	if (!safe("git remote get-url origin")) {
		throw new Error('No "origin" remote is configured for this repository.');
	}
}

function createMessage() {
	if (messageInput) {
		return messageInput;
	}

	return `backup: ${new Date().toISOString().replace("T", " ").replace(/\..+/, "")}`;
}

function writeBackupStamp(branch) {
	if (dryRun) {
		return;
	}

	mkdirSync(path.dirname(backupStampPath), { recursive: true });
	writeFileSync(
		backupStampPath,
		JSON.stringify(
			{
				branch,
				backedUpAt: new Date().toISOString(),
			},
			null,
			2,
		),
		"utf8",
	);
}

try {
	ensureGitReady();

	const branch = safe("git rev-parse --abbrev-ref HEAD");
	if (branch !== PRIMARY_BRANCH) {
		throw new Error(`Backups must run from '${PRIMARY_BRANCH}'. Current branch: '${branch || "unknown"}'.`);
	}
	assertRemoteCanFastForward(branch, "before commit");
	const status = safe("git status --porcelain");

	if (!status) {
		console.log("[backup] No changes to commit.");
		process.exit(0);
	}

	const message = createMessage();
	run("git add -A");
	run(`git commit -m ${shellQuote(message)}`);
	assertRemoteCanFastForward(branch, "before push");
	run(`git push origin ${shellQuote(branch)}`);
	writeBackupStamp(branch);

	console.log(`\n[backup] Done. ${dryRun ? `Would push to ${branch}.` : `Pushed to ${branch}.`}`);
} catch (error) {
	const message = error instanceof Error ? error.message : "Backup failed.";
	console.error(`[backup] ${message}`);
	process.exit(1);
}
