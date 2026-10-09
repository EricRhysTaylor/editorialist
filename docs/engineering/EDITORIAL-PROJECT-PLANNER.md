# Editorial project planner

The Revision plan can now prepare a book for an editor before feedback arrives.
Choose **Prepare for editor**, or use **Open editorial project in workspace** for
a wider view. A project belongs to the active book's existing plan. Project data
has its own version stamp; older plans load without a project, and unsupported
project versions fail rather than silently losing data.

## Workflow

The developmental-edit preset adds manuscript, series overview and query letter
materials. Four editable milestones fall 30, 21, 14 and 7 calendar days before
submission. Readiness and the hard submission date are separate. The preset's
requirements are editable assumptions to confirm against the editor's offer.

Overview emphasizes current packet readiness, next milestone, material blockers
and preparation tasks. Materials shows sources, exports and preserved copies.
Schedule retains Queue, Days, capacity and the preview-based auto-planner.
History retains recorded uploads and project events. Optional supporting
materials and editable preparation tasks can be added without importing feedback.

Material readiness is independent of task or session completion:

1. Link an existing Markdown source and an exported DOCX inside the vault.
   Supporting notes may be outside the manuscript folder.
2. Approve the source, or freeze manuscript sources. Exact source copies,
   membership, numeric path order and scene IDs are preserved locally.
3. Record the final manuscript Word-export count. Open the exact export and
   confirm each inspection requirement. Source/file SHA-256 fingerprints and a
   readable Word package are checked; formatting, intended frontmatter, complete
   export order and visual layout are author-confirmed, not automatically proven.
4. A successful inspection preserves source copies, export bytes and JSON
   recovery manifests under `Editorialist/Submissions/<project-id>/`.
5. Upload through the external collaboration, then record its filename, date and
   confirmation. Recording an upload does not send a file or verify a remote
   account. The submitted copy and evidence remain separate from working drafts.

Changing a source, its membership/order, export bytes, requirements, or recorded
word count invalidates its current readiness. Missing/changed preserved copies
also require rechecking. Historical uploads are retained. Headline counts refer
to versions that match the current drafts. Snapshot operations never alter
manuscript prose or accept review suggestions.

## Scheduling and returns

Preparation candidates retain stable task identities and milestone deadlines.
Source revision work is due by manuscript freeze and packet readiness; uploading
may be scheduled until the hard submission date. Automatic planning sorts
preparation commitments by deadline, puts source work ahead of freeze tasks with
the same deadline, and retains existing dependency, capacity and reserve rules.
Unknown estimates remain unknown. Applying a preview checks book, plan and source
freshness. Preparation sessions and author task completion remain distinct.

Project details can link an existing feedback delivery. Record actual editor
return separately from expected return; the questions deadline is calculated
from actual delivery. Recording actual return unlocks a separate revision
deadline while preserving the historical submission deadline.

## Hardening and verification

Unit and integration coverage includes legacy persistence, unknown schemas,
book isolation, source renames, rollback on save failure, snapshot byte fidelity,
unsaved editor buffers, source membership changes, changes during copying,
requirements, final word count, damaged staged copies, upload provenance,
milestone scheduling, and calendar arithmetic through daylight saving.

Word package inspection uses pinned `fflate` with filtered, bounded extraction;
arbitrary ZIPs, malformed packages and oversized document parts are rejected.
Its MIT notice is embedded in the generated plugin bundle. This is not a full
OOXML conformance checker or an automated visual Word review.

Rendered audit: Obsidian 1.14.4 in a separate local profile and synthetic vault,
with no author manuscript fixtures. Overview, Materials, Schedule and History
were captured at 420px and 300px in light/dark themes, along with empty, drift,
inspection and project-detail states. The visual pass corrected light-theme
status contrast, empty-state duplication, URL input styling and modal density.
Capture artifacts are retained outside the public repository. Custom themes,
mobile layouts and live collaboration upload were not verified.
