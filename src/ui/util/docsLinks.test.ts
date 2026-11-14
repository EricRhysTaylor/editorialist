import { describe, expect, it } from "vitest";
import { DOCS_URL, editorialistDocsUrl, RADIAL_TIMELINE_DOCS_URL, settingsDocsUrl } from "./docsLinks";

describe("editorialistDocsUrl", () => {
	it("maps a wiki page name under /editorialist/", () => {
		expect(editorialistDocsUrl("Line-Edits")).toBe(`${DOCS_URL}/editorialist/Line-Edits/`);
	});

	it("keeps a section anchor", () => {
		expect(editorialistDocsUrl("Settings-Reference", "cut-location")).toBe(`${DOCS_URL}/editorialist/Settings-Reference/#cut-location`);
	});

	it("treats no page, or Home, as the Editorialist docs home", () => {
		expect(editorialistDocsUrl()).toBe(`${DOCS_URL}/editorialist/`);
		expect(editorialistDocsUrl("Home")).toBe(`${DOCS_URL}/editorialist/`);
	});

	it("puts Radial Timeline's docs at the site root", () => {
		expect(RADIAL_TIMELINE_DOCS_URL).toBe(`${DOCS_URL}/`);
	});
});

describe("settingsDocsUrl", () => {
	const reference = `${DOCS_URL}/editorialist/Settings-Reference/`;

	it("links a tab to its part of Settings Reference", () => {
		expect(settingsDocsUrl("Contributors")).toBe(`${reference}#contributors-tab`);
	});

	it("links a section to its own heading", () => {
		expect(settingsDocsUrl("Cut location")).toBe(`${reference}#cut-location`);
		expect(settingsDocsUrl("Current revision")).toBe(`${reference}#revision-progress`);
	});

	it("covers titles that vary with the manuscript", () => {
		expect(settingsDocsUrl("Tracking notes")).toBe(`${reference}#tracking`);
		expect(settingsDocsUrl("Note inventory")).toBe(`${reference}#scene-inventory`);
	});

	it("falls back to the page for an unknown title", () => {
		expect(settingsDocsUrl("Something new")).toBe(reference);
	});
});
