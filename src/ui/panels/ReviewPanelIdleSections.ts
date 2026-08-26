// Idle / completion / workspace section renderers for ReviewPanel.
//
// Extracted from ReviewPanel.ts (Pass 21) to shrink the 2,000-line file
// without changing rendering behavior. Every function in this module is a
// 1:1 move of a former `private render*` / `private format*` method on
// ReviewPanel — DOM structure, class names, callbacks, and call order are
// preserved exactly. The split scope is intentionally narrow: only the
// !session branch sections of ReviewPanel.render() and the completed-sweep
// card. Active-session rendering (suggestion cards, filters, panel-only
// state, handoff card) stays in ReviewPanel.ts and is unaffected.
//
// Each renderer takes its dependencies explicitly via the `host` interface +
// plugin + parent element. The viewmodel layer
// (src/ui/viewmodels/ReviewPanelViewModel.ts) already pins which branch
// fires; this module owns the render bodies the panel dispatches to.

import { setIcon } from "obsidian";
import { renderContributorBrandMark, resolveContributorAvatarKind } from "../../core/ContributorBrandMarks";
import { formatReviewerTypeLabel } from "../../core/ContributorIdentity";
import { isPathInFolderScope } from "../../core/VaultScope";
import { isBatchReadyToClean } from "../../core/review/SweepCompletion";
import type EditorialistPlugin from "../../main";

// Re-exported for callers that historically imported it from this module.
export { isBatchReadyToClean };

// Minimal callback surface ReviewPanel exposes to these renderers. Matches
// what was previously reached via `this.*` inside the moved methods.
export interface IdleSectionsHost {
	bindAction(element: HTMLElement, onClick: () => void): void;
	requestRender(): void;
	getOnboardingExpanded(): boolean | null;
	setOnboardingExpanded(value: boolean): void;
}

// ── completed sweep ──────────────────────────────────────────────────────

export function renderCompletedSweepCard(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
	completedSweep: ReturnType<EditorialistPlugin["getCompletedSweepPanelState"]>,
): void {
	if (!completedSweep) {
		return;
	}

	const card = parent.createDiv({ cls: "editorialist-panel__completion" });
	const bgIcon = card.createSpan({ cls: "editorialist-panel__completion-bg-icon" });
	setIcon(bgIcon, "pen-tool");

	const titleRow = card.createDiv({ cls: "editorialist-panel__completion-title-row" });
	const titleIcon = titleRow.createSpan({ cls: "editorialist-panel__completion-title-icon" });
	setIcon(titleIcon, "pen-tool");
	titleRow.createSpan({
		cls: "editorialist-panel__completion-title",
		text: completedSweep.title,
	});

	card.createDiv({
		cls: "editorialist-panel__completion-summary",
		text: completedSweep.editsReviewedLabel,
	});
	if (completedSweep.durationLabel) {
		card.createDiv({
			cls: "editorialist-panel__completion-duration",
			text: completedSweep.durationLabel,
		});
	}
	card.createDiv({
		cls: "editorialist-panel__completion-description",
		text: completedSweep.description,
	});

	const steps = card.createDiv({ cls: "editorialist-panel__completion-steps" });
	completedSweep.nextSteps.forEach((step, index) => {
		const item = steps.createDiv({ cls: "editorialist-panel__completion-step" });
		if (index === 0) {
			item.addClass("is-primary");
		}
		const bullet = item.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
		setIcon(bullet, "arrow-right");

		if (step.action === "import") {
			const link = item.createEl("a", {
				cls: "editorialist-panel__completion-step-link",
				attr: {
					href: "#",
					title: step.label,
				},
			});
			link.createSpan({
				cls: "editorialist-panel__completion-link-text",
				text: step.label,
			});
			host.bindAction(link, () => {
				void plugin.openEditorialistModal();
			});
			return;
		}

		if (step.action === "start") {
			const link = item.createEl("a", {
				cls: "editorialist-panel__completion-step-link",
				attr: {
					href: "#",
					title: step.label,
				},
			});
			link.createSpan({
				cls: "editorialist-panel__completion-link-text",
				text: step.label,
			});
			host.bindAction(link, () => {
				void plugin.resumeCompletedReviewMode();
			});
			return;
		}

		if (step.action === "clean") {
			const link = item.createEl("a", {
				cls: "editorialist-panel__completion-step-link",
				attr: {
					href: "#",
					title: step.label,
				},
			});
			link.createSpan({
				cls: "editorialist-panel__completion-link-text",
				text: step.label,
			});
			host.bindAction(link, () => {
				void plugin.cleanupCompletedSweepReviewBlocks();
			});
			return;
		}

		item.createSpan({
			cls: "editorialist-panel__completion-step-text",
			text: step.label,
		});
	});

	const closeRow = card.createDiv({ cls: "editorialist-panel__completion-close" });
	const closeLink = closeRow.createEl("a", {
		cls: "editorialist-panel__completion-close-link",
		attr: {
			href: "#",
			title: completedSweep.closeLabel,
		},
	});
	closeLink.createSpan({ text: "→ " });
	closeLink.createSpan({
		cls: "editorialist-panel__completion-link-text",
		text: completedSweep.closeLabel,
	});
	host.bindAction(closeLink, () => {
		void plugin.closeReviewPanel();
	});
}

// ── idle (post-completion) card ──────────────────────────────────────────

export function renderIdleStateCard(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
	postCompletionIdle: ReturnType<EditorialistPlugin["getPostCompletionIdleState"]>,
): void {
	if (!postCompletionIdle) {
		return;
	}

	const card = parent.createDiv({
		cls: "editorialist-panel__completion editorialist-panel__completion--neutral",
	});
	const bgIcon = card.createSpan({ cls: "editorialist-panel__completion-bg-icon" });
	setIcon(bgIcon, "pen-tool");

	card.createDiv({
		cls: "editorialist-panel__completion-summary",
		text: "No active review",
	});
	const descriptionEl = card.createDiv({
		cls: "editorialist-panel__completion-description",
	});
	renderIdleStateDescription(descriptionEl, postCompletionIdle.description);

	const steps = card.createDiv({ cls: "editorialist-panel__completion-steps" });

	const importStep = steps.createDiv({
		cls: "editorialist-panel__completion-step editorialist-panel__completion-step--neutral-primary",
	});
	const importBullet = importStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
	setIcon(importBullet, "arrow-right");
	const importLink = importStep.createEl("a", {
		cls: "editorialist-panel__completion-step-link",
		attr: {
			href: "#",
			title: "Open Editorialist begin",
		},
	});
	importLink.createSpan({
		cls: "editorialist-panel__completion-link-text",
		text: "Import new revision notes",
	});
	host.bindAction(importLink, () => {
		void plugin.openEditorialistModal();
	});

	const operationsStep = steps.createDiv({ cls: "editorialist-panel__completion-step" });
	const operationsBullet = operationsStep.createSpan({ cls: "editorialist-panel__completion-step-bullet" });
	setIcon(operationsBullet, "arrow-right");
	operationsStep.createSpan({
		cls: "editorialist-panel__completion-step-text",
		text: "Review revision and contributor details in settings.",
	});
}

// Pure splitter: highlights the literal token "PENDING EDITS" inside the
// description copy with a pill span. Exported for completeness; the only
// call site is renderIdleStateCard above.
export function renderIdleStateDescription(parent: HTMLElement, description: string): void {
	const token = "PENDING EDITS";
	const tokenIndex = description.indexOf(token);
	if (tokenIndex === -1) {
		parent.setText(description);
		return;
	}
	const before = description.slice(0, tokenIndex);
	const after = description.slice(tokenIndex + token.length);
	if (before.length > 0) {
		parent.createSpan({ text: before });
	}
	parent.createSpan({
		cls: "editorialist-panel__completion-description-pill",
		text: token,
	});
	if (after.length > 0) {
		parent.createSpan({ text: after });
	}
}

// ── header launcher chip (workflows disclosure helper) ───────────────────

export function renderHeaderLauncherChip(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
): void {
	const chip = parent.createDiv({ cls: "editorialist-panel__launcher-chip" });
	const keys = chip.createSpan({ cls: "editorialist-panel__launcher-chip-keys" });
	keys.createEl("kbd", { text: "⌘" });
	keys.createEl("kbd", { text: "P" });
	const link = chip.createEl("a", {
		cls: "editorialist-panel__launcher-chip-link",
		attr: { href: "#", title: "Open the Editorialist launcher" },
	});
	link.setText("Launcher");
	host.bindAction(link, () => {
		void plugin.openEditorialistModal();
	});
}

// ── continue review card (workspace dominant card) ───────────────────────

export function renderContinueReviewCard(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
	launchTarget: NonNullable<ReturnType<EditorialistPlugin["getNextLogicalReviewLaunchTarget"]>>,
	overview: ReturnType<EditorialistPlugin["getReviewStateOverview"]>,
): void {
	const entry = overview
		? [...overview.pending, ...overview.processed].find(
			(candidate) => candidate.notePath === launchTarget.notePath,
		)
		: undefined;

	const card = parent.createDiv({ cls: "editorialist-panel__continue" });

	const eyebrow = card.createDiv({ cls: "editorialist-panel__continue-eyebrow" });
	const eyebrowIcon = eyebrow.createSpan({ cls: "editorialist-panel__continue-eyebrow-icon" });
	setIcon(eyebrowIcon, "pen-tool");
	eyebrow.createSpan({
		cls: "editorialist-panel__continue-eyebrow-text",
		text: launchTarget.intent === "active" ? "Continue review" : "Next in sweep",
	});

	card.createDiv({
		cls: "editorialist-panel__continue-title",
		text: launchTarget.label,
	});

	const metaParts: string[] = [];
	if (entry) {
		if (entry.pendingCount > 0) {
			metaParts.push(`${entry.pendingCount} pending`);
		}
		if (entry.unresolvedCount > 0) {
			metaParts.push(`${entry.unresolvedCount} unmatched`);
		}
		if (entry.deferredCount > 0) {
			metaParts.push(`${entry.deferredCount} deferred`);
		}
		if (entry.processedCount > 0) {
			metaParts.push(`${entry.processedCount} resolved`);
		}
	}
	if (metaParts.length === 0) {
		metaParts.push(`Resume this ${launchTarget.unitLabel}`);
	}
	card.createDiv({
		cls: "editorialist-panel__continue-meta",
		text: metaParts.join(" · "),
	});

	if (entry) {
		card.createDiv({
			cls: "editorialist-panel__continue-timestamp",
			text: `Last opened ${formatRelativeTime(entry.lastUpdated)}`,
		});
	}

	const resumeButton = card.createEl("button", {
		cls: "editorialist-panel__continue-action",
		attr: {
			type: "button",
			title: `Open ${launchTarget.label}`,
		},
	});
	resumeButton.createSpan({
		cls: "editorialist-panel__continue-action-text",
		text: launchTarget.intent === "active" ? "Resume review" : `Start ${launchTarget.unitLabel}`,
	});
	host.bindAction(resumeButton, () => {
		void plugin.startOrResumeReviewForNote(launchTarget.notePath);
	});
}

// ── workflows disclosure (onboarding) ────────────────────────────────────

export function renderWorkflowsDisclosure(
	host: IdleSectionsHost,
	plugin: EditorialistPlugin,
	parent: HTMLElement,
	defaultExpanded: boolean,
): void {
	const expanded = host.getOnboardingExpanded() ?? defaultExpanded;
	const section = parent.createDiv({
		cls: `editorialist-panel__workflows${expanded ? "" : " is-collapsed"}`,
	});

	const heading = section.createDiv({
		cls: "editorialist-panel__section-header editorialist-panel__workflows-header",
	});
	const caret = heading.createSpan({ cls: "editorialist-panel__workflows-caret" });
	setIcon(caret, expanded ? "chevron-down" : "chevron-right");
	heading.createDiv({ cls: "editorialist-panel__section-title", text: "How Editorialist works" });
	host.bindAction(heading, () => {
		host.setOnboardingExpanded(!expanded);
		host.requestRender();
	});
	renderHeaderLauncherChip(host, plugin, heading);

	if (!expanded) {
		return;
	}

	const grid = section.createDiv({ cls: "editorialist-panel__workflow-grid" });
	const workflows: Array<{ icon: string; title: string; body: string }> = [
		{
			icon: "download-cloud",
			title: "Imported review pass",
			body: "Pull in contributor notes from a human reader or AI editor, then accept, reject, or rewrite each suggestion in turn.",
		},
		{
			icon: "clipboard-list",
			title: "Pending edits sweep",
			body: "Walk through free-form revision notes you've left across the active book, scene by scene.",
		},
		{
			icon: "users",
			title: "Contributor directory",
			body: "Star trusted reviewers, resolve aliases on imported batches, and track who shaped each draft.",
		},
	];
	for (const wf of workflows) {
		const card = grid.createDiv({ cls: "editorialist-panel__workflow-card" });
		const iconWrap = card.createSpan({ cls: "editorialist-panel__workflow-icon" });
		setIcon(iconWrap, wf.icon);
		const text = card.createDiv({ cls: "editorialist-panel__workflow-text" });
		text.createDiv({ cls: "editorialist-panel__workflow-title", text: wf.title });
		text.createDiv({ cls: "editorialist-panel__workflow-body", text: wf.body });
	}
}

// ── recent activity block ────────────────────────────────────────────────

// One Recent Reviews row: every batch imported against the same scene set,
// newest pass first. Re-importing a scene produces a fresh batch each time, so
// a single evening of iterating on one scene used to fill the whole five-row
// list with what looked like five separate review sessions.
export interface RecentReviewGroup<Entry> {
	key: string;
	// Most recent pass by import time. Supplies the row title, the status
	// modifier, and the timestamp.
	latest: Entry;
	// Every pass against this scene set, newest first.
	passes: Entry[];
	lastImportedAt: number;
	firstImportedAt: number;
}

// Groups batches by the scenes they cover and orders both the groups and the
// passes inside them by IMPORT time — when the review actually happened.
//
// The previous ordering key was `cleanedAt ?? importedAt`, which is when the
// inventory sync first saw the batch's block gone. That is not activity: a
// burst of cleanups stamps near-identical times on passes whose imports were
// hours apart, so the list both misdated and misordered real work.
export function groupRecentReviews<
	Entry extends {
		sceneOrder: readonly string[];
		importedNotePaths: readonly string[];
		importedAt: number;
	},
>(entries: readonly Entry[], scopeFolder: string | null = null): RecentReviewGroup<Entry>[] {
	const groups = new Map<string, RecentReviewGroup<Entry>>();
	for (const entry of entries) {
		// Sorted so two passes that listed the same scenes in a different order
		// still land in one group.
		const key = [...resolveRecentReviewPaths(entry, scopeFolder)].sort().join(" ");
		const existing = groups.get(key);
		if (existing) {
			existing.passes.push(entry);
			continue;
		}
		groups.set(key, {
			key,
			latest: entry,
			passes: [entry],
			lastImportedAt: entry.importedAt,
			firstImportedAt: entry.importedAt,
		});
	}

	const ordered = [...groups.values()];
	for (const group of ordered) {
		group.passes.sort((left, right) => right.importedAt - left.importedAt);
		group.latest = group.passes[0] ?? group.latest;
		group.lastImportedAt = group.passes[0]?.importedAt ?? group.lastImportedAt;
		group.firstImportedAt =
			group.passes[group.passes.length - 1]?.importedAt ?? group.firstImportedAt;
	}
	ordered.sort((left, right) => right.lastImportedAt - left.lastImportedAt);
	return ordered;
}

// Sums decision counts across every pass in a group, so the chips report what
// was decided on the scene rather than what survived in the final import.
export function sumGroupStats(
	passes: readonly { batchId: string }[],
	getStats: (batchId: string) => {
		accepted: number;
		rejected: number;
		rewritten: number;
		deferred: number;
	},
): { accepted: number; rejected: number; rewritten: number; deferred: number } {
	const total = { accepted: 0, rejected: 0, rewritten: 0, deferred: 0 };
	for (const pass of passes) {
		const stats = getStats(pass.batchId);
		total.accepted += stats.accepted;
		total.rejected += stats.rejected;
		total.rewritten += stats.rewritten;
		total.deferred += stats.deferred;
	}
	return total;
}

export function renderRecentActivityBlock(
	plugin: EditorialistPlugin,
	parent: HTMLElement,
): void {
	const allEntries = plugin.getSweepRegistryEntries();
	if (allEntries.length === 0) {
		return;
	}

	const scopeFolder = plugin.getActiveBookScopeInfo().sourceFolder;
	const allGroups = groupRecentReviews(allEntries, scopeFolder);
	const groups = allGroups.slice(0, 5);

	const section = parent.createDiv({ cls: "editorialist-panel__history" });
	const heading = section.createDiv({ cls: "editorialist-panel__section-header" });
	heading.createDiv({ cls: "editorialist-panel__section-title", text: "Recent reviews" });
	// Counts scenes reviewed, not import batches. A batch count reads as a
	// session count and inflates with every re-import of the same scene.
	heading.createDiv({
		cls: "editorialist-panel__section-meta",
		text: `${allGroups.length} total`,
	});

	const list = section.createDiv({ cls: "editorialist-panel__history-list" });
	for (const group of groups) {
		const entry = group.latest;
		const passCount = group.passes.length;
		const row = list.createDiv({ cls: "editorialist-panel__history-row" });
		const main = row.createDiv({ cls: "editorialist-panel__history-main" });

		const sceneTitle = formatRecentReviewSceneTitle(entry, scopeFolder);
		main.createDiv({
			cls: "editorialist-panel__history-title",
			text: sceneTitle,
		});

		const metaParts: string[] = [];
		if (passCount > 1) {
			metaParts.push(`${passCount} passes`);
		}
		if (entry.totalSuggestions > 0) {
			metaParts.push(`${entry.totalSuggestions} ${entry.totalSuggestions === 1 ? "suggestion" : "suggestions"}`);
		}
		metaParts.push(formatRelativeTime(group.lastImportedAt));
		const meta = main.createDiv({
			cls: "editorialist-panel__history-meta",
			text: metaParts.join(" · "),
		});
		// The suggestion count names the latest pass only; the tooltip says so
		// and spans the group so a collapsed row is never read as a single import.
		meta.setAttr("title", formatGroupTooltip(passCount, entry.totalSuggestions, group.firstImportedAt, group.lastImportedAt));

		const stats = sumGroupStats(group.passes, (batchId) => plugin.getBatchDecisionStats(batchId));
		const statusModifier = entry.status.replace(/_/g, "-");
		const chip = row.createDiv({
			cls: `editorialist-panel__history-stats editorialist-panel__history-stats--${statusModifier}`,
			attr: {
				title: formatStatsTooltip(stats),
			},
		});
		renderStatChip(chip, "check", stats.accepted, "accepted");
		renderStatChip(chip, "x", stats.rejected, "rejected");
		renderStatChip(chip, "pencil-line", stats.rewritten, "rewritten");
		if (stats.deferred > 0) {
			renderStatChip(chip, "circle-pause", stats.deferred, "deferred");
		}

		// Cleanable-ness is per batch, and each batch owns its own block, so the
		// group's button cleans every pass that still has one. Already-cleaned
		// passes fail isBatchReadyToClean and are skipped.
		const cleanablePasses = group.passes.filter((pass) =>
			isBatchReadyToClean(pass, plugin.getBatchDecisionStats(pass.batchId)),
		);
		if (cleanablePasses.length > 0) {
			const cleanButton = row.createEl("button", {
				cls: "editorialist-panel__review-state-row-clean",
				attr: {
					type: "button",
					"aria-label":
						cleanablePasses.length === 1
							? "Clean this batch's review block from the scene"
							: `Clean ${cleanablePasses.length} review blocks from this scene`,
				},
			});
			const cleanIcon = cleanButton.createSpan({ cls: "editorialist-panel__review-state-row-clean-icon" });
			setIcon(cleanIcon, "eraser");
			cleanButton.createSpan({
				cls: "editorialist-panel__review-state-row-clean-text",
				text: "Clean",
			});
			cleanButton.addEventListener("click", () => {
				void plugin.cleanupReviewBatchesById(cleanablePasses.map((pass) => pass.batchId));
			});
		}
	}
}

// Spells out what a collapsed row covers: how many passes, what the suggestion
// count refers to, and the span of the work.
export function formatGroupTooltip(
	passCount: number,
	latestSuggestions: number,
	firstImportedAt: number,
	lastImportedAt: number,
	now: number = Date.now(),
): string {
	if (passCount <= 1) {
		return `Imported ${formatRelativeTime(lastImportedAt, now)}`;
	}
	return [
		`${passCount} import passes on this scene`,
		`Latest pass: ${latestSuggestions} ${latestSuggestions === 1 ? "suggestion" : "suggestions"}, imported ${formatRelativeTime(lastImportedAt, now)}`,
		`First pass imported ${formatRelativeTime(firstImportedAt, now)}`,
	].join("\n");
}

// ── contributors block ───────────────────────────────────────────────────

export function renderContributorsBlock(plugin: EditorialistPlugin, parent: HTMLElement): void {
	const allProfiles = plugin.getSortedReviewerProfiles();
	if (allProfiles.length === 0) {
		return;
	}

	const profiles = allProfiles.slice(0, 5);
	const section = parent.createDiv({ cls: "editorialist-panel__contributors" });
	const heading = section.createDiv({ cls: "editorialist-panel__section-header" });
	heading.createDiv({ cls: "editorialist-panel__section-title", text: "Contributors" });
	heading.createDiv({
		cls: "editorialist-panel__section-meta",
		text: `${allProfiles.length} total`,
	});

	const list = section.createDiv({ cls: "editorialist-panel__contributors-list" });
	for (const profile of profiles) {
		const row = list.createDiv({ cls: "editorialist-panel__contributors-row" });

		const avatarKind = resolveContributorAvatarKind(profile);
		const brand = avatarKind === "person" || avatarKind === "generic-ai" ? null : avatarKind;
		const avatarClasses = ["editorialist-panel__contributors-avatar"];
		if (avatarKind !== "person") {
			avatarClasses.push("is-ai");
		}
		if (profile.isStarred) {
			avatarClasses.push("is-starred");
		}
		if (brand) {
			avatarClasses.push(`is-provider-${brand}`);
		}
		const avatar = row.createSpan({ cls: avatarClasses.join(" ") });
		const avatarIcon = avatar.createSpan({ cls: "editorialist-panel__contributors-avatar-icon" });
		if (brand) {
			avatarIcon.addClass("is-brand");
			renderContributorBrandMark(avatarIcon, brand);
		} else if (avatarKind === "generic-ai") {
			setIcon(avatarIcon, "cpu");
		} else {
			setIcon(avatarIcon, profile.isStarred ? "user-star" : "user-round");
		}

		const main = row.createDiv({ cls: "editorialist-panel__contributors-main" });
		main.createDiv({ cls: "editorialist-panel__contributors-name", text: profile.displayName });

		const metaParts: string[] = [formatReviewerTypeLabel(profile.reviewerType)];
		if (profile.kind === "ai" && profile.provider) {
			metaParts.push(profile.provider);
		}
		main.createDiv({
			cls: "editorialist-panel__contributors-meta",
			text: metaParts.join(" · "),
		});

		const stat = profile.stats?.totalSuggestions ?? 0;
		if (stat > 0) {
			row.createDiv({
				cls: "editorialist-panel__contributors-stat",
				text: `${stat} ${stat === 1 ? "edit" : "edits"}`,
			});
		}
	}
}

// ── pure helpers ─────────────────────────────────────────────────────────

export function renderStatChip(
	parent: HTMLElement,
	icon: string,
	value: number,
	kind: string,
): void {
	const chip = parent.createSpan({
		cls: `editorialist-panel__history-stat editorialist-panel__history-stat--${kind}${value === 0 ? " is-zero" : ""}`,
	});
	const iconEl = chip.createSpan({ cls: "editorialist-panel__history-stat-icon" });
	setIcon(iconEl, icon);
	chip.createSpan({
		cls: "editorialist-panel__history-stat-value",
		text: `${value}`,
	});
}

export function formatStatsTooltip(stats: {
	accepted: number;
	rejected: number;
	rewritten: number;
	deferred: number;
}): string {
	const parts = [
		`${stats.accepted} accepted`,
		`${stats.rejected} rejected`,
		`${stats.rewritten} rewritten`,
	];
	if (stats.deferred > 0) {
		parts.push(`${stats.deferred} deferred`);
	}
	return parts.join(" · ");
}

// Builds the row title from the scenes a batch touched. One scene shows its
// basename. Two or three list them comma-separated. Four or more truncate
// to the first two plus a "+N more" suffix.
// The scenes a batch is displayed as covering. Single source of truth for both
// the row title and the Recent Reviews grouping key — if these two disagreed,
// two rows carrying the same visible title could refuse to collapse.
//
// When `scopeFolder` is set, only scenes inside it count, so a batch that
// happened to touch a note outside the active book (e.g. a content log) is
// named by its in-scope scenes alone. A null scope (no Radial Timeline book and
// no configured manuscript folder) keeps every path. If filtering would empty
// the list, the unfiltered paths are used so a fully out-of-scope batch never
// resolves to nothing.
export function resolveRecentReviewPaths(
	entry: {
		sceneOrder: readonly string[];
		importedNotePaths: readonly string[];
	},
	scopeFolder: string | null = null,
): readonly string[] {
	const allPaths = entry.sceneOrder.length > 0 ? entry.sceneOrder : entry.importedNotePaths;
	if (!scopeFolder) {
		return allPaths;
	}
	const scopedPaths = allPaths.filter((path) => isPathInFolderScope(path, scopeFolder));
	return scopedPaths.length > 0 ? scopedPaths : allPaths;
}

export function formatRecentReviewSceneTitle(
	entry: {
		sceneOrder: readonly string[];
		importedNotePaths: readonly string[];
		activeBookLabel?: string;
	},
	scopeFolder: string | null = null,
): string {
	const paths = resolveRecentReviewPaths(entry, scopeFolder);
	const titles = paths
		.map((path) => path.split("/").pop()?.replace(/\.md$/i, "")?.trim())
		.filter((title): title is string => Boolean(title));
	if (titles.length === 0) {
		return entry.activeBookLabel?.trim() || "Review pass";
	}
	if (titles.length === 1) {
		return titles[0] ?? "Review pass";
	}
	// Multi-scene batches: order ascending by leading scene number, shorten each
	// name to "<number> + 2 words…", and name up to MAX_NAMED before a count
	// suffix. Short names let the title wrap to a second line (see styles.css)
	// instead of ellipsis-truncating mid-word.
	const MAX_NAMED = 4;
	const ordered = titles
		.map((title, index) => ({ title, index, key: sceneNumberKey(title) }))
		.sort((left, right) => left.key - right.key || left.index - right.index)
		.map((item) => shortenSceneTitle(item.title));
	if (ordered.length <= MAX_NAMED) {
		return ordered.join(", ");
	}
	const head = ordered.slice(0, MAX_NAMED).join(", ");
	return `${head}, +${ordered.length - MAX_NAMED} more`;
}

// Trims a scene name to its leading number plus two words (e.g. "51 Long Road
// Up, Part 2" -> "51 Long Road…"). Names without a numeric prefix keep their
// first two words. Anything already at or below the limit is returned as-is.
export function shortenSceneTitle(title: string): string {
	const tokens = title.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return title;
	}
	const hasNumberPrefix = /^\d+(?:\.\d+)?$/.test(tokens[0] ?? "");
	const keep = hasNumberPrefix ? 3 : 2;
	if (tokens.length <= keep) {
		return tokens.join(" ");
	}
	return `${tokens.slice(0, keep).join(" ")}…`;
}

// Leading scene number used to order scenes within a batch title. Names without
// a number sort to the end (kept in their original relative order via the index
// tie-breaker at the call site).
function sceneNumberKey(title: string): number {
	const match = title.match(/^\s*(\d+(?:\.\d+)?)/);
	return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
	const diff = now - timestamp;
	if (diff < 60_000) return "just now";
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks}w ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	const years = Math.floor(days / 365);
	return `${years}y ago`;
}

