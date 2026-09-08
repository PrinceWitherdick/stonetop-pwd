// A colour a reader chose for one line, and the arithmetic that keeps it readable.
//
// WHY THERE ARE HEXES IN HERE AT ALL, when relmap-store.js says in as many words that a colour is
// never a value in stored data. The eight named inks are still the whole of what that rule is
// about: they are retuned by the stylesheet, raised under the high-contrast skin, and each carries
// a dash pattern, and none of that is possible for a value frozen into a world's flags. What this
// adds is the ninth answer -- "not one of those, THIS one" -- for the table that wants a particular
// purple and does not care that it is the ninth colour on the board.
//
// ⚠ AND IT IS THE ONE PLACE A COLOUR NOBODY VETTED REACHES THE BOARD, which is why the guard is
// here rather than in the window that offers it. There is a reader at this table on a screen
// magnifier: a line under 3:1 against the paper is a line they cannot follow, and the whole point
// of the board is which line goes where. So a chosen colour is DEEPENED along its own hue until it
// clears that bar, rather than refused -- the reader still gets their purple, and gets a readable
// one. `deepenInk` is that, and the tie bar says so when it has had to move a colour.
//
// WHAT THIS DOES NOT AND CANNOT DO is retune a stored hex the way the eight are retuned. A custom
// line sits at the ordinary 3:1 bar under the high-contrast skin, where its neighbours are raised
// to 4.5:1; the stylesheet darkens it further there with a `color-mix`, which helps and is not a
// promise, and the dash pattern reserved for custom lines is what actually carries the distinction
// under that skin. Said plainly because it is the real cost of the ninth colour.
//
// THE ARITHMETIC IS WCAG 2.x, exactly as stated:
//   https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
//   https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
// tests/fakes/contrast.js has the same sums and is NOT shared with this: that one parses every
// notation the whole stylesheet is written in, to sweep it. This parses the two this feature
// actually handles -- a hex from a colour input, and the `hsl()` the ink tokens are declared in --
// and answers null rather than guessing at anything else.

/**
 * The class fragment a line wearing a colour of its own is drawn with.
 *
 * NOT A NINTH INK KEY. It never appears in `RELMAP_INKS`, is never stored, and nothing chooses it:
 * it is what the renderer puts in the class when the stored ink turns out to be a hex, so that the
 * stylesheet has something to hang a dash pattern and the high-contrast darkening off. The colour
 * itself rides in `--relmap-ink-raw` on the element.
 */
export const RELMAP_INK_CUSTOM = "custom";

/**
 * The floor a line has to clear against the paper it is drawn on, as a GRAPHICAL OBJECT.
 *
 * Three and not four and a half, which is the bar for text: a stroke is not a letter, and 3:1 is
 * what WCAG asks of a thing whose shape carries the meaning. It is also exactly the bar the eight
 * named inks are held to by tests/styles/relationship-map-inks.test.js, so a custom line comes out
 * no weaker than the line beside it -- which is the whole reason not to pitch this higher.
 */
export const RELMAP_INK_FLOOR = 3;

/**
 * The two tones a board is drawn on, when there is no document to read them off.
 *
 * ⚠ A COPY OF THE STYLESHEET, and held to it by a test rather than by anybody remembering. Nothing
 * else in this file needs a hard-coded colour; these are here because the arithmetic has to work in
 * a context with no computed style to ask -- a test, or a call made before the sheet has landed --
 * and silently measuring against the wrong paper is worse than measuring against a stale copy that
 * something fails over.
 */
export const RELMAP_GROUND_FALLBACK = Object.freeze({
	page: "hsl(30deg 20% 98%)",
	panel: "hsl(30deg 20% 94%)",
});

/**
 * How many swatches the palette lays across, and it is not only the stylesheet's business.
 *
 * ⚠ IT IS ALSO THE ARROW KEYS. Up and Down in the palette step by a ROW, which is only a row if
 * this number is the number the grid is actually painted at -- and every block in the palette (the
 * eight, the forty, the row of the board's own colours) is laid out at the same width so that one
 * stride carries a reader down through all three. Wrong by one and Down walks diagonally, which is
 * the sort of thing that is never noticed by anybody using a mouse and is unusable without one.
 *
 * tests/styles/relationship-map-inks.test.js holds the stylesheet to this, because a grid rewritten
 * to five across would leave no other trace of having broken the keyboard.
 */
export const RELMAP_INK_ACROSS = 8;

/**
 * FORTY COLOURS LAID OUT TO BE AIMED AT, none of which is one of the eight.
 *
 * WHY A GRID OF HEXES SITS BESIDE A LIST OF KEYS, when relmap-store.js says a colour is never a
 * value in stored data. The eight named inks are the ones this system SHIPS: each is retuned by the
 * stylesheet under the high-contrast skin, each carries a dash pattern of its own, and a world's
 * boards follow them wherever they are retuned to. None of that is possible for a hex. What these
 * are is the ninth answer offered by the handful rather than one at a time -- a table that wants a
 * particular teal reaches it in one press instead of through the system colour dialog -- and every
 * one of them is stored, drawn and read as exactly what a colour typed into the picker is.
 *
 * ⚠ SO A PRESET IS A CUSTOM COLOUR, with everything that costs: the shared `custom` dash pattern
 * rather than one of its own, and the ordinary 3:1 bar under the high-contrast skin where the eight
 * are raised to 4.5:1. The eight are still the better answer for a board read at the far end of that
 * table, which is why they stay first in the palette and stay the default.
 *
 * ⚠ AND EVERY ONE OF THEM ALREADY CLEARS THE FLOOR, which is the whole reason they are frozen hexes
 * here rather than the colours they were drawn from. They follow the shape of a picker the table
 * asked for, whose pale tints and whites belong to a tool that paints on any ground; this board is
 * near-white parchment, and against it a pastel is not a faint line, it is no line. So each hue was
 * walked down to the PALEST tone of itself that still clears 3:1, and then to a deeper one beneath
 * it, by the arithmetic `deepenInk` uses. A swatch here shows the colour that lands on the board,
 * and picking one raises no "too pale to follow" notice, because there is nothing left to deepen.
 * tests/relmap/relmap-ink.test.js measures all forty against both grounds.
 *
 * ⚠ AND THEY KEEP CLEAR OF THE EIGHT, which is why the hues are not the even wheel they look like.
 * The eight are themselves near the palest legal tone of eight hues, so an evenly spaced sixteen
 * lands three or four of them almost exactly on top of one -- and a preset that is the same colour
 * as a named ink is a trap: it looks identical in the palette and draws a WORSE line, with no dash
 * pattern of its own and no retuning under the high-contrast skin. The hues were nudged off them
 * until every preset stands clear of all eight, at the cost of a wheel that is a little uneven in
 * the pinks. The same test holds that distance, in both directions.
 *
 * ⚠ THE `key` IS A NAME AND NEVER AN ANSWER. What a line stores when one of these is pressed is
 * the HEX, exactly as if it had been typed into the picker; the key exists so that the swatch has
 * something to be CALLED. That matters more here than anywhere else in this feature: the words were
 * taken off the discs to make a palette that reads as a grid, so a swatch's tooltip and its spoken
 * label are now the whole of what a reader who chooses by reading has, and "#0c6d78" is not a name.
 * Nothing sanitises, stores, migrates or compares these keys -- drop one and a colour loses its
 * name; drop a HEX and every line already drawn in it loses the swatch that finds it again.
 *
 * THE ORDER IS THE GRID, read left to right, eight across:
 *   rows 1-2  sixteen hues of the blue-through-red half of the wheel, vivid then deep
 *   rows 3-4  sixteen hues of the red-through-teal half, vivid then deep
 *   row 5     the earths and the neutrals, tan through to near-black
 * Each hue's two tones sit one above the other, so a column is one colour's range and a row is the
 * spectrum at one weight. Nothing READS this structure -- the stylesheet decides the width -- but
 * reordering without keeping it is how a palette turns back into a bag of colours.
 */
export const RELMAP_INK_PRESETS = Object.freeze([
	{ key: "teal", hex: "#119795" }, { key: "azure", hex: "#2295bf" },
	{ key: "cornflower", hex: "#5489d9" }, { key: "periwinkle", hex: "#7c80de" },
	{ key: "violet", hex: "#ac6ed8" }, { key: "orchid", hex: "#da4bdd" },
	{ key: "magenta", hex: "#e24bc6" }, { key: "fuchsia", hex: "#e354ac" },

	{ key: "tealDeep", hex: "#0c6d6b" }, { key: "azureDeep", hex: "#186b89" },
	{ key: "cornflowerDeep", hex: "#275eb2" }, { key: "periwinkleDeep", hex: "#3237c8" },
	{ key: "violetDeep", hex: "#8131ba" }, { key: "orchidDeep", hex: "#b022b3" },
	{ key: "magentaDeep", hex: "#ba1e9e" }, { key: "fuchsiaDeep", hex: "#c11f83" },

	{ key: "cerise", hex: "#e8596e" }, { key: "vermilion", hex: "#ee574f" },
	{ key: "orange", hex: "#ea5d2e" }, { key: "amber", hex: "#ad831f" },
	{ key: "citron", hex: "#6e9220" }, { key: "leaf", hex: "#359d25" },
	{ key: "fern", hex: "#1ca03b" }, { key: "jade", hex: "#109e6e" },

	{ key: "ceriseDeep", hex: "#cc1c36" }, { key: "vermilionDeep", hex: "#cf1e14" },
	{ key: "orangeDeep", hex: "#b83c12" }, { key: "amberDeep", hex: "#7d5e16" },
	{ key: "citronDeep", hex: "#4f6917" }, { key: "leafDeep", hex: "#26711b" },
	{ key: "fernDeep", hex: "#14732b" }, { key: "jadeDeep", hex: "#0b724f" },

	{ key: "tan", hex: "#876a45" }, { key: "bronze", hex: "#825435" },
	{ key: "umber", hex: "#634236" }, { key: "olive", hex: "#4e6237" },
	{ key: "sage", hex: "#496557" }, { key: "steel", hex: "#50667c" },
	{ key: "charcoal", hex: "#3a404a" }, { key: "soot", hex: "#1c1e22" },
]);

/** A colour input hands back `#rrggbb`, and this is the only shape that may reach a style attribute. */
const HEX6 = /^#[0-9a-f]{6}$/;
const HEX3 = /^#[0-9a-f]{3}$/;

/**
 * One colour as `#rrggbb`, or "" for anything this does not recognise as one.
 *
 * ⚠ THE EMPTY STRING IS A REFUSAL AND CALLERS MUST TREAT IT AS ONE. What comes out of here is
 * written into a `style` attribute on the board, so this is the gate between a value somebody
 * typed and markup -- and a lenient parser here is the whole of what a lenient parser here would
 * cost. Three-digit hexes are expanded because a reader typing into the picker's text field writes
 * them; everything else is refused rather than guessed at.
 */
export function normalizeHex(value) {
	const said = String(value ?? "").trim().toLowerCase();
	if (HEX6.test(said)) return said;
	if (HEX3.test(said)) return `#${said[1]}${said[1]}${said[2]}${said[2]}${said[3]}${said[3]}`;
	return "";
}

/* ── The arithmetic ─────────────────────────────────────────────────────── */

/** hsl -> rgb, per CSS Color 4. Hue in degrees, saturation and lightness as 0..1. */
function hslToRgb(h, s, l) {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = (((h % 360) + 360) % 360) / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	const [r, g, b] = hp < 1 ? [c, x, 0]
		: hp < 2 ? [x, c, 0]
		: hp < 3 ? [0, c, x]
		: hp < 4 ? [0, x, c]
		: hp < 5 ? [x, 0, c]
		: [c, 0, x];
	const m = l - c / 2;
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** rgb -> hsl, with hue in degrees and the other two as 0..1. */
function rgbToHsl([r, g, b]) {
	const [rr, gg, bb] = [r / 255, g / 255, b / 255];
	const max = Math.max(rr, gg, bb);
	const min = Math.min(rr, gg, bb);
	const l = (max + min) / 2;
	const d = max - min;
	if (!d) return [0, 0, l];
	const s = d / (1 - Math.abs(2 * l - 1));
	const h = max === rr ? 60 * (((gg - bb) / d) % 6)
		: max === gg ? 60 * (((bb - rr) / d) + 2)
		: 60 * (((rr - gg) / d) + 4);
	return [((h % 360) + 360) % 360, s, l];
}

/** A number that may be written as a percentage, as its 0..1 value. */
function num(token) {
	const raw = String(token).trim();
	return raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
}

/**
 * One CSS colour as `[r, g, b]`, or null.
 *
 * The two notations this feature meets and no others: a hex, which is what a colour input hands
 * back, and `hsl()` in the space-separated form with the unit spelled out, which is how every ink
 * token in the stylesheet is declared and therefore what `getComputedStyle` gives back for one.
 */
export function parseColour(value) {
	const said = String(value ?? "").trim().toLowerCase();
	const hex = normalizeHex(said);
	if (hex) {
		return [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
	}
	const hsl = said.match(/^hsla?\(([^)]+)\)$/);
	if (!hsl) return null;
	const parts = hsl[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
	if (parts.length < 3) return null;
	const h = parseFloat(parts[0]);
	const s = num(parts[1]);
	const l = num(parts[2]);
	if ([h, s, l].some(n => !Number.isFinite(n))) return null;
	return hslToRgb(h, s, l);
}

/** WCAG relative luminance of an `[r, g, b]`. */
export function luminance([r, g, b]) {
	const lin = v => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast between two `[r, g, b]`, 1 to 21. */
export function contrast(a, b) {
	const [x, y] = [luminance(a), luminance(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `[r, g, b]` as `#rrggbb`. */
function rgbToHex(rgb) {
	return `#${rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/* ── The guard ──────────────────────────────────────────────────────────── */

/**
 * The two tones a board is actually painted on, read off the document.
 *
 * READ RATHER THAN ASSUMED, so this measures against the paper the reader is looking at -- which
 * moves under the high-contrast skin and under the flat-paper setting, and a guard measuring
 * against a remembered tone would be passing colours against a page nobody has.
 *
 * @param {HTMLElement} [root]  the element to read the custom properties off; the document root by
 *        default, which is where every one of them is declared.
 * @returns {Array<number[]>}  the grounds, as rgb triples. Never empty: a document that answers
 *          nothing falls back to the stylesheet's own two, so the guard cannot quietly go blind.
 */
export function boardGrounds(root = globalThis.document?.documentElement ?? null) {
	const read = name => {
		const said = root && globalThis.getComputedStyle
			? globalThis.getComputedStyle(root).getPropertyValue(name)
			: "";
		return parseColour(said);
	};
	const page = read("--st-page") ?? parseColour(RELMAP_GROUND_FALLBACK.page);
	const panel = read("--stonetop-bg") ?? parseColour(RELMAP_GROUND_FALLBACK.panel);
	return [page, panel];
}

/**
 * Take a colour somebody chose and hand back one that can be followed on this board.
 *
 * ⚠ DEEPENED ALONG ITS OWN HUE, NEVER REFUSED. A dialog that says "no" to a colour is a dialog
 * that has taken the choice away and given nothing back; what a reader wants when they pick a pale
 * yellow is a yellow line, and a yellow line is available -- it is simply darker than the one the
 * swatch showed. So the hue and the saturation are kept exactly and only the lightness is walked,
 * one step at a time, toward whichever end of the scale actually gains contrast against this paper
 * (black against the ordinary near-white page; white, were the board ever painted on a dark one).
 *
 * MEASURED AGAINST BOTH TONES, the page and the panel, because the strokes cross both and the
 * darker of the two is the one that decides. It is the same pair the eight named inks are held to.
 *
 * @param {string} hex  the colour as chosen.
 * @param {object} [opts]
 * @param {Array<number[]>} [opts.grounds]  the tones to measure against; read off the document by
 *        default. Passed in by the tests, and by anything measuring for a page it is not on.
 * @param {number} [opts.floor]  the ratio to clear.
 * @returns {{hex: string, nudged: boolean, ratio: number}}  the colour to use, whether it had to be
 *          moved to get there, and what it ended up measuring. An unparseable colour comes back as
 *          `{hex: "", nudged: false}` -- a refusal the caller has to handle, not a black line.
 */
export function deepenInk(hex, { grounds = boardGrounds(), floor = RELMAP_INK_FLOOR } = {}) {
	const start = normalizeHex(hex);
	const rgb = start ? parseColour(start) : null;
	if (!rgb) return { hex: "", nudged: false, ratio: 0 };

	const worst = colour => Math.min(...grounds.map(ground => contrast(colour, ground)));
	const was = worst(rgb);
	if (was >= floor) return { hex: start, nudged: false, ratio: was };

	// WHICH WAY IS DOWNHILL, asked of the paper rather than assumed. Against the near-white page
	// this board is painted on the answer is always "darker", but a board on a dark ground would
	// need the opposite and a hard-coded direction would walk every colour the wrong way for a
	// hundred steps and hand back the least readable one it saw.
	const [h, s, l] = rgbToHsl(rgb);
	const toBlack = worst(hslToRgb(h, s, 0));
	const toWhite = worst(hslToRgb(h, s, 1));
	const step = toBlack >= toWhite ? -0.01 : 0.01;

	let best = rgb;
	let ratio = was;
	for (let at = l + step; at >= 0 && at <= 1; at += step) {
		best = hslToRgb(h, s, at);
		ratio = worst(best);
		if (ratio >= floor) break;
	}
	return { hex: rgbToHex(best), nudged: true, ratio };
}

/**
 * What one of the eight named inks resolves to right now, as a hex.
 *
 * ⚠ ONLY EVER TO SEED THE PICKER, and never to store or to paint with. A reader who opens the
 * colour picker on a line that is currently rose has to start FROM rose -- a picker that opened on
 * black would be asking them to find their way back to where they already were. What the line is
 * painted with stays the token, right up until they choose something else.
 *
 * @returns {string}  the hex, or "" where the token cannot be read (no document, no stylesheet).
 */
export function resolveInkHex(key, root = globalThis.document?.documentElement ?? null) {
	if (!root || !globalThis.getComputedStyle) return "";
	const said = globalThis.getComputedStyle(root).getPropertyValue(`--st-relmap-ink-${key}`);
	const rgb = parseColour(said);
	return rgb ? rgbToHex(rgb) : "";
}

/**
 * How one stored ink is DRAWN: which class the element wears, and what colour rides on it.
 *
 * In one place because the board paints an ink in two element families -- the stroke and the
 * arrowheads on its ends -- and a line whose head is a different colour from its own body is
 * exactly the kind of wrong that only shows up on the lines that happen to have heads.
 *
 * @returns {{inkKey: string, inkHex: string}}  the class fragment, and the colour to write inline
 *          for a custom line ("" for one of the eight, whose colour is the stylesheet's).
 */
export function inkPaint(ink) {
	const hex = normalizeHex(ink);
	return hex ? { inkKey: RELMAP_INK_CUSTOM, inkHex: hex } : { inkKey: ink, inkHex: "" };
}
