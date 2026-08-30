import { escHtml } from "../../utils/strings.js";

// ── The steading's three debilities (Book I, "Homefront") ───────────────────────
// ONE table, because three separate moves clear a debility and each used to carry its own
// copy: Return Triumphant, the public sacrifice half of Rites of the Land, and the Inn's
// seasonal gathering. Each copy quotes its `detail` straight into a dialog the table reads,
// so three copies is three places for the wording of a rule to drift apart.
//
// The WINDOW those moves put the choice in lives here too (openDebilityPicker), for the same
// reason: they all ask it the same way, and the parts that make it work are easy to lose in
// a copy.

export const DEBILITIES = [
	{ id: "diminished", label: "Diminished", detail: "disadvantage to Deploy, Muster, Pull Together" },
	{ id: "lacking",    label: "Lacking",    detail: "treat Prosperity as 1 lower" },
	{ id: "malcontent", label: "Malcontent", detail: "Fortunes reset to +0 each season; folks need Persuading more often" },
];

/** Where one debility's checkbox lives on the steading's system data. */
export function debilityPath(id) {
	return `attributes.debilities.options.${id}.value`;
}

/** Which of the three are marked right now. Order follows DEBILITIES, not the data. */
export function markedDebilities(steading) {
	return DEBILITIES.filter(d => steading?.getSystemValue(debilityPath(d.id), false));
}

/**
 * Clear one debility, attributed to the move that did it.
 *
 * The `stonetopMove` tag is not optional decoration: the steading ledger renders it as
 * "via <move>", which is the only thing that later tells a table whether a cleared
 * Malcontent was the Inn's doing or a Blessed's sacrifice.
 */
export async function clearDebility(steading, id, stonetopMove) {
	if (!steading || !DEBILITIES.some(d => d.id === id)) return false;
	await steading.setSystemValue(debilityPath(id), false, { stonetopMove });
	return true;
}

/** The chrome every debility picker wears. */
const PICKER_DIALOG_OPTIONS = { classes: ["dialog", "stonetop", "stonetop-disaster-move-dialog"] };

/**
 * The "pick one debility, then commit from the footer" window.
 *
 * ONE implementation, because every move that clears a debility puts the same question the
 * same way, and the details that make it work are the easiest thing to lose in a copy:
 *
 * · Picking and committing are separate acts. A click used to write the clear and shut the
 *   window in one motion, which put an irreversible steading edit a single mis-click away and
 *   left no moment to read the row before it landed. A click now only marks the choice; the
 *   footer button writes it, and it NAMES the debility it is about to clear so there is no
 *   doubt what the press does. Nothing starts picked, so the button starts disabled.
 *
 * · `autofocus` on the first row is load-bearing, not polish: Foundry's own Tab handler pulls
 *   focus to the first `.dialog-button` whenever focus is outside the dialog, and a DISABLED
 *   button cannot take focus — so without a focus target inside the window, Tab would never
 *   get a keyboard user in. Starting focus on a row leaves Tab to the browser from then on.
 *
 * · The apply callback is guarded rather than trusted to be unreachable: Foundry submits the
 *   `default` button on Enter whenever focus sits anywhere in the window, and `disabled` only
 *   stops the click. With nothing picked it closes writing nothing, like Escape.
 *
 * · `html[0] ?? html` both times: core hands render callbacks jQuery on v13 and there is no
 *   promise it always will. A bare `html[0]` would throw one line after the button was
 *   disabled and before a single row listener was wired, leaving a window whose only button
 *   is dead and whose rows do nothing — so the move could not be made at all.
 *
 * @param {object} opts
 * @param {string} opts.title             window title
 * @param {string} opts.introHtml         the line above the choices (trusted HTML)
 * @param {Array}  opts.marked            debilities to offer, from {@link markedDebilities}.
 *                                        Each `{id, label, detail}`; an optional `labelHtml`
 *                                        prints instead of the escaped `label` for a caller
 *                                        offering choices whose markup it authored itself.
 * @param {string} [opts.applyLabel]      footer button before anything is picked
 * @param {Function} [opts.applyLabelFor] (debility) => footer button once one is
 * @param {string} [opts.bodyClass]       extra class on the dialog body
 * @param {object} [opts.buttons]         further buttons, merged after `apply`
 * @param {string} [opts.choicesLabel]    what the radiogroup is choosing, for a screen reader
 * @param {object} [opts.dialogOptions]   Dialog application options
 * @param {Function} [opts.onRender]      (root, dialog) => void, for a window with a control of
 *                                        its own in `introHtml` (winter's "pay it instead")
 * @param {Function} opts.onApply         (debility) => void, run when the footer commits
 */
export function openDebilityPicker({
	title,
	introHtml,
	marked = [],
	applyLabel = "Clear Debility",
	applyLabelFor = d => `Clear ${d.label}`,
	bodyClass = "",
	buttons = {},
	choicesLabel = "Debility to clear",
	dialogOptions = PICKER_DIALOG_OPTIONS,
	onRender,
	onApply,
}) {
	// `labelHtml` is the opt-out from escaping, and it is opt-IN for a reason: a debility's
	// `label` is plain text and stays escaped, because a homebrew one is not ours to trust.
	// A caller offering choices IT authored (the rites' "Clear <strong>Diminished</strong>",
	// and its non-debility "Fortunes advantage" row) passes the markup it wrote deliberately.
	// `label` is still required alongside it — the footer button prints that one as text.
	const choicesHtml = marked.map((d, i) => `
		<li class="stonetop-disaster-choice" data-choice="${escHtml(d.id)}"
		    role="radio" aria-checked="false" tabindex="0"${i === 0 ? " autofocus" : ""}>
			<span class="stonetop-disaster-choice-label">${d.labelHtml ?? escHtml(d.label)}</span>
			<span class="stonetop-disaster-choice-detail">${escHtml(d.detail)}</span>
		</li>`).join("");

	let picked = null;

	// `const`, even though the render/button callbacks below refer to `dialog`: they run
	// after this statement completes, so the binding is always initialised by then.
	const dialog = new Dialog({
		title,
		content: `<div class="stonetop-disaster-dialog${bodyClass ? ` ${bodyClass}` : ""}">
			${introHtml}
			<ol class="stonetop-disaster-choices" role="radiogroup" aria-label="${escHtml(choicesLabel)}">${choicesHtml}</ol>
		</div>`,
		buttons: {
			apply: {
				label: applyLabel,
				callback: async () => {
					if (!picked) return;
					await onApply(picked);
				},
			},
			...buttons,
		},
		// Named even when it is the only button: omitting it makes Enter submit `undefined`,
		// which throws inside Dialog#submit.
		default: "apply",
		render: html => {
			const appEl    = dialog.element?.jquery ? dialog.element[0] : dialog.element;
			const applyBtn = appEl?.querySelector("button[data-button='apply']");
			if (applyBtn) applyBtn.disabled = true;

			const root    = html[0] ?? html;
			const options = [...root.querySelectorAll(".stonetop-disaster-choice")];
			const select = el => {
				picked = marked.find(d => d.id === el.dataset.choice) ?? null;
				for (const o of options) {
					const on = o === el;
					o.classList.toggle("is-selected", on);
					o.setAttribute("aria-checked", String(on));
				}
				if (!applyBtn) return;
				applyBtn.disabled = !picked;
				applyBtn.textContent = picked ? applyLabelFor(picked) : applyLabel;
			};

			for (const el of options) {
				el.addEventListener("click", () => select(el));
				// Space would scroll the window and Enter would reach Foundry's document-level
				// handler and submit the dialog, so a keyboard pick swallows its own key.
				el.addEventListener("keydown", event => {
					if ((event.key !== "Enter") && (event.key !== " ")) return;
					event.preventDefault();
					event.stopPropagation();
					select(el);
				});
			}

			onRender?.(root, dialog);
		},
	}, dialogOptions);
	dialog.render(true);
	return dialog;
}
