import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CSS_FILES = collectCssFiles(ROOT);

const ALLOWED_ROOT_CLASSES = [".editorialist-", ".ert-", ".rt-", ".radial-timeline-"];

const DISALLOWED_BARE_SELECTORS = new Set([
	"button",
	"input",
	"select",
	"textarea",
	"label",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"ul",
	"ol",
	"li",
]);

const SUSPICIOUS_GLOBAL_SELECTORS = [
	".modal",
	".menu",
	".workspace-leaf",
	".workspace-tabs",
	".view-content",
	".markdown-source-view",
	".cm-editor",
	".cm-content",
	".cm-line",
	".setting-item",
];

let hasError = false;

for (const file of CSS_FILES) {
	const css = fs.readFileSync(file, "utf8");
	auditScannerCompatibility(file, css);
	const blocks = extractSelectorBlocks(css);

	for (const block of blocks) {
		const selectors = splitSelectors(block.selector);

		for (const selector of selectors) {
			auditSelector(file, selector.trim());
		}
	}
}

if (hasError) {
	process.exit(1);
}

console.log("CSS audit passed.");

function auditSelector(file, selector) {
	if (!selector || selector.startsWith("@")) {
		return;
	}

	const normalized = selector.replace(/\s+/g, " ").trim();

	checkBareSelector(file, normalized);
	checkSuspiciousGlobals(file, normalized);
	checkUnprefixedClasses(file, normalized);
}

function checkBareSelector(file, selector) {
	const firstToken = selector
		.replace(/::?[a-zA-Z-]+(\(.+?\))?/g, "")
		.trim()
		.split(/[\s>+~]+/)[0];

	if (!firstToken) {
		return;
	}

	if (DISALLOWED_BARE_SELECTORS.has(firstToken)) {
		fail(
			file,
			selector,
			`Bare element selector "${firstToken}" is not allowed. Scope it under an Editorialist root class.`,
		);
	}
}

function checkSuspiciousGlobals(file, selector) {
	for (const suspicious of SUSPICIOUS_GLOBAL_SELECTORS) {
		if (selector.includes(suspicious) && !hasEditorialistScope(selector)) {
			fail(
				file,
				selector,
				`Suspicious global selector "${suspicious}" must be scoped under an Editorialist root class.`,
			);
		}
	}
}

function checkUnprefixedClasses(file, selector) {
	const classMatches = selector.match(/\.[a-zA-Z0-9_-]+/g) || [];
	for (const className of classMatches) {
		if (
			className.startsWith(".editorialist-") ||
			className.startsWith(".ert-") ||
			className.startsWith(".is-") ||
			className.startsWith(".has-") ||
			className.startsWith(".rt-") ||
			className.startsWith(".radial-timeline-") ||
			className.startsWith(".mod-") ||
			className.startsWith(".theme-")
		) {
			continue;
		}

		if (SUSPICIOUS_GLOBAL_SELECTORS.includes(className)) {
			continue;
		}

		fail(
			file,
			selector,
			`Unapproved class "${className}" found. Use an approved namespace such as "editorialist-", "ert-", legacy "rt-"/"radial-timeline-", or state prefixes "is-"/"has-".`,
		);
	}
}

// Obsidian's community review scan reports these as only partially
// supported. They were cleared for 3.0.1 (and before it in 455a92b), then
// crept back twice through new styling, because nothing local caught them.
//   - any text-decoration-* longhand (color, style, thickness, line, …)
//   - a multi-value text-decoration shorthand such as `underline wavy red`;
//     a single keyword (`line-through`, `underline`, `none`) is fine
//   - the :has() selector
// Use a single-keyword shorthand, or a border-bottom for styled underlines.
function auditScannerCompatibility(file, css) {
	const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
	const lineOf = (index) => source.slice(0, index).split("\n").length;
	for (const match of source.matchAll(/(^|[;{\s])(text-decoration-[a-z-]+)\s*:/g)) {
		failAt(file, lineOf(match.index), `"${match[2]}" is flagged by Obsidian's review scan as partially supported. Use a single-keyword text-decoration, or a border-bottom for a styled underline.`);
	}
	for (const match of source.matchAll(/(^|[;{\s])text-decoration\s*:\s*([^;}]+)/g)) {
		const value = match[2].trim().replace(/\s*!important$/, "");
		if (/\s/.test(value.replace(/\([^)]*\)/g, ""))) {
			failAt(file, lineOf(match.index), `Multi-value "text-decoration: ${value}" is flagged by Obsidian's review scan. Keep the shorthand to one keyword.`);
		}
	}
	for (const match of source.matchAll(/:has\(/g)) {
		failAt(file, lineOf(match.index), `":has()" is flagged by Obsidian's review scan. Toggle a class from code instead.`);
	}
}

function failAt(file, line, message) {
	hasError = true;
	console.error(`\n[css-audit] ${path.relative(ROOT, file)}:${line}`);
	console.error(`  Error: ${message}`);
}

function hasEditorialistScope(selector) {
	return ALLOWED_ROOT_CLASSES.some((prefix) => selector.includes(prefix));
}

function fail(file, selector, message) {
	hasError = true;
	console.error(`\n[css-audit] ${path.relative(ROOT, file)}`);
	console.error(`  Selector: ${selector}`);
	console.error(`  Error: ${message}`);
}

function collectCssFiles(dir) {
	const results = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
			continue;
		}

		const fullPath = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			results.push(...collectCssFiles(fullPath));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith(".css")) {
			results.push(fullPath);
		}
	}

	return results;
}

function extractSelectorBlocks(css) {
	const results = [];
	const regex = /([^{}]+)\{/g;
	let match;

	while ((match = regex.exec(css)) !== null) {
		const selector = match[1]?.trim();

		if (
			!selector ||
			selector.startsWith("@") ||
			selector.includes("from") ||
			selector.includes("to") ||
			/^\d+%/.test(selector)
		) {
			continue;
		}

		results.push({ selector });
	}

	return results;
}

function splitSelectors(selectorGroup) {
	return selectorGroup
		.split(",")
		.map((selector) => selector.trim())
		.filter(Boolean);
}
