import { sign } from "../../utils/roll-engine.js";

// ── Return Triumphant (Book I p.339) ────────────────────────────────────────────
// No dice: the move clears one of the steading's marked debilities, or raises Fortunes
// by 1 when none are marked. A PLAYER makes it, but every effect lands on the steading —
// which is why the walkthrough lives here rather than on a character sheet.
//
// MODULE LEVEL, not a method, because two surfaces now reach for it: the steading sheet's
// own move card, and the last step of the Run an Expedition walkthrough, which is where a
// table actually is when the move comes up. One copy, so the two cannot come to disagree
// about what "triumphant" does to Fortunes.

const DEBILITIES = [
	{ id: "diminished", label: "Diminished", detail: "disadvantage to Deploy, Muster, Pull Together" },
	{ id: "lacking",    label: "Lacking",    detail: "treat Prosperity as 1 lower" },
	{ id: "malcontent", label: "Malcontent", detail: "Fortunes reset to +0 each season; folks need Persuading more often" },
];

const DIALOG_OPTIONS = { classes: ["dialog", "stonetop", "stonetop-disaster-move-dialog"] };

/**
 * Open the Return Triumphant walkthrough against a steading.
 *
 * @param {StonetopSteading} steading  The steading wrapper the writes land on.
 * @param {object}   [opts]
 * @param {Function} [opts.onApplied]  Called after a write lands, so the surface that opened
 *                                     this can repaint. Nothing is called when the window is
 *                                     closed without committing.
 */
export function openReturnTriumphant(steading, { onApplied } = {}) {
	if (!steading) return;
	const done = () => onApplied?.();

	const marked = DEBILITIES.filter(d =>
		steading.getSystemValue(`attributes.debilities.options.${d.id}.value`, false));

	// No debilities marked → the move raises Fortunes by 1 instead.
	if (marked.length === 0) {
		const fortunes    = steading.getStatValue("fortunes");
		const newFortunes = fortunes + 1;
		new Dialog({
			title: "Return Triumphant",
			content: `<div class="stonetop-disaster-dialog">
				<p><em>You return home in triumph, and the steading has no debilities marked.</em></p>
				<p>Fortunes: <strong>${sign(fortunes)}</strong> → <strong>${sign(newFortunes)}</strong></p>
			</div>`,
			buttons: {
				cancel: { label: "Cancel" },
				apply: {
					label: "Increase Fortunes",
					callback: async () => {
						// Attributed to the move, so the steading ledger reads "via Return Triumphant".
						await steading.setSystemValue("stats.fortunes.value", newFortunes, { stonetopMove: "Return Triumphant" });
						done();
					},
				},
			},
			default: "apply",
		}, DIALOG_OPTIONS).render(true);
		return;
	}

	// One or more debilities marked → the GM clears 1.
	//
	// Picking and committing are two separate acts. A click used to write the clear and shut the
	// window in one motion, which put an irreversible steading edit a single mis-click away and
	// left no moment to read the row before it landed. A click now only marks the choice; the
	// footer button is what writes it, and it names the debility it is about to clear so there is
	// no doubt what the press does. Nothing starts picked, so the button starts disabled.
	//
	// `autofocus` on the first row is load-bearing, not polish: Foundry's own Tab handler pulls
	// focus to the first `.dialog-button` whenever focus is outside the dialog, and a DISABLED
	// button cannot take focus, so without a focus target inside the window Tab would never
	// get a keyboard user in. Starting focus on a row leaves Tab to the browser from then on.
	const choicesHtml = marked.map((d, i) => `
		<li class="stonetop-disaster-choice" data-choice="${d.id}"
		    role="radio" aria-checked="false" tabindex="0"${i === 0 ? " autofocus" : ""}>
			<span class="stonetop-disaster-choice-label">${d.label}</span>
			<span class="stonetop-disaster-choice-detail">${d.detail}</span>
		</li>`).join("");

	let picked = null;

	// `const`, even though the render/button callbacks below refer to `dialog`: they run
	// after this statement completes, so the binding is always initialised by then.
	const dialog = new Dialog({
		title: "Return Triumphant",
		content: `<div class="stonetop-disaster-dialog">
			<p><em>You return home in triumph.</em> Clear 1 of the steading's debilities:</p>
			<ol class="stonetop-disaster-choices" role="radiogroup" aria-label="Debility to clear">${choicesHtml}</ol>
		</div>`,
		buttons: {
			apply: {
				label: "Clear Debility",
				// Guarded rather than trusted to be unreachable: Foundry submits the `default`
				// button on Enter whenever focus sits anywhere in the window, and `disabled` only
				// stops the click. With nothing picked this closes writing nothing, like Escape.
				callback: async () => {
					if (!picked) return;
					await steading.setSystemValue(`attributes.debilities.options.${picked.id}.value`, false, { stonetopMove: "Return Triumphant" });
					done();
				},
			},
		},
		// Named even though it is the only button: omitting it makes Enter submit `undefined`,
		// which throws inside Dialog#submit.
		default: "apply",
		render: (html) => {
			const appEl    = dialog.element?.jquery ? dialog.element[0] : dialog.element;
			const applyBtn = appEl?.querySelector("button[data-button='apply']");
			if (applyBtn) applyBtn.disabled = true;

			const options = [...html[0].querySelectorAll(".stonetop-disaster-choice")];
			const select = (el) => {
				picked = marked.find(d => d.id === el.dataset.choice) ?? null;
				for (const o of options) {
					const on = o === el;
					o.classList.toggle("is-selected", on);
					o.setAttribute("aria-checked", String(on));
				}
				if (!applyBtn) return;
				applyBtn.disabled  = !picked;
				applyBtn.textContent = picked ? `Clear ${picked.label}` : "Clear Debility";
			};

			for (const el of options) {
				el.addEventListener("click", () => select(el));
				// Space would scroll the window and Enter would reach Foundry's document-level
				// handler and submit the dialog, so a keyboard pick swallows its own key.
				el.addEventListener("keydown", (event) => {
					if ((event.key !== "Enter") && (event.key !== " ")) return;
					event.preventDefault();
					event.stopPropagation();
					select(el);
				});
			}
		},
	}, DIALOG_OPTIONS);
	dialog.render(true);
}
