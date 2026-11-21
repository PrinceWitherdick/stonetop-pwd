import { normalizePlaybookGlyphs } from "../../../utils/strings.js";

// ── Pick-N with a write-in ───────────────────────────────────────────────────
// The rules and wiring CompanionSetupDialog and CrewSetupDialog share (and onboarding's crew and
// companion steps draw the same way): a "pick N" list of options held at `sel[key]`, write-in boxes
// that each spend a pick (the companion's one, the crew's three, crew-write-ins.js), and suggestion
// radios (instinct, cost) paired with a write-in of the player's own. What each write-in box adds to
// the picks stays with its dialog, since the crew's three boxes keep their own order.

/**
 * Tick or untick a listed pick. Refused (the picks come back unchanged, `ok` false) when ticking one
 * past the limit; the caller puts the box back.
 */
export function togglePick(sel, key, pick, checked, limit) {
	const picks = sel[key] ?? [];
	if (!checked) return { ok: true, sel: { ...sel, [key]: picks.filter(p => p !== pick) } };
	if (picks.includes(pick)) return { ok: true, sel };
	if (picks.length >= limit) return { ok: false, sel };
	return { ok: true, sel: { ...sel, [key]: [...picks, pick] } };
}

/** Suggestion radios and their write-in: each suggestion, whether it is `chosen`, and `chosen` when none is. */
export function suggestionView(suggestions, chosen) {
	const values = (suggestions ?? []).map(v => normalizePlaybookGlyphs(v));
	return {
		options: values.map(value => ({ value, selected: chosen === value })),
		custom:  chosen && !values.includes(chosen) ? chosen : "",
	};
}

/**
 * Repaint a pick-N list after a pick changes, without a re-render: the count, the unticked boxes
 * locked at the limit, each write-in box locked at the limit unless it holds a pick, and the create
 * button when there is one (onboarding's Next has its own refresh).
 */
export function paintPickLimit({ count, boxes, custom, create = null }, picked, limit, ready) {
	const atLimit = picked >= limit;
	count.text(picked);
	boxes.each((_, el) => { if (!el.checked) el.disabled = atLimit; });
	custom.each((_, el) => { el.disabled = atLimit && !String(el.value ?? "").trim(); });
	create?.prop("disabled", !ready);
}

/**
 * A suggestion radio saves its value (`apply`) and clears the write-in; typing a write-in saves it
 * trimmed and clears the radios. `after` runs once the value is saved. `markSelected` also repaints
 * the radios' cards when one is picked.
 */
export function bindSuggestionOrCustom(html, radioName, customSelector, apply, after, { markSelected = true } = {}) {
	html.find(`[name='${radioName}']`).on("change", ev => {
		apply(ev.currentTarget.value);
		html.find(customSelector).val("");
		if (markSelected) html.find(`[name='${radioName}']`).each((_, el) => el.closest(".stonetop-onboarding-card")?.classList.toggle("is-selected", el.checked));
		after();
	});
	html.find(customSelector).on("input", ev => {
		apply(ev.currentTarget.value.trim());
		html.find(`[name='${radioName}']`).prop("checked", false)
			.closest(".stonetop-onboarding-card").removeClass("is-selected");
		after();
	});
}

/**
 * The setup dialogs' instinct and cost pairs (`<prefix>-instinct` radios with a
 * `.<prefix>-instinct-custom` write-in, and the same for cost), saved into `app._sel`.
 */
export function bindInstinctAndCost(app, html, prefix, after) {
	for (const key of ["instinct", "cost"]) {
		bindSuggestionOrCustom(html, `${prefix}-${key}`, `.${prefix}-${key}-custom`, value => { app._sel = { ...app._sel, [key]: value }; }, after);
	}
}
