// THE COLOUR EACH KIND OF TIMELINE ROW WEARS, AND THE ARITHMETIC THAT KEEPS A GM'S CHOICE READABLE.
//
// The stylesheet carries the shipped palette as `--st-timeline-kind-<kind>` tokens, one value per
// skin (light, Lamplit dark, and the two high-contrast skins). This file holds the SAME values, held
// to the stylesheet by tests/timeline/timeline-colours.test.js, for two jobs the stylesheet cannot
// do: seeding the GM's colour picker with what a kind wears today, and turning ONE colour the GM
// chose into four, one per skin, each readable on the paper that skin paints.
//
// ⚠ ONE COLOUR IN, FOUR OUT. A GM picks a purple on whatever skin they happen to read in. The
// player across the table may be on the dark page, and the one on the magnifier on high contrast;
// a purple deep enough for parchment is invisible on #1d1915. So the choice is kept as the HUE it
// names and walked along its own lightness until it clears that skin's floor, the same bargain
// relmap-ink.js#deepenInk strikes for a line on the relationship map (and the same function does
// the walking). A colour that already clears the floor is used exactly as chosen.
//
// ⚠ NO IMPORT FROM timeline-core.js, and the kind list is restated below rather than derived from
// TIMELINE_SOURCES. settings.js imports this file to repaint on change, and timeline-core reaches
// the season clock, which is one of the routes back into settings. A test holds the two lists
// together instead.

import { contrast, deepenInk, normalizeHex, parseColour } from "../relmap/relmap-ink.js";
import { isDarkPalette } from "../utils/palette.js";

/**
 * The kinds that wear a colour: every source the system records for itself as a CARD. `hand` (a
 * typed row) is left out on purpose -- it wears no chip, and a colour would be a tag nobody gave it.
 * So is `season`: a Seasons Change prints inside its season's heading, which wears the season's own
 * colour, and is no card (timeline-core.js#TIMELINE_SEASON_SOURCE).
 *
 * ⚠ ORDER IS THE DIALOG'S ORDER, which is the Show menu's (TIMELINE_CARD_SOURCES, minus `hand`).
 */
export const TIMELINE_COLOUR_KINDS = Object.freeze([
	"levelup", "deed", "kills", "expedition", "site", "death", "wound", "arcana", "treasure", "follower", "improvement", "disaster", "threat",
]);

/** The four skins a colour has to read on, in the order the generated CSS writes them. */
export const TIMELINE_COLOUR_MODES = Object.freeze(["light", "dark", "lightHigh", "darkHigh"]);

/**
 * The shipped palette, one hex per kind per skin. ⚠ A COPY OF THE STYLESHEET'S TOKENS, and the
 * test fails if the two disagree. Why each kind is the colour it is, and why each sits at its own
 * lightness, is written once, beside the light tokens in styles/stonetop.css.
 */
export const TIMELINE_KIND_PALETTE = Object.freeze({
	levelup:    Object.freeze({ light: "#705409", dark: "#dcaa20", lightHigh: "#6b5109", darkHigh: "#d0a01e" }),
	kills:      Object.freeze({ light: "#6a1219", dark: "#fa9690", lightHigh: "#a51d28", darkHigh: "#f28991" }),
	expedition: Object.freeze({ light: "#0a625a", dark: "#4cc3be", lightHigh: "#0d5e5b", darkHigh: "#3db9b5" }),
	site:       Object.freeze({ light: "#295a8c", dark: "#a8c7e6", lightHigh: "#275788", darkHigh: "#9abee2" }),
	death:      Object.freeze({ light: "#4a4744", dark: "#b7b5b0", lightHigh: "#595450", darkHigh: "#aba6a1" }),
	wound:      Object.freeze({ light: "#7c300a", dark: "#f2a46e", lightHigh: "#772e0a", darkHigh: "#f2aa86" }),
	arcana:     Object.freeze({ light: "#7b31a7", dark: "#bca8f4", lightHigh: "#7a30a5", darkHigh: "#c794e4" }),
	follower:   Object.freeze({ light: "#9a276a", dark: "#f1bcdd", lightHigh: "#972668", darkHigh: "#e6a8cc" }),
	improvement:Object.freeze({ light: "#2a6026", dark: "#8fd17f", lightHigh: "#2a6026", darkHigh: "#8fd17f" }),
	deed:       Object.freeze({ light: "#3e3fa0", dark: "#b0b3f5", lightHigh: "#3e3fa0", darkHigh: "#b0b3f5" }),
	disaster:   Object.freeze({ light: "#8b1d41", dark: "#f59ab5", lightHigh: "#8b1d41", darkHigh: "#f59ab5" }),
	treasure:   Object.freeze({ light: "#5d5a10", dark: "#d6cf62", lightHigh: "#59560f", darkHigh: "#d6cf62" }),
	threat:     Object.freeze({ light: "#3b4a55", dark: "#a9bccb", lightHigh: "#3b4a55", darkHigh: "#a9bccb" }),
});

/**
 * What each skin paints behind a kind's marks, and the floor a mark must clear on all of it.
 *
 * ⚠ ALSO A COPY OF THE STYLESHEET (`--st-page`, `--stonetop-bg`, `--st-card-fill` and the two wash
 * tokens, per skin), held to it by the same test. Copied rather than read off the document because
 * the CSS this file writes has to be right for all four skins at once, and only one of them is
 * live on any given screen.
 *
 * The FLOOR is 4.5 and not the 3:1 a graphical object needs: the glyph in a chip is read at text
 * size. 7:1 under the high-contrast skins, whose whole promise is the AAA bar.
 *
 * ⚠ THE TWO DARK SKINS ARE TWO PAPERS EACH. Slate is the dark palette re-pointed cool and wears the
 * same `.stonetop-dark` rules, so a colour written for "dark" is painted on Slate's page too, and
 * `slate` holds that second set of grounds (a copy of the Slate blocks, held to them the same way).
 * A colour is measured on both, and the darker paper decides.
 */
export const TIMELINE_COLOUR_GROUNDS = Object.freeze({
	light:     Object.freeze({ page: "hsl(30deg 20% 98%)", panel: "hsl(30deg 20% 94%)", card: "rgba(0, 0, 0, 0.03)", cardWash: 0.05, chipWash: 0.14, floor: 4.5 }),
	dark:      Object.freeze({ page: "#1d1915", panel: "#27221d", card: "rgba(235, 228, 214, 0.035)", cardWash: 0.05, chipWash: 0.14, floor: 4.5,
		slate: Object.freeze({ page: "#1a1d21", panel: "#23272c", card: "rgba(230, 233, 238, 0.035)" }) }),
	lightHigh: Object.freeze({ page: "#fff", panel: "hsl(0deg 0% 97%)", card: "transparent", cardWash: 0, chipWash: 0, floor: 7 }),
	darkHigh:  Object.freeze({ page: "#141210", panel: "#1c1915", card: "transparent", cardWash: 0, chipWash: 0, floor: 7,
		slate: Object.freeze({ page: "#111315", panel: "#181b1f", card: "transparent" }) }),
});

/** The selector each skin's overrides are written under. Weights rise in this order on purpose. */
const MODE_SELECTOR = Object.freeze({
	light:     ":root",
	dark:      ":root.stonetop-dark",
	lightHigh: ":root.stonetop-high-contrast",
	darkHigh:  ":root.stonetop-dark.stonetop-high-contrast",
});

/** The id of the <style> a world's colours are written into. */
export const TIMELINE_COLOURS_STYLE_ID = "stonetop-timeline-kind-colours";

/**
 * Which of the four skins this page is painted in, read off the classes
 * settings.js#applySheetContrast puts on the root. What the GM's colour window previews in.
 */
export function currentColourMode(doc = globalThis.document) {
	const dark = isDarkPalette(doc?.documentElement);
	const high = !!doc?.documentElement?.classList?.contains?.("stonetop-high-contrast");
	if (dark) return high ? "darkHigh" : "dark";
	return high ? "lightHigh" : "light";
}

/** The stylesheet token a kind's colour is read from. */
export function kindToken(kind) {
	return `--st-timeline-kind-${kind}`;
}

/* ── The arithmetic ─────────────────────────────────────────────────────── */

/** `rgba(r, g, b, a)` (or anything relmap-ink can parse, or "transparent") as `{rgb, alpha}`. */
function layer(value) {
	const said = String(value ?? "").trim().toLowerCase();
	if (said === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
	const rgba = said.match(/^rgba?\(([^)]+)\)$/);
	if (rgba) {
		const [r, g, b, a = "1"] = rgba[1].split(/[\s,/]+/).filter(Boolean);
		return { rgb: [r, g, b].map(Number), alpha: Number(a) };
	}
	const rgb = parseColour(said);
	return rgb ? { rgb, alpha: 1 } : null;
}

/** `top` laid over `under` at `alpha`. */
function over(top, under, alpha) {
	return under.map((value, i) => top[i] * alpha + value * (1 - alpha));
}

/**
 * Every tone a kind's marks sit on in one skin: the page, the panel, a card on the panel, and --
 * where the skin washes -- the card and the chip tinted with the kind's OWN colour. That last pair
 * moves with the colour, which is why a colour is measured against grounds built for it.
 *
 * @param {string} mode    one of TIMELINE_COLOUR_MODES.
 * @param {number[]} [rgb] the kind's colour; without it the washes are left out.
 * @returns {Array<number[]>}
 */
export function kindGrounds(mode, rgb = null) {
	const g = TIMELINE_COLOUR_GROUNDS[mode];
	const grounds = [];
	for (const { page, panel, card } of paperGrounds(mode)) {
		grounds.push(page, panel, card);
		if (rgb && g.cardWash) {
			const washed = over(rgb, card, g.cardWash);
			grounds.push(washed, over(rgb, washed, g.chipWash));
		}
	}
	return grounds;
}

/** Each paper's page, panel and card as rgb, per skin. Constant, so parsed once. */
const PAPER_GROUNDS = new Map();

function paperGrounds(mode) {
	let papers = PAPER_GROUNDS.get(mode);
	if (!papers) {
		const g = TIMELINE_COLOUR_GROUNDS[mode];
		papers = (g.slate ? [g, g.slate] : [g]).map(paper => {
			const panel = parseColour(paper.panel);
			const fill = layer(paper.card);
			return { page: parseColour(paper.page), panel, card: over(fill.rgb, panel, fill.alpha) };
		});
		PAPER_GROUNDS.set(mode, papers);
	}
	return papers;
}

/** The worst contrast a colour makes on any ground of one skin. */
export function worstContrast(hex, mode) {
	const rgb = parseColour(normalizeHex(hex));
	if (!rgb) return 0;
	return Math.min(...kindGrounds(mode, rgb).map(ground => contrast(rgb, ground)));
}

/**
 * One chosen colour, made readable on one skin.
 *
 * Walked along its own hue by `deepenInk`, toward whichever end of the scale gains contrast on that
 * skin's paper: darker on parchment and white, lighter on the two dark pages. Measured again after
 * each walk, because the chip's tint is made OF the colour and moves when it does; a handful of
 * passes settles it.
 *
 * @returns {{hex: string, nudged: boolean, ratio: number}}  `hex` is "" for a value that is not a
 *          colour at all -- a refusal the caller must handle.
 */
export function readableKindColour(hex, mode) {
	let current = normalizeHex(hex);
	if (!current) return { hex: "", nudged: false, ratio: 0 };
	const floor = TIMELINE_COLOUR_GROUNDS[mode].floor;
	let nudged = false;
	for (let pass = 0; pass < 4; pass++) {
		const step = deepenInk(current, { grounds: kindGrounds(mode, parseColour(current)), floor });
		if (!step.nudged || !step.hex || step.hex === current) break;
		current = step.hex;
		nudged = true;
	}
	return { hex: current, nudged, ratio: worstContrast(current, mode) };
}

/** kindColourSet's answers by hex. A pure function of the colour, and a dear one. */
const COLOUR_SET_CACHE = new Map();

/**
 * One chosen colour as the four it is painted in.
 *
 * ⚠ CACHED BY HEX, AND FROZEN SO THE CACHE CANNOT BE WRITTEN THROUGH. Each answer is up to four
 * `deepenInk` walks per skin, thousands of contrast checks, and it is asked for per tagged card on
 * every repaint and per `input` event while the GM drags a picker.
 *
 * @returns {Readonly<Record<string, {hex: string, nudged: boolean, ratio: number}>>|null}  keyed by
 *          mode; null for a value that is not a colour.
 */
export function kindColourSet(hex) {
	const key = normalizeHex(hex);
	if (!key) return null;
	let set = COLOUR_SET_CACHE.get(key);
	if (!set) {
		set = Object.freeze(Object.fromEntries(
			TIMELINE_COLOUR_MODES.map(mode => [mode, Object.freeze(readableKindColour(key, mode))]),
		));
		COLOUR_SET_CACHE.set(key, set);
	}
	return set;
}

/* ── The world's choices ────────────────────────────────────────────────── */

/**
 * The stored setting, cleaned: known kinds only, each a `#rrggbb`. Anything else is dropped, never
 * guessed at -- what comes out of here is written into a <style>, so this is the gate between a
 * value in the world's data and the page's CSS.
 *
 * @returns {Record<string, string>}  only the kinds a GM has repainted.
 */
export function normalizeKindColours(raw) {
	const out = {};
	if (!raw || typeof raw !== "object") return out;
	for (const kind of TIMELINE_COLOUR_KINDS) {
		const hex = normalizeHex(raw[kind]);
		if (hex) out[kind] = hex;
	}
	return out;
}

/**
 * The CSS that paints a world's repainted kinds, one rule per skin. "" when nothing is repainted.
 *
 * ⚠ ALL FOUR SKINS ARE WRITTEN FOR EVERY OVERRIDE. In Foundry the system stylesheet sits in a
 * cascade LAYER and this <style> does not, so a bare `:root` rule here would beat the stylesheet's
 * heavier `:root.stonetop-dark` default and put the light colour on the dark page. Writing every
 * skin keeps the contest inside this sheet, where the selectors' weights decide it.
 */
export function kindColoursCss(raw) {
	const chosen = normalizeKindColours(raw);
	const kinds = Object.keys(chosen);
	if (!kinds.length) return "";
	const sets = Object.fromEntries(kinds.map(kind => [kind, kindColourSet(chosen[kind])]));
	return TIMELINE_COLOUR_MODES.map(mode => {
		const lines = kinds.map(kind => `\t${kindToken(kind)}: ${sets[kind][mode].hex};`);
		return `${MODE_SELECTOR[mode]} {\n${lines.join("\n")}\n}`;
	}).join("\n");
}

/**
 * Paint a world's repainted kinds onto this page: one <style> at the end of <head>, rewritten
 * whole, and removed when nothing is repainted.
 *
 * Called on ready and from the setting's onChange, which Foundry fires on EVERY client for a world
 * setting, so the whole table sees a GM's colour the moment it is saved, with no re-render.
 */
export function applyTimelineKindColours(raw, doc = globalThis.document) {
	if (!doc?.head) return;
	const css = kindColoursCss(raw);
	let style = doc.getElementById(TIMELINE_COLOURS_STYLE_ID);
	if (!css) {
		style?.remove();
		return;
	}
	if (!style) {
		style = doc.createElement("style");
		style.id = TIMELINE_COLOURS_STYLE_ID;
	}
	style.textContent = css;
	// Re-appended every time so it stays LAST in <head>, after anything loaded since it was made.
	doc.head.appendChild(style);
}
