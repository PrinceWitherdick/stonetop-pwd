// THE GM'S TIMELINE COLOURS: the colour each kind of row wears, for the whole world.
//
// A dropdown hung under the toolbar's Colours button, as the Filter menu hangs under its own (user,
// 2026-10-04). It was a window of its own; this is the same picker with the window taken away. The
// timeline holds one of these per host and draws the menu's rows from it, so a pick survives the
// repaint anyone's write at the table causes while the menu is open.
//
// One colour in, four out (timeline-colours.js): the GM picks on whatever skin they read in, and
// each skin gets that hue walked along its lightness until it reads there -- darker on the light
// pages, lighter on the dark ones. So the row previews the colour THIS page will wear, and says so
// when the pick had to be adjusted to read here.
//
// ⚠ THE NOTE IS FOR THIS SKIN ONLY. No one colour clears 7:1 on both the white high-contrast page
// and the near-black one, so "adjusted on some skin" is true of every pick there is and would sit
// on every row saying nothing.
//
// Only the kinds the GM actually picked are written; the rest keep the stylesheet's shipped colour,
// which is hand-tuned per skin. That is also why a pick that lands back ON this skin's shipped
// colour counts as no pick: kept as a choice, it would be walked into the other three skins and
// replace their own tuned colours with a derived one.
//
// NOTHING IS WRITTEN UNTIL SAVE. A press outside shuts the menu as it shuts Filter, but the picks
// wait in the draft for the menu to open again; only Cancel throws them away.

import { format } from "../utils/i18n.js";
import {
	TIMELINE_COLOUR_KINDS, TIMELINE_KIND_PALETTE, currentColourMode, kindColourSet,
} from "./timeline-colours.js";
import { kindChip } from "./timeline-view.js";
import { getTimelineKindColours, setTimelineKindColours } from "../settings.js";

/**
 * A row's Default button with nothing to put back: invisible but keeping its grid cell, so the
 * picker beside it never moves. Not `hidden`, which means gone (the stylesheet's one `[hidden]`
 * rule). `aria-hidden` and `tabindex` keep it out of the accessibility tree and the tab order as
 * `hidden` did, on top of the `visibility: hidden` the class gives; timeline.hbs draws the same
 * three for the first paint.
 */
export function setResetIdle(reset, idle) {
	reset.classList.toggle("is-idle", idle);
	if (idle) {
		reset.setAttribute("aria-hidden", "true");
		reset.setAttribute("tabindex", "-1");
	} else {
		reset.removeAttribute("aria-hidden");
		reset.removeAttribute("tabindex");
	}
}

export class TimelineColoursDraft {
	constructor() {
		/** The picks made in the menu and not yet saved, `{kind: "#rrggbb" | null}` (null = Default). */
		this._picks = {};
	}

	/** Whether there is anything unsaved. */
	get dirty() {
		return Object.keys(this._picks).length > 0;
	}

	/**
	 * The colour a kind is set to as the menu shows it: the unsaved pick, else the world's. The
	 * world's is read afresh each time, so a kind this GM has not touched follows a change made
	 * at another seat.
	 */
	_chosen(kind, world = getTimelineKindColours()) {
		if (kind in this._picks) return this._picks[kind];
		return world[kind] ?? null;
	}

	rows() {
		const world = getTimelineKindColours();
		return TIMELINE_COLOUR_KINDS.map(kind => this._row(kind, world));
	}

	/** One kind's row: its chip, the colour it would wear on this page, and whether it is repainted. */
	_row(kind, world) {
		const chip = kindChip(kind);
		return {
			kind,
			icon: chip.icon,
			label: chip.label,
			pickLabel: format("stonetop.timeline.colours.pick", { kind: chip.label }),
			resetLabel: format("stonetop.timeline.colours.resetTooltip", { kind: chip.label }),
			...this._paint(kind, world),
		};
	}

	/**
	 * What a row shows for its kind now: the picker's value, the chip's colour on this page, and the
	 * two flags. A repainted kind's picker holds what the GM chose; the chip shows what this skin
	 * makes of it. The skin is read afresh each time: the GM can change it with the menu open.
	 */
	_paint(kind, world) {
		const mode = currentColourMode();
		const chosen = this._chosen(kind, world);
		const read = chosen ? kindColourSet(chosen)?.[mode] : null;
		return {
			value: chosen || TIMELINE_KIND_PALETTE[kind][mode],
			colour: read ? read.hex : TIMELINE_KIND_PALETTE[kind][mode],
			repainted: !!read,
			nudged: !!read?.nudged,
		};
	}

	/** The picker moved. Landing on this skin's shipped colour is the default, not a choice. */
	pick(kind, value) {
		const shipped = String(value).toLowerCase() === TIMELINE_KIND_PALETTE[kind][currentColourMode()];
		this._picks[kind] = shipped ? null : value;
	}

	/** Default pressed: the kind goes back to the stylesheet's colour. */
	reset(kind) {
		this._picks[kind] = null;
	}

	/** Cancel: every unsaved pick goes. */
	discard() {
		this._picks = {};
	}

	/**
	 * Bring one row up to date by hand. A re-render would shut a colour picker the GM is still
	 * dragging about in, so nothing here re-renders.
	 */
	repaintRow(row, { syncPicker = false } = {}, world = undefined) {
		const paint = this._paint(row.dataset.kind, world);
		row.style.setProperty("--tl-kind", paint.colour);
		const reset = row.querySelector(".stonetop-timeline-colours-reset");
		if (reset) setResetIdle(reset, !paint.repainted);
		const note = row.querySelector(".stonetop-timeline-colours-note");
		if (note) note.hidden = !paint.nudged;
		if (syncPicker) {
			const pick = row.querySelector(".stonetop-timeline-colours-pick");
			if (pick) pick.value = paint.value;
		}
	}

	/** Every row in the menu, with the world's colours read once for all of them. */
	repaintAll(menu, options = {}) {
		const world = getTimelineKindColours();
		for (const row of menu.querySelectorAll(".stonetop-timeline-colours-row")) this.repaintRow(row, options, world);
	}

	/**
	 * Write the kinds touched here over the world's colours AS THEY STAND NOW, so a change made at
	 * another seat while the menu was open survives. Every client repaints from the setting's
	 * onChange. A player never writes, however they came by the menu.
	 *
	 * The draft is cleared only once the write has landed, and only of the picks it carried: a write
	 * that fails leaves every pick waiting for another Save, and a pick made while it was on its way
	 * is not lost with it.
	 */
	async save() {
		if (!game.user?.isGM) return this.discard();
		if (!this.dirty) return;
		const saving = { ...this._picks };
		const next = { ...getTimelineKindColours() };
		for (const [kind, colour] of Object.entries(saving)) {
			if (colour) next[kind] = colour;
			else delete next[kind];
		}
		await setTimelineKindColours(next);
		for (const [kind, colour] of Object.entries(saving)) {
			if (this._picks[kind] === colour) delete this._picks[kind];
		}
	}
}
