// A table moment: the brief full-width title band every client sees when a fight begins, an
// expedition sets out or comes home, or the party reaches a stop. This file only decides WHAT a
// payload shows; moment-overlay.js draws it and moment-broadcast.js carries it to the table.
// Pure, so tests/moments/moment-view.test.js reads every kind without a DOM.

/** How long each kind holds fully visible, in ms, between its entrance and its fade. */
export const MOMENT_HOLD_MS = Object.freeze({
	fight: 1200,
	setOut: 1600,
	home: 1600,
	arrive: 1400,
});

/** Per kind: its icon, whether the screen dims behind the band, and whether it is the small band. */
export const MOMENT_KINDS = Object.freeze({
	fight: Object.freeze({ icon: "fa-swords", veil: true, small: false }),
	setOut: Object.freeze({ icon: "fa-person-hiking", veil: false, small: false }),
	home: Object.freeze({ icon: "fa-house-chimney", veil: false, small: false }),
	arrive: Object.freeze({ icon: "fa-signs-post", veil: false, small: true }),
});

/** The longest title or sub a payload may carry. A socket is open to anyone, so this is a cap, not a style. */
export const MOMENT_TEXT_MAX = 80;

/** Plain text, trimmed and cut to the cap. Anything that isn't a string reads as empty. */
function clip(value) {
	if (typeof value !== "string") return "";
	const text = value.trim();
	return text.length > MOMENT_TEXT_MAX ? `${text.slice(0, MOMENT_TEXT_MAX - 1).trimEnd()}…` : text;
}

/**
 * What a moment payload shows, or null when its kind is not one of MOMENT_KINDS.
 *
 * @param {{kind?: string, title?: string, sub?: string}} payload
 * @param {{localize: Function}} [i18n]
 * @returns {{kind: string, icon: string, veil: boolean, small: boolean, title: string, sub: string, holdMs: number}|null}
 */
export function momentView(payload, i18n = globalThis.game?.i18n) {
	const kind = payload?.kind;
	if (typeof kind !== "string" || !Object.hasOwn(MOMENT_KINDS, kind)) return null;
	const { icon, veil, small } = MOMENT_KINDS[kind];
	const title = clip(payload.title) || clip(i18n?.localize?.(`stonetop.moments.${kind}.title`));
	return { kind, icon, veil, small, title, sub: clip(payload.sub), holdMs: MOMENT_HOLD_MS[kind] };
}
