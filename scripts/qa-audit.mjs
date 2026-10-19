import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SVG_TAGS = new Set([
	"svg",
	"g",
	"path",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"rect",
	"text",
	"textpath",
	"defs",
	"mask",
	"pattern",
	"lineargradient",
	"radialgradient",
	"stop",
	"symbol",
	"use",
	"clippath",
]);
const FILES = collectFiles(ROOT);

let hasError = false;

for (const file of FILES) {
	const text = fs.readFileSync(file, "utf8");
	checkControlBytes(file, text);
	if (file.endsWith(".ts") && !file.endsWith(".test.ts")) checkNativeTooltips(file, text);
	const lines = text.split(/\r?\n/);

	lines.forEach((line, index) => {
		const lineNumber = index + 1;
		const safe = line.includes("// SAFE:");

		checkPattern(file, lineNumber, line, /\.innerHTML\b/, safe, "Use textContent or DOM nodes instead of innerHTML.");
		checkPattern(file, lineNumber, line, /\.className\s*=/, safe, "Use classList methods instead of assigning className.");
		checkPattern(file, lineNumber, line, /(?:\:\s*any\b|\bas any\b|<any>)/, safe, "Avoid any; use a specific type or add a same-line SAFE comment.");
		checkPattern(file, lineNumber, line, /\.openFile\(/, safe, "Use workspace.openLinkText(...) instead of openFile(), or add a same-line SAFE comment.");
		checkPattern(file, lineNumber, line, /\.setAttribute\(\s*['\"]style['\"]/, safe, "Keep styling in CSS classes instead of inline style attributes.");

		checkStyleUsage(file, lineNumber, line, safe);
		checkSvgCreation(file, lineNumber, line, safe);
	});
}

if (hasError) {
	process.exit(1);
}

console.log("QA audit passed.");

// A raw control byte (most likely a NUL that should have been the escape
// "\0") makes grep and file(1) treat the whole source file as binary, so
// every grep-driven check silently skips it. Tabs, newlines, and carriage
// returns are the only control characters a source file legitimately holds.
function checkControlBytes(file, text) {
	const match = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
	if (!match || match.index === undefined) {
		return;
	}
	const lineNumber = text.slice(0, match.index).split("\n").length;
	const code = match[0].charCodeAt(0).toString(16).padStart(2, "0");
	const line = text.split(/\r?\n/)[lineNumber - 1] ?? "";
	fail(file, lineNumber, line, `Raw control byte 0x${code} in source. Use an escape sequence such as "\\0" instead.`);
}

// Obsidian renders aria-label as a tooltip. A native title adds a second,
// independently timed browser tooltip; all hover help uses Obsidian only.
function checkNativeTooltips(file, text) {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const name = (node) => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : "";
	const report = (node) => {
		const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
		fail(file, line + 1, text.split(/\r?\n/)[line], "Do not create native title tooltips. Use accessible names without hover, or one explanatory Obsidian tooltip.");
	};
	const visit = (node) => {
		if (ts.isPropertyAssignment(node) && name(node.name) === "attr" && ts.isObjectLiteralExpression(node.initializer)) {
			for (const property of node.initializer.properties) if (ts.isPropertyAssignment(property) && name(property.name) === "title") report(property);
		}
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
			const method = node.expression.name.text;
			if (["setAttr", "setAttribute"].includes(method) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "title") report(node);
			if (method === "setAttrs" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
				for (const property of node.arguments[0].properties) if (ts.isPropertyAssignment(property) && name(property.name) === "title") report(property);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
}

function checkStyleUsage(file, lineNumber, line, safe) {
	if (/\.style\.[A-Za-z_$][\w$]*\s*=/.test(line) && !safe) {
		fail(file, lineNumber, line, "Avoid inline style property assignment. Use classes or CSS variables instead.");
		return;
	}

	const setPropertyMatch = line.match(/\.style\.setProperty\(\s*(['"`])([^'"`]+)\1/);
	if (setPropertyMatch && !safe) {
		const propertyName = setPropertyMatch[2];
		if (!propertyName.startsWith("--")) {
			fail(file, lineNumber, line, "Only CSS variable setProperty(...) calls are allowed without a SAFE comment.");
		}
	}

	const removePropertyMatch = line.match(/\.style\.removeProperty\(\s*(['"`])([^'"`]+)\1/);
	if (removePropertyMatch && !safe) {
		const propertyName = removePropertyMatch[2];
		if (!propertyName.startsWith("--")) {
			fail(file, lineNumber, line, "Only CSS variable removeProperty(...) calls are allowed without a SAFE comment.");
		}
	}
}

function checkSvgCreation(file, lineNumber, line, safe) {
	const match = line.match(/createElement\(\s*(['"`])([a-z0-9:-]+)\1/);
	if (!match || safe) {
		return;
	}

	const tagName = match[2].toLowerCase();
	if (SVG_TAGS.has(tagName)) {
		fail(file, lineNumber, line, `Use createElementNS(...) for SVG tag "${tagName}".`);
	}
}

function checkPattern(file, lineNumber, line, pattern, safe, message) {
	if (pattern.test(line) && !safe) {
		fail(file, lineNumber, line, message);
	}
}

function fail(file, lineNumber, line, message) {
	hasError = true;
	console.error(`\n[qa-audit] ${path.relative(ROOT, file)}:${lineNumber}`);
	console.error(`  ${message}`);
	console.error(`  ${line.trim()}`);
}

function collectFiles(dir) {
	const results = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
			continue;
		}

		const fullPath = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			results.push(...collectFiles(fullPath));
			continue;
		}

		if (entry.isFile() && isAuditedSourceFile(fullPath, entry.name)) {
			results.push(fullPath);
		}
	}

	return results;
}

function isAuditedSourceFile(fullPath, fileName) {
	const relativePath = path.relative(ROOT, fullPath);
	if (relativePath === "main.js" || relativePath === path.join("scripts", "qa-audit.mjs")) {
		return false;
	}

	if (relativePath.startsWith(`scripts${path.sep}`) && fileName.endsWith(".mjs")) {
		return true;
	}

	if (relativePath.startsWith(`src${path.sep}`) && fileName.endsWith(".ts")) {
		return true;
	}

	if (fileName === "eslint.config.mjs" || fileName === "esbuild.config.mjs" || fileName === "stylelint.config.mjs") {
		return true;
	}

	return false;
}
