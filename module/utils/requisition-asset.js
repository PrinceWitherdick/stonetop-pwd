/** Sentinel <option> value for the "Something else…" custom-asset choice, shared by
 *  the two Requisition pickers (the player-facing RequisitionDialog and the steading
 *  sheet's GM walkthrough) so the marker can never drift between them. */
export const CUSTOM_ASSET_VALUE = "__custom__";

/**
 * Wire an asset <select> to its companion custom-text <input>: reveal/enable the input
 * only when "Something else…" is chosen, focus it, and (when a hidden field is given)
 * mirror the resolved value into it on every change. Runs once immediately to sync the
 * initial state. Returns the sync function for callers that need to re-run it.
 *
 * @param {object}      opts
 * @param {HTMLElement} opts.select        - the asset <select>
 * @param {HTMLElement} opts.customInput   - the free-text <input> shown for a custom asset
 * @param {HTMLElement} [opts.valueInput]  - hidden field to receive the resolved value; when
 *                                           present, keystrokes in the custom input sync too
 */
export function wireCustomAssetSelect({ select, customInput, valueInput } = {}) {
	const sync = () => {
		if (!select || !customInput) return;
		const isCustom = select.value === CUSTOM_ASSET_VALUE;
		customInput.hidden = !isCustom;
		customInput.disabled = !isCustom;
		if (valueInput) valueInput.value = isCustom ? customInput.value.trim() : select.value;
		if (isCustom) customInput.focus();
	};
	select?.addEventListener("change", sync);
	if (valueInput) customInput?.addEventListener("input", sync);
	sync();
	return sync;
}

/**
 * Who is holding a requisitioned asset, read out of its `takenBy` record.
 *
 * An asset can be out with a person (the player-facing Requisition move records the
 * character who took it), with an expedition (the GM walkthrough's Requisition step
 * records the trip), or with both. Returns null for an asset that is still on hand.
 *
 * @param {object} asset - one entry of the steading's `assets` flag
 * Who has it, not WHICH TRIP: the id an asset is tagged with is how the steading answers
 * `getAssetsOnExpedition`, and it is asked there, off the flag. This function is the naming half.
 *
 * @returns {{person: string|null, expedition: string|null}|null}
 */
export function assetHolder(asset) {
	const takenBy = asset?.takenBy;
	if (!takenBy) return null;
	const person = String(takenBy.name ?? "").trim();
	const trip = String(takenBy.expedition?.title ?? "").trim();
	return {
		person:     person || null,
		expedition: trip || null,
	};
}

/**
 * One line naming where an asset has gone: "Taken by Wren", "Out on The Wandering Tower",
 * or both when a named character took it on a named trip. "" for an asset on hand.
 *
 * The steading sheet's tooltip, the player-facing picker's "Already out" list and the
 * walkthrough's own asset list all print this, so a struck-through asset says the same
 * thing wherever the reader meets it.
 */
export function assetTakenLabel(asset) {
	const holder = assetHolder(asset);
	if (!holder) return "";
	if (holder.person && holder.expedition) return `Taken by ${holder.person}, out on ${holder.expedition}`;
	if (holder.expedition) return `Out on ${holder.expedition}`;
	return `Taken by ${holder.person || "someone"}`;
}

/** The label above, plus the steading sheet's affordance: clicking the name returns it. */
export function assetTakenTooltip(asset) {
	const label = assetTakenLabel(asset);
	return label ? `${label}. Click to return` : "";
}
