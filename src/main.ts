import { ManuscriptReconnectModal } from "./ui/ManuscriptReconnectModal";
import { ManuscriptReassociationService, type ReassociationPreview } from "./services/ManuscriptReassociationService";
import { folderPlanKey, type ManuscriptReassociation } from "./core/ManuscriptReassociation";
import { radialBookChoices, type RadialBookChoice } from "./core/RadialBookChoices";
import { manuscriptScopeKey, createManuscriptTarget, normalizeManuscriptTarget, type ManuscriptTarget } from "./core/ManuscriptTarget";
import { ManuscriptTargetModal } from "./ui/ManuscriptTargetModal";
import { t } from "./i18n";
import { editorMenuEntries, type EditorMenuEntry } from "./core/EditorMenuEntries";
import { ensureVaultFolderPath } from "./core/VaultFolders";
import { saveOpenEditors } from "./services/SaveOpenEditors";
import { AutoScheduleModal } from "./ui/AutoScheduleModal";
import { EditorialDeliveriesModal } from "./ui/EditorialDeliveriesModal";
import { deliveryCaption, planDeliveryLink, type DeliverySource, type EditorialDelivery } from "./core/EditorialDeliveries";
import { formatReviewerTypeLabel, normalizeReviewerType, passReviewerType } from "./core/ContributorIdentity";
import { RevisionPlanPanel, REVISION_PLAN_VIEW_TYPE, AUTHOR_PLAN_VIEW_TYPE } from "./ui/RevisionPlanPanel";
import { TodayPanel, TODAY_SHOWN_KEY, TODAY_VIEW_TYPE } from "./ui/TodayPanel";
import { RadialBookGoals, type RTDateEdit } from "./services/RadialBookGoals";
import { FolderWordCounter } from "./services/FolderWordCounter";
import { AUTHOR_PLAN_SCOPE, authorWork, carryRecordedWords, recordWordDay, withoutRecordedWords } from "./core/planning/AuthorPlan";
import { localDate, sourceKey, type RevisionPlan, type WorkCandidate } from "./core/planning/RevisionPlan";
import { advancePlanProgress } from "./core/planning/PlanProgress";
import { planDayLabel } from "./core/planning/WorkPresentation";
import { batchWork, directiveWork, pendingWork } from "./core/planning/RevisionWork";
import { isEngagementDelivery, preparationWork, projectEditor, recordProjectEvent, type EditorialProject } from "./core/planning/EditorialProject";
import { countProseWords } from "./core/WordCount";
import { collectPendingEdits, describeCollectFailure, type RadialTimelineBookLike } from "./core/PendingEditsCollector";
import { scheduledBookFolders } from "./core/planning/TodayAgenda";
import { endReviewRound, getEndableRoundBatches } from "./orchestrators/EndReviewRound";
import type { EditorView } from "@codemirror/view";
import { MarkdownView, Menu, normalizePath, Notice, Plugin, TFile, TFolder, type App, type WorkspaceLeaf } from "obsidian";
import { registerCommands } from "./commands/Commands";
import { SceneContextResolver } from "./orchestrators/SceneContextResolver";
import { EditorialismAnchorNavigator } from "./orchestrators/EditorialismAnchorNavigator";
import { CutFileController } from "./orchestrators/CutFileController";
import { ContributorManagementOrchestrator } from "./orchestrators/ContributorManagementOrchestrator";
import { ImportEngine } from "./core/ImportEngine";
import { MatchEngine } from "./core/MatchEngine";
import {
	canApplySuggestionDirectly,
	getEffectiveSuggestionStatus as getEffectiveSuggestionStatusShared,
	getSuggestionAnchorTarget,
	getSuggestionPresentationTone,
	getSuggestionPrimaryTarget,
	isSuggestionOpen as isSuggestionOpenShared,
} from "./core/OperationSupport";
import { isTerminalStatus } from "./core/status/ReviewStatusModel";
import { isBatchReadyToClean, isSweepComplete as isSweepCompleteShared,
	buildCompletedSweepNextSteps,
} from "./core/review/SweepCompletion";
import {
	canRevealSuggestionInManuscript as canRevealSuggestionInManuscriptShared,
	getAdjacentRevealableSuggestionId as getAdjacentRevealableSuggestionIdShared,
	hasLiveActionableSuggestions as hasLiveActionableSuggestionsShared,
} from "./core/review/SuggestionTraversal";
import { directiveEdits, directiveItem, directiveLine, type DotSource, type EditMatrixScene, type LiveEdit } from "./core/review/EditMatrix";
import { SceneSpotlight } from "./ui/SceneSpotlight";
import { closeDotPopover } from "./ui/primitives/DotPopover";
import type { EditRound } from "./core/review/EditLedger";
import { ReviewStateMachine } from "./core/review/ReviewStateMachine";
import { runEditorUndo } from "./core/review/EditorUndo";
import type { ReviewStateMachineHost } from "./core/review/ReviewStateMachineHost";
import {
	classifyNoteReviewBlocks,
	noteContainsReviewBlock,
	removeImportedReviewBlocks,
	type NoteReviewBlockState,
} from "./core/ReviewBlockFormat";
import { ReviewEngine } from "./core/ReviewEngine";
import { buildReviewTemplate, type ReviewTemplateContext } from "./core/ReviewTemplate";
import {
	getFrontmatterStringValues,
	getSceneIdForFile,
	isSceneNoteForScope,
	noteRouteName,
	type ActiveBookScopeInfo,
} from "./core/VaultScope";
import { buildSceneTokens, sceneNumberFromName, type SceneRelevanceContext } from "./core/SceneRelevance";
import { SuggestionParser } from "./core/SuggestionParser";
import type {
	CompletedSweepState,
	ReviewImportNoteGroup,
	ReviewSweepRegistryEntry,
} from "./models/ReviewImport";
import type { ReviewContributor, ReviewSession, ReviewSuggestion, ReviewTargetRef } from "./models/ReviewSuggestion";
import type {
	ContributorProfile,
	EditorialistEffortSettings,
	EditorialistPluginData,
	SceneReviewRecord,
} from "./models/ContributorProfile";
import { ReviewStore, type GuidedSweepState } from "./state/ReviewStore";
import { DebouncedSaver } from "./state/DebouncedSaver";
import { TrailingDebouncer } from "./state/TrailingDebouncer";
import { ContributorDirectory } from "./state/ContributorDirectory";
import { BACKUPS_FOLDER, EditorialismService, RESPONSES_FOLDER, WORD_FILES_FOLDER } from "./services/EditorialismService";
import { parseBackup, serializeBackup } from "./services/EditorialistBackup";
import { BackupRestoreSaveError, restoreBackupData } from "./services/RestoreEditorialistBackup";
import { extractEditorialismFileFromText } from "./core/EditorialismImport";
import { migratePluginData } from "./services/PluginDataMigration";
import { ReviewRegistryService } from "./services/ReviewRegistryService";
import { ReviewWorkflowService } from "./services/ReviewWorkflowService";
import { EditorialistModal } from "./ui/EditorialistModal";
import { formatRelativeTime } from "./core/RelativeTime";
import { openEditorialistChoiceModal } from "./ui/EditorialistChoiceModal";
import { openContributorReassignmentModal } from "./ui/ContributorReassignmentModal";
import { openContributorStrengthsModal } from "./ui/ContributorStrengthsModal";
import { EDITORIALISM_PANEL_VIEW_TYPE, EditorialismPanel } from "./ui/EditorialismPanel";
import { PENDING_EDITS_PANEL_VIEW_TYPE, PendingEditsPanel } from "./ui/PendingEditsPanel";
import { AuthorQueryModal } from "./ui/modals/AuthorQueryModal";
import { EditorResponseModal } from "./ui/modals/EditorResponseModal";
import { composeEditorResponse, editorResponseParagraphs, wordAnswers, type EditorResponse, type EditorResponseSceneInput } from "./core/review/EditorResponse";
import { writeDocx } from "./core/word/DocxWriter";
import { initialsOf, writeWordReplies } from "./core/word/WordReplies";
import {
	formatAuthorQueryMarker,
	stripAuthorQueryMarkerFromText,
	type AuthorQueryStripOutcome,
} from "./core/AuthorQueryMarker";
import {
	effortParamsFromSettings,
	estimateEditorialismEffort,
	type EffortEstimate,
} from "./core/EffortEstimate";
import { isAnchorRetired, isEditorialismActive, type Editorialism, type EditorialismItem } from "./models/Editorialism";
import { displayDirectiveText, handoffItems, needsDecision } from "./core/DirectiveText";
import { buildDirectiveFixPrompt, type DirectiveFixPassage } from "./core/DirectiveFixPrompt";
import { isLocated, locateAnchor, paragraphAround } from "./core/EditorialismAnchorLocator";
import { DECISION_COPY, DirectiveTextModal, QUESTION_COPY } from "./ui/modals/DirectiveTextModal";
import { selectCompletedSweepDurationLabel } from "./core/review/CompletedSweepDuration";
import { collectSceneDirectives, type SceneDirective } from "./core/SceneDirectives";
import { openAnchorTargetModal } from "./ui/modals/AnchorTargetModal";
import { REVIEW_PANEL_VIEW_TYPE, ReviewPanel } from "./ui/ReviewPanel";
import { compareSceneTitles } from "./ui/panels/ReviewPanelIdleSections";
import { EDITORIALIST_ICON_ID, registerEditorialistIcon } from "./ui/EditorialistLogoIcon";
import { registerRadialTimelineIcon } from "./ui/RadialTimelineLogoIcon";
import { EditorialistSettingTab, type SettingsTabId } from "./ui/EditorialistSettingTab";
import { createReviewDecorationsExtension, syncReviewDecorations } from "./ui/Decorations";
import { createReviewToolbarElement, type ToolbarState } from "./ui/Toolbar";
import { ToolbarKeyTracker } from "./ui/toolbar/ToolbarKeyTracker";
import { ToolbarOverlayController } from "./orchestrators/ToolbarOverlayController";
import { ReviewBatchProcessor,
	describeUnremovedBlocksSuffix,
	type CleanupOutcome,
} from "./orchestrators/ReviewBatchProcessor";
import { PendingEditsCoordinator, type PendingEditsSummary } from "./orchestrators/PendingEditsCoordinator";
import { buildToolbarState } from "./ui/viewmodels/ToolbarViewModel";
import type { ReviewBranchInputs, ToolbarStateInputs } from "./ui/viewmodels/ToolbarStateInputs";
import {
	SessionOrchestrator,
	type ActiveNoteContext,
	type BulkApplyConfirmState,
	type LastAppliedChange,
} from "./orchestrators/SessionOrchestrator";
import { ReviewActionsOrchestrator } from "./orchestrators/ReviewActionsOrchestrator";

interface OffsetRange {
	end: number;
	start: number;
}

type HighlightTone = "active" | "muted" | "anchor";

interface GuidedSweepHandoffState {
	currentPath: string;
	isFinal: boolean;
	nextLabel?: string;
	nextPath?: string;
	primaryActionLabel: string;
	progressLabel: string;
	panelProgressLabel: string;
	secondaryActionLabel?: string;
	summary: string;
	title: string;
	unitLabel: "note" | "scene";
}

interface EditorialistLaunchState {
	currentNoteHasReviewBlock: boolean;
	// Stamp-based classification of the review block(s) in the active note. Drives
	// the launcher's AI-direct-write affordance: only `unimported` offers an
	// in-place formalize. Independent of currentNoteHasReviewBlock, which a
	// registered (already-imported) block also sets.
	currentNoteReviewBlockState: NoteReviewBlockState;
	currentNoteStatus?: "ready" | "completed";
	nextNoteLabel?: string;
	nextNotePath?: string;
	noteUnitLabel: "note" | "scene";
}

interface PanelOnlyReviewState {
	contextLabel?: string;
	description: string;
	progressLabel?: string;
	remainingCount: number;
	title: string;
	unitLabel: "note" | "scene";
}

interface AcceptedReviewPreviewState {
	currentIndexLabel: string;
	title: string;
}

interface CompletedReviewPreviewState {
	currentIndexLabel?: string;
	title: string;
}

interface CompletedSweepPanelState {
	// Identifies which sweep this card is for, so the panel can tell a fresh
	// completion from a re-render of one the author has already looked at.
	batchId: string;
	closeLabel: string;
	description: string;
	editsReviewedLabel: string;
	durationLabel?: string;
	nextSteps: Array<{
		action?: "clean" | "import" | "respond" | "start";
		label: string;
	}>;
	title: string;
	// False while other scenes in the same import batch still hold undecided
	// suggestions: the card is then a scene checkpoint, not a completion.
	batchFinished: boolean;
	// Scenes outside this batch that still hold pending review work, so the
	// panel can send the author on to them instead of dead-ending here.
	otherPendingNotePaths: string[];
}

interface PostCompletionIdleState {
	description: string;
	title: string;
}

export interface ReviewStateIndexEntry {
	notePath: string;
	noteTitle: string;
	sceneId?: string;
	pendingCount: number;
	// Open items the matcher could not locate in the scene at last sync —
	// usually passages the author rewrote. Kept separate from pendingCount so
	// the panel can name the stuck state and offer bulk reconciliation.
	unresolvedCount: number;
	deferredCount: number;
	processedCount: number;
	lastUpdated: number;
	// Review blocks already removed from the note. The decisions are kept in
	// history, but there is nothing left in the scene to step through.
	cleaned: boolean;
}

export interface ReviewStateOverview {
	pending: ReviewStateIndexEntry[];
	// Every scene whose review work is finished, cleaned or not — the list the
	// author walks back through, mirroring `pending` going forward.
	reviewed: ReviewStateIndexEntry[];
}

interface ReviewLaunchTarget {
	intent: "active" | "next";
	label: string;
	notePath: string;
	unitLabel: "note" | "scene";
}

export type { PendingEditsSummary };

// Resolved source for a "Backup to cut file" action: either a manual editor
// selection or a cut/condense suggestion's target, plus the scene file both
// belong to so text and destination never drift apart.
// The reviewer named on a batch: the first named contributor among the imported
// suggestions and memos. Null when the paste named no reviewer.
function firstNamedContributor(groups: ReviewImportNoteGroup[]): ReviewContributor | null {
	for (const group of groups) {
		for (const contributor of [...group.suggestions.map((result) => result.suggestion.contributor), ...group.memos.map((memo) => memo.contributor)]) {
			if (contributor.raw.rawName?.trim()) return contributor;
		}
	}
	return null;
}

export default class EditorialistPlugin extends Plugin {
	private readonly store = new ReviewStore();

	private readonly reviewerDirectory = new ContributorDirectory();
	private readonly parser = new SuggestionParser(this.reviewerDirectory);
	private readonly matchEngine = new MatchEngine();
	private readonly reviewEngine = new ReviewEngine(this.parser, this.matchEngine);
	private readonly registry = new ReviewRegistryService(
		this.app,
		this.reviewEngine,
		this.reviewerDirectory,
		() => this.savePluginData(),
		(notePath) => this.resolveOpenNoteText(notePath),
	);
	private readonly editorialismService = new EditorialismService(this.app);
	private readonly manuscriptAssociations = new ManuscriptReassociationService(this.app, this.registry, this.editorialismService);
	private manuscriptRenameQueue: Promise<void> = Promise.resolve();
	private readonly workflow = new ReviewWorkflowService(this.store, this.registry, {
		isReviewTargetPath: (path) => this.isManuscriptTargetPath(path),
		clearReviewSelection: async () => {
			this.store.selectSuggestion(null);
			await this.revealSelectedSuggestion();
		},
		enterCompletedSweepAudit: async () => {
			await this.enterCompletedSweepAudit();
		},
		notify: (message) => {
			new Notice(message);
		},
		openNoteForReview: async (filePath) => {
			await this.startOrResumeReviewForNote(filePath);
			this.syncActiveEditorDecorations();
		},
		recordCompletedSceneRevision: async (notePath, batchId) => {
			return this.recordCompletedSceneRevision(notePath, batchId);
		},
	});
	private importEngine!: ImportEngine;

	private activeHighlightRange: OffsetRange | null = null;
	private activeHighlightTone: HighlightTone = "active";
	private activeAnchorHighlightRange: OffsetRange | null = null;
	private bulkApplyConfirmState: BulkApplyConfirmState | null = null;
	private lastAppliedChange: LastAppliedChange | null = null;
	private readonly toolbarKeyTracker = new ToolbarKeyTracker();
	getToolbarKeyTracker(): ToolbarKeyTracker {
		return this.toolbarKeyTracker;
	}
	private readonly toolbarOverlay = new ToolbarOverlayController({
		getActiveHighlightRange: () => this.activeHighlightRange,
		getSelectedSuggestionId: () => this.store.getState().selectedSuggestionId ?? null,
		createToolbarElement: (state) => createReviewToolbarElement(this, state),
	});
	private readonly batchProcessor = new ReviewBatchProcessor({
		app: this.app,
		getImportEngine: () => this.importEngine,
		isReviewTargetPath: (path) => this.isManuscriptTargetPath(path),
		getActiveNoteContext: () => this.getActiveNoteContext(),
		getReviewNoteContext: () => this.getReviewNoteContext(),
		getNoteContextByPath: (filePath) => this.getNoteContextByPath(filePath),
		getResolvedCompletedSweepState: () => this.getResolvedCompletedSweepState(),
		getGuidedSweep: () => this.getGuidedSweep(),
		setGuidedSweep: (value) => this.store.setGuidedSweep(value),
		persistContributorProfilesIfNeeded: () => this.persistContributorProfilesIfNeeded(),
		savePluginData: () => this.savePluginData(),
		resyncSessionForActiveNote: () => this.resyncSessionForActiveNote(),
		refreshReviewPanel: () => this.refreshReviewPanel(),
		findDuplicateSweep: (batch) => this.registry.findDuplicateSweep(batch),
		recordImportedBatch: async (batch, groups, status, currentNotePath) => {
			await this.registry.recordImportedBatch(batch, groups, status, currentNotePath);
			const contributor = firstNamedContributor(groups);
			await this.linkImportToDelivery({ kind: "batch", id: batch.batchId }, contributor?.displayName, contributor ? formatReviewerTypeLabel(passReviewerType(contributor)) : "", contributor?.kind === "ai");
		},
		getSweepRegistryEntry: (batchId) => this.getSweepRegistryEntry(batchId),
		updateSweepRegistry: (batchId, updates, options) =>
			this.registry.updateSweepRegistry(batchId, updates, options),
		syncSceneInventory: () => this.registry.syncSceneInventory(),
		formatRelativeTime: (timestamp: number) => formatRelativeTime(timestamp),
		getBatchDecisionStats: (batchId) => this.registry.getBatchDecisionStats(batchId),
		openChoiceModal: (options) => openEditorialistChoiceModal(this.app, options),
		resetBatchHistoryInRegistry: (batchId) => this.registry.resetBatchHistory(batchId),
		openExistingSweep: (entry) => this.workflow.openExistingSweep(entry),
		startGuidedSweep: (batchId, importedAt, notePaths) =>
			this.workflow.startGuidedSweep(batchId, importedAt, notePaths),
	});
	readonly pendingEdits = new PendingEditsCoordinator({
		app: this.app,
		refreshReviewPanel: () => this.refreshReviewPanel(),
		syncActiveEditorDecorations: () => this.syncActiveEditorDecorations(),
		ensureEditorialistPanelOpen: () => this.ensureEditorialistPanelOpen(),
		closeSettingsModal: () => this.closeSettingsModal(),
	});

	private readonly sessionOrchestrator = new SessionOrchestrator({
		store: this.store,
		reviewEngine: this.reviewEngine,
		registry: this.registry,
		workflow: this.workflow,
		getActiveNoteContext: () => this.getActiveNoteContext(),
		getReviewNoteContext: () => this.getReviewNoteContext(),
		getReviewSession: () => this.getReviewSession(),
		getLastAppliedChange: () => this.lastAppliedChange,
		setLastAppliedChange: (value) => {
			this.lastAppliedChange = value;
		},
		getBulkApplyConfirmState: () => this.bulkApplyConfirmState,
		setBulkApplyConfirmState: (value) => {
			this.bulkApplyConfirmState = value;
		},
		clearActiveHighlights: () => this.clearActiveHighlights(),
		setDefaultHighlightForSelection: () => this.setDefaultHighlightForSelection(),
		getResolvedCompletedSweepState: () => this.getResolvedCompletedSweepState(),
		isCompletedReviewSuggestion: (suggestion) => this.isCompletedReviewSuggestion(suggestion),
		getSceneReviewRecordByPath: (notePath) => this.getSceneReviewRecordByPath(notePath),
		shouldShowGuidedSweepHandoff: (session) => this.shouldShowGuidedSweepHandoff(session),
		getCurrentSessionTrackingContext: () => this.getCurrentSessionTrackingContext(),
		openReviewPanel: () => this.openReviewPanel(),
		revealSelectedSuggestion: () => this.revealSelectedSuggestion(),
		startOrResumeReviewForNote: (notePath) => this.startOrResumeReviewForNote(notePath),
		persistContributorProfilesIfNeeded: () => this.persistContributorProfilesIfNeeded(),
	});

	readonly reviewActions = new ReviewActionsOrchestrator({
		store: this.store,
		registry: this.registry,
		workflow: this.workflow,
		getReviewStateMachine: () => this.getReviewStateMachine(),
		getReviewSession: () => this.getReviewSession(),
		getReviewNoteContext: () => this.getReviewNoteContext(),
		hasActiveReviewSession: () => this.hasActiveReviewSession(),
		hasReviewSessionContext: () => this.hasReviewSessionContext(),
		getBatchSuggestionScenes: async (batchId) => (await this.collectBatchScenes(batchId))?.scenes ?? [],
		getSuggestionById: (id) => this.getSuggestionById(id),
		canApplyAndReviewSceneSuggestions: () => this.canApplyAndReviewSceneSuggestions(),
		canApplySuggestionInReviewAllMode: (s) => this.canApplySuggestionInReviewAllMode(s),
		isSweepComplete: (suggestions) => this.isSweepComplete(suggestions),
		getAdjacentRevealableSuggestionId: (dir) => this.getAdjacentRevealableSuggestionId(dir),
		getAdjacentAcceptedSuggestionId: (dir) => this.getAdjacentAcceptedSuggestionId(dir),
		getAdjacentCompletedReviewSuggestionId: (dir) => this.getAdjacentCompletedReviewSuggestionId(dir),
		getResolvedCompletedSweepState: () => this.getResolvedCompletedSweepState(),
		enterCompletedSweepAudit: () => this.enterCompletedSweepAudit(),
		getBulkApplyConfirmState: () => this.bulkApplyConfirmState,
		setBulkApplyConfirmState: (value) => {
			this.bulkApplyConfirmState = value;
		},
		setLastAppliedChange: (value) => {
			this.lastAppliedChange = value;
		},
		clearActiveHighlights: () => this.clearActiveHighlights(),
		setDefaultHighlightForSelection: () => this.setDefaultHighlightForSelection(),
		syncActiveEditorDecorations: () => this.syncActiveEditorDecorations(),
		refreshReviewPanel: () => this.refreshReviewPanel(),
		revealSelectedSuggestion: () => this.revealSelectedSuggestion(),
		revealSuggestionContext: (id) => this.revealSuggestionContext(id),
		focusResolvedTarget: (target) => this.focusResolvedTarget(target),
		focusEditorRange: (start, end) => this.focusEditorRange(start, end),
		closeReviewPanelLeaf: () => {
			this.app.workspace.detachLeavesOfType(REVIEW_PANEL_VIEW_TYPE);
		},
		dismissToolbar: () => this.toolbarOverlay.dismiss(),
		clearToolbarDismissedSignature: () => this.toolbarOverlay.clearDismissedSignature(),
	});
	// Editorialism anchor navigation — subject, walk position, unlocated
	// reasons, and the anchor highlights for the open note. The panel and the
	// command palette call it directly.
	readonly anchors = new EditorialismAnchorNavigator({
		app: this.app,
		editorialismService: this.editorialismService,
		getActiveBookScopeInfo: () => this.registry.getActiveBookScopeInfo(),
		getCutFolderOverride: () => this.registry.getCutFolderOverride(),
		getNoteContextByPath: (filePath) => this.getNoteContextByPath(filePath),
		focusReviewLeaf: (view) => this.focusReviewLeaf(view),
		ensureToolbarViewportClearance: (start) => this.ensureToolbarViewportClearance(start),
		syncActiveEditorDecorations: () => this.syncActiveEditorDecorations(),
		refreshEditorialismPanel: () => this.refreshEditorialismPanel(),
		chooseAnchorTarget: (choices) => openAnchorTargetModal(this.app, choices),
	});
	// Context across scenes: related passages beside a suggestion, and the
	// side pane they open into.
	readonly sceneContext = new SceneContextResolver({
		app: this.app,
		resolveSceneFileByNumber: (sceneNumber) => this.anchors.resolveSceneFileByNumber(sceneNumber),
		resolveOpenNoteText: (path) => this.resolveOpenNoteText(path),
	});
	// Cut-file subsystem — backup to the scene cut file, the lower cut pane,
	// and the scene the cut controls stay anchored to. The toolbar, the review
	// panel, and the command palette call it directly.
	readonly cutFiles = new CutFileController({
		app: this.app,
		getCutFolderOverride: () => this.registry.getCutFolderOverride(),
		getActiveBookScopeInfo: () => this.registry.getActiveBookScopeInfo(),
		getReviewSession: () => this.getReviewSession(),
		getSelectedSuggestionId: () => this.store.getState().selectedSuggestionId,
		getSuggestionById: (id) => this.getSuggestionById(id),
		getNoteContextByPath: (filePath) => this.getNoteContextByPath(filePath),
		getReviewPanelLeaf: () => this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE)[0],
		refreshReviewPanel: () => this.refreshReviewPanel(),
	});
	private settingTab: EditorialistSettingTab | null = null;

	// Contributor management — star, edit, move a pass, merge, delete, and the
	// suggestion-to-reviewer resolutions, with the session rewrites each
	// implies. The settings tab and the review panel call it directly.
	readonly contributors = new ContributorManagementOrchestrator({
		store: this.store,
		registry: this.registry,
		reviewerDirectory: this.reviewerDirectory,
		getSuggestionById: (id) => this.getSuggestionById(id),
		getCurrentSessionTrackingContext: () => this.getCurrentSessionTrackingContext(),
		savePluginData: () => this.savePluginData(),
		refreshReviewPanel: () => {
			this.refreshReviewPanel();
			for (const leaf of this.app.workspace.getLeavesOfType(REVISION_PLAN_VIEW_TYPE)) if (leaf.view instanceof RevisionPlanPanel) leaf.view.refreshContributorIdentity();
		},
		resyncSessionForActiveNote: () => this.resyncSessionForActiveNote(),
		openChoiceModal: (options) => openEditorialistChoiceModal(this.app, options),
		openStrengthsModal: (profile) => openContributorStrengthsModal(this.app, { profile }),
		openReassignmentModal: (options) => openContributorReassignmentModal(this.app, options),
		listContributorPasses: (reviewerId) => this.listContributorPasses(reviewerId),
		movePassToContributor: (batchId, reviewerId) => this.movePassToContributor(batchId, reviewerId),
	});

	async onload(): Promise<void> {
		await this.loadPluginData();
		await this.persistContributorProfilesIfNeeded();
		await this.registry.refreshActiveBookScope();
		this.importEngine = new ImportEngine(
			this.app,
			this.parser,
			this.matchEngine,
			() => this.registry.getBookFolderOverride(),
			async () => { await this.registry.refreshActiveBookScope(); return this.registry.getActiveBookScopeInfo(); },
			() => this.getCutFolderOverride(),
		);
		this.pendingEdits.initialize();
		this.registerEditorExtension(createReviewDecorationsExtension());
		// Register the brand icons before any view can render so a restored review
		// panel finds "editorialist-logo" (and the RT mark) already available.
		registerEditorialistIcon();
		registerRadialTimelineIcon();
		this.registerView(TODAY_VIEW_TYPE, (leaf) => new TodayPanel(leaf, this));
		this.registerView(REVISION_PLAN_VIEW_TYPE, (leaf) => new RevisionPlanPanel(leaf, this));
		this.registerView(AUTHOR_PLAN_VIEW_TYPE, (leaf) => new RevisionPlanPanel(leaf, this, true));
		this.registerView(REVIEW_PANEL_VIEW_TYPE, (leaf) => new ReviewPanel(leaf, this));
		this.registerView(EDITORIALISM_PANEL_VIEW_TYPE, (leaf) => new EditorialismPanel(leaf, this));
		this.registerView(PENDING_EDITS_PANEL_VIEW_TYPE, (leaf) => new PendingEditsPanel(leaf, this));
		this.settingTab = new EditorialistSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		// One ribbon for the single Ed panel. Editorialism mode is reached by the
		// in-panel swatch toggle or the "Toggle editorialism mode" command — no
		// second icon, no second tab.
		this.addRibbonIcon(EDITORIALIST_ICON_ID, t("ribbon.openPanel"), () => {
			void this.openTodayPanel();
		});
		registerCommands(this);
		this.registerDomEvent(window, "resize", () => {
			this.toolbarOverlay.handleResize();
		});

		const unsubscribe = this.store.subscribe(() => {
			this.refreshReviewPanel();
			this.syncActiveEditorDecorations();
		});
		this.register(unsubscribe);

		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.handleActiveLeafChange(leaf)));

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				if (this.workflow.isTransitioning()) {
					return;
				}
				this.cutFiles.rememberActiveScene();
				this.resyncSessionForActiveNote();
				this.syncActiveEditorDecorations();
				void this.pendingEdits.refreshPendingEditsSummary();
				// Keep the header cut-file button in step with the scene now in
				// focus: its active/muted state is per-scene, and navigating between
				// scenes need not change the review session (which is what otherwise
				// drives a panel re-render via the store subscription).
				this.refreshReviewPanel();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				// Every item acts on the editor that was right-clicked — passed in
				// here — never on "the active editor", which can be a different
				// pane (the scene under review while the author is in the cut
				// file, or an unfocused side pane). "Ed —" text prefix: macOS
				// native menus drop Obsidian's item icons, so the brand mark lives
				// in the title itself.
				const view = info instanceof MarkdownView ? info : null;
				const file = view?.file ?? null;
				// Which items appear where is decided in editorMenuEntries.
				const inScene = view !== null && file !== null && isSceneNoteForScope(
					this.app,
					file,
					this.registry.getActiveBookScopeInfo(),
					this.registry.getCutFolderOverride(),
				);

				const selection = editor.getSelection();
				const items: Record<EditorMenuEntry, { title: string; icon: string; run: () => void }> = {
					"author-query": { title: t("editorMenu.authorQuery"), icon: "message-square-plus", run: () => { void this.insertAuthorQuery(view ?? undefined); } },
					"backup-selection": { title: t("editorMenu.backupSelection"), icon: "archive", run: () => { void this.cutFiles.backupSelectionToCutFile({ view: view ?? undefined }); } },
					"anchor-selection": { title: t("editorMenu.anchorSelection"), icon: "corner-down-right", run: () => { void this.anchors.anchorSelectionToEditorialismItem(view ?? undefined); } },
				};
				for (const entry of editorMenuEntries({ inScene, hasSelection: selection.trim().length > 0 })) {
					const spec = items[entry];
					menu.addItem((item) => item.setTitle(spec.title).setIcon(spec.icon).onClick(spec.run));
				}
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				// Trailing-debounce because editor-change fires per-keystroke on
				// large manuscripts; the resync is idempotent so coalescing
				// bursts into a single trailing call preserves correctness while
				// removing the per-key cost. active-leaf-change and file-open
				// stay immediate — those are user-driven and rare.
				this.editorChangeResyncDebouncer.schedule();
			}),
		);

		// The header's cut button reports whether the active scene's cut file
		// exists on disk. That answer changes when the file is created, deleted, or
		// renamed — none of which touch the review store or the active file, so
		// neither the store subscription nor `file-open` would repaint the button
		// and it would stay muted until the user reopened the scene. Watch the
		// vault instead, and repaint only when the affected path is the very cut
		// file the button points at. Deferred to layout-ready because `create`
		// fires once per file while the vault index is warming up.
		this.app.workspace.onLayoutReady(() => {
			this.showTodayOnNewDay();
			// A word goal's day starts from the folder's first total that day, so
			// it is taken whether or not the planner is open.
			const recordWordGoals = (): void => {
				void this.recordAuthorWordGoals().then(async (result) => {
					if (result.saved) for (const leaf of this.app.workspace.getLeavesOfType(AUTHOR_PLAN_VIEW_TYPE)) if (leaf.view instanceof RevisionPlanPanel) await leaf.view.refresh();
				}).catch((error: unknown) => console.error("Editorialist: word goal count failed", error));
			};
			recordWordGoals();
			this.registerInterval(window.setInterval(recordWordGoals, 5 * 60 * 1000));
			// Folder/note membership cannot be validated before the vault index
			// is ready. Resolve the persisted target again at the actual boundary.
			void this.registry.syncOperationalMetadata().then(() => {
				this.refreshReviewPanel();
				this.refreshEditorialismPanel();
			}).catch((error: unknown) => console.error("Editorialist: manuscript target refresh failed", error));
			// One-time repair of per-batch attribution — reviewer signals and
			// review decisions alike — for vaults whose data.json predates
			// per-suggestion batch ids. Deferred to layout-ready because it reads
			// tracked notes, and fire-and-forget because nothing in startup
			// depends on it: a failure leaves the old attribution in place and
			// the pass simply runs again next load. It never deletes a record, so
			// an interrupted run cannot lose a decision.
			void this.registry.migrateBatchAttribution().catch((err: unknown) => {
				console.error("Editorialist: batch attribution migration failed", err);
			});
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					this.cutFiles.refreshReviewPanelIfActiveSceneCutFile(file.path);
					if (!(file instanceof TFile) || file.extension === "md") this.inventoryRescanDebouncer.schedule();
				}),
			);
			this.registerEvent(
				this.app.vault.on("delete", (file) => {
					this.cutFiles.refreshReviewPanelIfActiveSceneCutFile(file.path);
					// A deleted note may have carried a tracked review block; a deleted
					// folder may have carried several. Either way the registry must
					// stop offering them — see inventoryRescanDebouncer.
					if (!(file instanceof TFile) || file.extension === "md") {
						this.inventoryRescanDebouncer.schedule();
					}
				}),
			);
			this.registerEvent(
				this.app.vault.on("rename", (file, oldPath) => {
					// Either end of the rename can be the cut file: renaming one in
					// creates the button's target, renaming it away removes it.
					this.cutFiles.refreshReviewPanelIfActiveSceneCutFile(file.path);
					this.cutFiles.refreshReviewPanelIfActiveSceneCutFile(oldPath);
					if (file instanceof TFolder) {
						const newPath = file.path;
						this.manuscriptRenameQueue = this.manuscriptRenameQueue.then(async () => {
							if (await this.manuscriptAssociations.followRename(oldPath, newPath)) await this.refreshAfterManuscriptReconnection();
						}).catch((error: unknown) => {
							new Notice(error instanceof Error ? `Manuscript folder moved. ${error.message} Open the manuscript target and choose Reconnect.` : "Manuscript folder moved. Reconnect its saved work from the manuscript target.", 12000);
							this.inventoryRescanDebouncer.schedule();
						});
					} else if (file instanceof TFile && file.extension === "md") {
						const newPath = file.path;
						this.manuscriptRenameQueue = this.manuscriptRenameQueue.then(() => this.handleNoteRenamed(oldPath, newPath)).catch((error: unknown) => {
							console.error("Editorialist: note rename tracking failed", error);
							new Notice(error instanceof Error ? `Note moved. ${error.message}` : "Note moved, but its saved review references could not be updated. Check the manuscript target before continuing.", 12000);
						});
					} else {
						if (file instanceof TFile) {
							// A sent Word file or PDF, or a kept copy, keeps its link when renamed.
							const newPath = file.path;
							this.manuscriptRenameQueue = this.manuscriptRenameQueue.then(async () => {
								if (await this.registry.renameEngagementFile(oldPath, newPath)) await this.refreshPlanViews();
							}).catch((error: unknown) => console.error("Editorialist: engagement file rename tracking failed", error));
						}
						this.inventoryRescanDebouncer.schedule();
					}
				}),
			);
		});

		this.syncActiveEditorDecorations();
		void this.pendingEdits.refreshPendingEditsSummary({ force: true });
	}

	onunload(): void {
		// Obsidian submission guideline: do NOT detach leaves of your own view type here —
		// Obsidian restores workspace state on reload, and registerView() already handles cleanup.
		this.toolbarOverlay.destroy();
		this.toolbarKeyTracker.dispose();
		this.sceneSpotlight?.clear();
		closeDotPopover();
		this.editorChangeResyncDebouncer.cancel();
		this.inventoryRescanDebouncer.cancel();
		this.pendingEdits.clearInquiryMaps();
		// Flush any debounced plugin-data save so pending changes (e.g. a star
		// toggle right before the user disables the plugin) are not lost.
		// Obsidian does not await onunload, so the flush is fire-and-forget;
		// console.error is the only diagnostic surface during unload — a Notice
		// would not be seen because the plugin is shutting down.
		this.flushPluginDataSave().catch((err: unknown) => {
			console.error("Editorialist: failed to flush plugin data on unload", err);
		});
	}

	async parseCurrentNote(options?: { suppressNotice?: boolean }): Promise<void> {
		await this.sessionOrchestrator.parseCurrentNote(options);
	}

	async openEditorialistModal(): Promise<void> {
		const context = this.getActiveNoteContext();
		const selectedText = this.getActiveEditorSelection();
		const launchState = this.getEditorialistLaunchState(context);
		new EditorialistModal(this.app, {
			activeBookLabel: this.registry.getActiveBookScopeInfo().label,
			activeNoteLabel: context?.view.file?.basename,
			currentNoteHasReviewBlock: launchState.currentNoteHasReviewBlock,
			currentNoteReviewBlockState: launchState.currentNoteReviewBlockState,
			detectFileWrittenReviewBlocks: this.registry.getSettings().detectFileWrittenReviewBlocks,
			currentNoteStatus: launchState.currentNoteStatus,
			isReviewPanelOpen: this.isReviewPanelOpen(),
			nextNoteLabel: launchState.nextNoteLabel,
			noteUnitLabel: launchState.noteUnitLabel,
			onCopyTemplate: async () => {
				await this.copyReviewTemplateToClipboard(selectedText);
			},
			detectEditorialism: (rawText) => this.detectEditorialismInText(rawText),
			onSaveEditorialism: async (rawText) => this.saveEditorialismFromText(rawText),
			isBatchImported: (batch) => this.registry.findDuplicateSweep(batch) !== null,
			isEditorialismSaved: async (rawText) => this.isEditorialismSavedFromText(rawText),
			onReadClipboardText: async () => this.batchProcessor.readClipboardText(),
			onImportBatch: (batch, startReview, afterImport) => this.batchProcessor.importReviewBatch(batch, startReview, afterImport),
			onKeepWordFile: (batchId, fileName, editor, bytes) => this.keepWordFile(batchId, fileName, editor, bytes),
			onImportRawToActiveNote: async (rawText, startReview) => {
				await this.batchProcessor.importReviewBatchToActiveNote(rawText, startReview);
			},
			onFormalizeAuthoredBlock: async (startReview) => {
				await this.batchProcessor.formalizeAuthoredReviewBlockInActiveNote(startReview);
			},
			onInspectBatch: async (rawText, correctedTargets) =>
				this.batchProcessor.inspectReviewBatch(rawText, {
					activeNotePath: context?.filePath,
					correctedTargets,
				}),
			onLoadClipboardBatch: async () => this.batchProcessor.loadClipboardReviewBatch(),
			onOpenReviewPanel: async () => {
				await this.openReviewPanel();
			},
			onStartReviewInCurrentNote: async () => {
				await this.parseCurrentNote({ suppressNotice: true });
			},
			onStartReviewInNextNote: async () => {
				await this.openNextSweepNoteFromLaunch();
			},
		}).open();
	}

	// The Ed panel is a single leaf that holds EITHER the review or the
	// editorialism view. Open/reveal reuses any existing Ed leaf (either type)
	// and detaches stray duplicates, so opening or toggling never spawns a
	// second tab. Returns the leaf, or null when no sidebar slot is available.
	private async openEditorialistPanel(viewType: string): Promise<WorkspaceLeaf | null> {
		const existing = [
			...this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE),
			...this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE),
			...this.app.workspace.getLeavesOfType(EDITORIALISM_PANEL_VIEW_TYPE),
			...this.app.workspace.getLeavesOfType(PENDING_EDITS_PANEL_VIEW_TYPE),
			...this.app.workspace.getLeavesOfType(REVISION_PLAN_VIEW_TYPE),
			...this.app.workspace.getLeavesOfType(AUTHOR_PLAN_VIEW_TYPE),
		];
		const [primary, ...duplicates] = existing;
		for (const duplicate of duplicates) {
			duplicate.detach();
		}

		const leaf = primary ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			return null;
		}
		if (leaf.view.getViewType() !== viewType) {
			await leaf.setViewState({ type: viewType, active: false });
		}
		await this.app.workspace.revealLeaf(leaf);
		return leaf;
	}

	async openReviewPanel(): Promise<void> {
		const leaf = await this.openEditorialistPanel(REVIEW_PANEL_VIEW_TYPE);
		if (!leaf) {
			return;
		}
		this.refreshReviewPanel();
		void this.pendingEdits.refreshPendingEditsSummary({ force: true });
		// Reconcile the sweep registry against the review blocks actually on disk
		// before the user reaches for the clean button. This heals stale/orphaned
		// tracking — e.g. a batch whose scenes fell out of scope during a book
		// switch, which retires the registry record while the block stays in the
		// note — so a physically-present block becomes cleanable again.
		void this.registry.syncSceneInventory().then(() => this.refreshReviewPanel());
	}

	// Manual recovery lever: re-derive cleanup state from the review blocks on
	// disk. Surfaces batches whose blocks are present but whose registry tracking
	// went stale (so the clean button can act on them) and reports the result.
	async rescanReviewBlocks(): Promise<void> {
		await this.registry.syncSceneInventory();
		this.refreshReviewPanel();
		const count = this.getCleanableBatchIds().length;
		new Notice(
			count > 0
				? `Rescanned review blocks — ${count} batch${count === 1 ? "" : "es"} ready to clean.`
				: "Rescanned review blocks — nothing ready to clean.",
		);
	}

	isReviewPanelOpen(): boolean {
		return this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE).length > 0;
	}

	async openEditorialismPanel(): Promise<void> {
		await this.openEditorialistPanel(EDITORIALISM_PANEL_VIEW_TYPE);
	}

	getEditorialismFolder(): string {
		return this.editorialismService.getRootFolderName();
	}

	// Context for highlighting editorialism items that relate to the scene the
	// author is working on now: the scene number (from the file name) plus
	// character/subplot/action-description tokens (for subplot matching). Falls back
	// to the last scene the author had open when focus is on a side panel. Null
	// when no scene is in view.
	getSceneRelevanceContext(): SceneRelevanceContext | null {
		const active = this.app.workspace.getActiveFile();
		let file = active instanceof TFile && active.extension === "md" ? active : null;
		if (!file) {
			file = this.cutFiles.getRememberedSceneFile();
		}
		if (!file) {
			return null;
		}

		// Only an actual scene of the active book can carry scene relevance.
		// Without this, any note whose name starts with digits impersonated a
		// scene (`29.01 Crossing the Threshold`, Class: Beat, read as scene 29),
		// and the token-only path below let an unnumbered note with Character /
		// Subplot frontmatter match subplot-scoped directives from anywhere in
		// the vault. Shares one predicate with resolveAnchorSceneFile so the two
		// cannot drift apart again.
		if (
			!isSceneNoteForScope(
				this.app,
				file,
				this.registry.getActiveBookScopeInfo(),
				this.registry.getCutFolderOverride(),
			)
		) {
			return null;
		}

		const sceneNumber = sceneNumberFromName(file.basename);
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const characters = getFrontmatterStringValues(frontmatter, ["Character", "Characters", "character", "characters"]);
		const subplots = getFrontmatterStringValues(frontmatter, ["Subplot", "Subplots", "subplot", "subplots"]);
		const actions = getFrontmatterStringValues(frontmatter, [
			"Action",
			"Actions",
			"action",
			"actions",
			"Description",
			"Descriptions",
			"description",
			"descriptions",
			"Action Description",
			"Action Descriptions",
			"action description",
			"action descriptions",
			"ActionDescription",
			"ActionDescriptions",
			"actionDescription",
			"actionDescriptions",
		]);
		const tokens = buildSceneTokens([...characters, ...subplots, ...actions]);
		if (sceneNumber === null && tokens.size === 0) {
			return null;
		}
		return { sceneNumber, tokens };
	}

	// Estimate the authoring effort for one editorialism's open directives, using
	// the author's configured effort settings.
	estimateEditorialism(editorialism: Editorialism): EffortEstimate {
		return estimateEditorialismEffort(
			editorialism,
			effortParamsFromSettings(this.registry.getSettings().effort),
		);
	}

	getEffortDailyWritingHours(): number {
		return this.registry.getSettings().effort.dailyWritingHours;
	}

	getEffortSettings(): EditorialistEffortSettings {
		return this.registry.getSettings().effort;
	}

	async setEffortSettings(patch: Partial<EditorialistEffortSettings>): Promise<void> {
		this.registry.setEffortSettings(patch);
		await this.savePluginData();
	}

	// The first time Obsidian starts on a new day, the Ed panel shows Today
	// instead of whatever view it was left on. Later the same day the restored
	// view stays. Today records the day when it opens; see TodayPanel.
	private showTodayOnNewDay(): void {
		if (this.app.loadLocalStorage(TODAY_SHOWN_KEY) === localDate(new Date())) return;
		const leaf = [REVIEW_PANEL_VIEW_TYPE, EDITORIALISM_PANEL_VIEW_TYPE, PENDING_EDITS_PANEL_VIEW_TYPE, REVISION_PLAN_VIEW_TYPE, AUTHOR_PLAN_VIEW_TYPE]
			.flatMap((type) => this.app.workspace.getLeavesOfType(type))[0];
		if (leaf) void leaf.setViewState({ type: TODAY_VIEW_TYPE, active: false });
	}
	async openTodayPanel(): Promise<void> {
		await this.openEditorialistPanel(TODAY_VIEW_TYPE);
	}
	async openRevisionPlanPanel(): Promise<void> {
		await this.openEditorialistPanel(REVISION_PLAN_VIEW_TYPE);
	}
	async openEditorialProjectWorkspace(): Promise<void> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: REVISION_PLAN_VIEW_TYPE, active: true });
	}

	async openAuthorPlanner(): Promise<void> { await this.openEditorialistPanel(AUTHOR_PLAN_VIEW_TYPE); }
	/** Opens the book's engagement or schedule, or a writing goal's editor, from Today. */
	async openPlanSection(author: boolean, section: "overview" | "schedule", goalId: string | null = null): Promise<void> {
		const leaf = await this.openEditorialistPanel(author ? AUTHOR_PLAN_VIEW_TYPE : REVISION_PLAN_VIEW_TYPE);
		if (leaf?.view instanceof RevisionPlanPanel) leaf.view.focusSection(section, goalId);
	}
	openAuthorScheduler(): void { new AutoScheduleModal(this, null, false, AUTHOR_PLAN_SCOPE).open(); }
	readonly radialBookGoals = new RadialBookGoals(() => {
		// SAFE: Obsidian's loaded-plugin map is not in the public App typings.
		const app = this.app as typeof this.app & { plugins?: { plugins?: Record<string, unknown> } };
		return app.plugins?.plugins?.["radial-timeline"];
	});
	getAuthorPlanningPlan(): RevisionPlan { return this.radialBookGoals.resolve(this.getRevisionPlan(AUTHOR_PLAN_SCOPE)).plan; }
	collectAuthorWork(): { candidates: WorkCandidate[]; warnings: string[] } {
		const resolved = this.radialBookGoals.resolve(this.getRevisionPlan(AUTHOR_PLAN_SCOPE));
		return { candidates: authorWork(resolved.plan).map((item) => resolved.unavailable.has(item.locator) ? { ...item, inactive: true, due: null, targetDate: undefined } : item), warnings: resolved.warnings };
	}
	readonly folderWords = new FolderWordCounter(this.app, (path) => this.resolveOpenNoteText(path));
	/**
	 * Current folder totals of open word goals by goal id, null when a folder is
	 * missing. Records each goal's starting count and the day's first total.
	 */
	async recordAuthorWordGoals(): Promise<{ counts: Record<string, number | null>; saved: boolean }> {
		const raw = this.getRevisionPlan(AUTHOR_PLAN_SCOPE), plan = this.radialBookGoals.resolve(raw).plan, today = localDate(new Date());
		const counts: Record<string, number | null> = {}, folders = new Map<string, number | null>();
		let changed = false;
		for (const target of plan.targets ?? []) {
			if (!target.words || target.done) continue;
			if (!folders.has(target.words.folder)) folders.set(target.words.folder, await this.folderWords.count(target.words.folder));
			const count = folders.get(target.words.folder) ?? null;
			counts[target.id] = count;
			const next = count === null ? null : recordWordDay(target.words, target.start, target.due, count, today);
			if (next) { target.words = next; changed = true; }
		}
		// A goal edit or RT sync during the count wins; the next count records the day.
		const saved = changed && !this.authorGoalSaving && JSON.stringify(this.getRevisionPlan(AUTHOR_PLAN_SCOPE)) === JSON.stringify(raw);
		if (saved) await this.saveRevisionPlan(AUTHOR_PLAN_SCOPE, plan);
		return { counts, saved };
	}
	private authorGoalSaving = false;
	async synchronizeAuthorTargets(): Promise<void> {
		if (this.authorGoalSaving) return;
		const raw = this.getRevisionPlan(AUTHOR_PLAN_SCOPE), resolved = this.radialBookGoals.resolve(raw).plan;
		if (JSON.stringify(raw) !== JSON.stringify(resolved)) await this.saveRevisionPlan(AUTHOR_PLAN_SCOPE, resolved);
	}
	async saveAuthorGoalPlan(expected: RevisionPlan, next: RevisionPlan, edit?: RTDateEdit): Promise<void> {
		if (this.authorGoalSaving) throw new Error("A goal save is already in progress. Try again after it finishes.");
		this.authorGoalSaving = true;
		try {
			const raw = this.getRevisionPlan(AUTHOR_PLAN_SCOPE), current = this.radialBookGoals.resolve(raw).plan;
			// The daily word count may have run since the dialog opened; that is no conflict.
			if (JSON.stringify(withoutRecordedWords(current)) !== JSON.stringify(withoutRecordedWords(expected))) throw new Error("The goal or RT target changed. Reopen goal details before saving.");
			const receipt = edit ? await this.radialBookGoals.update(edit) : null;
			try {
				if (JSON.stringify(this.getRevisionPlan(AUTHOR_PLAN_SCOPE)) !== JSON.stringify(raw)) throw new Error("The author plan changed during the save. Reopen goal details.");
				await this.saveRevisionPlan(AUTHOR_PLAN_SCOPE, this.radialBookGoals.resolve(carryRecordedWords(next, expected, current)).plan);
			} catch (error) {
				if (receipt) { try { await this.radialBookGoals.rollback(receipt); } catch (rollbackError) { throw new Error(`Goal save failed; ${rollbackError instanceof Error ? rollbackError.message : "check the RT target before retrying"}`); } }
				throw error;
			}
		} finally { this.authorGoalSaving = false; }
		for (const leaf of this.app.workspace.getLeavesOfType(AUTHOR_PLAN_VIEW_TYPE)) if (leaf.view instanceof RevisionPlanPanel) await leaf.view.refresh();
	}
	getRevisionPlan(book: string): RevisionPlan { return this.registry.getRevisionPlan(book); }
	async saveRevisionPlan(book: string, plan: RevisionPlan): Promise<void> {
		await this.registry.setRevisionPlan(book, plan);
		// Every plan save funnels through here, so Today follows any planner edit.
		for (const leaf of this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE)) if (leaf.view instanceof TodayPanel) leaf.view.scheduleRefresh();
	}
	async refreshPlanViews(): Promise<void> {
		for (const type of [REVISION_PLAN_VIEW_TYPE, AUTHOR_PLAN_VIEW_TYPE]) for (const leaf of this.app.workspace.getLeavesOfType(type)) if (leaf.view instanceof RevisionPlanPanel) await leaf.view.refresh();
		for (const leaf of this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE)) if (leaf.view instanceof TodayPanel) leaf.view.scheduleRefresh();
	}

	getEditorialDeliveries(folder = this.getActiveBookScopeInfo().sourceFolder?.replace(/\/$/, "")): EditorialDelivery[] {
		return this.registry.getEditorialDeliveries().filter((delivery) => delivery.bookFolder === folder);
	}
	openEditorialDeliveries(): void { new EditorialDeliveriesModal(this).open(); }
	// An import joins its reviewer's open delivery in the active book, or starts
	// one received today, so a round's batches and Editorialism files are already
	// together when the author plans it. Only the return deadline is left to add.
	// Nothing happens without a reviewer, for an AI's own review, or when the
	// source is already in a delivery (planDeliveryLink).
	private async linkImportToDelivery(source: DeliverySource, reviewer: string | null | undefined, role: string, isAi: boolean): Promise<void> {
		const bookFolder = this.getActiveBookScopeInfo().sourceFolder?.replace(/\/$/, "");
		if (!bookFolder || !reviewer) return;
		const plan = planDeliveryLink({ version: 1, deliveries: this.registry.getEditorialDeliveries() }, {
			bookFolder, reviewer, role, isAi, source, today: localDate(new Date()), newId: crypto.randomUUID(),
		});
		if (!plan) return;
		try {
			await this.registry.saveEditorialDelivery(plan.delivery);
		} catch (error) {
			console.error("[Editorialist] Could not link the import to a delivery", error);
			return;
		}
		const delivery = await this.linkEngagementToDelivery(bookFolder, plan.delivery);
		const fragment = createFragment();
		fragment.createSpan({
			text: plan.created
				? `Started delivery “${delivery.title}” for ${delivery.reviewer}. Add its return deadline in `
				: `Added to ${delivery.reviewer}'s delivery “${delivery.title}”${delivery.due ? `, due ${planDayLabel(delivery.due)}` : ""}. `,
		});
		const open = fragment.createEl("a", { text: plan.created ? "Editorial deliveries" : "Open deliveries", href: "#" });
		if (plan.created) fragment.createSpan({ text: "." });
		const notice = new Notice(fragment, 8000);
		open.onClickEvent((event) => {
			event.preventDefault();
			notice.hide();
			this.openEditorialDeliveries();
		});
	}
	openDeliveryScheduler(delivery: EditorialDelivery | null, adjusting = false): void { new AutoScheduleModal(this, delivery, adjusting).open(); }
	async applyScheduledPlan(book: string, expected: RevisionPlan, next: RevisionPlan): Promise<void> {
		if (book !== AUTHOR_PLAN_SCOPE) await this.refreshActiveBookScope();
		const active = book === AUTHOR_PLAN_SCOPE ? AUTHOR_PLAN_SCOPE : JSON.stringify(["folder", this.getActiveBookScopeInfo().sourceFolder?.replace(/\/$/, "")]);
		if (book !== active || JSON.stringify(book === AUTHOR_PLAN_SCOPE ? this.getAuthorPlanningPlan() : this.getRevisionPlan(book)) !== JSON.stringify(expected)) throw new Error("The book or plan changed. Reopen the planner before applying.");
		await this.saveRevisionPlan(book, next);
		await this.refreshPlanViews();
	}
	// Feedback from the book's engagement editor links that engagement to its
	// delivery, the one record of when feedback came back. A return date the
	// author recorded on the engagement before then moves to the delivery.
	// Returns the delivery as saved.
	private async linkEngagementToDelivery(bookFolder: string, delivery: EditorialDelivery): Promise<EditorialDelivery> {
		const book = JSON.stringify(["folder", bookFolder]);
		const plan = this.getRevisionPlan(book);
		const project = plan.project;
		if (!project || project.deliveryId || !isEngagementDelivery(project, delivery, this.getReviewerProfiles())) return delivery;
		let linked = delivery;
		if (project.actualReturn && project.actualReturn !== delivery.received) {
			linked = { ...delivery, received: project.actualReturn };
			await this.registry.saveEditorialDelivery(linked);
		}
		project.deliveryId = linked.id;
		project.actualReturn = null;
		recordProjectEvent(project, `Feedback linked: ${linked.title}`);
		await this.saveRevisionPlan(book, plan);
		return linked;
	}

	async saveEditorialDelivery(delivery: EditorialDelivery): Promise<void> {
		if (delivery.bookFolder !== this.getActiveBookScopeInfo().sourceFolder?.replace(/\/$/, "")) throw new Error("The active book changed. Reopen deliveries before saving.");
		await this.registry.saveEditorialDelivery(delivery);
		this.refreshEditorialismPanel();
		for (const leaf of this.app.workspace.getLeavesOfType(REVISION_PLAN_VIEW_TYPE)) {
			if (leaf.view instanceof RevisionPlanPanel) await leaf.view.refresh();
		}
	}

	async collectRevisionWork(): Promise<RevisionWorkRead> {
		await this.refreshActiveBookScope();
		return this.collectBookWork(this.getActiveBookScopeInfo());
	}

	/**
	 * The revision work of the active book and of every other book with a session
	 * on the calendar, active book first. A book whose folder is gone cannot be
	 * read, so its sessions stay out rather than showing as work to do.
	 */
	async collectBooksWork(): Promise<BookWorkRead[]> {
		await this.refreshActiveBookScope();
		const active = this.getActiveBookScopeInfo();
		const activeFolder = active.sourceFolder?.replace(/\/$/, "");
		const books: BookWorkRead[] = activeFolder ? [{ folder: activeFolder, label: active.label ?? activeFolder, active: true, work: await this.collectBookWork(active) }] : [];
		// A radial target's exclusions apply to every book it can follow.
		const target = active.target?.kind === "radial" ? active.target : undefined;
		const radial = this.radialBookGoals.books(), saved = this.getManuscriptAssociations();
		for (const folder of scheduledBookFolders(this.registry.getRevisionPlanKeys(), (key) => this.getRevisionPlan(key))) {
			if (folder === activeFolder) continue;
			const book = radial.find((item) => item.folder === folder);
			const label = book?.title ?? saved.find((item) => item.path === folder)?.name ?? folder;
			const work: RevisionWorkRead = this.app.vault.getAbstractFileByPath(folder) instanceof TFolder
				? await this.collectBookWork({ label, sourceFolder: folder, structured: Boolean(book), target }, book ? { id: book.id, title: book.title, sourceFolder: folder } : null)
				: { candidates: [], warnings: [`${label}: its folder is missing, so its sessions are hidden here. Reconnect it from the manuscript target.`], held: [{ kind: "all" }] };
			books.push({ folder, label, active: false, work });
		}
		return books;
	}

	/** Moves the manuscript target to a book, through Radial Timeline when it tracks that book. */
	async openBook(folder: string): Promise<void> {
		const target = this.getManuscriptTarget();
		const book = this.radialBookGoals.books().find((item) => item.folder === folder);
		if (target?.kind === "folder" || !book) { await this.setManuscriptTarget(createManuscriptTarget("folder", folder)); return; }
		await this.radialBookGoals.select(book.id);
		await this.setManuscriptTarget(target?.kind === "radial" ? target : createManuscriptTarget("radial"));
	}

	// One book's revision work, with a warning for each source that could not be
	// read and `held` naming that work, so progress does not count its absence as
	// finished. `radialBook` names the book's Radial Timeline profile: left out,
	// it is RT's active book; null, RT does not track the book, so its pending
	// edits cannot be read and are held.
	private async collectBookWork(scope: ActiveBookScopeInfo, radialBook?: RadialTimelineBookLike | null): Promise<RevisionWorkRead> {
		const candidates: WorkCandidate[] = [];
		const warnings: string[] = [];
		const held: HeldSource[] = [];
		const folder = scope.sourceFolder?.replace(/\/$/, "");
		if (!folder) return { candidates, warnings: ["Select an active book with a source folder to plan revisions."], held: [{ kind: "all" }] };
		const project = this.getRevisionPlan(JSON.stringify(["folder", folder])).project;
		if (project) candidates.push(...preparationWork(project));
		const eligible = new Set(this.getManuscriptFiles(scope).map((file) => file.path));
		try {
			const pending = radialBook === null ? null : await collectPendingEdits(this.app, radialBook);
			if (!pending) held.push({ kind: "pending" });
			else if (pending.ok && pending.session.sourceFolder.replace(/\/$/, "") === folder) {
				candidates.push(...pendingWork(pending.session).filter((item) => eligible.has(item.path)));
			}
			else if (pending.ok) { warnings.push("Pending edits belong to a different active book. Refresh after selecting the intended book."); held.push({ kind: "pending" }); }
			else if (pending.reason !== "no_scenes_with_pending_edits" && !(project && pending.reason === "radial_timeline_missing")) { warnings.push(describeCollectFailure(pending.reason)); held.push({ kind: "pending" }); }
		} catch { warnings.push("Pending edits could not be loaded. Their absence is not a completed backlog."); held.push({ kind: "pending" }); }
		try {
			for (const summary of await this.listEditorialismsForActiveBook(scope.label)) {
				const document = await this.loadEditorialism(summary.filePath);
				if (document) {
					if (!document.book) { warnings.push(`“${document.title}” has no book attribution. Assign its book before adding it to a plan.`); held.push({ kind: "directive", path: summary.filePath }); continue; }
					candidates.push(...directiveWork(document, effortParamsFromSettings(this.getEffortSettings())));
				}
			}
		} catch { warnings.push("Some editorial agendas could not be loaded. Refresh before relying on the backlog."); held.push({ kind: "directive" }); }
		const activeBatches = this.getSweepRegistryEntries().filter((batch) => batch.status !== "cleaned" && batch.status !== "ended_early");
		const paths = new Set(activeBatches.flatMap((batch) => batch.importedNotePaths).filter((path) => eligible.has(path)));
		// Who sent each batch, to give a person's pass a response task.
		const senders = new Map<string, ReviewContributor>();
		for (const path of paths) {
			try {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) continue;
				const text = this.resolveOpenNoteText(path) ?? await this.app.vault.cachedRead(file);
				const session = this.registry.applyPersistedReviewState(this.reviewEngine.buildSession(path, text, null));
				for (const item of [...session.suggestions, ...session.memos]) {
					if (item.source.batchId && !senders.has(item.source.batchId)) senders.set(item.source.batchId, item.contributor);
				}
				candidates.push(...batchWork(session).filter((item) => activeBatches.some((batch) => batch.batchId === item.locator)).map((item) => {
					const importedAt = activeBatches.find((batch) => batch.batchId === item.locator)?.importedAt;
					return { ...item, detail: `${item.detail}${importedAt ? ` · ${new Date(importedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}` };
				}));
			} catch { warnings.push(`Could not load review work in ${path}.`); held.push({ kind: "batch", path }); }
		}
		for (const batch of activeBatches) {
			const sender = senders.get(batch.batchId);
			if (sender?.kind !== "human") continue;
			candidates.push({
				kind: "response",
				path: RESPONSES_FOLDER,
				locator: batch.batchId,
				title: `Write your response to ${sender.displayName}`,
				detail: `Replies to their comments and reasons for changes you kept · ${new Date(batch.importedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} pass`,
				complete: Boolean(batch.responseSavedAt),
				deferred: false,
				suggestedMinutes: 30,
			});
		}
		const deliveries = this.getEditorialDeliveries(folder);
		for (const candidate of candidates) {
			const delivery = deliveries.find((item) => candidate.kind === "directive" ? item.files.includes(candidate.path) : (candidate.kind === "batch" || candidate.kind === "response") && item.batchIds.includes(candidate.locator));
			if (!delivery) continue;
			candidate.deliveryId = delivery.id;
			candidate.due = delivery.due;
			// An Editorialism's detail already names its reviewer; show each part once.
			const parts = candidate.detail.split(" · ");
			const added = [...deliveryCaption(delivery).split(" · "), delivery.due ? `Due ${planDayLabel(delivery.due)}` : ""].filter((part) => part && !parts.includes(part));
			candidate.detail = [...parts, ...added].join(" · ");
		}
		return { candidates, warnings, held };
	}

	// Records the book's progress from a fresh read of its work: whatever was
	// open last time and is now finished or gone is done today. Work whose
	// source could not be read is held open. Both the planner and Today call
	// this, so progress moves whichever one the author opens.
	async recordRevisionProgress(book: string, work: RevisionWorkRead): Promise<void> {
		if (work.held.some((source) => source.kind === "all")) return;
		const plan = this.getRevisionPlan(book);
		const progress = advancePlanProgress(plan.progress, work.candidates.map((candidate) => ({
			key: sourceKey(candidate),
			kind: candidate.kind,
			state: candidate.inactive ? "inactive" as const : candidate.complete ? "complete" as const : "open" as const,
		})), localDate(new Date()), (item) => work.held.some((source) => {
			if (source.kind !== item.kind) return false;
			if (!("path" in source) || source.path === undefined) return true;
			const [, path] = JSON.parse(item.key) as [string, string];
			return path === source.path;
		}));
		if (JSON.stringify(progress) === JSON.stringify(plan.progress)) return;
		plan.progress = progress;
		await this.saveRevisionPlan(book, plan);
	}

	/** Current prose words of each engagement document that has a word limit. */
	async materialWordCounts(project: EditorialProject | undefined): Promise<Record<string, number>> {
		const counts: Record<string, number> = {};
		for (const material of project?.materials ?? []) {
			if (!material.wordLimit || !material.source) continue;
			const file = this.app.vault.getAbstractFileByPath(material.source);
			if (!(file instanceof TFile)) continue;
			counts[material.id] = countProseWords(this.resolveOpenNoteText(file.path) ?? await this.app.vault.cachedRead(file));
		}
		return counts;
	}

	async openRevisionWork(candidate: WorkCandidate): Promise<void> {
		if (candidate.kind === "response") {
			await this.openEditorResponse(candidate.locator);
			return;
		}
		if (candidate.kind === "batch") {
			await this.startOrResumeReviewForNote(candidate.path);
			const suggestion = this.store.getSession()?.suggestions.find((item) => item.source.batchId === candidate.locator && !["accepted", "rejected", "rewritten"].includes(item.status));
			if (suggestion) this.store.selectSuggestion(suggestion.id);
			return;
		}
		// Open the exact instruction in its source. Pending sessions can contain
		// several lines, so starting their aggregate sweep would broaden this task.
		const file = this.app.vault.getAbstractFileByPath(candidate.path);
		if (!(file instanceof TFile)) { new Notice("This source is no longer available. Refresh and relink the task."); return; }
		await this.app.workspace.openLinkText(file.path, "", false, candidate.line === undefined ? undefined : { eState: { line: candidate.line } });
	}

	async openPendingEditsPanel(): Promise<void> {
		await this.openEditorialistPanel(PENDING_EDITS_PANEL_VIEW_TYPE);
	}

	// Make an Ed panel visible WITHOUT changing its current mode. Launching a
	// pending-edits sweep uses this so it doesn't yank the Pending (or
	// Editorialism) panel back to Review — the toolbar drives the sweep, so the
	// side-panel mode is the author's to keep.
	async ensureEditorialistPanelOpen(): Promise<void> {
		const existing =
			this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE)[0] ??
			this.app.workspace.getLeavesOfType(PENDING_EDITS_PANEL_VIEW_TYPE)[0] ??
			this.app.workspace.getLeavesOfType(EDITORIALISM_PANEL_VIEW_TYPE)[0] ??
			this.app.workspace.getLeavesOfType(REVISION_PLAN_VIEW_TYPE)[0] ??
			this.app.workspace.getLeavesOfType(AUTHOR_PLAN_VIEW_TYPE)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		await this.openReviewPanel();
	}

	// The swatch mode switcher: a small menu of the panel modes, the
	// current one checked. Direct selection (no blind cycling) and it swaps the
	// single Ed leaf in place. Each mode also has its own command.
	showPanelModeMenu(event: MouseEvent, currentViewType: string): void {
		// Daily, then the working views a session opens into, then planning.
		const groups: Array<Array<{ type: string; label: string }>> = [
			[{ type: TODAY_VIEW_TYPE, label: t("panel.today") }],
			[
				{ type: REVIEW_PANEL_VIEW_TYPE, label: t("panel.review") },
				{ type: PENDING_EDITS_PANEL_VIEW_TYPE, label: t("panel.pendingEdits") },
				{ type: EDITORIALISM_PANEL_VIEW_TYPE, label: t("panel.editorialisms") },
			],
			[
				{ type: REVISION_PLAN_VIEW_TYPE, label: t("panel.editorEngagement") },
				{ type: AUTHOR_PLAN_VIEW_TYPE, label: t("panel.authorPlanner") },
			],
		];
		const menu = new Menu();
		for (const [index, modes] of groups.entries()) {
			if (index > 0) menu.addSeparator();
			for (const mode of modes) menu.addItem((item) => {
				item
					.setTitle(mode.label)
					.setIcon(EDITORIALIST_ICON_ID)
					.setChecked(mode.type === currentViewType)
					.onClick(() => {
						if (mode.type !== currentViewType) {
							void this.openEditorialistPanel(mode.type);
						}
					});
			});
		}
		menu.showAtMouseEvent(event);
	}

	// True when pasted launcher text carries a Format B editorialism file, so the
	// modal can offer the "Save editorialism file" action.
	detectEditorialismInText(rawText: string): boolean {
		return extractEditorialismFileFromText(rawText) !== null;
	}

	// True when the editorialism in pasted text is already saved and unchanged,
	// so the launcher can show that part of a two-part paste as done.
	async isEditorialismSavedFromText(rawText: string): Promise<boolean> {
		const extracted = extractEditorialismFileFromText(rawText);
		return extracted ? this.editorialismService.isEditorialismFileSaved(extracted) : false;
	}

	// Extract the Format B editorialism file from pasted text, write it to
	// Editorialist/<Book>/<Title>.md, open the Editorialisms panel, and reveal
	// the new file. Returns true when a file was saved.
	async saveEditorialismFromText(rawText: string): Promise<boolean> {
		const extracted = extractEditorialismFileFromText(rawText);
		if (!extracted) {
			new Notice("No editorialism file found in the pasted text.");
			return false;
		}
		const result = await this.editorialismService.saveEditorialismFile(extracted, async (details) => {
			const choice = await openEditorialistChoiceModal(this.app, {
				title: "Update existing editorialism?",
				description: "This agenda already exists. Progress on unchanged instructions and anchors stays intact. Review additions and removals before updating.",
				details,
				choices: [{ label: "Cancel", value: "cancel" }, { label: "Update agenda", value: "update", cta: true }],
			});
			return choice === "update";
		});
		if (result.cancelled) return false;
		if (result.keptApart) {
			new Notice(`A different reviewer's “${extracted.title}” already exists — saved this one beside it.`);
		}
		// The agenda's reviewer joins the contributor directory like a batch
		// reviewer would, so a developmental editor whose work arrives as a
		// checklist still has a profile. Directives carry no accept/reject, so
		// nothing here touches stats — identity only.
		if (extracted.reviewer) {
			this.reviewerDirectory.resolveContributor({
				rawName: extracted.reviewer,
				rawType: extracted.reviewerType ?? undefined,
			});
			await this.persistContributorProfilesIfNeeded();
		}
		new Notice(
			`${result.unchanged ? "Already imported" : result.created ? "Saved" : "Updated"} editorialism “${extracted.title}” at ${result.filePath}.`,
		);
		await this.linkImportToDelivery(
			{ kind: "file", path: result.filePath },
			extracted.reviewer,
			extracted.reviewerType ? formatReviewerTypeLabel(normalizeReviewerType(extracted.reviewerType)) : "",
			extracted.reviewerType ? normalizeReviewerType(extracted.reviewerType).startsWith("ai-") : false,
		);
		await this.openEditorialismPanel();
		const file = this.app.vault.getAbstractFileByPath(result.filePath);
		if (file instanceof TFile) {
			this.refreshReviewPanel();
		}
		return true;
	}

	async listEditorialismsForActiveBook(bookLabel: string | null): Promise<
		Awaited<ReturnType<EditorialismService["listForBook"]>>
	> {
		return this.editorialismService.listForBook(bookLabel, effortParamsFromSettings(this.getEffortSettings()));
	}

	async loadEditorialism(filePath: string): Promise<
		Awaited<ReturnType<EditorialismService["load"]>>
	> {
		return this.editorialismService.load(filePath);
	}

	async setEditorialismActive(filePath: string, active: boolean): Promise<void> {
		await this.editorialismService.setActive(filePath, active);
	}

	async setEditorialismItemStatus(
		filePath: string,
		lineIndex: number,
		nextStatus: Parameters<EditorialismService["setItemStatus"]>[2],
	): Promise<void> {
		await this.editorialismService.setItemStatus(filePath, lineIndex, nextStatus);
	}

	// Asks for (or edits) the author's answer to a decision directive and writes
	// it to the editorialism file. Cancel leaves the file untouched; an empty
	// answer clears a recorded decision.
	async promptEditorialismItemDecision(filePath: string, item: EditorialismItem): Promise<boolean> {
		const answer = await new DirectiveTextModal(this.app, displayDirectiveText(item.text), item.decision ?? "", DECISION_COPY).present();
		if (answer === null) {
			return false;
		}
		await this.editorialismService.setItemDecision(filePath, item.lineIndex, answer.trim() || null);
		this.refreshEditorialismPanel();
		return true;
	}

	// Asks for (or edits) the author's question about a directive. Saving marks
	// the directive a Question; cancel leaves the file untouched.
	async promptEditorialismItemQuestion(filePath: string, item: EditorialismItem): Promise<boolean> {
		const question = await new DirectiveTextModal(this.app, displayDirectiveText(item.text), item.question ?? "", QUESTION_COPY).present();
		if (question === null) {
			return false;
		}
		await this.editorialismService.setItemQuestion(filePath, item.lineIndex, question.trim() || null);
		this.refreshEditorialismPanel();
		return true;
	}

	// Directives from the active book's editorialisms that bear on a scene, for
	// the review panel's in-sweep card.
	//
	// The CALLER supplies the scene context rather than this method reading the
	// active note itself. The panel caches the result against the context it
	// asked for, and if this method resolved its own context the two could
	// disagree — load scene 26's directives, file them under scene 29 — which is
	// exactly how the card went stale when the author moved between scenes.
	async collectSceneDirectivesForContext(context: SceneRelevanceContext): Promise<SceneDirective[]> {
		const summaries = await this.editorialismService.listForBook(
			this.registry.getActiveBookScopeInfo().label,
		);
		const loaded: Editorialism[] = [];
		for (const summary of summaries) {
			const editorialism = await this.editorialismService.load(summary.filePath);
			if (editorialism && isEditorialismActive(editorialism)) {
				loaded.push(editorialism);
			}
		}
		return collectSceneDirectives(loaded, context);
	}

	refreshEditorialismPanel(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(EDITORIALISM_PANEL_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof EditorialismPanel) {
				void view.refresh();
			}
		}
	}

	// Opens Editorialist's settings, on the given tab when one is named.
	openSettings(tab?: SettingsTabId): void {
		if (tab) this.settingTab?.selectTab(tab);
		const appWithSettings = this.app as App & {
			setting?: {
				open: () => void;
				openTabById?: (id: string) => void;
			};
		};

		appWithSettings.setting?.open();
		appWithSettings.setting?.openTabById?.(this.manifest.id);
	}

	private closeSettingsModal(): void {
		const appWithSettings = this.app as App & {
			setting?: {
				close?: () => void;
			};
		};
		appWithSettings.setting?.close?.();
	}

	// Bridges the guided-sweep workflow to the per-scene polish counter
	// (Editorialist.revision in scene frontmatter — see
	// incrementSceneEditorialRevision for the full intent and gates).
	async recordCompletedSceneRevision(
		notePath: string,
		batchId: string,
	): Promise<{ from: number; to: number } | null> {
		// Gate 3: only bump when the user has actually closed all suggestions
		// for this scene. Abandoning mid-review must not advance the counter.
		const session = this.getReviewSession();
		if (session?.notePath === notePath && !this.isSweepComplete(session.suggestions)) {
			return null;
		}

		return this.registry.incrementSceneEditorialRevision(notePath, batchId);
	}

	getCutFolderOverride(): string {
		return this.registry.getCutFolderOverride();
	}

	async setCutFolderOverride(value: string): Promise<void> {
		this.registry.setCutFolderOverride(value);
		await this.savePluginData();
	}

	getDetectFileWrittenReviewBlocks(): boolean {
		return this.registry.getDetectFileWrittenReviewBlocks();
	}

	async setDetectFileWrittenReviewBlocks(value: boolean): Promise<void> {
		this.registry.setDetectFileWrittenReviewBlocks(value);
		await this.savePluginData();
	}

	getManuscriptFiles(scope = this.getActiveBookScopeInfo()): TFile[] {
		const cutFolder = this.getCutFolderOverride();
		return this.app.vault.getMarkdownFiles().filter((file) => isSceneNoteForScope(this.app, file, scope, cutFolder));
	}

	isManuscriptTargetPath(path: string): boolean {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile && isSceneNoteForScope(this.app, file, this.getActiveBookScopeInfo(), this.getCutFolderOverride());
	}

	getManuscriptAssociations(): { path: string; name: string; missing: boolean }[] { return this.manuscriptAssociations.folders(); }
	getRadialBookChoices(): RadialBookChoice[] {
		const profiles = this.getReviewerProfiles();
		return radialBookChoices(this.radialBookGoals.books(), this.radialBookGoals.activeBookId(), (folder) => {
			const project = this.getRevisionPlan(folderPlanKey(folder)).project;
			return project ? { title: project.title, editor: projectEditor(project, profiles).name } : null;
		});
	}
	openManuscriptReconnection(onSaved?: () => void): void { new ManuscriptReconnectModal(this, onSaved).open(); }
	previewManuscriptReconnection(change: ManuscriptReassociation): Promise<ReassociationPreview> { return this.manuscriptAssociations.preview(change); }
	async applyManuscriptReconnection(preview: ReassociationPreview): Promise<void> {
		await this.manuscriptAssociations.apply(preview);
		await this.refreshAfterManuscriptReconnection();
		new Notice("Manuscript reconnected. Saved work now follows its folder.");
	}
	private async refreshAfterManuscriptReconnection(): Promise<void> {
		this.store.clearSession();
		this.store.setAppliedReview(null);
		this.store.setGuidedSweep(null);
		this.store.setCompletedSweep(null);
		this.clearActiveHighlights();
		await this.registry.syncOperationalMetadata();
		this.resyncSessionForActiveNote();
		this.refreshReviewPanel();
		this.refreshEditorialismPanel();
		await this.refreshPlanViews();
	}

	getManuscriptTarget(): ManuscriptTarget | undefined { return this.registry.getManuscriptTarget(); }

	openManuscriptTargetSelector(onSaved?: () => void): void { new ManuscriptTargetModal(this, onSaved).open(); }

	async setManuscriptTarget(target: ManuscriptTarget): Promise<void> {
		const previous = this.registry.getManuscriptTarget();
		const normalized = normalizeManuscriptTarget(target);
		this.registry.setManuscriptTarget(normalized);
		try { await this.savePluginData(); }
		catch (error) { this.registry.restoreManuscriptTarget(previous); throw error; }
		await this.registry.syncOperationalMetadata();
		const eligible = new Set(this.getManuscriptFiles().map((file) => file.path));
		if (this.store.getSession() && !eligible.has(this.store.getSession()!.notePath)) {
			this.store.clearSession();
			this.store.setAppliedReview(null);
			this.clearActiveHighlights();
		}
		if (this.getGuidedSweep()?.notePaths.some((path) => !eligible.has(path))) this.store.setGuidedSweep(null);
		if (this.store.getCompletedSweep()?.notePaths.some((path) => !eligible.has(path))) this.store.setCompletedSweep(null);
		this.syncActiveEditorDecorations();
		this.refreshReviewPanel();
		this.refreshEditorialismPanel();
		await this.refreshPlanViews();
	}

	getBookFolderOverride(): string {
		return this.registry.getBookFolderOverride();
	}

	// Persist the new manuscript-folder override, then re-resolve the active-book
	// scope and rebuild the inventory so the change to what counts as "in the
	// book" takes effect immediately (registry, panel, and import routing).
	async setBookFolderOverride(value: string): Promise<void> {
		this.registry.setBookFolderOverride(value);
		await this.setManuscriptTarget(createManuscriptTarget(value.trim() ? "folder" : "none", value));
	}

	// Shared author-query insertion flow behind all three entry points (command,
	// editor right-click, panel button). Prompts for the question, then writes a
	// `%%query: …%%` marker into the scene editor at the cursor — or after the
	// selection, never replacing it — so the next review picks it up. Falls back
	// to the clipboard when no scene editor is in view (e.g. the panel is focused
	// with no manuscript open).
	async insertAuthorQuery(target?: MarkdownView): Promise<void> {
		// The right-click menu passes the editor that was clicked. From the
		// command palette, resolve the target editor BEFORE the modal opens —
		// once it is open the modal leaf is active, so getSceneEditorView would
		// no longer see the scene. getSceneEditorView still recovers the review
		// session's note when focus is on the panel.
		const view = target ?? this.cutFiles.getSceneEditorView();
		const question = await new AuthorQueryModal(this.app).present();
		if (!question) {
			return;
		}

		const marker = formatAuthorQueryMarker(question);
		const editor = view?.editor;
		if (editor) {
			// Insert at the cursor, or immediately after the selection — never
			// replace selected prose, which would delete the passage the author is
			// asking about.
			editor.replaceRange(marker, editor.getCursor("to"));
			editor.focus();
			return;
		}

		await this.copyTextToClipboard(
			marker,
			"Author query copied — paste it into the scene.",
			"Could not copy the author query.",
		);
	}

	// Mark an answered query resolved: persist the decision and strip the
	// matching %%query:…%% (or legacy %%ai:…%%) marker from the scene note so it
	// is not re-asked on the next export/review.
	async resolveAuthorQuery(id: string): Promise<void> {
		await this.applyAuthorQueryDecision(id, "resolved");
	}

	// The editor's pass the author is answering: the batch under review, or
	// else the most recent pass from a person whose review blocks are still in
	// the scenes. An AI's pass gets no response; nobody reads it.
	async findRespondableBatchId(): Promise<string | null> {
		const current = this.getGuidedSweep()?.batchId ?? this.getCurrentBatchId();
		const candidates = this.getSweepRegistryEntries()
			.filter((entry) => entry.status !== "cleaned")
			.sort((a, b) => (b.batchId === current ? 1 : 0) - (a.batchId === current ? 1 : 0) || b.importedAt - a.importedAt);
		for (const entry of candidates) {
			const response = await this.collectEditorResponse(entry.batchId);
			if (response) return entry.batchId;
		}
		return null;
	}

	// Who made a batch, read from the review session on screen. Null when the
	// session holds nothing from that batch.
	private getBatchContributor(batchId: string): ReviewContributor | null {
		const session = this.store.getSession();
		const item = [...(session?.suggestions ?? []), ...(session?.memos ?? [])].find((entry) => entry.source.batchId === batchId);
		return item?.contributor ?? null;
	}

	// One batch's scenes as they are now, with who made the batch. Null when
	// the batch is gone from the scenes.
	private async collectBatchScenes(batchId: string): Promise<{ entry: ReviewSweepRegistryEntry; scenes: EditorResponseSceneInput[]; reviewer: ReviewContributor | null } | null> {
		const entry = this.getSweepRegistryEntry(batchId);
		if (!entry || entry.status === "cleaned") return null;
		const paths = [...entry.sceneOrder.filter((path) => entry.importedNotePaths.includes(path)), ...entry.importedNotePaths.filter((path) => !entry.sceneOrder.includes(path))];
		const scenes: EditorResponseSceneInput[] = [];
		let reviewer: ReviewContributor | null = null;
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const text = this.resolveOpenNoteText(path) ?? await this.app.vault.cachedRead(file);
			const session = this.registry.applyPersistedReviewState(this.reviewEngine.buildSession(path, text, null));
			reviewer ??= [...session.suggestions, ...session.memos].find((item) => item.source.batchId === batchId)?.contributor ?? null;
			scenes.push({ notePath: path, sceneId: this.registry.getSceneIdForNotePath(path) ?? undefined, title: this.getNoteDisplayLabel(path), suggestions: session.suggestions, memos: session.memos });
		}
		// The pass records scenes in the order the import grouped them, which
		// puts a scene holding only a comment after the rest. The response is
		// read like the book, so it follows the story order the panel lists.
		scenes.sort((left, right) => compareSceneTitles(left.title, right.title));
		return { entry, scenes, reviewer };
	}

	// The response to one batch, read from its scenes as they are now and the
	// replies saved so far. Null when the batch is gone from the scenes or was
	// made by an AI.
	async collectEditorResponse(batchId: string): Promise<EditorResponse | null> {
		const batch = await this.collectBatchScenes(batchId);
		if (!batch?.reviewer || batch.reviewer.kind !== "human") return null;
		return composeEditorResponse({
			batchId,
			reviewer: batch.reviewer.displayName,
			bookLabel: batch.entry.activeBookLabel,
			date: new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
			scenes: batch.scenes,
			replies: this.registry.getEditorReplies(),
		});
	}

	async openEditorResponse(batchId?: string, focusKey?: string): Promise<void> {
		const id = batchId ?? await this.findRespondableBatchId();
		const response = id ? await this.collectEditorResponse(id) : null;
		if (!id || !response) {
			new Notice("There is no editor's pass to respond to. A response is made from an editor's changes while they are still in your scenes.");
			return;
		}
		new EditorResponseModal(this.app, this, id, response, focusKey).open();
	}

	saveEditorReply(key: string, text: string): void {
		this.registry.setEditorReply(key, text);
		void this.savePluginData();
	}

	getEditorReply(key: string): string {
		return this.registry.getEditorReplies()[key] ?? "";
	}

	getAuthorName(): string {
		return this.registry.getSettings().authorName ?? "";
	}

	async setAuthorName(name: string): Promise<void> {
		this.registry.setAuthorName(name);
		await this.savePluginData();
	}

	// The editor's Word file a batch came from, when it was kept at import.
	getBatchWordSource(batchId: string): { path: string; editor: string } | null {
		return this.getSweepRegistryEntry(batchId)?.wordSource ?? null;
	}

	// Keeps a copy of the editor's Word file in Editorialist/Word files and
	// records it on the batch. A different file of the same name gets a number.
	async keepWordFile(batchId: string, fileName: string, editor: string, bytes: Uint8Array): Promise<void> {
		const folder = WORD_FILES_FOLDER;
		if (!(await this.ensureVaultFolder(folder))) throw new Error("The review was imported, but the Word file could not be kept. Free the Word files folder and keep the original file.");
		const dot = fileName.toLowerCase().endsWith(".docx") ? fileName.length - 5 : fileName.length;
		const stem = fileName.slice(0, dot).replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "Editor's file";
		let path = normalizePath(`${folder}/${stem}.docx`);
		for (let copy = 2; ; copy++) {
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (!existing) {
				await this.app.vault.createBinary(path, new Uint8Array(bytes).buffer);
				break;
			}
			if (existing instanceof TFile && sameBytes(new Uint8Array(await this.app.vault.readBinary(existing)), bytes)) break;
			path = normalizePath(`${folder}/${stem} ${copy}.docx`);
		}
		await this.registry.updateSweepRegistry(batchId, { wordSource: { path, editor } });
	}

	private async ensureVaultFolder(folder: string): Promise<boolean> {
		const blocked = await ensureVaultFolderPath(this.app, folder, { stopAtFile: true });
		if (blocked !== null) {
			new Notice(`A file named “${blocked}” is in the way of the ${folder} folder.`);
			return false;
		}
		return true;
	}

	// Writes a new file and returns its path. A file already of that name, which
	// the author may have edited since, is never replaced: the new one is
	// numbered instead ("… 2.docx").
	private async writeNewVaultBinary(folder: string, name: string, bytes: Uint8Array): Promise<string> {
		const stem = name.replace(/[\\/:*?"<>|#^[\]]/g, "-");
		let path = normalizePath(`${folder}/${stem}.docx`);
		for (let copy = 2; this.app.vault.getAbstractFileByPath(path); copy++) path = normalizePath(`${folder}/${stem} ${copy}.docx`);
		// A copy, so the vault gets a plain ArrayBuffer of exactly these bytes.
		await this.app.vault.createBinary(path, new Uint8Array(bytes).buffer);
		return path;
	}

	// A saved response finishes the pass's response task in planning; Today and
	// the planner follow.
	private async recordResponseSaved(batchId: string): Promise<void> {
		await this.registry.updateSweepRegistry(batchId, { responseSavedAt: Date.now() });
		await this.refreshPlanViews();
	}

	// Writes the response as a Word file in Editorialist/Responses and returns
	// its path.
	async saveEditorResponseFile(batchId: string): Promise<string | null> {
		const response = await this.collectEditorResponse(batchId);
		if (!response) {
			new Notice("This editor's changes are no longer in your scenes, so the response cannot be made.");
			return null;
		}
		if (!(await this.ensureVaultFolder(RESPONSES_FOLDER))) return null;
		const path = await this.writeNewVaultBinary(RESPONSES_FOLDER, `Response to ${response.reviewer} ${localDate(new Date())}`, writeDocx(editorResponseParagraphs(response)));
		await this.recordResponseSaved(batchId);
		return path;
	}

	// Writes the author's replies into a copy of the editor's own Word file, in
	// Editorialist/Responses. Returns the copy's path and how many answers
	// found their place in it, or null with a notice when it cannot be made.
	async saveRepliesInWordFile(batchId: string): Promise<{ path: string; placed: number; expected: number } | null> {
		const source = this.getBatchWordSource(batchId);
		const batch = await this.collectBatchScenes(batchId);
		const authorName = this.getAuthorName();
		if (!source || !batch) {
			new Notice("This editor's changes are no longer in your scenes, so the reply cannot be made.");
			return null;
		}
		const file = this.app.vault.getAbstractFileByPath(source.path);
		if (!(file instanceof TFile)) {
			new Notice(`The editor's Word file is no longer at ${source.path}, so the reply cannot be written into it.`);
			return null;
		}
		if (!authorName) {
			new Notice("Add your name first. Word shows it on each of your comments.");
			return null;
		}
		const answers = wordAnswers({ batchId, scenes: batch.scenes, replies: this.registry.getEditorReplies() });
		if (answers.expected === 0) {
			new Notice("Nothing to write yet. Reply to a comment, or reject a change, first.");
			return null;
		}
		let result: Awaited<ReturnType<typeof writeWordReplies>>;
		try {
			result = await writeWordReplies(new Uint8Array(await this.app.vault.readBinary(file)), {
				editor: source.editor,
				author: { name: authorName, initials: initialsOf(authorName) },
				date: new Date(),
				replyFor: answers.answerFor,
			});
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not write into the editor's Word file.");
			return null;
		}
		if (result.placed === 0) {
			new Notice(`None of your replies found their place in ${file.name}. Save them as a letter instead.`);
			return null;
		}
		if (!(await this.ensureVaultFolder(RESPONSES_FOLDER))) return null;
		const path = await this.writeNewVaultBinary(RESPONSES_FOLDER, `${file.basename} with replies ${localDate(new Date())}`, result.bytes);
		await this.recordResponseSaved(batchId);
		return { path, placed: result.placed, expected: answers.expected };
	}

	// Dismiss a query: persist the decision but leave the note untouched — the
	// author chose not to act, and the marker stays for a later pass.
	async dismissAuthorQuery(id: string): Promise<void> {
		await this.applyAuthorQueryDecision(id, "dismissed");
	}

	private async applyAuthorQueryDecision(id: string, status: "resolved" | "dismissed"): Promise<void> {
		const session = this.getReviewSession();
		const memo = session?.memos.find((entry) => entry.id === id && entry.kind === "query");
		if (!session || !memo || !memo.question) {
			return;
		}

		if (status === "resolved") {
			await this.stripAuthorQueryMarker(session.notePath, memo.question);
		}

		await this.registry.persistAuthorQueryDecision(session.notePath, memo.question, status);
		this.store.updateMemoStatus(id, status);
	}

	private async stripAuthorQueryMarker(notePath: string, question: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return;
		}
		// Warn only when the scene actually holds a marker we failed to match — a
		// reviewer can raise a QUERY the author never asked for, and there is
		// nothing to strip for one of those. Warning on that case told authors to
		// go delete a marker that had never existed, which read as the resolve
		// having failed when it had not.
		if ((await this.applyAuthorQueryMarkerStrip(file, question)) === "unmatched") {
			new Notice(
				"Query resolved, but its `%%query:…%%` marker was not found in the scene (the review may have reworded the question). Remove the marker manually so it is not re-asked.",
			);
		}
	}

	// Split out so the outcome crosses an annotated boundary: TypeScript narrows a
	// local to its initializer because it cannot see the vault.process callback
	// assign to it, which makes the comparison above look impossible.
	private async applyAuthorQueryMarkerStrip(
		file: TFile,
		question: string,
	): Promise<AuthorQueryStripOutcome> {
		let outcome: AuthorQueryStripOutcome = "no_marker_present";
		await saveOpenEditors(this.app, file.path);
		await this.app.vault.process(file, (text) => {
			const result = stripAuthorQueryMarkerFromText(text, question);
			outcome = result.outcome;
			return result.text;
		});
		return outcome;
	}

	private reviewStateMachineInstance: ReviewStateMachine | null = null;

	private getReviewStateMachine(): ReviewStateMachine {
		if (!this.reviewStateMachineInstance) {
			this.reviewStateMachineInstance = new ReviewStateMachine(this.createReviewStateMachineHost());
		}
		return this.reviewStateMachineInstance;
	}

	private createReviewStateMachineHost(): ReviewStateMachineHost {
		return {
			store: {
				getSession: () => this.store.getSession(),
				getCompletedSweep: () => this.store.getCompletedSweep(),
				selectSuggestion: (suggestionId) => this.store.selectSuggestion(suggestionId),
				updateSuggestionStatus: (suggestionId, status) =>
					this.store.updateSuggestionStatus(suggestionId, status),
				setCompletedSweep: (value) => this.store.setCompletedSweep(value),
				setGuidedSweep: (value) => this.store.setGuidedSweep(value),
			},
			getSelectedSuggestionId: () => this.store.getState().selectedSuggestionId,
			getGuidedSweep: () => this.getGuidedSweep(),
			registry: {
				captureReviewDecisionRollback: (notePath, suggestion) =>
					this.registry.captureReviewDecisionRollback(notePath, suggestion),
				persistReviewDecision: (notePath, suggestion, status, options) =>
					this.registry.persistReviewDecision(notePath, suggestion, status, options),
				clearPersistedReviewDecision: (notePath, suggestion, options) =>
					this.registry.clearPersistedReviewDecision(notePath, suggestion, options),
				syncReviewerSignalsForSession: (session, options) =>
					this.registry.syncReviewerSignalsForSession(session as ReviewSession | null, options),
				syncSceneInventoryForSession: (session) =>
					this.registry.syncSceneInventoryForSession(session as ReviewSession | null),
			},
			getReviewNoteContext: () => this.getReviewNoteContext(),
			getActiveEditorView: () => this.getActiveEditorView(),
			focusReviewLeaf: (view) => this.focusReviewLeaf(view as MarkdownView),
			executeEditorUndo: () => runEditorUndo(this.app.workspace.getActiveViewOfType(MarkdownView)),
			notify: (message) => {
				new Notice(message);
			},
			canAcceptSuggestion: (suggestionId) => this.canAcceptSuggestion(suggestionId),
			canRejectSuggestion: (suggestionId) => this.canRejectSuggestion(suggestionId),
			canMarkSuggestionRewritten: (suggestionId) => this.canMarkSuggestionRewritten(suggestionId),
			hasActiveReviewSession: () => this.hasActiveReviewSession(),
			hasReviewSessionContext: () => this.hasReviewSessionContext(),
			getReviewSession: () => this.getReviewSession(),
			getSuggestionById: (suggestionId) => this.getSuggestionById(suggestionId),
			getCurrentSessionTrackingContext: () => this.getCurrentSessionTrackingContext(),
			getPanelOnlyReviewStateForSession: (session) =>
				this.getPanelOnlyReviewStateForSession(session as ReviewSession | null),
			revealSelectedSuggestion: () => this.revealSelectedSuggestion(),
			revealSuggestionContext: (suggestionId) => this.revealSuggestionContext(suggestionId),
			enterGuidedSweepHandoff: () => this.enterGuidedSweepHandoff(),
			refreshSessionAfterAcceptedEdit: (session, suggestionId) =>
				this.refreshSessionAfterAcceptedEdit(session as ReviewSession, suggestionId),
			syncActiveEditorDecorations: () => this.syncActiveEditorDecorations(),
			resyncSessionForActiveNote: () => this.resyncSessionForActiveNote(),
			focusResolvedTarget: async (target) => {
				await this.focusResolvedTarget(target as ReviewTargetRef | undefined);
			},
			getLastAppliedChange: () => this.lastAppliedChange,
			setLastAppliedChange: (value) => {
				this.lastAppliedChange = value;
			},
			setActiveHighlight: (range, tone) => {
				this.activeHighlightRange = range;
				this.activeHighlightTone = tone ?? "active";
			},
		};
	}

	// One-click reconciliation from the workspace view: open (or resume) the
	// scene's review session, then mark its unmatched leftovers as rewritten.
	// The resolve step recomputes unmatched-ness from the live session after
	// matching runs, so a stale registry count can never over-resolve.
	async resolveUnmatchedSuggestionsForNote(notePath: string): Promise<void> {
		await this.startOrResumeReviewForNote(notePath);
		const session = this.getCurrentReviewSession();
		if (session?.notePath !== notePath) {
			return;
		}
		await this.reviewActions.resolveUnmatchedSuggestions();
	}

	getReviewerProfiles(): ContributorProfile[] {
		return this.reviewerDirectory.getProfiles();
	}

	getSortedReviewerProfiles(): ContributorProfile[] {
		return this.reviewerDirectory.getSortedProfiles();
	}

	getReviewerProfile(reviewerId?: string): ContributorProfile | null {
		return reviewerId ? this.reviewerDirectory.getProfileById(reviewerId) : null;
	}

	getSweepRegistryEntries(): ReviewSweepRegistryEntry[] {
		return this.registry.getSweepRegistryEntries();
	}

	private endingReviewRound = false;

	getEndableRoundBatches(): ReviewSweepRegistryEntry[] {
		const eligible = new Set(this.getManuscriptFiles().map((file) => file.path));
		return getEndableRoundBatches(
			this.getSweepRegistryEntries(), this.getActiveBookScopeInfo().sourceFolder,
			(this.getGuidedSweep()?.batchId ?? this.getCurrentBatchId()),
		).filter((entry) => entry.importedNotePaths.every((path) => eligible.has(path)));
	}

	async endCurrentReviewRound(): Promise<void> {
		if (this.endingReviewRound) return;
		this.endingReviewRound = true;
		try {
			await this.registry.syncSceneInventory();
			const scope = this.getActiveBookScopeInfo();
			const entries = this.getEndableRoundBatches().map((entry) => structuredClone(entry));
			if (entries.length === 0) {
				new Notice("No removable review batches in the current book. Open a scene with feedback or select your manuscript folder.");
				return;
			}
			let selected = entries;
			if (entries.length > 1) {
				const currentId = (this.getGuidedSweep()?.batchId ?? this.getCurrentBatchId());
				const current = entries.find((entry) => entry.batchId === currentId);
				const choice = await openEditorialistChoiceModal(this.app, {
					title: "End current round",
					description: `Choose the feedback to remove from ${scope.label ?? "the current scene"}. Your manuscript edits will be kept.`,
					details: entries.map((entry) => `${entry.batchId} · ${entry.importedNotePaths.length} ${entry.importedNotePaths.length === 1 ? "scene" : "scenes"}`),
					choices: [
						...(current ? [{ label: "Current batch only", value: "current" }] : []),
						{ label: "All remaining batches in this book", value: "all" },
						{ label: "Cancel", value: "cancel" },
					],
				});
				if (!choice || choice === "cancel") return;
				if (choice === "current" && current) selected = [current];
			}
			const paths = [...new Set(selected.flatMap((entry) => entry.importedNotePaths))];
			const choice = await openEditorialistChoiceModal(this.app, {
				title: "End this round?",
				description: `Remove ${selected.length} review batch${selected.length === 1 ? "" : "es"} from ${paths.length} scene${paths.length === 1 ? "" : "s"}? Your manuscript edits and decision counts will be retained. Unfinished suggestions will be removed without counting as rejected.`,
				details: [...selected.map((entry) => `Batch: ${entry.batchId}`), ...paths],
				choices: [
					{ label: "End round and clear feedback", value: "end" },
					{ label: "Cancel", value: "cancel" },
				],
			});
			if (choice !== "end") return;
			if (selected.some((entry) => JSON.stringify(entry.importedNotePaths) !== JSON.stringify(this.getSweepRegistryEntry(entry.batchId)?.importedNotePaths))) {
				throw new Error("The selected scenes changed. Open End current round again.");
			}
			if (manuscriptScopeKey(scope) !== manuscriptScopeKey(this.getActiveBookScopeInfo())) throw new Error("The manuscript target changed. Open End current round again.");
			await endReviewRound({
				app: this.app,
				getNoteContextByPath: (path) => this.getNoteContextByPath(path),
				getScopeFolder: () => this.getActiveBookScopeInfo().sourceFolder,
				getScopeKey: () => manuscriptScopeKey(this.getActiveBookScopeInfo()),
				getEntry: (id) => this.getSweepRegistryEntry(id),
				getDecisionStats: (id) => this.getBatchDecisionStats(id),
				updateEntry: (id, updates) => this.registry.updateSweepRegistry(id, updates, { persist: false }),
				sync: async () => { await this.registry.syncSceneInventory(); await this.savePluginData(); },
				clearNavigation: (ids) => {
					if (ids.includes(this.getGuidedSweep()?.batchId ?? "")) this.store.setGuidedSweep(null);
					if (ids.includes(this.store.getCompletedSweep()?.batchId ?? "")) this.store.setCompletedSweep(null);
					this.store.setAppliedReview(null);
					this.resyncSessionForActiveNote();
					this.refreshReviewPanel();
				},
			}, selected.map((entry) => entry.batchId), scope.sourceFolder);
			new Notice("Round ended. Your edits and decision counts were kept. You can import the revised feedback now.");
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not end the review round.", 10000);
		} finally {
			this.endingReviewRound = false;
		}
	}

	// Sweep batches in the active book that are fully decided and still carry a
	// review block — i.e. cleanable right now. Powers the panel header's Clean
	// action so the user never has to hunt for per-card clean links.
	getCleanableBatchIds(): string[] {
		const eligible = new Set(this.getManuscriptFiles().map((file) => file.path));
		const inActiveBook = (entry: ReviewSweepRegistryEntry): boolean => {
			const paths = entry.importedNotePaths;
			return paths.length > 0 && paths.every((path) => eligible.has(path));
		};
		return this.registry
			.getSweepRegistryEntries()
			.filter((entry) => inActiveBook(entry) && isBatchReadyToClean(entry, this.getBatchDecisionStats(entry.batchId)))
			.map((entry) => entry.batchId);
	}

	// Remove the review blocks of every cleanable batch in one pass — one sync,
	// one summary notice, one panel refresh. Returns the batch count cleaned.
	async cleanReadyBatches(): Promise<number> {
		const batchIds = this.getCleanableBatchIds();
		if (batchIds.length === 0) {
			new Notice("No resolved batches are ready to clean.");
			return 0;
		}
		if (
			!(await this.confirmReviewBlockRemoval(
				`This removes the imported review blocks of ${batchIds.length} resolved batch${batchIds.length === 1 ? "" : "es"} from their scenes.`,
			))
		) {
			return 0;
		}
		let blocksRemoved = 0;
		let cleaned = 0;
		let skippedUnfencedCount = 0;
		for (const batchId of batchIds) {
			const outcome = await this.batchProcessor.cleanupReviewBatch(batchId, { notify: false });
			blocksRemoved += outcome.removedCount;
			if (!outcome.skipped) cleaned++;
			skippedUnfencedCount += outcome.skippedUnfencedCount;
		}
		this.refreshReviewPanel();
		new Notice(
			`Cleaned ${cleaned} batch${cleaned === 1 ? "" : "es"} (${blocksRemoved} review block${blocksRemoved === 1 ? "" : "s"}) from their scenes.` +
				(cleaned < batchIds.length ? ` ${batchIds.length - cleaned} batch${batchIds.length - cleaned === 1 ? " was" : "es were"} left uncleaned because the manuscript target or saved registry changed.` : "") +
				describeUnremovedBlocksSuffix(skippedUnfencedCount),
		);
		return cleaned;
	}

	// Aggregates per-suggestion decisions across scenes that participated in a
	// given sweep batch. Exact when each touched scene has only seen this one
	// batch (the common case); approximate when scenes are shared across
	// batches — in that case counts are the union, which is acceptable for the
	// at-a-glance Recent Reviews display.
	getBatchDecisionStats(batchId: string): {
		accepted: number;
		rejected: number;
		rewritten: number;
		deferred: number;
	} {
		return this.registry.getBatchDecisionStats(batchId);
	}

	// The round's edits: review edits from the scenes, plus each directive of
	// the active book's Editorialism agendas that are still in use.
	async collectEditMatrix(): Promise<{ scenes: EditMatrixScene[]; startedAt: number; rounds: EditRound[] }> {
		const directives: LiveEdit[] = [];
		for (const summary of await this.listEditorialismsForActiveBook(this.getActiveBookScopeInfo().label)) {
			if (!isEditorialismActive(summary)) continue;
			const editorialism = await this.loadEditorialism(summary.filePath);
			const file = this.app.vault.getAbstractFileByPath(summary.filePath);
			if (editorialism && file instanceof TFile) directives.push(...directiveEdits(editorialism, file.stat.ctime));
		}
		return this.registry.collectEditMatrix(directives);
	}

	// Opens an Editorialism agenda in its panel with one directive in view.
	async openEditorialismItem(filePath: string, id: string): Promise<void> {
		const leaf = await this.openEditorialistPanel(EDITORIALISM_PANEL_VIEW_TYPE);
		if (!(leaf?.view instanceof EditorialismPanel)) {
			new Notice("Could not open the Editorialism panel.");
			return;
		}
		// The directive's line is found now, since lines move as the agenda changes.
		const editorialism = await this.loadEditorialism(filePath);
		await leaf.view.showItem(filePath, editorialism ? directiveLine(editorialism, id) ?? -1 : -1);
	}

	private sceneSpotlight: SceneSpotlight | null = null;
	private spotlightRun = 0;

	/**
	 * Lights an edit's scene up wherever it is shown; null puts it out. A
	 * directive's scene is its first anchored scene, else the scene or the
	 * first scene of the range it is scoped to. A directive with none of those
	 * lights nothing, rather than a guess.
	 */
	async spotlightEdit(edit: { notePath: string; source: DotSource; id: string } | null): Promise<void> {
		const run = ++this.spotlightRun;
		this.sceneSpotlight ??= new SceneSpotlight(this.app);
		if (!edit) {
			this.sceneSpotlight.show(null);
			return;
		}
		let path: string | null = edit.notePath;
		if (edit.source === "editorialism") {
			const editorialism = await this.loadEditorialism(edit.notePath);
			if (run !== this.spotlightRun) return;
			const item = editorialism ? directiveItem(editorialism, edit.id) : null;
			path = item ? this.directiveScenePath(item) : null;
		}
		this.sceneSpotlight.show(path);
	}

	private directiveScenePath(item: EditorialismItem): string | null {
		for (const anchor of item.anchors) {
			const file = this.anchors.resolveAnchorSceneFile(anchor, item);
			if (file) return file.path;
		}
		const scene = item.scope?.kind === "scene" ? item.scope.scene : item.scope?.kind === "range" ? item.scope.start : undefined;
		const number = scene ? Number.parseInt(scene, 10) : Number.NaN;
		return Number.isFinite(number) ? this.anchors.resolveSceneFileByNumber(number)?.path ?? null : null;
	}

	async startNewEditRound(archive: boolean): Promise<void> {
		await this.registry.startNewEditRound(archive);
		this.refreshReviewPanel();
		for (const leaf of this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE)) if (leaf.view instanceof TodayPanel) leaf.view.reloadEdits();
	}

	getSceneReviewRecords(options?: { activeBookOnly?: boolean }): SceneReviewRecord[] {
		return this.registry.getSceneReviewRecords(options);
	}

	getTrackingIdentitySummary(options?: { activeBookOnly?: boolean }): {
		editorialIdCount: number;
		genericFrontmatterIdCount: number;
		missingCount: number;
		mode: "editorial-note-ids" | "frontmatter-ids" | "path-fallback" | "radial-timeline";
		rtSceneIdCount: number;
		trackedCount: number;
	} {
		return this.registry.getTrackingIdentitySummary(options);
	}

	getActiveBookScopeInfo(): ActiveBookScopeInfo {
		return this.registry.getActiveBookScopeInfo();
	}

	async refreshActiveBookScope(): Promise<void> {
		await this.registry.refreshActiveBookScope();
	}

	async syncOperationalMetadata(): Promise<void> {
		await this.registry.syncOperationalMetadata();
	}

	async injectStableNoteIdsIntoTrackedNotes(activeBookOnly = false): Promise<number> {
		const notePaths = this.getSceneReviewRecords({ activeBookOnly }).map((record) => record.notePath);
		const injectedCount = await this.registry.injectStableNoteIds(notePaths);
		this.resyncSessionForActiveNote();
		this.refreshReviewPanel();
		return injectedCount;
	}

	async resetBatchHistory(batchId: string): Promise<{ removedDecisions: number; removedSignals: number; removedSweep: boolean }> {
		return this.batchProcessor.resetBatchHistory(batchId);
	}

	async resetAllRevisionHistory(): Promise<{ removedDecisions: number; removedSignals: number; removedSweeps: number }> {
		const result = await this.registry.resetAllRevisionHistory();
		await this.reviewActions.closeActiveReviewContext();
		this.store.batch(() => {
			this.store.setGuidedSweep(null);
			this.store.acknowledgeCompletedSweep(null);
		});
		await this.savePluginData();
		this.resyncSessionForActiveNote();
		this.refreshReviewPanel();
		return result;
	}

	getReviewActivitySummary(): {
		accepted: number;
		cleanedSweeps: number;
		completedSweeps: number;
		deferred: number;
		processed: number;
		inProgressSweeps: number;
		pending: number;
		rejected: number;
		rewritten: number;
		totalSuggestions: number;
		totalSweeps: number;
		unresolved: number;
	} {
		return this.registry.getReviewActivitySummary();
	}

	getReviewPanelHeaderDetails(): {
		summary: string;
	} {
		const session = this.store.getSession();
		if (!session) {
			return {
				summary: "",
			};
		}

		const parts = [`${session.suggestions.length} ${session.suggestions.length === 1 ? "suggestion" : "suggestions"}`];
		const guidedSweep = this.getGuidedSweep();
		if (guidedSweep?.notePaths.length) {
			parts.push(`${guidedSweep.notePaths.length} ${this.getSweepUnitLabel(guidedSweep.notePaths.length, session.notePath)}`);
			if (guidedSweep.notePaths.length > 1) {
				parts.push(`${guidedSweep.currentNoteIndex + 1}/${guidedSweep.notePaths.length}`);
			}
		} else {
			const batchId = this.getCurrentBatchId();
			const entry = this.getSweepRegistryEntry(batchId ?? undefined);
			if (entry?.importedNotePaths.length) {
				parts.push(`${entry.importedNotePaths.length} ${this.getSweepUnitLabel(entry.importedNotePaths.length, session.notePath)}`);
			}
		}

		return {
			summary: parts.join(" • "),
		};
	}

	usesSceneTerminology(notePath?: string): boolean {
		return this.registry.usesSceneTerminology(notePath);
	}

	getGuidedSweepHandoffState(): GuidedSweepHandoffState | null {
		const guidedSweep = this.getGuidedSweep();
		const session = this.getReviewSession() ?? this.store.getSession();
		if (!guidedSweep || !session || !this.shouldShowGuidedSweepHandoff(session)) {
			return null;
		}

		const currentPath = guidedSweep.notePaths[guidedSweep.currentNoteIndex] ?? session.notePath;
		const nextPath = guidedSweep.notePaths[guidedSweep.currentNoteIndex + 1];
		const isFinal = !nextPath;
		const unitLabel = this.registry.usesSceneTerminology(currentPath) ? "scene" : "note";
		const unitTitle = this.toTitleCase(unitLabel);

		return {
			currentPath,
			isFinal,
			nextLabel: nextPath ? this.getNoteDisplayLabel(nextPath) : undefined,
			nextPath,
			primaryActionLabel: isFinal ? "Finish pass" : `Next ${unitLabel}`,
			progressLabel: isFinal
				? "You're done with this pass."
				: `${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`,
			panelProgressLabel: `${unitTitle} ${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`,
			secondaryActionLabel: isFinal ? undefined : "Finish pass",
			summary: isFinal
				? "You're done with this pass."
				: `All revision notes in this ${unitLabel} are resolved.`,
			title: isFinal ? "All revision notes are resolved" : `${unitTitle} complete`,
			unitLabel,
		};
	}

	getPanelOnlyReviewState(): PanelOnlyReviewState | null {
		return this.getPanelOnlyReviewStateForSession();
	}

	getNextLogicalReviewLaunchTarget(): ReviewLaunchTarget | null {
		if (this.getPostCompletionIdleState()) {
			return null;
		}

		const context = this.getActiveNoteContext();
		const launchState = this.getEditorialistLaunchState(context);
		if (context && launchState.currentNoteHasReviewBlock && launchState.currentNoteStatus !== "completed") {
			return {
				intent: "active",
				label: this.getNoteDisplayLabel(context.filePath),
				notePath: context.filePath,
				unitLabel: launchState.noteUnitLabel,
			};
		}

		if (launchState.nextNotePath && launchState.nextNoteLabel) {
			return {
				intent: "next",
				label: launchState.nextNoteLabel,
				notePath: launchState.nextNotePath,
				unitLabel: launchState.noteUnitLabel,
			};
		}

		const guidedSweep = this.getGuidedSweep();
		if (guidedSweep?.notePaths.length) {
			const candidatePath = guidedSweep.notePaths
				.slice(guidedSweep.currentNoteIndex)
				.find((notePath) => this.isSweepableSceneRecord(this.getSceneReviewRecordByPath(notePath)));
			if (candidatePath) {
				return {
					intent: context?.filePath === candidatePath ? "active" : "next",
					label: this.getNoteDisplayLabel(candidatePath),
					notePath: candidatePath,
					unitLabel: this.registry.usesSceneTerminology(candidatePath) ? "scene" : "note",
				};
			}
		}

		const activeBookCandidate = this.getSceneReviewRecords({ activeBookOnly: true }).find((record) =>
			this.isSweepableSceneRecord(record),
		);
		if (!activeBookCandidate) {
			return null;
		}

		return {
			intent: context?.filePath === activeBookCandidate.notePath ? "active" : "next",
			label: activeBookCandidate.noteTitle,
			notePath: activeBookCandidate.notePath,
			unitLabel: this.registry.usesSceneTerminology(activeBookCandidate.notePath) ? "scene" : "note",
		};
	}

	getCompletedSweepPanelState(): CompletedSweepPanelState | null {
		const completedSweep = this.getResolvedCompletedSweepState();
		if (!completedSweep) {
			return null;
		}
		if (this.store.getAcknowledgedCompletedSweepBatchId() === completedSweep.batchId) {
			return null;
		}

		const { entry, unitLabel, isCleaned, batchFinished, pending, otherPendingNotePaths, title } =
			this.resolveCompletedSweepOutcome(completedSweep);
		const unfinishedScenes = batchFinished || !entry
			? 0
			: pending.filter(
				(item) => entry.importedNotePaths.includes(item.notePath) && !completedSweep.notePaths.includes(item.notePath),
			).length;
		// Order (and therefore emphasis — the card marks its first step primary)
		// is decided in SweepCompletion alongside the rest of the sweep-state
		// rules, so it stays testable and cannot drift from isBatchReadyToClean.
		const nextSteps: CompletedSweepPanelState["nextSteps"] = batchFinished
			? buildCompletedSweepNextSteps({
				isCleaned,
				hasImportedNotes: (entry?.importedNotePaths.length ?? 0) > 0,
				respondTo: this.getBatchContributor(completedSweep.batchId)?.kind === "human"
					? this.getBatchContributor(completedSweep.batchId)?.displayName
					: undefined,
			})
			: [{ action: "start", label: "Review changes" }];

		if (!batchFinished) {
			return {
				batchId: completedSweep.batchId,
				batchFinished,
				closeLabel: "Close review",
				title,
				otherPendingNotePaths,
				editsReviewedLabel: `${completedSweep.totalSuggestions} edit${completedSweep.totalSuggestions === 1 ? "" : "s"} reviewed`,
				description: unfinishedScenes > 0
					? `${unfinishedScenes} more ${unfinishedScenes === 1 ? "scene" : "scenes"} in this batch still ${unfinishedScenes === 1 ? "has" : "have"} suggestions to review.`
					: "Other scenes in this batch still have suggestions to review.",
				nextSteps,
			};
		}

		return {
			batchId: completedSweep.batchId,
			batchFinished,
			closeLabel: "Close review",
			title,
			otherPendingNotePaths,
			editsReviewedLabel: `${completedSweep.totalSuggestions} edit${completedSweep.totalSuggestions === 1 ? "" : "s"} reviewed across ${completedSweep.notePaths.length} ${unitLabel}`,
			description: isCleaned
				? "Review blocks have been removed from your notes. Import a new revision pass when you're ready."
				: "You've finished this revision pass.",
			durationLabel: this.getCompletedSweepDurationLabel(completedSweep),
			nextSteps,
		};
	}

	// What finishing this sweep amounts to, shared by the panel's completion card
	// and the editor toolbar so the two never disagree about it.
	//
	// Finishing the last suggestion in one scene is not finishing its batch: an
	// import round routinely spans dozens of scenes. Until every scene in the
	// batch is decided it is a scene-level checkpoint — no celebration and,
	// above all, no batch-wide Clean, which would strip the review blocks from
	// scenes the author has not reviewed yet. And finishing one batch is not
	// finishing the book: when other scenes still hold pending batches, nothing
	// may claim every revision is done.
	private resolveCompletedSweepOutcome(completedSweep: CompletedSweepState) {
		const entry = this.getSweepRegistryEntry(completedSweep.batchId);
		const unitLabel = this.getSweepUnitLabel(completedSweep.notePaths.length, completedSweep.notePaths[0]);
		const isCleaned = entry?.status === "cleaned";
		const batchFinished = !entry || isCleaned || isBatchReadyToClean(entry, this.getBatchDecisionStats(entry.batchId));
		const pending = this.getReviewStateOverview()?.pending ?? [];
		const otherPendingNotePaths = pending
			.map((item) => item.notePath)
			.filter((notePath) => !completedSweep.notePaths.includes(notePath));
		const title = !batchFinished
			? `${this.toTitleCase(unitLabel)} complete`
			: otherPendingNotePaths.length > 0
				? "Batch complete"
				: "All revisions complete";
		return { entry, unitLabel, isCleaned, batchFinished, pending, otherPendingNotePaths, title };
	}

	getReviewStateOverview(): ReviewStateOverview | null {
		// Cleaning a scene zeroes its record's batch counts, so a cleaned scene
		// is kept by status: it was reviewed, even though no block remains.
		const records = this.getSceneReviewRecords({ activeBookOnly: true }).filter(
			(record) => record.batchCount > 0 || record.status === "cleaned",
		);
		if (records.length === 0) {
			return null;
		}

		const pending: ReviewStateIndexEntry[] = [];
		const reviewed: ReviewStateIndexEntry[] = [];

		for (const record of records) {
			const entry: ReviewStateIndexEntry = {
				notePath: record.notePath,
				noteTitle: record.noteTitle,
				sceneId: record.sceneId,
				pendingCount: record.pendingCount,
				unresolvedCount: record.unresolvedCount,
				deferredCount: record.deferredCount,
				processedCount: record.acceptedCount + record.rejectedCount + record.rewrittenCount,
				lastUpdated: record.lastUpdated,
				cleaned: record.status === "cleaned",
			};

			if (
				!entry.cleaned &&
				(record.status === "in_progress" || entry.pendingCount > 0 || entry.unresolvedCount > 0 || entry.deferredCount > 0)
			) {
				pending.push(entry);
			} else {
				reviewed.push(entry);
			}
		}

		return { pending, reviewed };
	}

	getPostCompletionIdleState(): PostCompletionIdleState | null {
		const activeSceneRecords = this.getSceneReviewRecords().filter((record) => record.batchCount > 0);
		if (activeSceneRecords.length === 0) {
			return {
				title: "Editorialist review",
				description:
					"Editorialist reviews two kinds of revision work: imported review notes and PENDING EDITS notes across the active book.",
			};
		}

		const remainingCount = activeSceneRecords.reduce(
			(total, record) => total + record.pendingCount + record.unresolvedCount + record.deferredCount,
			0,
		);
		const inProgressSweeps = this.registry
			.getSweepRegistryEntries()
			.filter((entry) => entry.status === "in_progress").length;
		if (remainingCount > 0 || inProgressSweeps > 0) {
			return null;
		}

		return {
			title: "Editorialist review",
			description:
				"Editorialist reviews two kinds of revision work: imported review notes and PENDING EDITS notes across the active book.",
		};
	}

	canAcceptSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion || suggestion.status !== "pending") {
			return false;
		}

		return canApplySuggestionDirectly(suggestion);
	}

	canAcceptSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canAcceptSuggestion(selected.id) : false;
	}

	canRejectSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(
			suggestion &&
			suggestion.status !== "accepted" &&
			suggestion.status !== "rejected" &&
			suggestion.status !== "rewritten",
		);
	}

	canRejectSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canRejectSuggestion(selected.id) : false;
	}

	canDeferSuggestion(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(
			suggestion &&
			suggestion.status !== "accepted" &&
			suggestion.status !== "rejected" &&
			suggestion.status !== "rewritten",
		);
	}

	canMarkSuggestionRewritten(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return Boolean(
			suggestion &&
			suggestion.status !== "accepted" &&
			suggestion.status !== "rejected" &&
			suggestion.status !== "rewritten",
		);
	}

	canRewriteSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canMarkSuggestionRewritten(selected.id) : false;
	}

	canDeferSelectedSuggestion(): boolean {
		const selected = this.store.getSelectedSuggestion();
		return selected ? this.canDeferSuggestion(selected.id) : false;
	}

	canUndoLastAppliedSuggestion(): boolean {
		const context = this.getReviewNoteContext();
		return this.sessionOrchestrator.hasCurrentLastAppliedChangeForContext(context);
	}

	canApplyAndReviewSceneSuggestions(): boolean {
		const session = this.getReviewSession();
		return Boolean(session?.suggestions.some((suggestion) => this.canApplySuggestionInReviewAllMode(suggestion)));
	}

	private shouldShowUndoForSelectedSuggestion(selectedId: string): boolean {
		const context = this.getReviewNoteContext();
		const change = this.lastAppliedChange;
		return Boolean(
			change &&
			this.sessionOrchestrator.hasCurrentLastAppliedChangeForContext(context) &&
			change.suggestionId === selectedId,
		);
	}

	getSuggestionPresentationTone(suggestion: ReviewSuggestion): "active" | "muted" {
		return getSuggestionPresentationTone(suggestion);
	}

	// Public read-through facades for the panel UI. The store itself is private
	// to the plugin — external callers go through these getters so that store
	// mutations remain owned by the plugin/state-machine path.
	getCurrentReviewSession(): ReviewSession | null {
		return this.store.getSession();
	}

	getSelectedSuggestionId(): string | null {
		return this.store.getState().selectedSuggestionId;
	}

	canJumpToSuggestionTarget(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			return false;
		}

		return this.hasResolvedRange(getSuggestionPrimaryTarget(suggestion));
	}

	canJumpToSuggestionAnchor(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const suggestion = this.getSuggestionById(id);
		return this.hasResolvedRange(suggestion ? getSuggestionAnchorTarget(suggestion) : undefined);
	}

	canJumpToSuggestionSource(id: string): boolean {
		if (!this.hasReviewSessionContext()) {
			return false;
		}

		const source = this.getSuggestionById(id)?.source;
		return Boolean(source && source.startOffset !== undefined && source.endOffset !== undefined);
	}

	refreshReviewPanel(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(REVIEW_PANEL_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof ReviewPanel) {
				view.render();
			}
		}
	}

	private getActiveNoteContext(): ActiveNoteContext | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!view || !file) {
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				return null;
			}

			return this.getNoteContextByPath(activeFile.path);
		}

		return {
			filePath: file.path,
			text: view.editor.getValue(),
			view,
		};
	}

	private getNoteContextByPath(filePath: string): ActiveNoteContext | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== filePath) {
				continue;
			}

			return {
				filePath: view.file.path,
				text: view.editor.getValue(),
				view,
			};
		}

		return null;
	}

	// Workspace-aware open-note text resolver injected into
	// ReviewRegistryService so the service stays at the vault/persistence
	// layer and never reaches `app.workspace` directly. Mirrors the original
	// private helper that lived inside the service; the search is unchanged.
	resolveOpenNoteText(notePath: string): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as { file?: { path?: string }; editor?: { getValue: () => string } };
			if (view.file?.path !== notePath || !view.editor) {
				continue;
			}

			return view.editor.getValue();
		}

		return null;
	}

	// The review note's path and live text, for panel features that need to
	// place something against the prose the sweep is walking.
	getReviewNoteText(): { filePath: string; text: string } | null {
		const context = this.getReviewNoteContext();
		return context ? { filePath: context.filePath, text: context.text } : null;
	}

	private getReviewNoteContext(): ActiveNoteContext | null {
		const session = this.store.getSession();
		if (!session || !this.isManuscriptTargetPath(session.notePath)) {
			return null;
		}

		const activeContext = this.getActiveNoteContext();
		if (activeContext?.filePath === session.notePath) {
			return activeContext;
		}

		return this.getNoteContextByPath(session.notePath);
	}

	private getActiveEditorSelection(): string | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const selectedText = view?.editor.getSelection();
		return selectedText?.trim() ? selectedText : undefined;
	}

	private getActiveEditorView(): EditorView | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return null;
		}

		// @ts-expect-error Obsidian exposes the CM6 instance at runtime but does not type it.
		return view.editor.cm as EditorView;
	}

	private getEditorialistLaunchState(context: ActiveNoteContext | null): EditorialistLaunchState {
		const noteUnitLabel = context && this.registry.usesSceneTerminology(context.filePath) ? "scene" : "note";
		if (!context || !this.isManuscriptTargetPath(context.filePath)) {
			return {
				currentNoteHasReviewBlock: false,
				currentNoteReviewBlockState: "none",
				noteUnitLabel,
			};
		}

		const reviewBlockState = classifyNoteReviewBlocks(context.text);

		const previousSession = this.store.getSession();
		const session = this.registry.applyPersistedReviewState(
			this.reviewEngine.buildSession(
				context.filePath,
				context.text,
				previousSession?.notePath === context.filePath ? previousSession : null,
			),
		);
		if (!session.hasReviewBlock) {
			return {
				currentNoteHasReviewBlock: false,
				currentNoteReviewBlockState: "none",
				noteUnitLabel,
			};
		}

		const hasActiveTrackedBatches = this.getSceneReviewRecords().some((record) => record.batchCount > 0);

		const batchId = this.registry.resolveCurrentBatchId(this.store.getGuidedSweep()?.batchId ?? null, context.text);
		const entry = this.registry.getSweepRegistryEntry(batchId ?? undefined);
		const notePaths = entry ? (entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths) : [];
		const currentIndex = notePaths.findIndex((path) => path === context.filePath);
		const nextNotePath =
			hasActiveTrackedBatches && currentIndex !== -1 ? notePaths[currentIndex + 1] : undefined;

		return {
			currentNoteHasReviewBlock: true,
			currentNoteReviewBlockState: reviewBlockState,
			currentNoteStatus: this.hasLiveActionableSuggestions(session.suggestions) ? "ready" : "completed",
			nextNoteLabel: nextNotePath ? this.getNoteDisplayLabel(nextNotePath) : undefined,
			nextNotePath,
			noteUnitLabel,
		};
	}

	private getToolbarState(hasReviewBlock: boolean): ToolbarState | null {
		const session = this.getReviewSession();
		const selected = this.store.getSelectedSuggestion();

		let review: ReviewBranchInputs | null = null;
		if (session && selected) {
			const suggestions = session.suggestions;
			const guidedSweep = this.getGuidedSweep();
			const unitLabel = this.getSweepUnitLabel(guidedSweep?.notePaths.length ?? 0, session.notePath);
			const sceneProgressLabel =
				guidedSweep && guidedSweep.notePaths.length > 1
					? `${this.toTitleCase(unitLabel.slice(0, -1))} ${guidedSweep.currentNoteIndex + 1}/${guidedSweep.notePaths.length}`
					: undefined;
			review = {
				selectedIndex: suggestions.findIndex((suggestion) => suggestion.id === selected.id),
				suggestionsLength: suggestions.length,
				effectiveStatuses: suggestions.map((suggestion) => this.getEffectiveSuggestionStatus(suggestion)),
				anchorDirection: this.getActiveMoveAnchorDirection(selected),
				sweepComplete: this.isSweepComplete(suggestions),
				sceneProgressLabel,
				canApply: this.canAcceptSelectedSuggestion(),
				canDefer: this.canDeferSelectedSuggestion(),
				canRewrite: this.canRewriteSelectedSuggestion(),
				canReject: this.canRejectSelectedSuggestion(),
				canNext: this.getAdjacentRevealableSuggestionId("next") !== null,
				canPrevious: this.getAdjacentRevealableSuggestionId("previous") !== null,
				canUndoLastAccept: this.shouldShowUndoForSelectedSuggestion(selected.id),
				operation: selected.operation,
				operationLabel: selected.operation.toUpperCase(),
			};
		}

		const appliedReview = this.store.getAppliedReview();
		const inputs: ToolbarStateInputs = {
			pendingEditsToolbarState: this.pendingEdits.getPendingEditsToolbarState(),
			hasReviewBlock,
			hasSession: session !== null,
			sessionNotePath: session?.notePath ?? null,
			appliedReview: appliedReview
				? { currentIndex: appliedReview.currentIndex, entryCount: appliedReview.entries.length }
				: null,
			completedReviewPreview: this.getCompletedReviewPreviewState(session),
			completedReviewCanNext: this.getAdjacentCompletedReviewSuggestionId("next") !== null,
			completedReviewCanPrevious: this.getAdjacentCompletedReviewSuggestionId("previous") !== null,
			hasLastAppliedChange: Boolean(this.lastAppliedChange),
			canUndoLastAppliedSuggestion: this.canUndoLastAppliedSuggestion(),
			acceptedReviewPreview: this.getAcceptedReviewPreviewState(session),
			acceptedReviewCanNext: this.getAdjacentAcceptedSuggestionId("next") !== null,
			acceptedReviewCanPrevious: this.getAdjacentAcceptedSuggestionId("previous") !== null,
			sessionHasNoOpenWork: session ? !this.hasLiveActionableSuggestions(session.suggestions) : false,
			guidedSweepHandoff: this.getGuidedSweepHandoffState(),
			panelOnly: this.getPanelOnlyReviewStateForSession(session),
			hasSelectedSuggestion: selected !== null,
			bulkApplyConfirmNotePath: this.bulkApplyConfirmState?.notePath ?? null,
			canApplyAndReviewSceneSuggestions: this.canApplyAndReviewSceneSuggestions(),
			bulkApplicableCount: session
				? session.suggestions.filter((suggestion) => this.canApplySuggestionInReviewAllMode(suggestion)).length
				: 0,
			review,
		};

		return buildToolbarState(inputs);
	}

	private async openNextSweepNoteFromLaunch(): Promise<void> {
		const context = this.getActiveNoteContext();
		if (!context) {
			new Notice("No active Markdown note to continue from.");
			return;
		}

		const launchState = this.getEditorialistLaunchState(context);
		const unitLabel = launchState.noteUnitLabel;
		if (!launchState.nextNotePath) {
			new Notice(`No next ${unitLabel} is available.`);
			return;
		}

		const batchId = this.registry.resolveCurrentBatchId(this.store.getGuidedSweep()?.batchId ?? null, context.text);
		const entry = this.registry.getSweepRegistryEntry(batchId ?? undefined);
		if (!entry) {
			await this.startOrResumeReviewForNote(launchState.nextNotePath);
			return;
		}

		const notePaths = entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths;
		const currentNoteIndex = notePaths.findIndex((path) => path === context.filePath);
		if (currentNoteIndex === -1) {
			await this.startOrResumeReviewForNote(launchState.nextNotePath);
			return;
		}

		this.store.setGuidedSweep({
			batchId: entry.batchId,
			currentNoteIndex,
			notePaths,
			startedAt: entry.importedAt,
		});
		await this.registry.updateSweepRegistry(entry.batchId, {
			currentNotePath: context.filePath,
			sceneOrder: notePaths,
			status: "in_progress",
		});
		await this.workflow.advanceGuidedSweep();
	}

	private syncActiveEditorDecorations(): void {
		const editorView = this.getActiveEditorView();
		const context = this.getActiveNoteContext();
		if (!editorView || !context) {
			this.toolbarOverlay.destroy();
			return;
		}

		const hasReviewBlock = noteContainsReviewBlock(context.text);
		const highlight = this.hasReviewSessionContext() ? this.activeHighlightRange : null;
		const toolbarState = this.getToolbarState(hasReviewBlock);

		// Anchor decorations belong to one note and win while they are up: they
		// are set by an explicit jump and cleared by any review focus.
		const anchorSnapshot = this.anchors.getDecorationSnapshot(context.filePath);
		syncReviewDecorations(editorView, anchorSnapshot ?? this.getReviewDecorationSnapshot(highlight));
		this.toolbarOverlay.sync(editorView, toolbarState, highlight);
	}

	// Obsidian makes the review panel the active leaf on the mousedown that
	// focuses it, before mouseup. Focusing the panel cannot change the note
	// under review, so the session is not resynced then: the resync re-selects
	// the current suggestion, which repaints the panel, and a repaint between
	// mousedown and mouseup replaced the pressed tick box or button so that
	// first click never arrived.
	private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
		if (this.workflow.isTransitioning()) {
			return;
		}
		this.cutFiles.rememberActiveScene();
		if (!(leaf?.view instanceof ReviewPanel)) {
			this.resyncSessionForActiveNote();
		}
		this.syncActiveEditorDecorations();
	}

	private resyncSessionForActiveNote(): void {
		this.sessionOrchestrator.resyncSessionForActiveNote();
	}

	private refreshSessionAfterAcceptedEdit(session: ReviewSession, acceptedSuggestionId: string): void {
		this.sessionOrchestrator.refreshSessionAfterAcceptedEdit(session, acceptedSuggestionId);
	}

	private getSuggestionById(id: string): ReviewSuggestion | null {
		const session = this.store.getSession();
		return session?.suggestions.find((suggestion) => suggestion.id === id) ?? null;
	}

	private getReviewSession(): ReviewSession | null {
		const context = this.getReviewNoteContext();
		const session = this.store.getSession();
		if (!context || !session || session.notePath !== context.filePath) {
			return null;
		}

		return session;
	}

	private getGuidedSweep(): GuidedSweepState | null {
		return this.store.getGuidedSweep();
	}

	private getSweepRegistryEntry(batchId?: string): ReviewSweepRegistryEntry | null {
		return this.registry.getSweepRegistryEntry(batchId);
	}

	private getCurrentBatchId(): string | null {
		const context = this.getReviewNoteContext() ?? this.getActiveNoteContext();
		if (!context) {
			return null;
		}

		return this.workflow.getCurrentBatchId(context.text);
	}

	private getCurrentSessionTrackingContext(): {
		sessionId?: string;
		sessionStartedAt?: number;
	} {
		const sessionId = this.getCurrentBatchId() ?? undefined;
		return {
			sessionId,
			sessionStartedAt: sessionId ? this.getSweepRegistryEntry(sessionId)?.importedAt : undefined,
		};
	}

	private hasReviewSessionContext(): boolean {
		return Boolean(this.getReviewSession());
	}

	private hasActiveReviewSession(): boolean {
		return Boolean(this.getReviewSession()?.suggestions.length);
	}

	private async revealSelectedSuggestion(): Promise<void> {
		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			this.clearActiveHighlights();
			this.syncActiveEditorDecorations();
			return;
		}

		await this.revealSuggestionContext(selectedSuggestion.id);
	}

	private async revealSuggestionContext(id: string): Promise<void> {
		const suggestion = this.getSuggestionById(id);
		if (!suggestion) {
			this.clearActiveHighlights();
			this.syncActiveEditorDecorations();
			return;
		}

		if (suggestion.operation === "move") {
			const sourceRange = this.getResolvedOffsetRange(getSuggestionPrimaryTarget(suggestion));
			const anchorRange = this.getResolvedOffsetRange(getSuggestionAnchorTarget(suggestion));
			if (sourceRange) {
				this.activeAnchorHighlightRange = anchorRange;
				await this.focusEditorRange(
					sourceRange.start,
					sourceRange.end,
					this.getSuggestionHighlightTone(suggestion),
				);
				return;
			}

			this.activeAnchorHighlightRange = null;
			if (await this.focusResolvedTarget(getSuggestionAnchorTarget(suggestion), "anchor")) {
				return;
			}
		} else if (await this.focusResolvedTarget(getSuggestionPrimaryTarget(suggestion), this.getSuggestionHighlightTone(suggestion))) {
			this.activeAnchorHighlightRange = null;
			return;
		}
		this.clearActiveHighlights();
		this.syncActiveEditorDecorations();
	}

	private async focusResolvedTarget(
		target?: ReviewTargetRef,
		tone: HighlightTone = "active",
	): Promise<boolean> {
		if (!target || !this.hasResolvedRange(target)) {
			return false;
		}

		const start = target.startOffset;
		const end = target.endOffset;
		if (start === undefined || end === undefined) {
			return false;
		}

		await this.focusEditorRange(start, end, tone);
		return true;
	}

	private hasResolvedRange(target?: ReviewTargetRef): boolean {
		return Boolean(target && target.startOffset !== undefined && target.endOffset !== undefined);
	}

	private canRevealSuggestionInManuscript(suggestion: ReviewSuggestion): boolean {
		return canRevealSuggestionInManuscriptShared(suggestion);
	}

	private getAdjacentRevealableSuggestionId(
		direction: "next" | "previous",
		fromId?: string,
		treatCurrentAsDeferred = false,
	): string | null {
		const session = this.getReviewSession();
		if (!session || session.suggestions.length === 0) {
			return null;
		}

		return getAdjacentRevealableSuggestionIdShared(
			session.suggestions,
			this.store.getState().selectedSuggestionId,
			direction,
			{ fromId, treatCurrentAsDeferred },
		);
	}

	private shouldShowGuidedSweepHandoff(session?: ReviewSession | null): boolean {
		const targetSession = session ?? this.getReviewSession();
		return Boolean(this.getGuidedSweep() && targetSession && !this.hasLiveActionableSuggestions(targetSession.suggestions));
	}

	private hasLiveActionableSuggestions(suggestions: ReviewSuggestion[]): boolean {
		return hasLiveActionableSuggestionsShared(suggestions);
	}

	canApplySuggestionInReviewAllMode(suggestion: ReviewSuggestion): boolean {
		return suggestion.status !== "unresolved" && suggestion.operation !== "move" && this.canAcceptSuggestion(suggestion.id);
	}

	private getAcceptedReviewPreviewState(session?: ReviewSession | null): AcceptedReviewPreviewState | null {
		const targetSession = session ?? this.getReviewSession();
		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (
			!targetSession ||
			this.hasLiveActionableSuggestions(targetSession.suggestions) ||
			!selectedSuggestion ||
			!this.isAcceptedReviewSuggestion(selectedSuggestion) ||
			!this.shouldShowUndoForSelectedSuggestion(selectedSuggestion.id)
		) {
			return null;
		}

		const acceptedSuggestions = targetSession.suggestions.filter((suggestion) => this.isAcceptedReviewSuggestion(suggestion));
		const currentIndex = acceptedSuggestions.findIndex((suggestion) => suggestion.id === selectedSuggestion.id);
		if (currentIndex === -1) {
			return null;
		}

		return {
			currentIndexLabel: `${currentIndex + 1} of ${acceptedSuggestions.length}`,
			title: "Review accepted changes",
		};
	}

	private getCompletedReviewPreviewState(session?: ReviewSession | null): CompletedReviewPreviewState | null {
		const completedSweep = this.getResolvedCompletedSweepState();
		const targetSession = session ?? this.getReviewSession();
		if (!completedSweep || !targetSession) {
			return null;
		}

		const { title } = this.resolveCompletedSweepOutcome(completedSweep);
		const reviewableSuggestions = targetSession.suggestions.filter((suggestion) =>
			this.isCompletedReviewSuggestion(suggestion),
		);
		if (reviewableSuggestions.length === 0) {
			return { title };
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		const currentIndex = selectedSuggestion
			? reviewableSuggestions.findIndex((suggestion) => suggestion.id === selectedSuggestion.id)
			: -1;

		return {
			currentIndexLabel:
				currentIndex === -1 ? undefined : `${currentIndex + 1} of ${reviewableSuggestions.length}`,
			title,
		};
	}

	private getAdjacentAcceptedSuggestionId(
		direction: "next" | "previous",
		fromId?: string,
	): string | null {
		const session = this.getReviewSession();
		if (!session) {
			return null;
		}

		const acceptedSuggestions = session.suggestions.filter((suggestion) => this.isAcceptedReviewSuggestion(suggestion));
		if (acceptedSuggestions.length === 0) {
			return null;
		}

		const currentId = fromId ?? this.store.getState().selectedSuggestionId;
		const currentIndex = currentId
			? acceptedSuggestions.findIndex((suggestion) => suggestion.id === currentId)
			: -1;
		if (currentIndex === -1) {
			return acceptedSuggestions[0]?.id ?? null;
		}

		const nextIndex =
			direction === "next"
				? (currentIndex + 1) % acceptedSuggestions.length
				: (currentIndex - 1 + acceptedSuggestions.length) % acceptedSuggestions.length;
		return acceptedSuggestions[nextIndex]?.id ?? null;
	}

	private getAdjacentCompletedReviewSuggestionId(
		direction: "next" | "previous",
		fromId?: string,
	): string | null {
		const session = this.getReviewSession();
		if (!session) {
			return null;
		}

		const reviewableSuggestions = session.suggestions.filter((suggestion) =>
			this.isCompletedReviewSuggestion(suggestion),
		);
		if (reviewableSuggestions.length === 0) {
			return null;
		}

		const currentId = fromId ?? this.store.getState().selectedSuggestionId;
		const currentIndex = currentId
			? reviewableSuggestions.findIndex((suggestion) => suggestion.id === currentId)
			: -1;
		if (currentIndex === -1) {
			return reviewableSuggestions[0]?.id ?? null;
		}

		const nextIndex =
			direction === "next"
				? (currentIndex + 1) % reviewableSuggestions.length
				: (currentIndex - 1 + reviewableSuggestions.length) % reviewableSuggestions.length;
		return reviewableSuggestions[nextIndex]?.id ?? null;
	}

	private getPanelOnlyReviewStateForSession(session?: ReviewSession | null): PanelOnlyReviewState | null {
		const targetSession = session ?? this.getReviewSession();
		if (!targetSession) {
			return null;
		}

		const openSuggestions = targetSession.suggestions.filter((suggestion) => this.isSuggestionOpen(suggestion));
		if (openSuggestions.length === 0) {
			return null;
		}

		if (openSuggestions.some((suggestion) => this.canRevealSuggestionInManuscript(suggestion))) {
			return null;
		}

		const guidedSweep = this.getGuidedSweep();
		const unitLabel = this.registry.usesSceneTerminology(targetSession.notePath) ? "scene" : "note";
		const unitTitle = this.toTitleCase(unitLabel);
		const contextLabel = unitLabel === "scene"
			? this.formatSceneContextLabel(targetSession.notePath)
			: undefined;
		const progressLabel =
			guidedSweep && guidedSweep.notePaths.length > 1
				? `${unitTitle} ${guidedSweep.currentNoteIndex + 1} of ${guidedSweep.notePaths.length}`
				: undefined;

		return {
			contextLabel,
			description: `More notes further down ${unitLabel === "scene" ? "this scene" : "this note"}.`,
			progressLabel,
			remainingCount: openSuggestions.length,
			title: contextLabel ? `Continue review in ${contextLabel}` : `Continue review in this ${unitLabel}`,
			unitLabel,
		};
	}

	private getSceneReviewRecordByPath(notePath: string): SceneReviewRecord | null {
		return this.getSceneReviewRecords().find((record) => record.notePath === notePath) ?? null;
	}

	private isSweepableSceneRecord(record: SceneReviewRecord | null): boolean {
		if (!record || record.batchCount === 0 || record.status === "cleaned") {
			return false;
		}

		return record.pendingCount > 0 || record.unresolvedCount > 0 || record.deferredCount > 0;
	}

	private isSweepComplete(suggestions: ReviewSuggestion[]): boolean {
		return isSweepCompleteShared(suggestions);
	}

	private isSuggestionOpen(suggestion: ReviewSuggestion): boolean {
		return isSuggestionOpenShared(suggestion);
	}

	private getEffectiveSuggestionStatus(suggestion: ReviewSuggestion): ReviewSuggestion["status"] {
		return getEffectiveSuggestionStatusShared(suggestion);
	}

	private isAcceptedReviewSuggestion(suggestion: ReviewSuggestion): boolean {
		return suggestion.status === "accepted" && this.hasRevealableAcceptedRange(suggestion);
	}

	private isCompletedReviewSuggestion(suggestion: ReviewSuggestion): boolean {
		return isTerminalStatus(this.getEffectiveSuggestionStatus(suggestion));
	}

	private hasRevealableAcceptedRange(suggestion: ReviewSuggestion): boolean {
		if (this.hasResolvedRange(getSuggestionPrimaryTarget(suggestion))) {
			return true;
		}

		return this.hasResolvedRange(getSuggestionAnchorTarget(suggestion));
	}

	private getSuggestionHighlightTone(suggestion: ReviewSuggestion): "active" | "muted" {
		return suggestion.status === "accepted" ? "muted" : "active";
	}

	private clearActiveHighlights(): void {
		this.activeHighlightRange = null;
		this.activeAnchorHighlightRange = null;
		this.activeHighlightTone = "active";
	}

	private getResolvedOffsetRange(target?: ReviewTargetRef): OffsetRange | null {
		if (!target || !this.hasResolvedRange(target)) {
			return null;
		}

		return {
			start: target.startOffset as number,
			end: target.endOffset as number,
		};
	}

	private getActiveMoveAnchorDirection(suggestion: ReviewSuggestion | null): "above" | "below" | undefined {
		if (!suggestion || suggestion.operation !== "move") {
			return undefined;
		}

		const source = this.getResolvedOffsetRange(getSuggestionPrimaryTarget(suggestion));
		const anchor = this.getResolvedOffsetRange(getSuggestionAnchorTarget(suggestion));
		if (!source || !anchor) {
			return undefined;
		}

		return anchor.start < source.start ? "above" : "below";
	}

	private setDefaultHighlightForSelection(): void {
		if (this.store.getAppliedReview()) {
			return;
		}

		const selectedSuggestion = this.store.getSelectedSuggestion();
		if (!selectedSuggestion) {
			this.clearActiveHighlights();
			return;
		}

		if (selectedSuggestion.operation === "move") {
			const sourceRange = this.getResolvedOffsetRange(getSuggestionPrimaryTarget(selectedSuggestion));
			const anchorRange = this.getResolvedOffsetRange(getSuggestionAnchorTarget(selectedSuggestion));
			this.activeHighlightRange = sourceRange ?? anchorRange;
			this.activeAnchorHighlightRange = sourceRange && anchorRange ? anchorRange : null;
			this.activeHighlightTone = sourceRange ? this.getSuggestionHighlightTone(selectedSuggestion) : "anchor";
			return;
		}

		const target = this.getResolvedOffsetRange(getSuggestionPrimaryTarget(selectedSuggestion))
			? getSuggestionPrimaryTarget(selectedSuggestion)
			: getSuggestionAnchorTarget(selectedSuggestion);

		this.activeHighlightRange = this.getResolvedOffsetRange(target);
		this.activeAnchorHighlightRange = null;
		this.activeHighlightTone = this.getSuggestionHighlightTone(selectedSuggestion);
	}

	private async enterGuidedSweepHandoff(): Promise<void> {
		this.store.batch(() => {
			this.store.setAppliedReview(null);
			this.store.selectSuggestion(null);
		});
		this.clearActiveHighlights();
		this.syncActiveEditorDecorations();
	}

	private async enterCompletedSweepAudit(): Promise<void> {
		const completedSweep = this.getResolvedCompletedSweepState();
		if (completedSweep && !this.store.getCompletedSweep()) {
			this.store.setCompletedSweep(completedSweep);
		}

		await this.sessionOrchestrator.ensureCompletedSweepAuditSession();
		this.store.setAppliedReview(null);
		const suggestionId = this.getAdjacentCompletedReviewSuggestionId("next");
		this.store.selectSuggestion(suggestionId);
		await this.revealSelectedSuggestion();
	}

	private getResolvedCompletedSweepState(): CompletedSweepState | null {
		const completedSweep = this.store.getCompletedSweep();
		if (completedSweep) {
			return completedSweep;
		}

		if (this.store.getGuidedSweep()) {
			return null;
		}

		// Per-session completion is independent of other scenes' state: when the
		// user closes out every suggestion in the active session, advance to the
		// completion card immediately even if unrelated batches in other scenes
		// still have pending work. Without this, single-scene reviews never wrap.
		const currentSession = this.getReviewSession();
		if (currentSession && !this.hasLiveActionableSuggestions(currentSession.suggestions)) {
			return {
				batchId: this.getCurrentBatchId() ?? `session-complete:${currentSession.notePath}`,
				completedAt: Date.now(),
				currentNoteIndex: 0,
				notePaths: [currentSession.notePath],
				startedAt: currentSession.parsedAt,
				// `parsedAt` is when the note was parsed, not when the author
				// started revising, so this path has no duration to report.
				hasSweepStart: false,
				totalSuggestions: currentSession.suggestions.length,
			};
		}

		const remainingCount = this.getSceneReviewRecords()
			.filter((record) => record.batchCount > 0)
			.reduce((total, record) => total + record.pendingCount + record.unresolvedCount + record.deferredCount, 0);
		if (remainingCount > 0) {
			return null;
		}

		const latestCompletedSweep = this.registry
			.getSweepRegistryEntries()
			.find((entry) => entry.status === "completed");
		if (!latestCompletedSweep) {
			return null;
		}

		const notePaths =
			latestCompletedSweep.sceneOrder.length > 0
				? [...latestCompletedSweep.sceneOrder]
				: [...latestCompletedSweep.importedNotePaths];
		if (notePaths.length === 0) {
			return null;
		}

		const currentNoteIndex = Math.max(
			0,
			notePaths.findIndex((path) => path === latestCompletedSweep.currentNotePath),
		);

		return {
			batchId: latestCompletedSweep.batchId,
			completedAt: latestCompletedSweep.updatedAt,
			currentNoteIndex,
			notePaths,
			startedAt: latestCompletedSweep.importedAt,
			// importedAt is the canonical sweep start — openExistingSweep seeds a
			// guided sweep's startedAt from this same field.
			hasSweepStart: true,
			totalSuggestions: latestCompletedSweep.totalSuggestions,
		};
	}

	private getCompletedSweepDurationLabel(completedSweep: CompletedSweepState): string | undefined {
		return selectCompletedSweepDurationLabel(completedSweep);
	}


	private getReviewDecorationSnapshot(highlight: OffsetRange | null): Parameters<typeof syncReviewDecorations>[1] {
		const appliedReview = this.store.getAppliedReview();
		if (appliedReview && appliedReview.entries.length > 0) {
			return {
				highlights: appliedReview.entries.map((entry, index) => ({
					start: entry.start,
					end: entry.end,
					tone: index === appliedReview.currentIndex ? "applied-active" : "applied",
				})),
			};
		}

		return {
			highlights: [
				...(highlight
					? [
							{
								start: highlight.start,
								end: highlight.end,
								tone: this.activeHighlightTone,
							},
						]
					: []),
				...(this.activeAnchorHighlightRange
					? [
							{
								start: this.activeAnchorHighlightRange.start,
								end: this.activeAnchorHighlightRange.end,
								tone: "anchor" as const,
							},
						]
					: []),
			],
		};
	}

	private getSweepUnitLabel(count: number, notePath?: string): string {
		const singular = this.registry.usesSceneTerminology(notePath) ? "scene" : "note";
		return count === 1 ? singular : `${singular}s`;
	}

	private getNoteDisplayLabel(notePath: string): string {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		return file instanceof TFile ? file.basename : notePath.split("/").pop() ?? notePath;
	}

	private formatSceneContextLabel(notePath: string): string {
		return `Scene ${this.getNoteDisplayLabel(notePath).replace(/^[Ss]cene\s+/u, "")}`;
	}

	private toTitleCase(value: string): string {
		return value.charAt(0).toUpperCase() + value.slice(1);
	}

	private async focusEditorRange(
		start: number,
		end: number,
		tone: HighlightTone = "active",
	): Promise<void> {
		const context = this.getReviewNoteContext();
		if (!context) {
			return;
		}

		this.anchors.clearHighlights();
		await this.focusReviewLeaf(context.view);
		this.activeHighlightRange = { start, end };
		this.activeHighlightTone = tone;
		const from = context.view.editor.offsetToPos(start);
		const to = context.view.editor.offsetToPos(end);
		context.view.editor.setSelection(from, to);
		context.view.editor.scrollIntoView({ from, to }, true);
		context.view.editor.focus();
		this.ensureToolbarViewportClearance(start);
		this.syncActiveEditorDecorations();
	}

	private ensureToolbarViewportClearance(start: number): void {
		const editorView = this.getActiveEditorView();
		if (!editorView) {
			return;
		}

		const coords = editorView.coordsAtPos(start);
		const scrollRect = editorView.scrollDOM.getBoundingClientRect();
		if (!coords) {
			return;
		}

		const topPadding = 110;
		const topOffset = coords.top - scrollRect.top;
		if (topOffset < topPadding) {
			editorView.scrollDOM.scrollTop -= topPadding - topOffset;
		}
		this.toolbarOverlay.scheduleReposition();
	}

	private async focusReviewLeaf(view: MarkdownView): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType("markdown").find((candidate) => candidate.view === view);
		if (!leaf) {
			return;
		}

		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private async loadPluginData(): Promise<void> {
		const rawSavedData = (await this.loadData()) as unknown;
		const savedData = migratePluginData(rawSavedData);
		this.registry.load(savedData);
		this.reviewerDirectory.setProfiles(savedData.reviewerProfiles);
		this.reviewerDirectory.setPassAssignments(this.registry.getPassAssignments());
		this.registry.rebuildReviewerStatsFromSignals();
	}

	// Trailing-debounce around saveData() so bursty workflows (batch import,
	// bulk reviewer reassignment, rapid star toggles) coalesce into a single
	// JSON write. Callers still await savePluginData() and get a promise that
	// resolves only after the write that covers their request completes.
	private readonly pluginDataSaver = new DebouncedSaver(
		() => this.saveData(this.registry.buildPluginData(this.reviewerDirectory.getProfiles())),
		300,
	);

	// Coalesces per-keystroke editor-change events into a single trailing
	// resync. 120ms keeps the response feeling immediate while folding even
	// fast typing into one batch. Cancelled in onunload — running a resync
	// against torn-down state is pointless and risks stale references.
	private readonly editorChangeResyncDebouncer = new TrailingDebouncer(
		() => this.resyncSessionForActiveNote(),
		120,
	);

	// An author who does not trust Clean removes review blocks by deleting them,
	// or deletes the note. The inventory is only ever rebuilt from the notes on
	// disk, so nothing is lost, but until a full scan runs the registry still
	// shows the batch as resumable and the panel can offer a scene with nothing
	// left to review. Rescanning on delete closes that window; deletes are rare
	// and a folder delete coalesces into one scan.
	private readonly inventoryRescanDebouncer = new TrailingDebouncer(
		() => {
			if (this.manuscriptAssociations.busy) { this.inventoryRescanDebouncer.schedule(); return; }
			void this.registry.syncSceneInventory().then(() => this.refreshReviewPanel());
		},
		500,
	);

	private async savePluginData(): Promise<void> {
		await this.pluginDataSaver.request();
	}

	async flushPluginDataSave(): Promise<void> {
		await this.pluginDataSaver.flush();
	}

	private async syncSceneReviewIndex(): Promise<void> {
		await this.registry.syncSceneInventory();
	}

	// Review tracking is keyed by note path. Move it with the file so a
	// retitled scene keeps its counts and the panel never points at a path
	// that no longer exists.
	private async handleNoteRenamed(oldPath: string, newPath: string): Promise<void> {
		const changed = await this.registry.renameNotePath(oldPath, newPath);
		this.store.renameNotePath(oldPath, newPath);
		if (!changed) {
			return;
		}
		await this.registry.refreshActiveBookScope();
		this.resyncSessionForActiveNote();
		this.refreshReviewPanel();
		this.refreshEditorialismPanel();
	}

	async openSceneNote(notePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			new Notice("Scene note not found.");
			return;
		}

		await this.app.workspace.openLinkText(notePath, "", false);
	}

	async startOrResumeReviewForNote(notePath: string): Promise<void> {
		await this.openSceneNote(notePath);
		const context =
			this.getNoteContextByPath(notePath) ??
			(this.getActiveNoteContext()?.filePath === notePath ? this.getActiveNoteContext() : null);
		if (!context) {
			new Notice("Could not open the next note for review.");
			return;
		}

		await this.sessionOrchestrator.parseReviewContext(context, true);
	}

	// Opens a scene's review and selects one edit in it. Ids are fixed by the
	// edit's place in the review block, so they survive the session rebuild.
	async openReviewSuggestion(notePath: string, suggestionId: string): Promise<void> {
		await this.startOrResumeReviewForNote(notePath);
		const session = this.getCurrentReviewSession();
		if (session?.notePath !== notePath || !session.suggestions.some((suggestion) => suggestion.id === suggestionId)) {
			new Notice("That edit is no longer in this scene's review.");
			return;
		}
		await this.reviewActions.selectSuggestion(suggestionId);
	}

	// Every Clean entry point routes through here. There are four — the panel's
	// per-scene Clean, the Recent Reviews per-batch Clean, the header's clean-all,
	// and the settings bulk actions — and settings was the only one that asked
	// before writing to a manuscript.
	private async confirmReviewBlockRemoval(description: string): Promise<boolean> {
		const choice = await openEditorialistChoiceModal(this.app, {
			title: "Clean review blocks?",
			description: `${description} Accepted edits and saved history stay in place.`,
			choices: [
				{ label: "Clean review blocks", value: "confirm" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		return choice === "confirm";
	}

	async cleanSceneReviewNote(notePath: string): Promise<void> {
		// The panel's per-scene Clean writes to a manuscript note, so it confirms
		// like every other cleanup does. Settings' bulk cleanups already gate on
		// confirmDestructiveAction; this single-scene path was the one destructive
		// action in the product that fired straight off the click.
		const sceneName = notePath.split("/").pop()?.replace(/\.md$/i, "")?.trim() || notePath;
		if (!(await this.confirmReviewBlockRemoval(`This removes the imported review blocks from “${sceneName}”.`))) {
			return;
		}

		const context = this.getNoteContextByPath(notePath);
		let removedCount = 0;
		let skippedUnfencedCount = 0;

		if (context) {
			const removed = removeImportedReviewBlocks(context.view.editor.getValue());
			skippedUnfencedCount = removed.skippedUnfencedCount;
			if (removed.removedCount > 0) {
				context.view.editor.setValue(removed.text);
				removedCount = removed.removedCount;
			}
		} else {
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				new Notice("Scene note not found.");
				return;
			}
			await this.app.vault.process(file, (currentText) => {
				const removed = removeImportedReviewBlocks(currentText);
				removedCount = removed.removedCount;
				skippedUnfencedCount = removed.skippedUnfencedCount;
				return removed.removedCount > 0 ? removed.text : currentText;
			});
		}

		await this.syncSceneReviewIndex();
		this.resyncSessionForActiveNote();
		// An unfenced stamped block is reported, never quietly tolerated: the note
		// still holds a review block the user believes was just cleaned.
		const skippedSuffix = describeUnremovedBlocksSuffix(skippedUnfencedCount);
		new Notice(
			(removedCount > 0
				? `Cleaned ${removedCount} imported review block${removedCount === 1 ? "" : "s"} from this note.`
				: "No imported review blocks were found in this note.") + skippedSuffix,
		);
	}

	async cleanupSceneReviewNotes(notePaths: string[]): Promise<CleanupOutcome> {
		let removedCount = 0;
		let skippedUnfencedCount = 0;
		for (const notePath of notePaths) {
			const context = this.getNoteContextByPath(notePath);
			if (context) {
				const removed = removeImportedReviewBlocks(context.view.editor.getValue());
				skippedUnfencedCount += removed.skippedUnfencedCount;
				if (removed.removedCount > 0) {
					context.view.editor.setValue(removed.text);
					removedCount += removed.removedCount;
				}
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) {
				continue;
			}

			let currentRemovedCount = 0;
			await this.app.vault.process(file, (currentText) => {
				const removed = removeImportedReviewBlocks(currentText);
				currentRemovedCount = removed.removedCount;
				skippedUnfencedCount += removed.skippedUnfencedCount;
				return removed.removedCount > 0 ? removed.text : currentText;
			});
			removedCount += currentRemovedCount;
		}

		await this.syncSceneReviewIndex();
		this.resyncSessionForActiveNote();
		return { removedCount, skippedUnfencedCount };
	}

	async cleanupCompletedSceneReviewNotes(activeBookOnly = false): Promise<CleanupOutcome> {
		const notePaths = this.getSceneReviewRecords({ activeBookOnly })
			.filter((record) => record.status === "completed")
			.map((record) => record.notePath);
		return this.cleanupSceneReviewNotes(notePaths);
	}

	async cleanupAllSceneReviewNotes(activeBookOnly = false): Promise<CleanupOutcome> {
		const notePaths = this.getSceneReviewRecords({ activeBookOnly })
			.filter((record) => record.batchCount > 0)
			.map((record) => record.notePath);
		return this.cleanupSceneReviewNotes(notePaths);
	}

	// Saves everything in data.json as a backup file in Editorialist/Backups
	// and returns its path. Notes are not in it; they are in the vault.
	async saveEditorialistBackup(): Promise<string | null> {
		await this.syncOperationalMetadata();
		if (!(await this.ensureVaultFolder(BACKUPS_FOLDER))) return null;
		const now = new Date();
		const stem = `Editorialist backup ${localDate(now)}`;
		let path = normalizePath(`${BACKUPS_FOLDER}/${stem}.json`);
		for (let copy = 2; this.app.vault.getAbstractFileByPath(path); copy++) path = normalizePath(`${BACKUPS_FOLDER}/${stem} ${copy}.json`);
		await this.app.vault.create(path, serializeBackup(this.registry.buildPluginData(this.reviewerDirectory.getProfiles()), now));
		return path;
	}

	// A contributor's imported passes, newest first, labelled for choosing one.
	listContributorPasses(reviewerId: string): Array<{ batchId: string; label: string }> {
		const batchIds = new Set(this.registry.getReviewerBatchIds(reviewerId));
		return this.getSweepRegistryEntries()
			.filter((entry) => batchIds.has(entry.batchId))
			.sort((a, b) => b.importedAt - a.importedAt)
			.map((entry) => {
				const scenes = entry.sceneOrder.length;
				const date = new Date(entry.importedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
				return { batchId: entry.batchId, label: `Imported ${date} · ${scenes} ${scenes === 1 ? "scene" : "scenes"}${entry.activeBookLabel ? ` · ${entry.activeBookLabel}` : ""}` };
			});
	}

	// Credits one imported pass to another contributor. The review blocks in
	// the scenes are left as they are, so every decision saved on them stays;
	// the pass's entry records who it is from, the notes read that way from
	// now on, and the pass's stats move with it.
	async movePassToContributor(batchId: string, reviewerId: string): Promise<void> {
		await this.registry.updateSweepRegistry(batchId, { contributorId: reviewerId }, { persist: false });
		this.reviewerDirectory.setPassAssignments(this.registry.getPassAssignments());
		this.registry.reassignReviewerSignalsForPass(batchId, reviewerId);
		this.registry.rebuildReviewerStatsFromSignals();
		await this.savePluginData();
		this.resyncSessionForActiveNote();
		await this.refreshPlanViews();
	}

	// The backups in Editorialist/Backups, newest first.
	listEditorialistBackups(): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(BACKUPS_FOLDER);
		if (!(folder instanceof TFolder)) return [];
		return folder.children
			.filter((child): child is TFile => child instanceof TFile && child.extension === "json")
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	// Replaces Editorialist's saved data with a backup's. Notes are untouched;
	// the scene inventory is then rebuilt from them, as on startup.
	async restoreEditorialistBackup(file: TFile): Promise<boolean> {
		let data: EditorialistPluginData;
		try {
			data = parseBackup(await this.app.vault.read(file));
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "That backup could not be read.");
			return false;
		}
		try {
			await restoreBackupData({
				flush: () => this.flushPluginDataSave(),
				snapshot: () => this.registry.buildPluginData(this.reviewerDirectory.getProfiles()),
				load: (next) => {
					this.registry.load(next);
					this.reviewerDirectory.setProfiles(next.reviewerProfiles);
					this.reviewerDirectory.setPassAssignments(this.registry.getPassAssignments());
					this.registry.rebuildReviewerStatsFromSignals();
				},
				save: () => this.savePluginData(),
			}, data);
		} catch (error) {
			if (error instanceof BackupRestoreSaveError) {
				this.reviewActions.resetAfterDataRestore();
				this.store.clearSession();
				this.store.setAppliedReview(null);
				this.store.setGuidedSweep(null);
				this.store.setCompletedSweep(null);
				this.clearActiveHighlights();
			}
			new Notice(error instanceof Error ? error.message : "The backup could not be restored.", 10000);
			return false;
		}
		this.reviewActions.resetAfterDataRestore();
		try {
			await this.refreshAfterManuscriptReconnection();
		} catch (error) {
			console.error("Editorialist: backup restored but views could not refresh", error);
			new Notice("The backup was saved, but the open views could not refresh. Restart Editorialist to check them.", 10000);
			return true;
		}
		new Notice(`Restored Editorialist from ${file.name}.`);
		return true;
	}

	// Copies a prompt asking an AI to turn directives into a review batch of
	// concrete edits; the reply comes back through the normal import. Every
	// open passage is quoted with the paragraph around it from the current
	// text, so the AI can write verbatim Originals.
	// Hands a whole editorialism to the AI in one prompt: every unfinished
	// directive carrying a decision or a question from the author. The
	// one-directive "Draft fixes" is the same prompt with one item.
	async copyEditorialismHandoff(editorialism: Editorialism): Promise<void> {
		const items = handoffItems(editorialism);
		if (items.length === 0) {
			new Notice("Record a decision or ask a question on a directive first — the hand-off sends those.");
			return;
		}
		await this.copyDirectiveFixPrompt(items);
	}

	async copyDirectiveFixPrompt(items: readonly EditorialismItem[]): Promise<void> {
		const directives = [];
		const manuscriptFiles = this.getManuscriptFiles();
		for (const item of items) {
			const passages: DirectiveFixPassage[] = [];
			for (const anchor of item.anchors.filter((candidate) => !isAnchorRetired(candidate.status))) {
				const file = this.anchors.resolveAnchorSceneFile(anchor, item);
				const text = file ? this.resolveOpenNoteText(file.path) ?? await this.app.vault.cachedRead(file) : null;
				const location = text === null ? null : locateAnchor(text, anchor);
				const paragraph = text !== null && location && isLocated(location) ? paragraphAround(text, location) : null;
				const sceneId = file ? getSceneIdForFile(this.app, file) ?? null : null;
				passages.push({
					sceneLabel: file?.basename ?? (anchor.scene ? `Scene ${anchor.scene}` : "Unknown scene"),
					sceneId,
					noteName: file && !sceneId ? noteRouteName(file, manuscriptFiles) : null,
					fragment: anchor.closing ? `${anchor.opening}" → "${anchor.closing}` : anchor.opening,
					paragraph: text !== null && paragraph ? text.slice(paragraph.start, paragraph.end).trim() : null,
				});
			}
			directives.push({
				text: displayDirectiveText(item.text),
				scope: item.scope?.raw ?? null,
				decision: item.decision ?? null,
				question: item.question ?? null,
				needsDecision: needsDecision(item),
				passages,
			});
		}
		const prompt = buildDirectiveFixPrompt(directives, this.gatherReviewTemplateContext());
		await this.copyTextToClipboard(
			prompt,
			"Prompt copied. Paste it to your AI, then import its reply as a review batch.",
			"Could not copy the prompt.",
		);
	}

	private async copyReviewTemplateToClipboard(selectedText?: string): Promise<void> {
		const context = this.gatherReviewTemplateContext();
		const template = buildReviewTemplate(selectedText, context);
		await this.copyTextToClipboard(template, "Review template copied", "Could not copy the review template.");
	}

	// Collects the active book label, the active note's scene id (if any), the
	// full list of scene ids in the active book, and the names of manuscript
	// notes that have no id — so the copied prompt gives the AI a concrete set
	// of valid SceneIds and Notes. Without this, AIs invent plausible-looking
	// ids (e.g. `scn_eb08b7ef`) that fail to route, and a book of plain chapter
	// notes gets no way to place a memo at all.
	private gatherReviewTemplateContext(): ReviewTemplateContext {
		const scope = this.registry.getActiveBookScopeInfo();
		const activeFile = this.app.workspace.getActiveFile();
		const sceneIds: { id: string; title: string }[] = [];
		const noteNames: string[] = [];
		let activeSceneId: string | null = null;
		let activeNoteName: string | null = null;

		// Legacy installations with no target and no book folder would otherwise
		// list every note in the vault.
		const manuscriptFiles = scope.sourceFolder || scope.target ? this.getManuscriptFiles() : [];
		const seenIds = new Set<string>();
		for (const file of manuscriptFiles) {
			const sceneId = getSceneIdForFile(this.app, file);
			if (!sceneId) {
				noteNames.push(noteRouteName(file, manuscriptFiles));
				continue;
			}
			if (seenIds.has(sceneId)) {
				continue;
			}
			seenIds.add(sceneId);
			sceneIds.push({ id: sceneId, title: file.basename });
		}
		sceneIds.sort((left, right) => left.title.localeCompare(right.title, undefined, { numeric: true }));
		noteNames.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

		if (activeFile && isSceneNoteForScope(this.app, activeFile, scope, this.getCutFolderOverride())) {
			activeSceneId = getSceneIdForFile(this.app, activeFile) ?? null;
			if (!activeSceneId && manuscriptFiles.some((file) => file.path === activeFile.path)) {
				activeNoteName = noteRouteName(activeFile, manuscriptFiles);
			}
		}

		return {
			bookLabel: scope.label,
			activeSceneId,
			activeNoteName,
			sceneIds,
			noteNames,
		};
	}

	async copyTextToClipboard(
		text: string,
		successMessage = "Copied to clipboard",
		errorMessage = "Could not copy to the clipboard.",
	): Promise<boolean> {
		if (!navigator.clipboard?.writeText) {
			new Notice("Clipboard access is not available in this environment.");
			return false;
		}

		try {
			await navigator.clipboard.writeText(text);
			new Notice(successMessage);
			return true;
		} catch {
			new Notice(errorMessage);
			return false;
		}
	}

	private async persistContributorProfilesIfNeeded(): Promise<void> {
		if (!this.reviewerDirectory.consumeDidChange()) {
			return;
		}

		await this.savePluginData();
	}

	// Recent Reviews' per-row Clean lands here. A row collapses every import
	// pass against one scene, so it can carry more than one uncleaned batch —
	// they are confirmed together, as the single gesture the user made, rather
	// than prompting once per batch.
	async cleanupReviewBatchesById(batchIds: readonly string[]): Promise<void> {
		if (batchIds.length === 0) {
			return;
		}
		const prompt =
			batchIds.length === 1
				? "This removes this batch's imported review blocks from their scenes."
				: `This removes ${batchIds.length} batches' imported review blocks from their scenes.`;
		if (!(await this.confirmReviewBlockRemoval(prompt))) {
			return;
		}
		for (const batchId of batchIds) {
			await this.batchProcessor.cleanupReviewBatchById(batchId);
		}
		// Refresh so the Recent Reviews row that triggered this (and its Clean
		// action) reflects the now-cleaned batches immediately.
		this.refreshReviewPanel();
	}

	async cleanupCompletedSweepReviewBlocks(): Promise<void> {
		await this.batchProcessor.cleanupCompletedSweepReviewBlocks();
	}

	async removeImportedReviewBlocksInCurrentNote(): Promise<void> {
		await this.batchProcessor.removeImportedReviewBlocksInCurrentNote();
	}
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

// A source whose work could not be read: every source ("all"), every source of
// one kind, or one note or editorialism.
type HeldSource = { kind: "all" } | { kind: WorkCandidate["kind"]; path?: string };

export interface RevisionWorkRead {
	candidates: WorkCandidate[];
	warnings: string[];
	held: HeldSource[];
}

export interface BookWorkRead {
	folder: string;
	label: string;
	active: boolean;
	work: RevisionWorkRead;
}
