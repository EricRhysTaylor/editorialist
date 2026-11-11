import { setAccessibleLabel } from "./primitives/AccessibleLabel";
import { ButtonComponent, Component, Notice, PluginSettingTab, SettingPage, requireApiVersion, setIcon, TFile, ToggleComponent, type App, type SettingDefinitionItem } from "obsidian";
import { formatReviewerTypeLabel } from "../core/ContributorIdentity";
import { sweepStatusLabel } from "../core/status/ReviewStatusModel";
import {
	renderContributorBrandMark,
	resolveContributorAvatarKind,
} from "../core/ContributorBrandMarks";
import {
	CONTRIBUTOR_ROLE_DEFINITIONS,
	getContributorStrengthDefinition,
} from "../core/ContributorStrengths";
import { getFrontmatterStringValues } from "../core/VaultScope";
import type { ReviewSweepRegistryEntry } from "../models/ReviewImport";
import type { EditorialistEffortSettings, SceneReviewRecord } from "../models/ContributorProfile";
import type EditorialistPlugin from "../main";
import { openEditorialistChoiceModal } from "./EditorialistChoiceModal";
import { BACKUPS_FOLDER, EDITORIALISM_FOLDER_NAME, RESPONSES_FOLDER, WORD_FILES_FOLDER } from "../services/EditorialismService";
import { describeUnremovedBlocksSuffix } from "../orchestrators/ReviewBatchProcessor";
import { RADIAL_TIMELINE_ICON_ID } from "./RadialTimelineLogoIcon";

export type SettingsTabId = "core" | "reviewer" | "configuration";

export class EditorialistSettingTab extends PluginSettingTab {
	private static readonly SETTINGS_DOCS_URL = "https://github.com/EricRhysTaylor/Editorialist#readme";
	private static readonly RADIAL_TIMELINE_INSTALL_URL = "obsidian://show-plugin?id=radial-timeline";
	private static readonly RADIAL_TIMELINE_REPOSITORY_URL = "https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline";
	private static readonly RADIAL_TIMELINE_WIKI_URL = "https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline/wiki";
	private activeBookOnly = true;
	private activeTab: SettingsTabId = "core";
	private dashboardEl: HTMLElement | null = null;

	/** Search opens the same dashboard and controls, including on versions that support settings pages. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const destinations: Array<{ name: string; tab: SettingsTabId; section: string }> = [
			{ name: "Manuscript target and book folder", tab: "configuration", section: "Manuscript target" },
			{ name: "Name on your comments and files", tab: "configuration", section: "You and your files" },
			{ name: "Cut folder and backup to cut file", tab: "configuration", section: "Cut location" },
			{ name: "Notes an AI writes into a scene", tab: "configuration", section: "Notes an AI writes into a scene" },
			...[
				"Revision effort estimate", "Words per new scene", "Drafting rate words per hour",
				"Minutes per Editorialism item", "Daily writing hours",
			].map((name) => ({ name, tab: "configuration" as const, section: "Revision effort estimate" })),
			{ name: "Contributors and reviewers", tab: "reviewer", section: "Contributor directory" },
			{ name: "Save and restore backups", tab: "reviewer", section: "Backup" },
			{ name: "Maintenance and review history", tab: "configuration", section: "Maintenance" },
		];
		if (requireApiVersion("1.13.0")) return [
			{ name: "Dashboard", searchable: false, render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.removeClass("setting-item");
				this.dashboardEl = setting.settingEl.createDiv();
				void this.displayAsync(true);
			} },
			{ type: "group", cls: "editorialist-settings__tab-content is-hidden", items: destinations.map(({ name, tab, section }) => ({
				type: "page" as const, name, page: () => {
					const render = (container: HTMLElement): void => {
						this.dashboardEl = container;
						this.activeTab = tab;
						void this.displayAsync(true).then(() => {
							if (this.dashboardEl === container && container.isConnected) this.revealSearchSection(section);
						});
					};
					const dispose = (): void => { this.hide(); this.dashboardEl = null; };
					return new class extends SettingPage {
						display(): void { render(this.containerEl); }
						hide(): void { dispose(); }
					}();
				},
			})) },
		];
		return [];
	}

	private revealSearchSection(title: string): void {
		const sections = this.dashboardEl?.querySelectorAll<HTMLElement>(".editorialist-settings__section") ?? [];
		for (const section of sections) {
			if (section.querySelector(".editorialist-settings__section-title")?.textContent?.trim() === title) {
				section.scrollIntoView({ block: "start" });
				break;
			}
		}
	}

	// The tab to show. When the settings are already on screen, show it now:
	// recording it alone left the old tab drawn, and a click on the new tab then
	// did nothing because it already counted as active. Otherwise display()
	// shows it when the settings open.
	selectTab(tab: SettingsTabId): void {
		if (this.activeTab === tab) return;
		this.activeTab = tab;
		if (this.containerEl.isConnected) void this.displayAsync(false);
	}
	private displayRunId = 0;
	private contributorEvents = new Component();
	private contributorMergePending = false;

	private static readonly RT_STATUS_GLYPH_DEFINITIONS = [
		{ glyph: "T", label: "Todo", tone: "todo", values: ["todo", "to do", "t"] },
		{ glyph: "W", label: "Working", tone: "working", values: ["working", "in progress", "draft", "w"] },
		{ glyph: "C", label: "Complete", tone: "complete", values: ["complete", "completed", "done", "final", "c"] },
	] as const;

	private static readonly RT_STAGE_GLYPH_DEFINITIONS = [
		{ glyph: "Z", label: "Zero", tone: "zero", values: ["zero", "z"] },
		{ glyph: "A", label: "Author", tone: "author", values: ["author", "a"] },
		{ glyph: "H", label: "House", tone: "house", values: ["house", "h"] },
		{ glyph: "P", label: "Press", tone: "press", values: ["press", "p"] },
	] as const;

	constructor(
		app: App,
		private readonly plugin: EditorialistPlugin,
	) {
		super(app, plugin);
		plugin.register(() => this.contributorEvents.unload());
	}

	display(): void {
		this.dashboardEl = this.containerEl;
		void this.displayAsync(true);
	}

	hide(): void {
		this.displayRunId += 1;
		this.contributorEvents.unload();
	}

	private async displayAsync(refreshMetadata: boolean): Promise<void> {
		this.contributorEvents.unload();
		this.contributorEvents = new Component();
		this.contributorEvents.load();
		const runId = ++this.displayRunId;
		const containerEl = this.dashboardEl ?? this.containerEl;
		containerEl.empty();
		containerEl.addClass("editorialist-settings");

		if (refreshMetadata) {
			await this.plugin.syncOperationalMetadata();
		}
		await this.plugin.pendingEdits.refreshPendingEditsSummary({ force: refreshMetadata });
		if (runId !== this.displayRunId) {
			return;
		}
		const summary = this.plugin.getReviewActivitySummary();
		const activeBook = this.plugin.getActiveBookScopeInfo();
		if (!activeBook.label) {
			this.activeBookOnly = false;
		}

		if (runId !== this.displayRunId) {
			return;
		}

		const shell = containerEl.createDiv({ cls: "editorialist-settings__shell" });
		const tabBar = shell.createDiv({ cls: "editorialist-settings__tabs" });
		this.createTab(tabBar, "core", "settings", "Core");
		this.createTab(tabBar, "reviewer", "users", "Contributors");
		this.createTab(tabBar, "configuration", "sliders-horizontal", "Configuration");

		const coreContent = shell.createDiv({ cls: "editorialist-settings__tab-content" });
		const reviewerContent = shell.createDiv({ cls: "editorialist-settings__tab-content" });
		const configurationContent = shell.createDiv({ cls: "editorialist-settings__tab-content" });
		coreContent.toggleClass("is-hidden", this.activeTab !== "core");
		reviewerContent.toggleClass("is-hidden", this.activeTab !== "reviewer");
		configurationContent.toggleClass("is-hidden", this.activeTab !== "configuration");

		const inventory = this.plugin.getSceneReviewRecords({ activeBookOnly: this.activeBookOnly });
		this.renderCoreHero(coreContent);
		if (!this.isRadialTimelineInstalled()) {
			this.renderRadialTimelineCard(coreContent);
		}
		this.renderHero(coreContent, summary, inventory);
		this.renderInventorySection(coreContent, inventory, activeBook.label);
		this.renderPendingEditsSection(coreContent);
		this.renderActivitySection(coreContent, summary);

		this.renderContributorsHero(reviewerContent);
		this.renderContributorsSection(reviewerContent);
		this.renderMetadataSection(reviewerContent);

		// Configuration holds the knobs and admin: manuscript scope first (the
		// most fundamental "what counts as the book" setting), then the tracking
		// identity that scope drives, the cut-file location, and finally the
		// destructive maintenance actions.
		this.renderConfigurationHero(configurationContent);
		this.renderBookFolderSection(configurationContent, activeBook);
		this.renderTrackingSection(configurationContent, activeBook);
		this.renderAuthorSection(configurationContent);
		this.renderCutLocationSection(configurationContent, activeBook);
		this.renderFileWriteDetectionSection(configurationContent);
		this.renderEffortSection(configurationContent);
		this.renderMaintenanceSection(configurationContent, activeBook.label);
	}

	private getInventoryVocabulary(activeBook: { label: string | null; sourceFolder: string | null }): {
		hasStructuredRtContext: boolean;
		pluralLabel: string;
		pluralLabelLower: string;
		scopeLabel: string;
		singularLabel: string;
		singularLabelLower: string;
	} {
		const hasStructuredRtContext = this.plugin.getActiveBookScopeInfo().structured;
		if (hasStructuredRtContext) {
			return {
				hasStructuredRtContext,
				singularLabel: "Scene",
				singularLabelLower: "scene",
				pluralLabel: "Scenes",
				pluralLabelLower: "scenes",
				scopeLabel: "book",
			};
		}

		return {
			hasStructuredRtContext,
			singularLabel: "Note",
			singularLabelLower: "note",
			pluralLabel: "Notes",
			pluralLabelLower: "notes",
			scopeLabel: activeBook.sourceFolder ? "manuscript" : this.plugin.getManuscriptTarget()?.kind === "note" ? "note" : "vault",
		};
	}

	private renderCoreHero(parent: HTMLElement): void {
		const hero = parent.createDiv({
			cls: "editorialist-settings__hero-intro editorialist-settings__panel",
		});
		const badgeRow = hero.createDiv({ cls: "editorialist-settings__hero-intro-badge-row" });
		const badge = badgeRow.createSpan({ cls: "editorialist-settings__hero-intro-badge" });
		const badgeIcon = badge.createSpan({ cls: "editorialist-settings__hero-intro-badge-icon" });
		setIcon(badgeIcon, "settings");
		badge.createSpan({
			cls: "editorialist-settings__hero-intro-badge-text",
			text: "Core · Editorial review",
		});
		const badgeLink = badge.createEl("a", {
			href: EditorialistSettingTab.SETTINGS_DOCS_URL,
			cls: "editorialist-settings__hero-intro-badge-link editorialist-settings__rt-card-badge-link",
			attr: {
				target: "_blank",
				rel: "noopener",
			},
		});
		setAccessibleLabel(badgeLink, "Open Editorialist documentation");
		setIcon(badgeLink, "external-link");

		const titleRow = hero.createDiv({ cls: "editorialist-settings__hero-intro-title-row" });
		titleRow.createDiv({
			cls: "editorialist-settings__hero-intro-title",
			text: "Structured editorial review in Obsidian",
		});
		hero.createDiv({
			cls: "editorialist-settings__hero-intro-subtitle",
			text: "Editorialist is a revision workspace for authors who want structured, in-context editing inside Obsidian. It brings together feedback from human editors, beta readers, and AI into one review flow, so you can compare suggestions against the manuscript before making a decision. That means fewer scattered notes, less copy-and-paste friction, and a much clearer path through revision. Every change stays under author control until accepted. It works with any vault note out of the box, whether you are revising a single chapter or managing a full manuscript.",
		});

		const features = hero.createDiv({ cls: "editorialist-settings__hero-features" });
		features.createDiv({
			cls: "editorialist-settings__hero-features-kicker",
			text: "Core highlights:",
		});
		const featureList = features.createDiv({ cls: "editorialist-settings__hero-features-list" });
		this.createHeroFeature(featureList, "table-properties", "Scene inventory — see every scene that still has revision notes and track progress at a glance.");
		this.createHeroFeature(featureList, "pen-tool", "Review in context — jump straight into any scene and continue editing without searching.");
		this.createHeroFeature(featureList, "users", "Contributor tracking — keep revision identities clean, merge aliases, and preserve trustworthy editorial history.");
		this.createHeroFeature(featureList, "database-backup", "Backups — save everything Editorialist remembers and restore it later, on the Contributors tab, without touching your manuscript.");
	}

	private renderContributorsHero(parent: HTMLElement): void {
		const hero = parent.createDiv({
			cls: "editorialist-settings__hero-intro editorialist-settings__panel",
		});
		const badgeRow = hero.createDiv({ cls: "editorialist-settings__hero-intro-badge-row" });
		const badge = badgeRow.createSpan({ cls: "editorialist-settings__hero-intro-badge" });
		const badgeIcon = badge.createSpan({ cls: "editorialist-settings__hero-intro-badge-icon" });
		setIcon(badgeIcon, "users");
		badge.createSpan({
			cls: "editorialist-settings__hero-intro-badge-text",
			text: "Contributors · Directory",
		});
		const badgeLink = badge.createEl("a", {
			href: EditorialistSettingTab.SETTINGS_DOCS_URL,
			cls: "editorialist-settings__hero-intro-badge-link editorialist-settings__rt-card-badge-link",
			attr: {
				target: "_blank",
				rel: "noopener",
			},
		});
		setAccessibleLabel(badgeLink, "Open Editorialist documentation");
		setIcon(badgeLink, "external-link");

		const titleRow = hero.createDiv({ cls: "editorialist-settings__hero-intro-title-row" });
		titleRow.createDiv({
			cls: "editorialist-settings__hero-intro-title",
			text: "See how each voice shapes your draft",
		});
		hero.createDiv({
			cls: "editorialist-settings__hero-intro-subtitle",
			text: "Editorialist keeps track of who contributed each revision note so you can see what’s working and what isn’t. Whether feedback comes from a human editor, a beta reader, or AI, you can compare how often suggestions are accepted across each contributor. Over time, this helps you understand how each voice shapes your work and where each one tends to add the most value.",
		});

		const features = hero.createDiv({ cls: "editorialist-settings__hero-features" });
		features.createDiv({
			cls: "editorialist-settings__hero-features-kicker",
			text: "Contributor highlights:",
		});
		const featureList = features.createDiv({ cls: "editorialist-settings__hero-features-list" });
		this.createHeroFeature(featureList, "users", "Contributor directory — see everyone who has helped shape your revisions, from editors to AI tools.");
		this.createHeroFeature(featureList, "shuffle", "Refine your sources — update or combine names so your contributor history stays clear and accurate.");
		this.createHeroFeature(featureList, "star", "See what works — compare how often suggestions are accepted to understand which feedback improves your writing.");
	}

	private renderConfigurationHero(parent: HTMLElement): void {
		const hero = parent.createDiv({
			cls: "editorialist-settings__hero-intro editorialist-settings__panel",
		});
		const badgeRow = hero.createDiv({ cls: "editorialist-settings__hero-intro-badge-row" });
		const badge = badgeRow.createSpan({ cls: "editorialist-settings__hero-intro-badge" });
		const badgeIcon = badge.createSpan({ cls: "editorialist-settings__hero-intro-badge-icon" });
		setIcon(badgeIcon, "sliders-horizontal");
		badge.createSpan({
			cls: "editorialist-settings__hero-intro-badge-text",
			text: "Configuration · Scope & data",
		});
		const badgeLink = badge.createEl("a", {
			href: EditorialistSettingTab.SETTINGS_DOCS_URL,
			cls: "editorialist-settings__hero-intro-badge-link editorialist-settings__rt-card-badge-link",
			attr: {
				target: "_blank",
				rel: "noopener",
			},
		});
		setAccessibleLabel(badgeLink, "Open Editorialist documentation");
		setIcon(badgeLink, "external-link");

		const titleRow = hero.createDiv({ cls: "editorialist-settings__hero-intro-title-row" });
		titleRow.createDiv({
			cls: "editorialist-settings__hero-intro-title",
			text: "Tell Editorialist where your manuscript lives",
		});
		hero.createDiv({
			cls: "editorialist-settings__hero-intro-subtitle",
			text: "Choose the writing Editorialist reviews: a manuscript folder, one pinned note, or the entire vault. You can also follow the active Radial Timeline book. From here you manage stable note identity, choose where cut files are kept, and clean review blocks or reset saved history.",
		});

		const features = hero.createDiv({ cls: "editorialist-settings__hero-features" });
		features.createDiv({
			cls: "editorialist-settings__hero-features-kicker",
			text: "What you configure here:",
		});
		const featureList = features.createDiv({ cls: "editorialist-settings__hero-features-list" });
		this.createHeroFeature(featureList, "folder", "Manuscript target — choose the writing to review, independently or by following Radial Timeline.");
		this.createHeroFeature(featureList, "fingerprint", "Stable identity — keep revision history attached to the right note even as titles and order change.");
		this.createHeroFeature(featureList, "archive", "Cut files — preserve strong prose before you reduce, in a location you choose.");
		this.createHeroFeature(featureList, "wrench", "Maintenance — clean review blocks or reset saved history without touching your writing.");
	}

	private renderBookFolderSection(
		parent: HTMLElement,
		activeBook: { label: string | null; sourceFolder: string | null; structured: boolean; unavailableReason?: string },
	): void {
		const body = this.createSection(parent, "Manuscript target", "Choose a folder, one note, the entire vault, or follow the active Radial Timeline book. Folder targets can exclude supporting material and include or skip subfolders.", "folder");
		body.parentElement?.addClass("editorialist-settings__section--utility");
		const count = this.plugin.getManuscriptFiles().length;
		body.createDiv({ cls: "editorialist-settings__maintenance-note", text: activeBook.unavailableReason ?? `${activeBook.label ?? "Entire vault"} · ${count} eligible note${count === 1 ? "" : "s"}` });
		this.createActionButton(body, "folder", "Change target…", async () => { this.plugin.openManuscriptTargetSelector(() => { void this.displayAsync(false); }); });
	}

	// The author's name on comments written into an editor's Word file, and
	// the folders Editorialist saves into, so neither is a surprise.
	private renderAuthorSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"You and your files",
			"Your name goes on the comments Editorialist writes into an editor's Word file when you reply. Editorialist saves its own files in your vault, never inside your scenes.",
			"user",
		);
		body.parentElement?.addClass("editorialist-settings__section--utility");

		const fieldRow = body.createDiv({ cls: "editorialist-settings__cut-row" });
		fieldRow.createEl("label", { cls: "editorialist-settings__cut-label", text: "Name on your comments", attr: { for: "editorialist-author-name" } });
		const input = fieldRow.createEl("input", {
			cls: "editorialist-settings__cut-input",
			attr: { id: "editorialist-author-name", type: "text", placeholder: "Your name" },
		});
		input.value = this.plugin.getAuthorName();
		input.addEventListener("change", () => {
			void this.plugin.setAuthorName(input.value).then(() => {
				new Notice(input.value.trim() ? `Your comments in Word will be signed ${input.value.trim()}.` : "Your name was cleared. You will be asked for it when you reply in Word.");
			});
		});

		const list = body.createEl("ul", { cls: "editorialist-settings__folders" });
		for (const [folder, purpose] of [
			[EDITORIALISM_FOLDER_NAME, "Editorialisms: the structural notes from an editor's letter"],
			[WORD_FILES_FOLDER, "A copy of each Word file an editor sent you"],
			[RESPONSES_FOLDER, "Your responses to editors, as letters or in their Word file"],
			[BACKUPS_FOLDER, "Backups you save from the Contributors tab"],
		]) {
			const item = list.createEl("li");
			item.createEl("code", { text: folder });
			item.createSpan({ text: ` · ${purpose}` });
		}
	}

	private renderCutLocationSection(
		parent: HTMLElement,
		activeBook: { label: string | null; sourceFolder: string | null },
	): void {
		const body = this.createSection(
			parent,
			"Cut location",
			"Choose where “Backup to cut file” saves the passages you cut. Editorialist keeps one cut file per scene, in a folder of its own, so your scenes stay clean.",
			"scissors",
		);
		body.parentElement?.addClass("editorialist-settings__section--utility");

		const fieldRow = body.createDiv({ cls: "editorialist-settings__cut-row" });
		fieldRow.createDiv({
			cls: "editorialist-settings__cut-label",
			text: "Cut folder",
		});

		const defaultFolder = activeBook.sourceFolder ? `${activeBook.sourceFolder}/Cut` : "Cut, beside each scene";
		const input = fieldRow.createEl("input", {
			cls: "editorialist-settings__cut-input",
			attr: {
				type: "text",
				spellcheck: "false",
				placeholder: defaultFolder,
			},
		});
		input.value = this.plugin.getCutFolderOverride();

		const actions = fieldRow.createDiv({ cls: "editorialist-settings__cut-actions" });
		this.createActionButton(actions, "save", "Save", async () => {
			await this.plugin.setCutFolderOverride(input.value);
			new Notice(
				input.value.trim()
					? `Cut folder set to ${input.value.trim()}.`
					: "Cut files go back to the default folder.",
			);
			void this.displayAsync(false);
		});
		this.createActionButton(actions, "rotate-ccw", "Use default", async () => {
			await this.plugin.setCutFolderOverride("");
			new Notice("Cut files go back to the default folder.");
			void this.displayAsync(false);
		});

		const note = body.createDiv({ cls: "editorialist-settings__cut-note" });
		note.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: this.plugin.getCutFolderOverride()
				? `Cut files are saved in ${this.plugin.getCutFolderOverride()}.`
				: activeBook.sourceFolder
					? `Cut files are saved in ${defaultFolder}, or beside the scene when it is outside the book.`
					: "Cut files are saved in a Cut folder beside each scene.",
		});
	}

	private renderFileWriteDetectionSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"Notes an AI writes into a scene",
			"If an AI can edit your vault, it may write its revision notes straight into a scene instead of giving you text to paste. Turn this on and the launcher offers to bring those notes in for review. It never changes your writing on its own. Most writers leave this off.",
			"file-input",
		);
		body.parentElement?.addClass("editorialist-settings__section--utility");

		const fieldRow = body.createDiv({ cls: "editorialist-settings__cut-row" });
		fieldRow.createDiv({
			cls: "editorialist-settings__cut-label",
			text: "Look for notes an AI wrote into a scene",
		});

		const control = fieldRow.createDiv({ cls: "editorialist-settings__cut-actions" });
		new ToggleComponent(control)
			.setValue(this.plugin.getDetectFileWrittenReviewBlocks())
			.onChange(async (value) => {
				await this.plugin.setDetectFileWrittenReviewBlocks(value);
				new Notice(
					value
						? "On: the launcher offers to bring in notes an AI wrote into a scene."
						: "Off: revision notes come in only through the launcher.",
				);
				void this.displayAsync(false);
			});

		const note = body.createDiv({ cls: "editorialist-settings__cut-note" });
		note.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: this.plugin.getDetectFileWrittenReviewBlocks()
				? "On: when a scene holds notes an AI wrote there, opening the launcher offers to bring them in for review."
				: "Off (default): revision notes come in only through the launcher, from a Word file or a pasted reply.",
		});
	}

	private renderEffortSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"Revision effort estimate",
			"How Editorialist estimates the time an Editorialism's work will take, for planning. Drafting rate is how many words of new prose you write in an hour, which is slower than revising.",
			"clock",
		);

		const effort = this.plugin.getEffortSettings();
		const fields: Array<{ key: keyof EditorialistEffortSettings; label: string }> = [
			{ key: "wordsPerNewScene", label: "Words per new scene" },
			{ key: "draftRateWordsPerHour", label: "Drafting rate (words / hour)" },
			{ key: "minutesPerDirective", label: "Minutes per Editorialism item" },
			{ key: "dailyWritingHours", label: "Daily writing hours" },
		];

		for (const field of fields) {
			const row = body.createDiv({ cls: "editorialist-settings__effort-row" });
			row.createSpan({ cls: "editorialist-settings__effort-label", text: field.label });
			row.createSpan({ cls: "editorialist-settings__effort-leader" });
			const input = row.createEl("input", {
				cls: "editorialist-settings__effort-input",
				attr: { type: "number", min: "1", step: "1", inputmode: "numeric" },
			});
			input.value = String(effort[field.key]);
			input.addEventListener("change", () => {
				const value = Number.parseFloat(input.value);
				if (Number.isFinite(value) && value > 0) {
					const patch: Partial<EditorialistEffortSettings> = {};
					patch[field.key] = value;
					void this.plugin.setEffortSettings(patch);
				} else {
					input.value = String(this.plugin.getEffortSettings()[field.key]);
				}
			});
		}
	}

	private isRadialTimelineInstalled(): boolean {
		const plugins = this.app as App & {
			plugins?: {
				enabledPlugins?: Set<string>;
				manifests?: Record<string, { id?: string; name?: string }>;
			};
		};
		const enabledPlugins = plugins.plugins?.enabledPlugins;
		if (enabledPlugins?.has("radial-timeline")) {
			return true;
		}

		const manifests = Object.values(plugins.plugins?.manifests ?? {});
		return manifests.some((manifest) => manifest.id === "radial-timeline");
	}

	private renderRadialTimelineCard(parent: HTMLElement): void {
		const card = parent.createDiv({
			cls: "editorialist-settings__rt-card editorialist-settings__panel",
		});
		const backgroundIcon = card.createDiv({ cls: "editorialist-settings__rt-card-bg-icon" });
		setIcon(backgroundIcon, RADIAL_TIMELINE_ICON_ID);

		const row = card.createDiv({ cls: "editorialist-settings__rt-card-row" });
		const content = row.createDiv({ cls: "editorialist-settings__rt-card-content" });
		const badgeRow = content.createDiv({ cls: "editorialist-settings__hero-intro-badge-row" });
		const badge = badgeRow.createSpan({ cls: "editorialist-settings__hero-intro-badge editorialist-settings__rt-card-badge" });
		const badgeIcon = badge.createSpan({ cls: "editorialist-settings__hero-intro-badge-icon" });
		setIcon(badgeIcon, RADIAL_TIMELINE_ICON_ID);
		badge.createSpan({
			cls: "editorialist-settings__hero-intro-badge-text",
			text: "Radial Timeline integration",
		});
		const wikiLink = badge.createEl("a", {
			href: EditorialistSettingTab.RADIAL_TIMELINE_WIKI_URL,
			cls: "editorialist-settings__hero-intro-badge-link editorialist-settings__rt-card-badge-link",
			attr: {
				target: "_blank",
				rel: "noopener",
			},
		});
		setAccessibleLabel(wikiLink, "Open the Radial Timeline wiki");
		setIcon(wikiLink, "external-link");
		content.createDiv({
			cls: "editorialist-settings__rt-card-title",
			text: "Work with scenes",
		});
		content.createDiv({
			cls: "editorialist-settings__rt-card-body",
			text: "Editorialist works with any notes, but it becomes even more useful when combined with the visual architecture of the Radial Timeline plugin for Obsidian and its scene and book project organization.",
		});

		const actions = row.createDiv({ cls: "editorialist-settings__rt-card-actions" });
		const installLink = actions.createEl("a", {
			href: EditorialistSettingTab.RADIAL_TIMELINE_INSTALL_URL,
			cls: "editorialist-settings__action-button editorialist-settings__action-button--primary",
			attr: {
				target: "_blank",
				rel: "noopener",
			},
		});
		setAccessibleLabel(installLink, "Install the Radial Timeline community plugin");
		const installIcon = installLink.createSpan({ cls: "editorialist-settings__action-button-icon" });
		setIcon(installIcon, "download");
		installLink.createSpan({
			cls: "editorialist-settings__action-button-label",
			text: "Install Radial Timeline",
		});

		const fallbackLink = actions.createEl("a", {
			href: EditorialistSettingTab.RADIAL_TIMELINE_REPOSITORY_URL,
			cls: "editorialist-settings__rt-card-fallback-link",
			text: "Open plugin page",
			attr: {
				target: "_blank",
				rel: "noopener",
			},
		});
		setAccessibleLabel(fallbackLink, "Open the Radial Timeline plugin page");
		const fallbackIcon = fallbackLink.createSpan({ cls: "editorialist-settings__rt-card-fallback-icon" });
		setIcon(fallbackIcon, "external-link");

		card.createDiv({
			cls: "editorialist-settings__rt-card-hint",
			text: 'Find it in Community Plugins -> search "Radial Timeline"',
		});
	}

		private renderTrackingSection(
		parent: HTMLElement,
		activeBook: { label: string | null; sourceFolder: string | null },
	): void {
		const summary = this.plugin.getTrackingIdentitySummary({ activeBookOnly: this.activeBookOnly });
		const vocabulary = this.getInventoryVocabulary(activeBook);
		const hasRtTrackingContext = this.shouldRenderRtSceneGlyphs(activeBook);
		const body = this.createSection(
			parent,
			vocabulary.hasStructuredRtContext ? "Tracking scenes" : "Tracking notes",
			"Editorialist uses stable note identity to keep revision history attached to the right scene or note as your manuscript changes.",
			"fingerprint",
		);

		const card = body.createDiv({ cls: "editorialist-settings__maintenance-card" });
		const row = card.createDiv({ cls: "editorialist-settings__maintenance-row" });
		const info = row.createDiv({ cls: "editorialist-settings__maintenance-info" });

		const unitLabel = summary.trackedCount === 1 ? vocabulary.singularLabelLower : vocabulary.pluralLabelLower;
		const trackedLabel = summary.trackedCount > 0 ? `${summary.trackedCount} tracked ${unitLabel}` : `No tracked ${unitLabel} yet`;

		if (hasRtTrackingContext) {
			info.createDiv({
				cls: "editorialist-settings__maintenance-title",
				text: "Radial Timeline based tracking",
			});
			info.createDiv({
				cls: "editorialist-settings__maintenance-description",
				text: "Radial Timeline gives Editorialist stable scene IDs in the active book, so revision history stays attached to the right scene even when titles change or scenes are reordered.",
			});
			const actions = row.createDiv({ cls: "editorialist-settings__maintenance-actions" });
			const badge = actions.createDiv({
				cls: "editorialist-settings__tracking-badge editorialist-settings__tracking-badge--rt",
			});
			const badgeIcon = badge.createSpan({ cls: "editorialist-settings__tracking-badge-icon" });
			setIcon(badgeIcon, RADIAL_TIMELINE_ICON_ID);
			badge.createSpan({
				cls: "editorialist-settings__tracking-badge-label",
				text: "Radial Timeline",
			});
			card.createDiv({
				cls: "editorialist-settings__maintenance-note",
				text:
					summary.trackedCount > 0
						? trackedLabel
						: "When scenes are tracked in this book, Editorialist will validate them against Radial Timeline scene IDs.",
			});
			return;
		}

		if (summary.mode === "editorial-note-ids" || summary.mode === "frontmatter-ids") {
			info.createDiv({
				cls: "editorialist-settings__maintenance-title",
				text: "Using stable note IDs",
			});
			info.createDiv({
				cls: "editorialist-settings__maintenance-description",
				text:
					summary.mode === "editorial-note-ids"
						? "Editorialist is using injected note IDs for rename-safe tracking, so note titles and folder moves do not split revision history."
						: "Editorialist found stable note IDs in frontmatter, so note renames do not break revision history.",
			});
			card.createDiv({
				cls: "editorialist-settings__maintenance-note",
				text: trackedLabel,
			});
			return;
		}

		info.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Keep tracking through renames",
		});
		info.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "Editorialist knows these notes by their file names, so renaming one can lose its review history. Give each a permanent ID to keep its history through renames.",
		});
		const actions = row.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(actions, "fingerprint", "Add permanent IDs", async () => {
			if (!(await this.confirmDestructiveAction({
				title: "Add permanent IDs",
				description: `This adds a short “editorial_id” line to the properties of each tracked ${vocabulary.singularLabelLower} that does not have one yet. Your writing is not changed.`,
				confirmLabel: "Add IDs",
			}))) {
				return;
			}

			const injectedCount = await this.plugin.injectStableNoteIdsIntoTrackedNotes(this.activeBookOnly);
			void this.displayAsync(false);
			new Notice(
				injectedCount > 0
					? `Added permanent IDs to ${injectedCount} tracked ${injectedCount === 1 ? vocabulary.singularLabelLower : vocabulary.pluralLabelLower}.`
					: "Every tracked note already has a permanent ID.",
			);
		});
		card.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text:
				summary.trackedCount > 0
					? `${trackedLabel} · ${summary.missingCount} still depend on note paths.`
					: `When you start tracking ${vocabulary.pluralLabelLower}, you can give them permanent IDs here.`,
		});
	}

	private renderHero(
		parent: HTMLElement,
		summary: ReturnType<EditorialistPlugin["getReviewActivitySummary"]>,
		inventory: SceneReviewRecord[],
	): void {
		const hero = parent.createDiv({
			cls: "editorialist-settings__hero editorialist-settings__panel",
		});
		const titleRow = this.createSectionTitleRow(hero, "pie-chart", "Current revision");
		titleRow.addClass("editorialist-settings__section-title-row--hero");
		hero.createDiv({
			cls: "editorialist-settings__hero-subtitle",
			text: "See what is left in the pass you are reviewing now.",
		});

		const trackedScenes = inventory.filter((record) => record.batchCount > 0);
		const currentSummary = trackedScenes.reduce(
			(totals, record) => {
				totals.totalSuggestions +=
					record.pendingCount +
					record.unresolvedCount +
					record.deferredCount +
					record.acceptedCount +
					record.rejectedCount +
					record.rewrittenCount;
				totals.pending += record.pendingCount;
				totals.unresolved += record.unresolvedCount;
				totals.deferred += record.deferredCount;
				totals.accepted += record.acceptedCount;
				totals.rejected += record.rejectedCount;
				totals.rewritten += record.rewrittenCount;
				return totals;
			},
			{
				totalSuggestions: 0,
				pending: 0,
				unresolved: 0,
				deferred: 0,
				accepted: 0,
				rejected: 0,
				rewritten: 0,
			},
		);
		const processedCount = Math.max(
			0,
			currentSummary.accepted + currentSummary.rejected + currentSummary.rewritten,
		);
		const completionRatio = currentSummary.totalSuggestions > 0 ? processedCount / currentSummary.totalSuggestions : 0;
		const remainingCount = currentSummary.pending + currentSummary.unresolved + currentSummary.deferred;
		const currentRevisionStatus = {
			...summary,
			totalSuggestions: currentSummary.totalSuggestions,
			pending: currentSummary.pending,
			unresolved: currentSummary.unresolved,
			deferred: currentSummary.deferred,
			accepted: currentSummary.accepted,
			rejected: currentSummary.rejected,
			rewritten: currentSummary.rewritten,
			processed: processedCount,
			inProgressSweeps: trackedScenes.length > 0 ? summary.inProgressSweeps : 0,
		};
		const heroBody = hero.createDiv({ cls: "editorialist-settings__hero-body" });
		const progressCard = heroBody.createDiv({ cls: "editorialist-settings__hero-progress" });
		const ring = progressCard.createDiv({ cls: "editorialist-settings__hero-ring" });
		ring.style.setProperty("--editorialist-settings-progress", `${Math.round(completionRatio * 360)}deg`);
		const sceneGradient = this.buildSceneProgressGradient(trackedScenes);
		if (sceneGradient) {
			ring.style.setProperty("--editorialist-settings-scene-gradient", sceneGradient);
			ring.addClass("editorialist-settings__hero-ring--has-scene-slices");
		} else {
			ring.style.removeProperty("--editorialist-settings-scene-gradient");
			ring.removeClass("editorialist-settings__hero-ring--has-scene-slices");
		}
		ring.createDiv({ cls: "editorialist-settings__hero-ring-value", text: `${processedCount}/${currentSummary.totalSuggestions}` });
		progressCard.createDiv({
			cls: "editorialist-settings__hero-progress-title",
			text: "Revisions processed",
		});
		progressCard.createDiv({
			cls: "editorialist-settings__hero-progress-detail",
			text:
				currentSummary.totalSuggestions === 0
					? "No revision notes imported yet"
					: remainingCount === 0
						? currentSummary.rewritten > 0
							? `Current revision complete · ${currentSummary.rewritten} rewritten by the author`
							: "Current revision complete"
						: "Current revision progress",
		});

		const summaryGrid = heroBody.createDiv({ cls: "editorialist-settings__hero-summary" });
		this.createHeroMetric(
			summaryGrid,
			"Remaining",
			`${remainingCount}`,
			remainingCount > 0
				? `${currentSummary.pending} pending · ${currentSummary.unresolved} unresolved · ${currentSummary.deferred} deferred`
				: "All revision notes in this pass are resolved",
		);
		this.createHeroMetric(summaryGrid, "Current pass", ...this.getCurrentRevisionStatus(currentRevisionStatus, remainingCount));
	}

	private renderPendingEditsSection(parent: HTMLElement): void {
		const summary = this.plugin.pendingEdits.getPendingEditsSummary();
		const radialTimelineInstalled = this.isRadialTimelineInstalled();

		if (!radialTimelineInstalled && !summary) {
			return;
		}

		const body = this.createSection(
			parent,
			"Pending edits",
			"Your own revision notes from each scene's Pending Edits property, reviewed separately from notes you import. Work through each line in order.",
			"clipboard-list",
		);

		const cards = body.createDiv({ cls: "editorialist-settings__stats" });

		const sceneCount = summary?.sceneCount ?? 0;
		const segmentCount = summary?.segmentCount ?? 0;
		const humanCount = summary?.humanCount ?? 0;
		const inquiryCount = summary?.inquiryCount ?? 0;

		this.createStatCard(
			cards,
			"Scenes",
			`${sceneCount}`,
			sceneCount === 0 ? "No scenes with pending edits" : "With pending edits in active book",
		);
		this.createStatCard(
			cards,
			"Items",
			`${segmentCount}`,
			segmentCount === 0
				? "Human notes and Inquiry insertions will appear here"
				: `${humanCount} human · ${inquiryCount} inquiry`,
		);

		const actionCard = cards.createDiv({
			cls: "editorialist-settings__stat-card editorialist-settings__stat-card--action",
		});
		actionCard.createDiv({ cls: "editorialist-settings__stat-label", text: "Action" });
		actionCard.createDiv({
			cls: "editorialist-settings__stat-detail",
			text: segmentCount === 0
				? "Nothing to review right now"
				: "Walk each item across the active book",
		});
		const actionFooter = actionCard.createDiv({ cls: "editorialist-settings__stat-action-footer" });
		const startButton = this.createActionButton(actionFooter, "play", "Start review", async () => {
			await this.plugin.pendingEdits.startPendingEditsReview();
		});
		if (segmentCount === 0) {
			startButton.setAttribute("disabled", "true");
			startButton.setAttribute("aria-disabled", "true");
		}
	}

	private renderActivitySection(
		parent: HTMLElement,
		summary: ReturnType<EditorialistPlugin["getReviewActivitySummary"]>,
	): void {
		const body = this.createSection(
			parent,
			"Revision history",
			"See how many revision notes you have reviewed over time, and how many passes you have finished.",
			"activity",
		);
		const cards = body.createDiv({ cls: "editorialist-settings__stats" });

		this.createStatCard(
			cards,
			"Total suggestions",
			`${summary.totalSuggestions}`,
			"Across all revision passes",
		);
		this.createStatCard(
			cards,
			"Actions taken",
			`${summary.accepted} / ${summary.rejected} / ${summary.rewritten}`,
			"Accepted · Rejected · Rewritten",
		);
		this.createStatCard(cards, "Finished passes", `${summary.completedSweeps}`, `${summary.totalSweeps} total imported`);
	}

	private renderInventorySection(
		parent: HTMLElement,
		inventory: SceneReviewRecord[],
		activeBookLabel: string | null,
	): void {
		const liveInventory = inventory.filter((record) => record.batchCount > 0);
		const activeBook = this.plugin.getActiveBookScopeInfo();
		const vocabulary = this.getInventoryVocabulary(activeBook);
		const showRtSceneGlyphs = this.shouldRenderRtSceneGlyphs(activeBook);
		const body = this.createSection(
			parent,
			`${vocabulary.singularLabel} inventory`,
			`${vocabulary.pluralLabel} with revision notes and their current progress.`,
			"table-properties",
		);

		if (!vocabulary.hasStructuredRtContext) {
			const helper = body.createDiv({
				cls: "editorialist-settings__inventory-context-note",
			});
			helper.createDiv({
				cls: "editorialist-settings__inventory-context-title",
				text: "Using note-level inventory",
			});
			helper.createDiv({
				cls: "editorialist-settings__inventory-context-body",
				text: "Radial Timeline has no active book right now, so Editorialist counts review activity by note. With an active book it counts by scene.",
			});
		}

		if (activeBookLabel) {
			const host = this.getSectionTitleRow(body);
			const filterButton = this.createActionButton(
				host,
				"book-open",
				this.activeBookOnly ? `Active ${vocabulary.scopeLabel}: ${activeBookLabel}` : `All ${vocabulary.scopeLabel}s`,
				async () => {
					this.activeBookOnly = !this.activeBookOnly;
					void this.displayAsync(false);
				},
			);
			filterButton.addClass("editorialist-settings__inventory-filter");
			filterButton.addClass("editorialist-settings__section-header-action");
			if (this.activeBookOnly) {
				filterButton.addClass("is-active");
			}
		}

		if (liveInventory.length === 0) {
			body.createDiv({
				cls: "editorialist-settings__empty",
				text: this.activeBookOnly && activeBookLabel
					? `No Editorialist ${vocabulary.singularLabelLower} records found in ${activeBookLabel}.`
					: `No Editorialist ${vocabulary.singularLabelLower} records yet.`,
			});
			return;
		}

		const tableWrap = body.createDiv({ cls: "editorialist-settings__inventory-wrap" });
		const table = tableWrap.createEl("table", { cls: "editorialist-settings__inventory-table" });
		const head = table.createTHead().insertRow();
		[
			"",
			vocabulary.singularLabel,
			"Imports",
			"Passes finished",
			"Open",
			"Done",
		].forEach((label, index) => {
			const cell = head.createEl("th", { text: label });
			if (index === 0) {
				cell.addClass("editorialist-settings__inventory-col-completion");
				setAccessibleLabel(cell, "Complete");
			}
			if (index >= 2) {
				cell.addClass("editorialist-settings__inventory-col-number");
			}
		});

		const bodyEl = table.createTBody();
		for (const record of liveInventory) {
			const openCount = record.pendingCount + record.unresolvedCount + record.deferredCount;
			const row = bodyEl.insertRow();
			const completionCell = row.createEl("td", { cls: "editorialist-settings__inventory-col-completion" });
			const completionIcon = completionCell.createSpan({
				cls: `editorialist-settings__inventory-completion${openCount === 0 ? " is-complete" : ""}`,
			});
			setAccessibleLabel(completionIcon, openCount === 0 ? `${record.noteTitle} complete` : `${record.noteTitle} still open`);
			setIcon(completionIcon, openCount === 0 ? "square-check" : "square");

			const sceneCell = row.createEl("td", {
				cls: "editorialist-settings__inventory-col-scene",
			});
			const sceneEntry = sceneCell.createDiv({
				cls: "editorialist-settings__inventory-scene-entry",
			});
			if (showRtSceneGlyphs) {
				const rtGlyphs = this.getRtSceneGlyphState(record.notePath);
				if (rtGlyphs) {
					this.createInventoryRtGlyph(
						sceneEntry,
						rtGlyphs.status.glyph,
						rtGlyphs.status.label,
						rtGlyphs.status.tone,
						"status",
					);
					this.createInventoryRtGlyph(
						sceneEntry,
						rtGlyphs.stage.glyph,
						rtGlyphs.stage.label,
						rtGlyphs.stage.tone,
						"stage",
					);
				}
			}
			const sceneLink = sceneEntry.createEl("a", {
				cls: "editorialist-settings__inventory-note-link",
				text: record.noteTitle,
				attr: {
					href: "#",
				},
			});
			setAccessibleLabel(sceneLink, `Open ${record.noteTitle}`);
			sceneLink.addEventListener("click", (event) => {
				event.preventDefault();
				void this.plugin.openSceneNote(record.notePath);
			});
			if (this.plugin.pendingEdits.hasPendingEditsForScene(record.notePath)) {
				const badge = sceneEntry.createSpan({
					cls: "editorialist-settings__inventory-pending-badge",
					attr: {
						"aria-label": "This scene also has pending edits (free-form revision notes).",
					},
				});
				const badgeIcon = badge.createSpan({ cls: "editorialist-settings__inventory-pending-badge-icon" });
				setIcon(badgeIcon, "clipboard-list");
				badge.createSpan({
					cls: "editorialist-settings__inventory-pending-badge-text",
					text: "pending",
				});
			}
			row.createEl("td", {
				cls: "editorialist-settings__inventory-col-number",
				text: `${record.batchCount}`,
			});
			const polish = this.readScenePolishState(record.notePath);
			const sweepsCell = row.createEl("td", {
				cls: "editorialist-settings__inventory-col-number",
				text: `${polish.revision}`,
			});
			if (polish.lastUpdatedLabel) {
				sweepsCell.setAttribute("aria-label", `Last pass finished: ${polish.lastUpdatedLabel}`);
			}
			row.createEl("td", {
				cls: "editorialist-settings__inventory-col-number",
				text: `${openCount}`,
			});
			row.createEl("td", {
				cls: "editorialist-settings__inventory-col-number",
				text: `${record.acceptedCount + record.rewrittenCount}`,
			});
		}
	}

	// Reads the per-scene polish state written by the guided-sweep workflow
	// (see incrementSceneEditorialRevision). Falls back to the legacy lower-case
	// `editorial:` key for vaults predating the rename.
	private readScenePolishState(notePath: string): { revision: number; lastUpdatedLabel: string | null } {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return { revision: 0, lastUpdatedLabel: null };
		}
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) {
			return { revision: 0, lastUpdatedLabel: null };
		}
		const block = (frontmatter.Editorialist ?? frontmatter.editorial) as Record<string, unknown> | undefined;
		if (!block || typeof block !== "object" || Array.isArray(block)) {
			return { revision: 0, lastUpdatedLabel: null };
		}
		const rawRevision = Number(block.revision);
		const revision = Number.isFinite(rawRevision) && rawRevision > 0 ? rawRevision : 0;
		const rawUpdated = typeof block.revision_updated === "string" ? block.revision_updated : null;
		const parsed = rawUpdated ? Date.parse(rawUpdated) : Number.NaN;
		const lastUpdatedLabel = Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : null;
		return { revision, lastUpdatedLabel };
	}

	private shouldRenderRtSceneGlyphs(activeBook: { label: string | null; sourceFolder: string | null }): boolean {
		return this.isRadialTimelineInstalled() && this.plugin.getActiveBookScopeInfo().structured && Boolean(activeBook.label && activeBook.sourceFolder);
	}

	private getRtSceneGlyphState(notePath: string):
		| {
				status: { glyph: string; label: string; tone: string };
				stage: { glyph: string; label: string; tone: string };
		  }
		| null {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			return null;
		}

		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) {
			return null;
		}

		const status = this.resolveRtGlyphValue(
			frontmatter,
			[
				"status",
				"Status",
				"scene_status",
				"sceneStatus",
				"SceneStatus",
				"manuscript_status",
				"manuscriptStatus",
				"ManuscriptStatus",
			],
			EditorialistSettingTab.RT_STATUS_GLYPH_DEFINITIONS,
		);
		const stage = this.resolveRtGlyphValue(
			frontmatter,
			[
				"stage",
				"Stage",
				"scene_stage",
				"sceneStage",
				"SceneStage",
				"manuscript_stage",
				"manuscriptStage",
				"ManuscriptStage",
				"publishing_stage",
				"publishingStage",
				"PublishingStage",
			],
			EditorialistSettingTab.RT_STAGE_GLYPH_DEFINITIONS,
		);

		if (!status || !stage) {
			return null;
		}

		return { status, stage };
	}

	private resolveRtGlyphValue(
		frontmatter: Record<string, unknown>,
		keys: string[],
		definitions: ReadonlyArray<{
			glyph: string;
			label: string;
			tone: string;
			values: readonly string[];
		}>,
	): { glyph: string; label: string; tone: string } | null {
		const values = getFrontmatterStringValues(frontmatter, keys);
		for (const rawValue of values) {
			const normalizedValue = rawValue.trim().toLowerCase();
			const definition = definitions.find((candidate) => candidate.values.includes(normalizedValue));
			if (definition) {
				return {
					glyph: definition.glyph,
					label: definition.label,
					tone: definition.tone,
				};
			}
		}

		return null;
	}

	private createInventoryRtGlyph(
		parent: HTMLElement,
		glyph: string,
		label: string,
		tone: string,
		kind: "status" | "stage",
	): void {
		const glyphEl = parent.createSpan({
			cls: `editorialist-settings__inventory-rt-glyph editorialist-settings__inventory-rt-glyph--${kind} editorialist-settings__inventory-rt-glyph--${tone}`,
			text: glyph,
		});
		setAccessibleLabel(glyphEl, label);
	}

	private renderContributorsSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"Contributor directory",
			"People and AI tools that have contributed revision notes across your manuscript.",
			"users",
		);
		body.parentElement?.addClass("editorialist-settings__section--primary");
		body.parentElement?.addClass("editorialist-settings__section--contributors");

		const profiles = this.plugin.getSortedReviewerProfiles();
		body.createDiv({
			cls: "editorialist-settings__section-meta",
			text: `${profiles.length} contributor${profiles.length === 1 ? "" : "s"}`,
		});

		if (profiles.length > 1) {
			body.createDiv({
				cls: "editorialist-settings__section-meta",
				text: "Drag a contributor onto the name you want to keep to combine their aliases, history, and stats. You can also use Manage contributor → Merge.",
			});
		}

		const list = body.createDiv({ cls: "editorialist-settings__contributors" });
		if (profiles.length === 0) {
			list.createDiv({
				cls: "editorialist-settings__empty",
				text: "No contributor profiles yet.",
			});
			return;
		}

		let draggedId: string | null = null;
		const clearDrag = () => {
			draggedId = null;
			list.querySelectorAll(".is-dragging, .is-drop-target").forEach((element) => {
				element.classList.remove("is-dragging", "is-drop-target");
			});
		};
		for (const profile of profiles) {
			const card = list.createDiv({ cls: "editorialist-settings__contributor" });
			card.draggable = profiles.length > 1;
			this.contributorEvents.registerDomEvent(card, "dragstart", (event) => {
				const origin = event.target as HTMLElement | null;
				if (this.contributorMergePending || origin?.closest("button, input, select, a") || !event.dataTransfer) {
					event.preventDefault();
					return;
				}
				draggedId = profile.id;
				event.dataTransfer.setData("text/plain", profile.displayName);
				event.dataTransfer.effectAllowed = "move";
				card.addClass("is-dragging");
			});
			this.contributorEvents.registerDomEvent(card, "dragend", clearDrag);
			this.contributorEvents.registerDomEvent(card, "dragover", (event) => {
				if (!draggedId || draggedId === profile.id || this.contributorMergePending) return;
				event.preventDefault();
				if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
				card.addClass("is-drop-target");
			});
			this.contributorEvents.registerDomEvent(card, "dragleave", (event) => {
				if (event.relatedTarget && card.contains(event.relatedTarget as Node)) return;
				card.removeClass("is-drop-target");
			});
			this.contributorEvents.registerDomEvent(card, "drop", (event) => {
				const sourceId = draggedId;
				if (!sourceId || sourceId === profile.id || this.contributorMergePending) return;
				event.preventDefault();
				clearDrag();
				this.contributorMergePending = true;
				void this.plugin.contributors.reassignContributorById(sourceId, "merge", profile.id)
					.then(async (didChange) => {
						if (didChange) await this.displayAsync(false);
					})
					.catch((error: unknown) => {
						console.error("Could not merge contributors", error);
						new Notice("Could not merge contributors. Check the contributor directory before trying again.");
					})
					.finally(() => { this.contributorMergePending = false; });
			});
			const identity = card.createDiv({ cls: "editorialist-settings__contributor-identity" });
			const main = identity.createDiv({ cls: "editorialist-settings__contributor-main" });
			this.createContributorAvatar(main, profile);
			const text = main.createDiv({ cls: "editorialist-settings__contributor-text" });
			text.createDiv({
				cls: "editorialist-settings__contributor-title",
				text: profile.displayName,
			});
			const roleLine = text.createDiv({ cls: "editorialist-settings__contributor-role-line" });
			roleLine.createSpan({
				cls: "editorialist-settings__contributor-role",
				text: formatReviewerTypeLabel(profile.reviewerType),
			});
			this.renderContributorUseIcons(roleLine, profile);

			card.createDiv({
				cls: "editorialist-settings__contributor-stats",
				text: this.formatContributorStats(profile),
			});
			if (profile.aliases.length > 0) {
				card.createDiv({
					cls: "editorialist-settings__contributor-aliases",
					text: `Also appears as: ${profile.aliases.join(" · ")}`,
				});
			}

			const footer = card.createDiv({ cls: "editorialist-settings__contributor-footer" });
			const controls = footer.createDiv({ cls: "editorialist-settings__contributor-controls" });
			const starButton = new ButtonComponent(controls)
				.onClick(() => {
					void this.plugin.contributors.toggleReviewerStarById(profile.id).then(() => this.displayAsync(false));
				});
			setAccessibleLabel(starButton.buttonEl, profile.isStarred ? "Unstar contributor" : "Star contributor");
			starButton.buttonEl.addClass("editorialist-settings__star-button");
			if (profile.isStarred) {
				starButton.buttonEl.addClass("is-starred");
			}
			const starIcon = starButton.buttonEl.createSpan({ cls: "editorialist-settings__action-button-icon" });
			setIcon(starIcon, "star");

			const manageButton = new ButtonComponent(controls)
				.onClick(() => {
					void this.plugin.contributors.openContributorManagementFlow(profile.id).then((didChange) => {
						if (didChange) {
							void this.displayAsync(false);
						}
					});
				});
			setAccessibleLabel(manageButton.buttonEl, "Manage contributor");
			manageButton.buttonEl.addClass("editorialist-settings__star-button");
			manageButton.buttonEl.addClass("editorialist-settings__contributor-menu-button");
			const manageIcon = manageButton.buttonEl.createSpan({ cls: "editorialist-settings__action-button-icon" });
			setIcon(manageIcon, "ellipsis");
		}

		const fillerCount = (3 - (profiles.length % 3)) % 3;
		for (let index = 0; index < fillerCount; index += 1) {
			list.createDiv({
				cls: "editorialist-settings__contributor editorialist-settings__contributor--filler",
				attr: {
					"aria-hidden": "true",
				},
			});
		}
	}

	private renderMetadataSection(parent: HTMLElement): void {
		const body = this.createSection(
			parent,
			"Backup",
			"Save everything Editorialist remembers, and bring it back later. Your notes are never in a backup and never change.",
			"database-backup",
		);
		body.parentElement?.addClass("editorialist-settings__section--utility");
		const grid = body.createDiv({ cls: "editorialist-settings__maintenance-grid" });

		const backupCard = grid.createDiv({ cls: "editorialist-settings__maintenance-card" });
		backupCard.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Backup",
		});
		backupCard.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "A backup holds your contributors, your accept and reject decisions, your replies to editors, your plans and goals, and these settings.",
		});
		const backupActions = backupCard.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(backupActions, "download", "Save a backup", async () => {
			const path = await this.plugin.saveEditorialistBackup();
			if (path) new Notice(`Saved a backup to ${path}.`);
		});
		this.createActionButton(backupActions, "history", "Restore a backup", async () => {
			const backups = this.plugin.listEditorialistBackups();
			if (backups.length === 0) {
				new Notice(`There are no backups in ${BACKUPS_FOLDER} yet.`);
				return;
			}
			const chosen = await openEditorialistChoiceModal(this.app, {
				title: "Restore a backup",
				description: "Choose the backup to go back to.",
				choices: backups.map((file) => ({ label: file.basename, value: file.path })),
			});
			const file = backups.find((backup) => backup.path === chosen);
			if (!file) return;
			if (!(await this.confirmDestructiveAction({
				title: `Restore ${file.basename}?`,
				description: "Everything Editorialist remembers goes back to how it was in this backup. Anything since, such as decisions, replies and plan changes, is replaced. Your notes do not change. Save a backup first if you may want today's state back.",
				confirmLabel: "Restore",
			}))) return;
			if (await this.plugin.restoreEditorialistBackup(file)) void this.displayAsync(false);
		});
		backupCard.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: `Backups are saved in ${BACKUPS_FOLDER}. Keep a copy somewhere else too if the vault itself is not backed up.`,
		});

		const resetCard = grid.createDiv({ cls: "editorialist-settings__maintenance-card" });
		resetCard.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Reset",
		});
		resetCard.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "Delete every contributor and their saved stats, to start the directory again. Notes in your scenes are not changed.",
		});
		const resetActions = resetCard.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(resetActions, "users", "Delete all contributors", async () => {
			const removedCount = await this.plugin.contributors.deleteAllContributors();
			if (removedCount > 0) {
				void this.displayAsync(false);
			}
		});
		resetCard.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: "This clears the contributor directory and saved contributor stats, but leaves revision decisions and scene history in place.",
		});
	}

	private renderMaintenanceSection(parent: HTMLElement, activeBookLabel: string | null): void {
		const activeBook = this.plugin.getActiveBookScopeInfo();
		const vocabulary = this.getInventoryVocabulary(activeBook);
		const body = this.createSection(
			parent,
			"Maintenance",
			"Use Maintenance to keep your notes clean while preserving your revision history. A common workflow is to remove review blocks after finishing a scene, while keeping the underlying history so you can track how revisions evolved over time. Editorialist adds and removes review blocks inside your notes, but your actual writing is only changed when you accept edits.",
			"wrench",
		);
		body.parentElement?.addClass("editorialist-settings__section--maintenance");

		const cleanupRow = body.createDiv({
			cls: "editorialist-settings__maintenance-row",
		});
		const cleanupInfo = cleanupRow.createDiv({
			cls: "editorialist-settings__maintenance-info",
		});
		cleanupInfo.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: activeBookLabel
				? "Remove Editorialist review blocks from scenes in the active book."
				: "Remove Editorialist review blocks from notes in the current vault.",
		});

		const cleanupActions = cleanupRow.createDiv({ cls: "editorialist-settings__maintenance-actions" });
		this.createActionButton(cleanupActions, "brush-cleaning", `Clean all ${vocabulary.pluralLabelLower}`, async () => {
			if (!(await this.confirmDestructiveAction({
				title: `Clean all ${vocabulary.pluralLabelLower}`,
				description: `This removes imported Editorialist review blocks from tracked ${vocabulary.pluralLabelLower}. Accepted manuscript edits and saved review history stay in place.`,
				confirmLabel: `Clean all ${vocabulary.pluralLabelLower}`,
			}))) {
				return;
			}

			const outcome = await this.plugin.cleanupAllSceneReviewNotes(this.activeBookOnly);
			void this.displayAsync(false);
			new Notice(
				(outcome.removedCount > 0
					? `Cleaned ${outcome.removedCount} imported review block${outcome.removedCount === 1 ? "" : "s"} across ${vocabulary.pluralLabelLower}.`
					: "No imported review blocks were found to clean.") + describeUnremovedBlocksSuffix(outcome.skippedUnfencedCount),
			);
		});
		this.createActionButton(cleanupActions, "archive-x", `Clean completed ${vocabulary.pluralLabelLower}`, async () => {
			if (!(await this.confirmDestructiveAction({
				title: `Clean completed ${vocabulary.pluralLabelLower}`,
				description: `This removes imported Editorialist review blocks only from completed ${vocabulary.pluralLabelLower}. Accepted manuscript edits and saved review history stay in place.`,
				confirmLabel: `Clean completed ${vocabulary.pluralLabelLower}`,
			}))) {
				return;
			}

			const outcome = await this.plugin.cleanupCompletedSceneReviewNotes(this.activeBookOnly);
			void this.displayAsync(false);
			new Notice(
				(outcome.removedCount > 0
					? `Cleaned ${outcome.removedCount} imported review block${outcome.removedCount === 1 ? "" : "s"} from completed ${vocabulary.pluralLabelLower}.`
					: `No completed ${vocabulary.pluralLabelLower} were ready for cleanup.`) +
					describeUnremovedBlocksSuffix(outcome.skippedUnfencedCount),
			);
		});

		const historyCard = body.createDiv({ cls: "editorialist-settings__maintenance-card" });
		const historyRow = historyCard.createDiv({
			cls: "editorialist-settings__maintenance-row editorialist-settings__maintenance-row--reset",
		});
		const historyInfo = historyRow.createDiv({
			cls: "editorialist-settings__maintenance-info",
		});
		historyInfo.createDiv({
			cls: "editorialist-settings__maintenance-title",
			text: "Reset saved revision history",
		});
		historyInfo.createDiv({
			cls: "editorialist-settings__maintenance-description",
			text: "Use this if a pass was imported twice or its saved history is wrong. Revision notes still in your scenes are found again the next time Editorialist looks.",
		});
		const historyFooter = historyCard.createDiv({
			cls: "editorialist-settings__maintenance-row editorialist-settings__maintenance-row--footer",
		});
		historyFooter.createDiv({
			cls: "editorialist-settings__maintenance-note",
			text: "Resetting history clears Editorialist’s saved decisions and batch tracking, not the review blocks currently written into notes.",
		});
		const historyActions = historyFooter.createDiv({
			cls: "editorialist-settings__maintenance-actions editorialist-settings__maintenance-actions--reset-footer",
		});
		this.createActionButton(historyActions, "history", "Reset one batch", async () => {
			await this.handleResetSingleBatch();
		});
		this.createActionButton(historyActions, "rotate-ccw", "Reset all history", async () => {
			await this.handleResetAllHistory();
		});
	}

	private async handleResetSingleBatch(): Promise<void> {
		const entries = this.plugin.getSweepRegistryEntries();
		if (entries.length === 0) {
			new Notice("No saved revision batches were found.");
			return;
		}

		const batchId = await openEditorialistChoiceModal(this.app, {
			title: "Reset one batch",
			description: "Choose which imported revision pass to remove from saved Editorialist history.",
			choices: entries.map((entry) => ({
				label: this.formatSweepChoiceLabel(entry),
				value: entry.batchId,
			})),
		});
		if (!batchId) {
			return;
		}

		const confirm = await openEditorialistChoiceModal(this.app, {
			title: "Confirm reset",
			description: "This removes the saved decisions and stats for that batch. Review blocks still present in notes will be discovered again.",
			choices: [
				{ label: "Reset batch", value: "reset" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (confirm !== "reset") {
			return;
		}

		const result = await this.plugin.resetBatchHistory(batchId);
		void this.displayAsync(false);
		new Notice(
			result.removedDecisions > 0 || result.removedSignals > 0 || result.removedSweep
				? "Reset saved history for that batch."
				: "No saved history was found for that batch.",
		);
	}

	private async handleResetAllHistory(): Promise<void> {
		const confirm = await openEditorialistChoiceModal(this.app, {
			title: "Reset all revision history",
			description: "This clears Editorialist’s saved batch history and decision stats. Review blocks still present in notes will be discovered again.",
			choices: [
				{ label: "Reset all history", value: "reset" },
				{ label: "Cancel", value: "cancel" },
			],
		});
		if (confirm !== "reset") {
			return;
		}

		const result = await this.plugin.resetAllRevisionHistory();
		void this.displayAsync(false);
		new Notice(
			result.removedDecisions > 0 || result.removedSignals > 0 || result.removedSweeps > 0
				? "Reset all saved revision history."
				: "No saved revision history was found.",
		);
	}

	private async confirmDestructiveAction(options: {
		title: string;
		description: string;
		confirmLabel: string;
	}): Promise<boolean> {
		const choice = await openEditorialistChoiceModal(this.app, {
			title: options.title,
			description: options.description,
			choices: [
				{ label: options.confirmLabel, value: "confirm" },
				{ label: "Cancel", value: "cancel" },
			],
		});

		return choice === "confirm";
	}

	private formatSweepChoiceLabel(entry: ReviewSweepRegistryEntry): string {
		const dateLabel = new Date(entry.importedAt).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
		const sceneCount = entry.sceneOrder.length;
		const sceneLabel = sceneCount === 1 ? "scene" : "scenes";
		const statusLabel = sweepStatusLabel(entry.status);
		return `${dateLabel} · ${entry.totalSuggestions} edits · ${sceneCount} ${sceneLabel} · ${statusLabel}`;
	}

	private createTab(
		parent: HTMLElement,
		id: "core" | "reviewer" | "configuration",
		icon: string,
		label: string,
	): void {
		const tab = parent.createDiv({
			cls: "editorialist-settings__tab" + (this.activeTab === id ? " is-active" : ""),
		});
		const iconEl = tab.createSpan({ cls: "editorialist-settings__tab-icon" });
		setIcon(iconEl, icon);
		tab.createSpan({ cls: "editorialist-settings__tab-label", text: label });
		tab.addEventListener("click", () => {
			if (this.activeTab === id) {
				return;
			}
			this.activeTab = id;
			void this.displayAsync(false);
		});
	}

	private createSection(
		parent: HTMLElement,
		title: string,
		description: string,
		icon: string,
	): HTMLElement {
		const section = parent.createDiv({
			cls: "editorialist-settings__section editorialist-settings__panel",
		});
		const header = section.createDiv({ cls: "editorialist-settings__section-header" });
		this.createSectionTitleRow(header, icon, title);
		header.createDiv({ cls: "editorialist-settings__section-description", text: description });

		return section.createDiv({ cls: "editorialist-settings__section-body" });
	}

	// Every section body comes from createSection, which always builds the
	// header and its title row, so a missing row is a programming error rather
	// than a state to fall back from.
	private getSectionTitleRow(body: HTMLElement): HTMLElement {
		const titleRow = body.parentElement
			?.querySelector(".editorialist-settings__section-header")
			?.querySelector<HTMLElement>(".editorialist-settings__section-title-row");
		if (!titleRow) {
			throw new Error("Section body is not inside a createSection() section.");
		}
		return titleRow;
	}

	private createSectionTitleRow(parent: HTMLElement, icon: string, title: string): HTMLElement {
		const row = parent.createDiv({ cls: "editorialist-settings__section-title-row" });
		const iconEl = row.createSpan({ cls: "editorialist-settings__section-title-icon" });
		setIcon(iconEl, icon);
		row.createSpan({ cls: "editorialist-settings__section-title", text: title });
		const link = row.createEl("a", {
			href: EditorialistSettingTab.SETTINGS_DOCS_URL,
			cls: "editorialist-settings__section-title-link",
			attr: {
				target: "_blank",
				rel: "noopener",
			},
		});
		setAccessibleLabel(link, `Open documentation for ${title}`);
		setIcon(link, "external-link");
		return row;
	}

	private createHeroFeature(parent: HTMLElement, icon: string, text: string): void {
		const item = parent.createDiv({ cls: "editorialist-settings__hero-feature" });
		const iconEl = item.createSpan({ cls: "editorialist-settings__hero-feature-icon" });
		setIcon(iconEl, icon);
		item.createSpan({ cls: "editorialist-settings__hero-feature-text", text });
	}

	private createHeroMetric(parent: HTMLElement, label: string, value: string, detail: string): void {
		const metric = parent.createDiv({ cls: "editorialist-settings__hero-metric" });
		metric.createDiv({ cls: "editorialist-settings__hero-metric-label", text: label });
		metric.createDiv({ cls: "editorialist-settings__hero-metric-value", text: value });
		metric.createDiv({ cls: "editorialist-settings__hero-metric-detail", text: detail });
	}

	private createStatCard(parent: HTMLElement, label: string, value: string, detail: string): void {
		const card = parent.createDiv({ cls: "editorialist-settings__stat-card" });
		card.createDiv({ cls: "editorialist-settings__stat-label", text: label });
		card.createDiv({ cls: "editorialist-settings__stat-value", text: value });
		card.createDiv({ cls: "editorialist-settings__stat-detail", text: detail });
	}

	private createActionButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void | Promise<void>,
	): HTMLElement {
		const button = parent.createEl("button", {
			cls: "editorialist-settings__action-button",
			attr: {
				type: "button",
			},
		});
		const iconEl = button.createSpan({ cls: "editorialist-settings__action-button-icon" });
		setIcon(iconEl, icon);
		button.createSpan({ cls: "editorialist-settings__action-button-label", text: label });
		button.addEventListener("click", () => {
			void onClick();
		});
		return button;
	}

	private getCurrentRevisionStatus(
		summary: ReturnType<EditorialistPlugin["getReviewActivitySummary"]>,
		remainingCount: number,
	): [string, string] {
		if (remainingCount === 0 && summary.totalSuggestions > 0) {
			return ["Complete", "No revision notes remain"];
		}

		if (summary.inProgressSweeps > 0) {
			return [
				"In progress",
				`${summary.inProgressSweeps} pass${summary.inProgressSweeps === 1 ? "" : "es"} under way`,
			];
		}

		if (remainingCount > 0) {
			return ["Ready", "Revision notes remain to review"];
		}

		return ["Idle", "No pass under way"];
	}

	private formatContributorStats(profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number]): string {
		const stats = profile.stats;
		if (!stats) {
			return "No contribution history yet";
		}

		// The rate is of the changes the author has decided: one not yet looked
		// at says nothing about the contributor.
		const decided = stats.accepted + stats.rejected + stats.rewritten;
		const acceptedRate = decided > 0 ? Math.round((stats.accepted / decided) * 100) : 0;
		const parts = [
			`${stats.totalSuggestions} contribution${stats.totalSuggestions === 1 ? "" : "s"}`,
			`${stats.accepted} accepted`,
		];
		if (stats.rewritten > 0) {
			parts.push(`${stats.rewritten} rewritten`);
		}
		if (decided > 0) {
			parts.push(`${acceptedRate}% accepted of those decided`);
		}
		if (decided >= 5 && acceptedRate >= 80) {
			parts.push("trusted");
		}
		return parts.join(" • ");
	}

	private buildSceneProgressGradient(records: SceneReviewRecord[]): string | null {
		if (records.length === 0) {
			return null;
		}

		const sliceAngle = 360 / records.length;
		const completeColor = "color-mix(in srgb, var(--color-green) 46%, var(--background-primary) 54%)";
		const incompleteColor = "color-mix(in srgb, var(--background-modifier-border) 72%, transparent)";
		const gapColor = "color-mix(in srgb, var(--background-modifier-border) 40%, transparent)";
		const segments: string[] = [];
		let currentAngle = 0;

		for (const record of records) {
			const sliceStart = currentAngle;
			const sliceEnd = currentAngle + sliceAngle;
			const gapDegrees = records.length > 1 ? Math.min(2, sliceAngle * 0.14) : 0;
			const visualStart = Math.min(sliceEnd, sliceStart + gapDegrees / 2);
			const visualEnd = Math.max(visualStart, sliceEnd - gapDegrees / 2);
			const totalSuggestions =
				record.pendingCount +
				record.unresolvedCount +
				record.deferredCount +
				record.acceptedCount +
				record.rejectedCount +
				record.rewrittenCount;
			const processedSuggestions = record.acceptedCount + record.rejectedCount + record.rewrittenCount;
			const processedRatio = totalSuggestions > 0 ? Math.min(1, processedSuggestions / totalSuggestions) : 0;
			const visualSpan = Math.max(0, visualEnd - visualStart);
			const processedEnd = visualStart + (visualSpan * processedRatio);

			if (sliceStart < visualStart) {
				segments.push(`${gapColor} ${sliceStart}deg ${visualStart}deg`);
			}

			if (processedRatio > 0) {
				segments.push(`${completeColor} ${visualStart}deg ${processedEnd}deg`);
			}

			if (processedEnd < visualEnd) {
				segments.push(`${incompleteColor} ${processedEnd}deg ${visualEnd}deg`);
			}

			if (visualEnd < sliceEnd) {
				segments.push(`${gapColor} ${visualEnd}deg ${sliceEnd}deg`);
			}

			currentAngle = sliceEnd;
		}

		return `conic-gradient(${segments.join(", ")})`;
	}

	private createContributorAvatar(
		parent: HTMLElement,
		profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number],
	): void {
		const avatarKind = resolveContributorAvatarKind(profile);
		const isAiStyle = avatarKind !== "person";
		const brand = avatarKind === "person" || avatarKind === "generic-ai" ? null : avatarKind;
		const avatar = parent.createDiv({
			cls: `editorialist-settings__contributor-avatar${isAiStyle ? " is-ai" : ""}${profile.isStarred ? " is-starred" : ""}${brand ? ` is-provider-${brand}` : ""}`,
		});
		const icon = avatar.createSpan({ cls: "editorialist-settings__contributor-avatar-icon" });
		if (brand) {
			icon.addClass("is-brand");
			renderContributorBrandMark(icon, brand);
			return;
		}
		if (avatarKind === "generic-ai") {
			setIcon(icon, "cpu");
			return;
		}

		setIcon(icon, profile.isStarred ? "user-star" : "user-round");
	}

	private renderContributorUseIcons(
		parent: HTMLElement,
		profile: ReturnType<EditorialistPlugin["getSortedReviewerProfiles"]>[number],
	): void {
		const icons = parent.createDiv({
			cls: "editorialist-settings__contributor-use-icons editorialist-settings__contributor-use-icons--inline",
		});
		const roleDefinition = CONTRIBUTOR_ROLE_DEFINITIONS.find((definition) => definition.value === profile.reviewerType);
		if (roleDefinition) {
			const roleIcon = icons.createSpan({
				cls: "editorialist-settings__contributor-use-icon editorialist-settings__contributor-use-icon--inline",
			});
			setAccessibleLabel(roleIcon, roleDefinition.label);
			setIcon(roleIcon, roleDefinition.icon);
		}

		if ((profile.strengths?.length ?? 0) === 0) {
			return;
		}

		for (const strength of profile.strengths ?? []) {
			const definition = getContributorStrengthDefinition(strength);
			if (!definition) {
				continue;
			}

			const strengthIcon = icons.createSpan({
				cls: "editorialist-settings__contributor-use-icon editorialist-settings__contributor-use-icon--inline",
			});
			setAccessibleLabel(strengthIcon, definition.label);
			setIcon(strengthIcon, definition.icon);
		}
	}

}
