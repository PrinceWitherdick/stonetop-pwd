// Author a reusable, draggable steading-improvement card (name + flavor + optional
// requirement checklist + effect). On create it lands as a card in the "Homebrew
// Steading Improvements" journal, which the GM drags onto any steading's Improvements
// tab. The steading-bound quick-add (StonetopSteadingSheet._onCreateImprovementOpen)
// stays for adding straight to the open steading; this one is the reusable path.
import { createImprovementCard } from "../journal/steading-improvement-cards.js";
import { IMPROVEMENT_CATEGORIES } from "../actors/steading/StonetopSteading.js";

/**
 * The Category picker both improvement forms carry — this dialog's, and the steading sheet's
 * quick-add (StonetopSteadingSheet._onCreateImprovementOpen).
 *
 * Shared because it renders IMPROVEMENT_CATEGORIES: a fourth category, or a change to the
 * "None" wording, is otherwise a two-file edit with no test over the sheet's copy. The rest of
 * the two forms is still duplicated by prior design — that predates this and is left alone.
 */
export function improvementCategoryFieldHtml() {
	return `<label class="stonetop-homestead-field">
						<span>Category</span>
						<select name="category">
							<option value="">None (always shown)</option>
							${IMPROVEMENT_CATEGORIES.map(c => `<option value="${c.key}">${c.label}</option>`).join("")}
						</select>
					</label>`;
}

/** Open the create-improvement dialog. Resolves after the card is authored (or cancel). */
export function openCreateImprovementDialog() {
	const dialog = new Dialog({
		title: "Create Steading Improvement",
		content: `<form class="stonetop-homestead-dialog">
			<p class="stonetop-homestead-trigger"><em>Author a reusable improvement card, then drag it onto any steading's Improvements tab.</em></p>
			<div class="stonetop-homestead-fields">
				<label class="stonetop-homestead-field">
					<span>Name</span>
					<input type="text" name="name" placeholder="e.g. Roadbuilding" autofocus>
				</label>
				${improvementCategoryFieldHtml()}
				<label class="stonetop-homestead-field">
					<span>Flavor</span>
					<textarea name="flavor" rows="2" placeholder="A short description shown under the title (optional)."></textarea>
				</label>
				<label class="stonetop-homestead-field">
					<span>Requirements</span>
					<textarea name="requirements" rows="4" placeholder="One requirement per line: each becomes a check-off step (optional)."></textarea>
				</label>
				<label class="stonetop-homestead-field">
					<span>Effect</span>
					<textarea name="effect" rows="2" placeholder="What completing it does: new resources, defenses, etc. (optional)."></textarea>
				</label>
			</div>
		</form>`,
		buttons: {
			cancel: { label: "Cancel" },
			create: {
				label: "Create",
				callback: async (html) => {
					const form = html[0].querySelector("form");
					const val = n => form.querySelector(`[name="${n}"]`)?.value?.trim() ?? "";
					const name = val("name");
					if (!name) {
						globalThis.ui?.notifications?.warn?.("Enter a name for the improvement.");
						return;
					}
					const items = val("requirements").split("\n").map(s => s.trim()).filter(Boolean);
					const def = {
						name,
						// Rides along in the card's payload so a dropped card lands under the
						// right chip; validated on the receiving end by addCustomImprovement.
						category: val("category"),
						flavor: val("flavor"),
						effect: val("effect"),
						sections: items.length ? [{ heading: "Requires all of the following:", items }] : [],
					};
					await createImprovementCard(def);
				},
			},
		},
		default: "create",
	}, { classes: ["dialog", "stonetop", "stonetop-create-improvement-dialog"], resizable: true });
	dialog.render(true);
}
