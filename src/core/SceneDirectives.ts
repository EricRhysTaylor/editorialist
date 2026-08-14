// Collects the editorialism directives that bear on the scene the author is
// reviewing right now, so a structural agenda reaches them inside the sweep
// they already run instead of waiting in a panel they have to remember to open.
//
// This is deliberately NOT part of the review session, and the separation is
// load-bearing:
//
//   - A review suggestion is disposable, appended to the scene note, and drives
//     the sweep state machine — including the completion predicate and the
//     `Editorialist.revision` stamp.
//   - A directive is durable, book-scoped, and lives in its own markdown file
//     that the author can edit with the plugin uninstalled.
//
// Keeping directives out of `ReviewSession.suggestions` is what makes it
// structurally impossible for one to block sweep completion or for a batch
// operation (Erase batches, cleanup) to reach an editorialism file. Nothing
// here applies anything to the manuscript: a directive carries no payload.

import { scopeRelatesToScene, type SceneRelevanceContext } from "./SceneRelevance";
import {
	isAnchorRetired,
	type Editorialism,
	type EditorialismAnchor,
	type EditorialismItem,
} from "../models/Editorialism";

export interface SceneDirective {
	editorialismPath: string;
	editorialismTitle: string;
	sectionHeading: string;
	item: EditorialismItem;
	// The item's anchors that point at THIS scene. An item spanning scenes
	// 13–22 surfaces only the passages living here, so the card is a route
	// through the current scene rather than a copy of the whole agenda.
	anchorsInScene: EditorialismAnchor[];
	// Anchors in this scene still awaiting the author (neither done nor
	// deferred), for the card's summary line.
	openAnchorsInScene: number;
}

// Which scene an anchor points at. The anchor's own leading scene token wins;
// a scene-scoped parent item supplies the fallback. This mirrors the precedence
// in the plugin's resolveAnchorSceneFile so the card and the jump agree about
// where an anchor lives — if they disagreed, a row could appear here and then
// navigate somewhere else.
export function anchorTargetsScene(
	anchor: EditorialismAnchor,
	item: EditorialismItem,
	sceneNumber: number,
): boolean {
	const token = anchor.scene ?? (item.scope?.kind === "scene" ? item.scope.scene ?? null : null);
	if (!token) {
		return false;
	}
	const value = Number.parseInt(token, 10);
	return Number.isFinite(value) && value === sceneNumber;
}

export function collectSceneDirectives(
	editorialisms: ReadonlyArray<Editorialism>,
	context: SceneRelevanceContext,
): SceneDirective[] {
	const sceneNumber = context.sceneNumber;
	const out: SceneDirective[] = [];

	for (const editorialism of editorialisms) {
		for (const section of editorialism.sections) {
			for (const item of section.items) {
				// A finished directive is not work in this scene. Deferred and
				// question items stay: the author parked them, they did not
				// resolve them, and the scene they touch is exactly where the
				// reminder is useful.
				if (item.status === "done") {
					continue;
				}
				// `manuscript` and `unknown` scopes never match by design — a
				// directive that applies everywhere does not help locate
				// anything, and surfacing it at every scene would make this card
				// noise. Giving those a jump target is issue #3's job.
				if (!scopeRelatesToScene(item.scope, context)) {
					continue;
				}

				const anchorsInScene =
					sceneNumber === null
						? []
						: item.anchors.filter((anchor) => anchorTargetsScene(anchor, item, sceneNumber));

				out.push({
					editorialismPath: editorialism.filePath,
					editorialismTitle: editorialism.title,
					sectionHeading: section.heading,
					item,
					anchorsInScene,
					openAnchorsInScene: anchorsInScene.filter((anchor) => !isAnchorRetired(anchor.status)).length,
				});
			}
		}
	}

	return out;
}

export function countOpenAnchors(directives: ReadonlyArray<SceneDirective>): number {
	return directives.reduce((total, directive) => total + directive.openAnchorsInScene, 0);
}
