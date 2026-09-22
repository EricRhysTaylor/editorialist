import { normalizePath, TFile, type App } from "obsidian";
import {
	getSuggestionPrimaryTarget,
	isMoveSuggestion,
} from "./OperationSupport";
import {
	appendBlockToNote,
	createReviewBlock,
	normalizeImportedReviewText,
	stripAllReviewBlocks,
} from "./ReviewBlockFormat";
import {
	getActiveNoteScopeRoot,
	getSceneIdForFile,
	isPathInFolderScope,
	isSceneClassFile,
	matchesSceneId,
	readRadialTimelineActiveBookScope,
} from "./VaultScope";
import { countNormalizedMatches, findExactMatches } from "./TextMatching";
import type { MatchEngine } from "./MatchEngine";
import type { SuggestionParser } from "./SuggestionParser";
import type {
	ReviewImportBatch,
	ReviewImportNoteGroup,
	ReviewImportSuggestionResult,
	ReviewImportSummary,
	ReviewProposedCorrection,
	ReviewRouteStrategy,
	ReviewUnroutedMemo,
} from "../models/ReviewImport";
import type {
	ParsedReviewDocument,
	ReviewSuggestion,
	ReviewSuggestionRouting,
	SceneMemo,
	SupportedReviewOperationType,
} from "../models/ReviewSuggestion";

interface ResolvedFileMatch {
	file?: TFile;
	reason: string;
	status: "resolved" | "mismatch" | "unresolved";
	strategy: ReviewRouteStrategy;
}

interface ReviewMetadata {
	model?: string;
	provider?: string;
	reviewer: string;
	reviewerType: ReviewSuggestion["contributor"]["reviewerType"];
}

interface InspectBatchOptions {
	activeNotePath?: string;
	// suggestion.id → target note path. Author-confirmed re-targets for entries
	// whose declared SceneId pointed at the wrong scene. Suggestion ids are
	// deterministic for identical raw text, so the map survives a re-parse.
	correctedTargets?: ReadonlyMap<string, string>;
}

interface TextMatchCounts {
	exactCount: number;
	normalizedCount: number;
}

export class ImportEngine {
	constructor(
		private readonly app: App,
		private readonly parser: SuggestionParser,
		private readonly matchEngine: MatchEngine,
		// The configured manuscript/book folder ("" when unset). Used as the
		// scope root when Radial Timeline is not driving the active book, so
		// non-RT authors get the same book-bounded routing. Defaults to unset so
		// existing call sites and tests need no change.
		private readonly getConfiguredBookFolder: () => string = () => "",
	) {}

	parseBatch(rawText: string): ParsedReviewDocument {
		const normalizedText = normalizeImportedReviewText(rawText);
		return this.parser.parse(normalizedText ?? rawText);
	}

	async inspectBatch(rawText: string, options?: InspectBatchOptions): Promise<ReviewImportBatch> {
		const normalizedBatchText = normalizeImportedReviewText(rawText) ?? rawText.trim();
		const contentHash = this.createContentHash(normalizedBatchText);
		const createdAt = Date.now();
		const parsedDocument = this.parseBatch(rawText);
		const results: ReviewImportSuggestionResult[] = [];
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const bookScope = await this.resolveBookScope();
		const scopeFiles = this.getActiveBookScopeFiles(options?.activeNotePath, markdownFiles, bookScope);
		const noteTextCache = new Map<string, string>();

		const activeNotePath = options?.activeNotePath;
		const correctedTargets = options?.correctedTargets;
		for (const suggestion of parsedDocument.suggestions) {
			results.push(
				await this.inspectSuggestion(
					suggestion,
					markdownFiles,
					scopeFiles,
					noteTextCache,
					bookScope.declaredFolder,
					activeNotePath,
					correctedTargets,
				),
			);
		}

		const groups = this.buildGroups(results);
		const unroutedMemos = this.routeMemosToGroups(
			parsedDocument.memos,
			groups,
			markdownFiles,
			scopeFiles,
			bookScope.declaredFolder,
			activeNotePath,
		);
		const summary = this.buildSummary(results, groups, parsedDocument.memos.length, unroutedMemos.length);

		return {
			batchId: `batch-${createdAt.toString(36)}-${contentHash.slice(0, 8)}`,
			contentHash,
			createdAt,
			rawText,
			results,
			groups,
			unroutedMemos,
			summary,
		};
	}

	async importBatch(batch: ReviewImportBatch): Promise<ReviewImportNoteGroup[]> {
		const importedGroups: ReviewImportNoteGroup[] = [];

		for (const group of batch.groups) {
			if (!group.isReady) {
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(group.filePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			const block = this.serializeGroup(batch.batchId, batch.createdAt, group);
			await this.app.vault.process(file, (currentText) => appendBlockToNote(currentText, block));
			importedGroups.push(group);
		}

		return importedGroups;
	}

	private async inspectSuggestion(
		suggestion: ReviewSuggestion,
		markdownFiles: TFile[],
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
		declaredScopeFolder: string | null,
		activeNotePath?: string,
		correctedTargets?: ReadonlyMap<string, string>,
	): Promise<ReviewImportSuggestionResult> {
		const resolvedFileMatch = await this.resolveFileForSuggestion(
			suggestion,
			markdownFiles,
			scopeFiles,
			noteTextCache,
			declaredScopeFolder,
			activeNotePath,
			correctedTargets,
		);

		if (!resolvedFileMatch.file) {
			return {
				suggestion,
				routeStatus: resolvedFileMatch.status,
				routeStrategy: resolvedFileMatch.strategy,
				routeReason: resolvedFileMatch.reason,
				verificationStatus: "note_unresolved",
				verificationReason: "Target note is unresolved.",
			};
		}

		const resolvedFile = resolvedFileMatch.file;
		const noteText = await this.readNoteText(resolvedFile, noteTextCache);
		const matchedSuggestion = this.matchEngine.matchSuggestion(noteText, suggestion);
		const verification = this.classifyVerification(matchedSuggestion);

		const proposedCorrection =
			resolvedFileMatch.strategy === "declared_scene_id" && verification.status === "none"
				? await this.detectProposedCorrection(suggestion, resolvedFile, scopeFiles, noteTextCache)
				: undefined;

		return {
			suggestion: matchedSuggestion,
			resolvedPath: resolvedFile.path,
			resolvedNoteTitle: resolvedFile.basename,
			routeStatus: resolvedFileMatch.status,
			routeStrategy: resolvedFileMatch.strategy,
			routeReason: resolvedFileMatch.reason,
			verificationStatus: verification.status,
			verificationReason: verification.reason,
			proposedCorrection,
		};
	}

	// The declared SceneId resolved to exactly one scene, but the quoted text
	// is not there. If that same verbatim text lives in exactly one OTHER scene
	// in the active book, the AI almost certainly stamped a stale/wrong id.
	// Reuse the existing exact+unique inference gate so a near-duplicate passage
	// across scenes never produces a false correction.
	private async detectProposedCorrection(
		suggestion: ReviewSuggestion,
		declaredFile: TFile,
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
	): Promise<ReviewProposedCorrection | undefined> {
		const inferred = await this.inferFileForSuggestion(suggestion, scopeFiles, noteTextCache);
		if (
			!inferred?.file ||
			inferred.strategy !== "inferred_exact" ||
			inferred.file.path === declaredFile.path
		) {
			return undefined;
		}

		const declaredSceneId = suggestion.routing?.sceneId?.trim() || undefined;
		return {
			declaredSceneId,
			declaredPath: declaredFile.path,
			declaredNoteTitle: declaredFile.basename,
			targetPath: inferred.file.path,
			targetNoteTitle: inferred.file.basename,
			targetSceneId: getSceneIdForFile(this.app, inferred.file),
			reason: `Declared ${
				declaredSceneId ? `SceneId ${declaredSceneId}` : "scene"
			} resolves to ${declaredFile.basename}, but the quoted text was not found there. It matches exactly and uniquely in ${inferred.file.basename}.`,
		};
	}

	private async resolveFileForSuggestion(
		suggestion: ReviewSuggestion,
		markdownFiles: TFile[],
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
		declaredScopeFolder: string | null,
		activeNotePath?: string,
		correctedTargets?: ReadonlyMap<string, string>,
	): Promise<ResolvedFileMatch> {
		const correctedPath = correctedTargets?.get(suggestion.id);
		if (correctedPath) {
			const correctedFile = this.app.vault.getAbstractFileByPath(correctedPath);
			if (correctedFile instanceof TFile) {
				return {
					file: correctedFile,
					status: "resolved",
					strategy: "corrected_target",
					reason: `Re-targeted by author to ${correctedFile.basename}.`,
				};
			}
		}

		const declared = this.resolveDeclaredRoute(suggestion.routing, markdownFiles, declaredScopeFolder);
		if (declared.match) {
			return declared.match;
		}
		const sceneIdFailureReason = declared.sceneIdFailureReason;

		const inferredMatch = await this.inferFileForSuggestion(suggestion, scopeFiles, noteTextCache);
		if (inferredMatch) {
			return {
				...inferredMatch,
				reason: this.combineRoutingReasons(sceneIdFailureReason, inferredMatch.reason),
			};
		}

		// Fallback: use the active note when nothing else routes the suggestion.
		// Common case: AI emits descriptive Targets for CONDENSE/CUT/MOVE that don't anchor in scene text,
		// or hallucinated SceneIds. The user is reviewing the active scene — route the suggestion there
		// so it surfaces in the embed and side panel as advisory rather than getting silently dropped.
		const activeFallback = this.resolveActiveNoteFallback(activeNotePath, scopeFiles);
		if (activeFallback) {
			return {
				file: activeFallback,
				status: "resolved",
				strategy: "fallback_active_note",
				reason: this.combineRoutingReasons(
					sceneIdFailureReason,
					`Routed to the active note (${activeFallback.basename}) as a fallback; verify the suggestion manually.`,
				),
			};
		}

		if (sceneIdFailureReason) {
			return {
				status: "unresolved",
				strategy: "declared_scene_id",
				reason: this.combineRoutingReasons(
					sceneIdFailureReason,
					scopeFiles.length > 0
						? "No Path, Note, or safe inferred scene match could be resolved."
						: "No Path or Note hint could be resolved, and no active-book scene scope was available for inferred matching.",
				),
			};
		}

		return {
			status: "unresolved",
			strategy: "unresolved",
			reason:
				scopeFiles.length > 0
					? "No SceneId, Path, Note, or safe inferred scene match could be resolved."
					: "No SceneId, Path, or Note hint could be resolved, and no active-book scene scope was available for inferred matching.",
		};
	}

	// The declared-routing half of resolution, shared by suggestions and memos:
	// SceneId first, then Path / Note / Scene name hints. Returns the match when
	// one hint lands, or the SceneId failure to fold into whatever the caller
	// tries next (inference and the active-note fallback for a suggestion;
	// nothing for a memo, which has no prose to infer from).
	private resolveDeclaredRoute(
		routing: ReviewSuggestionRouting | undefined,
		markdownFiles: TFile[],
		declaredScopeFolder: string | null,
	): { match: ResolvedFileMatch | null; sceneIdFailureReason: string | null } {
		const sceneId = routing?.sceneId?.trim();
		let sceneIdFailureReason: string | null = null;

		if (sceneId) {
			// Draft copies retain scene IDs. Resolve identity inside the selected
			// book, never by whichever sibling the vault happens to enumerate first.
			const sceneMatches = markdownFiles.filter((file) =>
				this.isWithinDeclaredScope(file, declaredScopeFolder) && this.matchesSceneId(file, sceneId),
			);
			if (sceneMatches.length > 1) {
				return {
					match: {
						status: "unresolved",
						strategy: "unresolved",
						reason: `Multiple notes match SceneId ${sceneId} within the current scope.`,
					},
					sceneIdFailureReason: null,
				};
			} else if (sceneMatches.length === 0) {
				sceneIdFailureReason = `No note matches SceneId ${sceneId}.`;
			}

			const resolvedFile = sceneMatches[0];
			if (resolvedFile) {
				const mismatchReason = this.getRoutingMismatchReason(resolvedFile, routing);
				if (!mismatchReason) {
					return {
						match: {
							file: resolvedFile,
							status: "resolved",
							strategy: "declared_scene_id",
							reason: `Resolved via SceneId ${sceneId}.`,
						},
						sceneIdFailureReason: null,
					};
				}

				sceneIdFailureReason = mismatchReason;
			}
		}

		// Path / Note / Scene name hints resolve against the whole vault, so they
		// are the one route that can land a suggestion on a note outside the book
		// (a content log, a brief, scratch). When a book scope is declared (Radial
		// Timeline OR the configured manuscript folder), confine these hints to
		// that folder; an out-of-book hit is rejected so the suggestion falls
		// through to inference / the active-note fallback instead of writing a
		// review block into an unrelated note. With no declared scope, behavior is
		// unchanged (vault-wide).
		const pathMatch = this.resolvePathHint(routing?.path);
		if (pathMatch && this.isWithinDeclaredScope(pathMatch, declaredScopeFolder)) {
			return {
				match: {
					file: pathMatch,
					status: "resolved",
					strategy: "declared_path",
					reason: this.combineRoutingReasons(sceneIdFailureReason, "Resolved via Path hint."),
				},
				sceneIdFailureReason,
			};
		}

		const noteMatch = this.resolveUniqueFileByName(routing?.note, markdownFiles);
		if (noteMatch && this.isWithinDeclaredScope(noteMatch, declaredScopeFolder)) {
			return {
				match: {
					file: noteMatch,
					status: "resolved",
					strategy: "declared_note",
					reason: this.combineRoutingReasons(sceneIdFailureReason, "Resolved via Note hint."),
				},
				sceneIdFailureReason,
			};
		}

		const sceneMatch = this.resolveUniqueFileByName(routing?.scene, markdownFiles);
		if (sceneMatch && this.isWithinDeclaredScope(sceneMatch, declaredScopeFolder)) {
			return {
				match: {
					file: sceneMatch,
					status: "resolved",
					strategy: "declared_scene",
					reason: this.combineRoutingReasons(sceneIdFailureReason, "Resolved via Scene hint."),
				},
				sceneIdFailureReason,
			};
		}

		return { match: null, sceneIdFailureReason };
	}

	private resolveActiveNoteFallback(activeNotePath: string | undefined, scopeFiles: TFile[]): TFile | null {
		if (!activeNotePath) {
			return null;
		}
		const file = this.app.vault.getAbstractFileByPath(activeNotePath);
		if (!(file instanceof TFile)) {
			return null;
		}
		// Restrict to scene-class files inside the active book scope when scope is known.
		if (scopeFiles.length > 0 && !scopeFiles.some((scope) => scope.path === file.path)) {
			return null;
		}
		if (scopeFiles.length === 0 && !isSceneClassFile(this.app, file)) {
			return null;
		}
		return file;
	}

	private combineRoutingReasons(primary: string | null | undefined, fallback: string): string {
		if (!primary?.trim()) {
			return fallback;
		}

		return `${primary} ${fallback}`;
	}

	// The active book scope for this import: Radial Timeline's source folder wins
	// (structured — guarantees Class: Scene notes); otherwise the configured
	// manuscript folder (unstructured — folder membership only). `declaredFolder`
	// is null when neither is set, leaving routing vault-wide as before.
	private async resolveBookScope(): Promise<{ declaredFolder: string | null; structured: boolean }> {
		const rtFolder = (await readRadialTimelineActiveBookScope(this.app)).sourceFolder;
		if (rtFolder) {
			return { declaredFolder: rtFolder, structured: true };
		}
		const configured = this.getConfiguredBookFolder().trim();
		if (configured) {
			return { declaredFolder: normalizePath(configured), structured: false };
		}
		return { declaredFolder: null, structured: false };
	}

	private getActiveBookScopeFiles(
		activeNotePath: string | undefined,
		markdownFiles: TFile[],
		bookScope: { declaredFolder: string | null; structured: boolean },
	): TFile[] {
		const scopeRoot = bookScope.declaredFolder ?? getActiveNoteScopeRoot(activeNotePath);
		if (!scopeRoot) {
			return [];
		}

		// Scene-class is a hard filter for a structured (Radial Timeline) book and
		// for the active-note fallback (preserving prior behavior). A configured
		// manuscript folder is folder-only, so non-RT notes without Class: Scene
		// still populate the scope used for inference and the active-note fallback.
		const requireSceneClass = bookScope.declaredFolder ? bookScope.structured : true;
		return markdownFiles.filter(
			(file) =>
				isPathInFolderScope(file.path, scopeRoot) &&
				(!requireSceneClass || isSceneClassFile(this.app, file)),
		);
	}

	private isWithinDeclaredScope(file: TFile, declaredScopeFolder: string | null): boolean {
		if (!declaredScopeFolder) {
			return true;
		}
		return isPathInFolderScope(file.path, declaredScopeFolder);
	}

	private matchesSceneId(file: TFile, sceneId: string): boolean {
		return matchesSceneId(this.app, file, sceneId);
	}

	private getRoutingMismatchReason(file: TFile, routing: ReviewSuggestionRouting | undefined): string | null {
		const pathHint = routing?.path?.trim();
		if (pathHint) {
			const normalizedHint = normalizePath(pathHint);
			if (normalizePath(file.path) !== normalizedHint) {
				return `SceneId resolves to ${file.basename}, but Path points to ${normalizedHint}.`;
			}
		}

		const noteHint = routing?.note?.trim();
		if (noteHint && file.basename !== noteHint) {
			return `SceneId resolves to ${file.basename}, but Note says ${noteHint}.`;
		}

		const sceneHint = routing?.scene?.trim();
		if (sceneHint && file.basename !== sceneHint) {
			return `SceneId resolves to ${file.basename}, but Scene says ${sceneHint}.`;
		}

		return null;
	}

	private resolvePathHint(pathHint?: string): TFile | null {
		if (!pathHint?.trim()) {
			return null;
		}

		const abstractFile = this.app.vault.getAbstractFileByPath(normalizePath(pathHint.trim()));
		return abstractFile instanceof TFile ? abstractFile : null;
	}

	private resolveUniqueFileByName(name: string | undefined, files: TFile[]): TFile | null {
		if (!name?.trim()) {
			return null;
		}

		const normalizedName = name.trim().toLowerCase();
		const matches = files.filter(
			(file) =>
				file.basename.toLowerCase() === normalizedName ||
				file.path.toLowerCase() === normalizedName,
		);

		return matches.length === 1 ? (matches[0] ?? null) : null;
	}

	private async inferFileForSuggestion(
		suggestion: ReviewSuggestion,
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
	): Promise<ResolvedFileMatch | null> {
		if (scopeFiles.length === 0) {
			return null;
		}

		const inferredText = this.getInferredRoutingText(suggestion);
		if (!inferredText?.trim()) {
			return {
				status: "unresolved",
				strategy: "unresolved",
				reason:
					suggestion.operation === "move"
						? "Move suggestion could not be inferred safely from target and anchor text."
						: "No routing hint or inferable source text was available.",
			};
		}

		const exactMatches = await this.findExactInferenceMatches(suggestion, scopeFiles, noteTextCache);
		if (exactMatches.length === 1) {
			const resolvedFile = exactMatches[0];
			if (!resolvedFile) {
				return null;
			}
			return {
				file: resolvedFile,
				status: "resolved",
				strategy: "inferred_exact",
				reason: `Resolved via exact inferred text match in ${resolvedFile.basename}.`,
			};
		}

		if (exactMatches.length > 1) {
			return {
				status: "unresolved",
				strategy: "inferred_exact",
				reason: `${exactMatches.length} scene notes in the active book contain the exact ${this.getInferredTargetLabel(suggestion.operation)} text.`,
			};
		}

		const normalizedMatches = await this.findNormalizedInferenceMatches(suggestion, scopeFiles, noteTextCache);
		if (normalizedMatches.length === 1) {
			const normalizedFile = normalizedMatches[0];
			if (!normalizedFile) {
				return null;
			}
			return {
				status: "unresolved",
				strategy: "inferred_normalized",
				reason: `Normalized text suggests ${normalizedFile.basename}, but the exact text was not found safely.`,
			};
		}

		if (normalizedMatches.length > 1) {
			return {
				status: "unresolved",
				strategy: "inferred_normalized",
				reason: `Normalized text matches ${normalizedMatches.length} scene notes in the active book.`,
			};
		}

		return null;
	}

	private getInferredRoutingText(suggestion: ReviewSuggestion): string | null {
		switch (suggestion.operation) {
			case "edit":
				return suggestion.payload.original;
			case "cut":
				return suggestion.payload.target;
			case "condense":
				return suggestion.payload.target;
			case "expand":
				return suggestion.payload.target;
			case "move":
				return suggestion.payload.target;
			default:
				return null;
		}
	}

	private getInferredTargetLabel(operation: SupportedReviewOperationType): string {
		switch (operation) {
			case "edit":
				return "original";
			case "cut":
			case "condense":
			case "expand":
				return "target";
			case "move":
				return "target and anchor";
		}
	}

	private async findExactInferenceMatches(
		suggestion: ReviewSuggestion,
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
	): Promise<TFile[]> {
		const matches: TFile[] = [];

		for (const file of scopeFiles) {
			const noteText = await this.readNoteText(file, noteTextCache);
			const counts = this.getSuggestionMatchCounts(noteText, suggestion);
			if (this.isSafeExactInferenceMatch(suggestion, counts)) {
				matches.push(file);
			}
		}

		return matches;
	}

	private async findNormalizedInferenceMatches(
		suggestion: ReviewSuggestion,
		scopeFiles: TFile[],
		noteTextCache: Map<string, string>,
	): Promise<TFile[]> {
		const matches: TFile[] = [];

		for (const file of scopeFiles) {
			const noteText = await this.readNoteText(file, noteTextCache);
			if (this.hasNormalizedInferenceMatch(noteText, suggestion)) {
				matches.push(file);
			}
		}

		return matches;
	}

	private getSuggestionMatchCounts(noteText: string, suggestion: ReviewSuggestion): TextMatchCounts {
		switch (suggestion.operation) {
			case "edit":
				return {
						exactCount: this.findAllExactMatches(noteText, suggestion.payload.original).length,
						normalizedCount: this.findAllNormalizedMatches(noteText, suggestion.payload.original),
				};
			case "cut":
				return {
					exactCount: this.findAllExactMatches(noteText, suggestion.payload.target).length,
					normalizedCount: this.findAllNormalizedMatches(noteText, suggestion.payload.target),
				};
			case "condense":
				return {
					exactCount: this.findAllExactMatches(noteText, suggestion.payload.target).length,
					normalizedCount: this.findAllNormalizedMatches(noteText, suggestion.payload.target),
				};
			case "expand":
				return {
					exactCount: this.findAllExactMatches(noteText, suggestion.payload.target).length,
					normalizedCount: this.findAllNormalizedMatches(noteText, suggestion.payload.target),
				};
			case "move": {
				const targetExactCount = this.findAllExactMatches(noteText, suggestion.payload.target).length;
				const anchorExactCount = this.findAllExactMatches(noteText, suggestion.payload.anchor).length;
				const targetNormalizedCount = this.findAllNormalizedMatches(noteText, suggestion.payload.target);
				const anchorNormalizedCount = this.findAllNormalizedMatches(noteText, suggestion.payload.anchor);
				return {
					exactCount: targetExactCount === 1 && anchorExactCount === 1 ? 1 : 0,
					normalizedCount: targetNormalizedCount === 1 && anchorNormalizedCount === 1 ? 1 : 0,
				};
			}
		}
	}

	private isSafeExactInferenceMatch(
		suggestion: ReviewSuggestion,
		matchCounts: TextMatchCounts,
	): boolean {
		if (suggestion.operation === "move") {
			return matchCounts.exactCount === 1;
		}

		return matchCounts.exactCount === 1;
	}

	private hasNormalizedInferenceMatch(noteText: string, suggestion: ReviewSuggestion): boolean {
		const counts = this.getSuggestionMatchCounts(noteText, suggestion);
		return counts.exactCount === 0 && counts.normalizedCount === 1;
	}

	private async readNoteText(file: TFile, noteTextCache: Map<string, string>): Promise<string> {
		const cached = noteTextCache.get(file.path);
		if (cached !== undefined) {
			return cached;
		}

		const noteText = await this.app.vault.cachedRead(file);
		const matchableText = stripAllReviewBlocks(noteText).text;
		noteTextCache.set(file.path, matchableText);
		return matchableText;
	}

	private classifyVerification(suggestion: ReviewSuggestion): { reason: string; status: ReviewImportSuggestionResult["verificationStatus"] } {
		if (suggestion.executionMode === "advisory") {
			return {
				status: "advisory",
				reason: "Advisory-only suggestion.",
			};
		}

		if (isMoveSuggestion(suggestion)) {
			const target = suggestion.location.target;
			const anchor = suggestion.location.anchor;
			if (suggestion.location.relocation?.canApply) {
				return {
					status: "exact",
					reason: "Target and anchor both resolved exactly.",
				};
			}

			if (target?.matchType === "multiple" || anchor?.matchType === "multiple") {
				return {
					status: "multiple",
					reason: suggestion.location.relocation?.reason ?? "Move resolution is ambiguous.",
				};
			}

			return {
				status: "none",
				reason: suggestion.location.relocation?.reason ?? "Move resolution failed.",
			};
		}

		const primary = getSuggestionPrimaryTarget(suggestion);
		if (primary?.matchType === "exact") {
			return {
				status: "exact",
				reason: primary.reason ?? "Exact match found.",
			};
		}

		if (primary?.matchType === "multiple") {
			return {
				status: "multiple",
				reason: primary.reason ?? "Multiple matches found.",
			};
		}

		return {
			status: "none",
			reason: primary?.reason ?? "No exact match found.",
		};
	}

	private buildGroups(results: ReviewImportSuggestionResult[]): ReviewImportNoteGroup[] {
		const groupsByPath = new Map<string, ReviewImportSuggestionResult[]>();

		for (const result of results) {
			if (!result.resolvedPath) {
				continue;
			}

			const existing = groupsByPath.get(result.resolvedPath) ?? [];
			existing.push(result);
			groupsByPath.set(result.resolvedPath, existing);
		}

		return [...groupsByPath.entries()]
			.map(([filePath, suggestionResults]) => {
				const first = suggestionResults[0];
				const exactCount = suggestionResults.filter((result) => result.verificationStatus === "exact").length;
				const declaredCount = suggestionResults.filter((result) => result.routeStrategy.startsWith("declared_")).length;
				const inferredCount = suggestionResults.filter((result) => result.routeStrategy === "inferred_exact").length;
				const exactInferredCount = suggestionResults.filter(
					(result) => result.routeStrategy === "inferred_exact" && result.verificationStatus === "exact",
				).length;
				const advisoryCount = suggestionResults.filter((result) => result.verificationStatus === "advisory").length;
				const unresolvedCount = suggestionResults.filter(
					(result) =>
						result.verificationStatus === "multiple" ||
						result.verificationStatus === "none" ||
						result.verificationStatus === "note_unresolved",
				).length;
				const mismatchCount = suggestionResults.filter((result) => result.routeStatus === "mismatch").length;

				return {
					filePath,
					fileName: first?.resolvedNoteTitle ?? filePath,
					sceneId: first?.suggestion.routing?.sceneId,
					suggestions: suggestionResults,
					memos: [],
					exactCount,
					declaredCount,
					inferredCount,
					exactInferredCount,
					advisoryCount,
					unresolvedCount,
					mismatchCount,
					isReady: suggestionResults.every((result) => result.routeStatus === "resolved"),
				};
			});
	}

	// Memos attach to groups after suggestions have been routed. A memo with a
	// SceneId / Note / Path hint goes to that note, opening a memo-only group
	// when the note received no line edits — a reviewer who scoped a note to a
	// scene meant that scene, edits or not. An unrouted memo is manuscript-wide:
	// it is duplicated into every group in the batch, and when the batch has no
	// groups at all (an editorial letter with no line edits) it lands on the
	// active scene, the same fallback a suggestion with no anchor text uses.
	// Anything that still has no destination is returned rather than dropped,
	// so the launcher can say so.
	private routeMemosToGroups(
		memos: SceneMemo[],
		groups: ReviewImportNoteGroup[],
		markdownFiles: TFile[],
		scopeFiles: TFile[],
		declaredScopeFolder: string | null,
		activeNotePath: string | undefined,
	): ReviewUnroutedMemo[] {
		const unrouted: ReviewUnroutedMemo[] = [];
		const hasRouting = (memo: SceneMemo): boolean =>
			Boolean(memo.routing?.sceneId?.trim() || memo.routing?.note?.trim() || memo.routing?.path?.trim() || memo.routing?.scene?.trim());

		// Routed memos first, so a scene-scoped memo can open the group that a
		// manuscript-wide memo is then duplicated into as well.
		for (const memo of memos.filter(hasRouting)) {
			// A group that declared the same SceneId / Note / Path wins even when
			// its file was found by text inference (the declared id matched no
			// note): the memo follows the edits it was written alongside.
			const declaredGroup = this.findGroupByDeclaredRouting(groups, memo.routing);
			if (declaredGroup) {
				declaredGroup.memos.push(memo);
				continue;
			}
			const declared = this.resolveDeclaredRoute(memo.routing, markdownFiles, declaredScopeFolder);
			const file = declared.match?.file;
			if (!file) {
				unrouted.push({
					memo,
					reason:
						declared.match?.reason ??
						this.combineRoutingReasons(
							declared.sceneIdFailureReason,
							"No Note or Path hint resolved to a note in the current scope.",
						),
				});
				continue;
			}
			this.ensureGroupForFile(groups, file, memo.routing?.sceneId?.trim()).memos.push(memo);
		}

		for (const memo of memos.filter((candidate) => !hasRouting(candidate))) {
			if (groups.length > 0) {
				for (const group of groups) {
					group.memos.push(memo);
				}
				continue;
			}

			const fallback = this.resolveActiveNoteFallback(activeNotePath, scopeFiles);
			if (fallback) {
				this.ensureGroupForFile(groups, fallback).memos.push(memo);
				continue;
			}

			unrouted.push({
				memo,
				reason: "No SceneId, and no scene in the active book is open to receive it.",
			});
		}

		return unrouted;
	}

	private findGroupByDeclaredRouting(
		groups: ReviewImportNoteGroup[],
		routing: ReviewSuggestionRouting | undefined,
	): ReviewImportNoteGroup | undefined {
		const sceneId = routing?.sceneId?.trim();
		const note = routing?.note?.trim();
		const path = routing?.path?.trim();
		return groups.find((group) => {
			if (sceneId && group.sceneId === sceneId) {
				return true;
			}
			if (path && normalizePath(group.filePath) === normalizePath(path)) {
				return true;
			}
			return Boolean(note && group.fileName === note);
		});
	}

	private ensureGroupForFile(groups: ReviewImportNoteGroup[], file: TFile, declaredSceneId?: string): ReviewImportNoteGroup {
		const existing = groups.find((group) => group.filePath === file.path);
		if (existing) {
			return existing;
		}
		const group: ReviewImportNoteGroup = {
			filePath: file.path,
			fileName: file.basename,
			sceneId: declaredSceneId || getSceneIdForFile(this.app, file),
			suggestions: [],
			memos: [],
			exactCount: 0,
			declaredCount: 0,
			inferredCount: 0,
			exactInferredCount: 0,
			advisoryCount: 0,
			unresolvedCount: 0,
			mismatchCount: 0,
			// Nothing to verify: a memo carries no target text, so a memo-only
			// group is always writable.
			isReady: true,
		};
		groups.push(group);
		return group;
	}

	private buildSummary(
		results: ReviewImportSuggestionResult[],
		groups: ReviewImportNoteGroup[],
		totalMemos: number,
		unroutedMemoCount: number,
	): ReviewImportSummary {
		return {
			totalSuggestions: results.length,
			totalMemos,
			totalRoutedMemos: totalMemos - unroutedMemoCount,
			totalMatchedScenes: groups.length,
			totalResolvedScenes: groups.filter((group) => group.isReady).length,
			totalUnresolvedScenes: new Set(
				results
					.filter((result) => result.routeStatus !== "resolved")
					.map((result) => result.suggestion.routing?.sceneId ?? result.suggestion.id),
			).size,
			totalMismatches: results.filter((result) => result.routeStatus === "mismatch").length,
			totalExactMatches: results.filter((result) => result.verificationStatus === "exact").length,
			totalDeclaredRoutes: results.filter((result) => result.routeStrategy.startsWith("declared_")).length,
			totalInferredRoutes: results.filter((result) => result.routeStrategy === "inferred_exact").length,
			totalAdvisoryOnly: results.filter((result) => result.verificationStatus === "advisory").length,
			totalUnresolvedMatches: results.filter(
				(result) =>
					result.verificationStatus === "multiple" ||
					result.verificationStatus === "none" ||
					result.verificationStatus === "note_unresolved",
			).length,
		};
	}

	private serializeGroup(batchId: string, createdAt: number, group: ReviewImportNoteGroup): string {
		const metadata = this.extractMetadata(group);
		// Body only — createReviewBlock adds the fence, sizing it past any backtick
		// run a payload happens to carry. Assembling the fence here would reopen the
		// truncation this centralizing fixed.
		const lines: string[] = [];

		lines.push(`BatchId: ${batchId}`);
		lines.push("ImportedBy: Editorialist");
		// Human-readable import time so successive batches in a scene can be told
		// apart at a glance. ISO (UTC, seconds) sorts lexicographically = newest
		// last. Readers ignore unknown header keys, so this is back-compatible.
		lines.push(`ImportedAt: ${new Date(createdAt).toISOString().replace(/\.\d{3}Z$/, "Z")}`);
		lines.push(`Reviewer: ${metadata.reviewer}`);
		lines.push(`ReviewerType: ${metadata.reviewerType}`);

		if (metadata.provider) {
			lines.push(`Provider: ${metadata.provider}`);
		}

		if (metadata.model) {
			lines.push(`Model: ${metadata.model}`);
		}

		for (const memo of group.memos) {
			lines.push("");
			if (memo.kind === "query") {
				// Round-trip an author query as === QUERY === so re-parsing the
				// scene note reconstructs it (a plain === MEMO === with no
				// strengths/issues/body would serialize an empty memo). SceneId
				// keeps the query self-routing.
				lines.push("=== QUERY ===");
				if (memo.routing?.sceneId) {
					lines.push(`SceneId: ${memo.routing.sceneId}`);
				}
				if (memo.question) {
					lines.push(`Question: ${memo.question}`);
				}
				if (memo.answer) {
					lines.push(`Answer: ${memo.answer}`);
				}
				if (memo.recommendation) {
					lines.push(`Recommendation: ${memo.recommendation}`);
				}
				continue;
			}
			lines.push("=== MEMO ===");
			if (memo.strengths) {
				lines.push(`Strengths: ${memo.strengths}`);
			}
			if (memo.issues) {
				lines.push(`Issues: ${memo.issues}`);
			}
			if (memo.body && !memo.strengths && !memo.issues) {
				lines.push(memo.body);
			} else if (memo.body) {
				lines.push(`Notes: ${memo.body}`);
			}
		}

		for (const result of group.suggestions) {
			lines.push("");
			lines.push(`=== ${result.suggestion.operation.toUpperCase()} ===`);

			const routing = result.suggestion.routing;
			if (routing?.sceneId) {
				lines.push(`SceneId: ${routing.sceneId}`);
			}

			if (routing?.note) {
				lines.push(`Note: ${routing.note}`);
			}

			if (routing?.path) {
				lines.push(`Path: ${routing.path}`);
			}

			switch (result.suggestion.operation) {
				case "edit":
					lines.push(`Original: ${result.suggestion.payload.original}`);
					lines.push(`Revised: ${result.suggestion.payload.revised}`);
					break;
				case "cut":
					lines.push(`Target: ${result.suggestion.payload.target}`);
					break;
				case "condense":
					lines.push(`Target: ${result.suggestion.payload.target}`);
					if (result.suggestion.payload.suggestion) {
						lines.push(`Suggestion: ${result.suggestion.payload.suggestion}`);
					}
					break;
				case "expand":
					lines.push(`Target: ${result.suggestion.payload.target}`);
					if (result.suggestion.payload.suggestion) {
						lines.push(`Suggestion: ${result.suggestion.payload.suggestion}`);
					}
					break;
				case "move":
					lines.push(`Target: ${result.suggestion.payload.target}`);
					lines.push(
						`${result.suggestion.payload.placement === "after" ? "After" : "Before"}: ${result.suggestion.payload.anchor}`,
					);
					break;
			}

			if (result.suggestion.why) {
				lines.push(`Why: ${result.suggestion.why}`);
			}
		}

		return createReviewBlock(lines.join("\n"));
	}

	private extractMetadata(group: ReviewImportNoteGroup): ReviewMetadata {
		// A memo-only group has no suggestion to read the reviewer from; the
		// memos carry the same parsed contributor.
		const contributor = group.suggestions[0]?.suggestion.contributor ?? group.memos[0]?.contributor;
		const raw = contributor?.raw;

		return {
			reviewer: contributor?.displayName || raw?.rawName?.trim() || "Unknown contributor",
			reviewerType: contributor?.reviewerType ?? "author",
			provider: contributor?.provider ?? raw?.rawProvider?.trim(),
			model: contributor?.model ?? raw?.rawModel?.trim(),
		};
	}


	private createContentHash(value: string): string {
		let hash = 2166136261;
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}

		return (hash >>> 0).toString(16).padStart(8, "0");
	}

	private findAllExactMatches(noteText: string, text: string): number[] {
		return findExactMatches(noteText, text);
	}

	private findAllNormalizedMatches(noteText: string, text: string): number {
		return countNormalizedMatches(noteText, text);
	}
}
