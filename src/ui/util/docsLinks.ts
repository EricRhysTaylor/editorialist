// Help links into the docs site, docs.radialtimeline.com. Editorialist's pages live under
// /editorialist/ and are built from the published wiki, so they keep the wiki's page names and
// section anchors (Settings-Reference#cut-location). Radial Timeline's docs are at the root.

export const DOCS_URL = "https://docs.radialtimeline.com";
export const RADIAL_TIMELINE_DOCS_URL = `${DOCS_URL}/`;

/** An Editorialist docs page by its wiki page name, with an optional section anchor. */
export function editorialistDocsUrl(page = "", anchor = ""): string {
	const path = page && page !== "Home" ? `/editorialist/${page}/` : "/editorialist/";
	return `${DOCS_URL}${path}${anchor ? `#${anchor}` : ""}`;
}

// Settings sections, by the title the Settings tab shows, to their part of Settings Reference.
// Titles that vary with the manuscript ("Tracking scenes" / "Tracking notes", "Scene inventory" /
// "Note inventory") share one entry each.
const SETTINGS_SECTION_ANCHORS: Record<string, string> = {
	"Core": "core-tab",
	"Contributors": "contributors-tab",
	"Configuration": "configuration-tab",
	"Current revision": "revision-progress",
	"Pending edits": "pending-edits",
	"Revision history": "revision-history",
	"Contributor directory": "contributor-directory",
	"Backup": "backup",
	"Manuscript target": "manuscript-target",
	"You and your files": "you-and-your-files",
	"Cut location": "cut-location",
	"Notes an AI writes into a scene": "notes-an-ai-writes-into-a-scene",
	"Revision effort estimate": "revision-effort-estimate",
	"Maintenance": "maintenance",
};

/** Settings Reference, at the section for a Settings tab or section title when there is one. */
export function settingsDocsUrl(title = ""): string {
	const anchor = /^Tracking\b/.test(title)
		? "tracking"
		: / inventory$/.test(title)
			? "scene-inventory"
			: SETTINGS_SECTION_ANCHORS[title] ?? "";
	return editorialistDocsUrl("Settings-Reference", anchor);
}
