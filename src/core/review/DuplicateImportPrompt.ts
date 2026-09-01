// The prompt shown when an import matches a batch already in the registry.
//
// Detection used to consider only `in_progress` sweeps, on the reasoning that
// nothing else is resumable. True, but it conflated two different questions:
// "can I reopen this?" and "have I already done this?". A batch that was
// finished — or finished and cleaned — matched nothing, so re-importing it
// warned about nothing at all. That is the accident worth guarding: the work is
// done, and a second copy puts the same review blocks back into the same scenes
// and asks the author to decide the same edits over.
//
// Resuming is offered only while the sweep is genuinely open. Everything else
// gets a warning whose emphasis is on NOT importing, with the batch named so it
// can be matched against the Recent reviews list.

import type { ReviewSweepStatus } from "../../models/ReviewImport";

export type DuplicateImportChoice = "cancel" | "import" | "open";

export interface DuplicateImportChoiceOption {
	label: string;
	value: DuplicateImportChoice;
	cta?: boolean;
}

export interface DuplicateImportPrompt {
	title: string;
	description: string;
	details: string[];
	choices: DuplicateImportChoiceOption[];
}

export interface DuplicateImportPromptInput {
	status: ReviewSweepStatus;
	batchId: string;
	/** Pre-formatted by the caller — this module stays free of clock access. */
	importedAtLabel: string;
	sceneCount: number;
	decisions: { accepted: number; rejected: number; rewritten: number; deferred: number };
}

export function buildDuplicateImportPrompt(input: DuplicateImportPromptInput): DuplicateImportPrompt {
	const details = [
		`BatchId: ${input.batchId}`,
		`Imported ${input.importedAtLabel}`,
		`${input.sceneCount} ${input.sceneCount === 1 ? "scene" : "scenes"}`,
		...describeDecisions(input.decisions),
	];

	if (input.status === "in_progress") {
		return {
			title: "This review batch is already open",
			description:
				"You imported this batch and have not finished it. Open the existing sweep to carry on where you left off, or import again to start a second copy alongside it.",
			details,
			choices: [
				{ label: "Open existing sweep", value: "open" },
				{ label: "Import anyway", value: "import" },
				{ label: "Cancel", value: "cancel" },
			],
		};
	}

	const cleaned = input.status === "cleaned";
	return {
		title: cleaned ? "You already reviewed and cleaned this batch" : "You already reviewed this batch",
		description: cleaned
			? "Every suggestion in this batch was resolved and its review blocks were removed from your notes. Importing it again puts them back and asks you to decide the same edits a second time."
			: "Every suggestion in this batch was already resolved. Importing it again adds a second copy of the same review blocks to the same scenes and asks you to decide the same edits a second time.",
		details,
		// Cancel carries the emphasis here: re-importing finished work is almost
		// always the accident, not the intent.
		choices: [
			{ label: "Cancel", value: "cancel", cta: true },
			{ label: "Import anyway", value: "import" },
		],
	};
}

function describeDecisions(decisions: DuplicateImportPromptInput["decisions"]): string[] {
	const parts = [
		[decisions.accepted, "accepted"],
		[decisions.rejected, "rejected"],
		[decisions.rewritten, "rewritten"],
		[decisions.deferred, "deferred"],
	] as const;
	const written = parts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
	return written.length > 0 ? [written.join(" · ")] : [];
}
