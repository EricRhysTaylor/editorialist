import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TEXT_PROPERTIES = new Set(["text", "title", "label", "name", "desc", "description", "placeholder", "aria-label", "completionLabel", "selectedIndexLabel", "remainingLabel", "currentIndexLabel", "countLabel", "keys"]);
const TEXT_ARGUMENTS = new Map([["setText", 0], ["setName", 0], ["setDesc", 0], ["setTitle", 0], ["setTooltip", 0], ["setAccessibleLabel", 1], ["setPlaceholder", 0], ["setButtonText", 0], ["buildButton", 2], ["buildActionButton", 1], ["buildFlatIconButton", 1], ["renderMetaSegment", 1], ["addRibbonIcon", 1]]);
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
const literal = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
const nameOf = node => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : "";

function filesUnder(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const file = path.join(dir, entry.name);
		return entry.isDirectory() ? filesUnder(file) : [file];
	});
}

function catalog(file) {
	const entries = new Map();
	const ast = parse(file, fs.readFileSync(file, "utf8"));
	walk(ast, node => {
		if (!ts.isPropertyAssignment(node)) return;
		const key = nameOf(node.name);
		if (!key || !literal(node.initializer)) throw new Error(`Catalog entries must be named literal strings: ${file}`);
		if (entries.has(key)) throw new Error(`Duplicate key ${key}: ${file}`);
		if (!node.initializer.text.trim()) throw new Error(`Empty message ${key}: ${file}`);
		for (const match of node.initializer.text.matchAll(/\{\{([^{}]*)\}\}/g)) {
			if (!/^[A-Za-z][A-Za-z0-9]*$/.test(match[1])) throw new Error(`Invalid placeholder in ${key}: ${file}`);
		}
		entries.set(key, node.initializer.text);
	});
	if (entries.size === 0) throw new Error(`Empty catalog: ${file}`);
	return entries;
}

const protectedTokens = text => [...text.matchAll(/\{\{[^{}]+\}\}|%%[^%]+%%|`[^`]+`/g)].map(match => match[0]).sort().join("\n");

/** Candidates at known UI call sites, not every string in a source file. */
function textCandidates(ast) {
	const candidates = new Set();
	function add(node) {
		if (!node) return;
		if ((literal(node) || ts.isTemplateExpression(node)) && /[A-Za-z]/.test(node.getText(ast))) candidates.add(node);
		else if (ts.isConditionalExpression(node)) { add(node.whenTrue); add(node.whenFalse); }
		else if (ts.isBinaryExpression(node)) { add(node.left); add(node.right); }
	}
	walk(ast, node => {
		// Parameter values may contain author names or literal protocol text.
		// They are data, not an untranslated interface-message definition.
		for (let parent = node.parent; parent; parent = parent.parent) {
			if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && ["t", "tCount"].includes(parent.expression.text)) return;
		}
		if (ts.isPropertyAssignment(node) && TEXT_PROPERTIES.has(nameOf(node.name))) add(node.initializer);
		if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && ["textContent", "ariaLabel", "title", "placeholder"].includes(node.left.name.text)) add(node.right);
		if (ts.isNewExpression(node) && node.expression.getText(ast) === "Notice") add(node.arguments?.[0]);
		if (!ts.isCallExpression(node)) return;
		const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.getText(ast);
		const argument = TEXT_ARGUMENTS.get(name);
		if (argument !== undefined) add(node.arguments[argument]);
		if (name === "setAttribute" && node.arguments[0] && literal(node.arguments[0]) && ["aria-label", "title", "placeholder"].includes(node.arguments[0].text)) add(node.arguments[1]);
	});
	return [...candidates];
}

export function checkI18n(root, release = false) {
	const errors = [];
	const localeDir = path.join(root, "src/i18n/locales");
	const english = catalog(path.join(localeDir, "en.ts"));
	const catalogs = filesUnder(localeDir).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts"));
	for (const file of catalogs) {
		const translated = catalog(file);
		for (const [key, text] of english) {
			const value = translated.get(key);
			if (value === undefined) errors.push(`${path.basename(file)}: missing ${key}`);
			else if (protectedTokens(text) !== protectedTokens(value)) errors.push(`${path.basename(file)}: changed protected tokens in ${key}`);
		}
		for (const key of translated.keys()) if (!english.has(key)) errors.push(`${path.basename(file)}: unknown ${key}`);
	}
	const scope = JSON.parse(fs.readFileSync(path.join(root, "scripts/i18n-scope.json"), "utf8"));
	const migrated = new Set(scope.migratedFiles);
	const used = new Set();
	const inventory = [];
	for (const file of filesUnder(path.join(root, "src")).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".fixtures.ts") && !file.includes(`${path.sep}i18n${path.sep}`))) {
		const relative = path.relative(root, file).split(path.sep).join("/");
		const ast = parse(file, fs.readFileSync(file, "utf8"));
		walk(ast, node => {
			if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !["t", "tCount"].includes(node.expression.text)) return;
			const keyNode = node.arguments[0];
			if (!keyNode || !literal(keyNode)) { errors.push(`${relative}: message keys must be literals`); return; }
			const keys = node.expression.text === "tCount" ? [keyNode.text + ".one", keyNode.text + ".other"] : [keyNode.text];
			for (const key of keys) { used.add(key); if (!english.has(key)) errors.push(`${relative}: unknown message key ${key}`); }
		});
		const candidates = textCandidates(ast);
		if (candidates.length) inventory.push({ file: relative, candidates: candidates.length });
		if (migrated.has(relative)) {
			migrated.delete(relative);
			for (const node of candidates) errors.push(`${relative}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: untranslated UI text ${node.getText(ast)}`);
		}
	}
	for (const file of migrated) errors.push(`Missing migrated source file: ${file}`);
	for (const key of english.keys()) if (!used.has(key)) errors.push(`Unused English message key: ${key}`);
	if (release) {
		const bundle = fs.readFileSync(path.join(root, "main.js"), "utf8");
		for (const sentinel of ["commands.openAuthorPlanner", "toolbar.applyOperation", "panel.actions"]) {
			if (!bundle.includes(sentinel)) errors.push(`Built main.js is missing catalog sentinel ${sentinel}`);
		}
	}
	return { errors, englishKeys: english.size, catalogs: catalogs.length, migratedFiles: scope.migratedFiles.length, inventory: inventory.sort((a, b) => b.candidates - a.candidates) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const result = checkI18n(process.cwd(), process.argv.includes("--release"));
		if (process.argv.includes("--inventory")) console.log(JSON.stringify(result, null, 2));
		else {
			console.log(`[i18n] ${result.englishKeys} English keys; ${result.catalogs} catalog; ${result.migratedFiles} migrated files.`);
			console.log(`[i18n] Remaining known-site candidates: ${result.inventory.reduce((total, file) => total + file.candidates, 0)} across ${result.inventory.length} files. This is a partial migration.`);
			for (const error of result.errors) console.error(error);
		}
		process.exitCode = result.errors.length ? 1 : 0;
	} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
