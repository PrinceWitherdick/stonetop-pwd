/**
 * Colour arithmetic for the accessibility guards.
 *
 * The high-contrast palette is a list of promises written in a stylesheet ("10.86:1, from 3.53:1"),
 * and a promise about a contrast ratio is the kind that rots silently: somebody nudges a hex two
 * digits to warm it up, the comment beside it still says 7.57:1, and nothing anywhere fails. The
 * guards in tests/styles/high-contrast.test.js re-derive every one of those numbers from the values
 * actually in the file, which needs real WCAG arithmetic, and there was none in the repo.
 *
 * WCAG 2.x relative luminance and contrast, exactly as the spec states them:
 *   https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *   https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 *
 * The parser covers the notations this stylesheet actually writes and nothing more: hex in 3, 6 and
 * 8 digits, `rgb()`/`rgba()`, `hsl()`/`hsla()` in both the comma and the space-with-slash forms,
 * `hsl(30deg …)` with the unit spelled out (which is how the paper token is written), and the
 * named colours it uses. Anything else returns null rather than a guess, and the callers assert on
 * that — a guard that silently skipped the one value somebody broke would be worse than no guard.
 *
 * ALPHA IS COMPOSITED, NOT IGNORED. Several of the values under test are washes
 * (`rgba(0, 0, 0, 0.55)` for a card's edge), and their contrast is a property of what they are laid
 * over, so `parseColor` returns the alpha and `over()` does the compositing. Treating a 55% black as
 * black would have passed a hairline that is actually 4.76:1 as though it were 21:1.
 */

/**
 * The named colours this stylesheet uses. Both spellings of slate are here on purpose: CSS treats
 * them as one colour, and a name missing from this table is not an error anyone sees — `parseColor`
 * answers `null`, which the token sweep reads as "not a colour, skip it", so the value simply drops
 * out of the ratio checks. Cheaper to carry the second spelling than to lose a guard to it.
 */
const NAMED = {
	white: [255, 255, 255],
	black: [0, 0, 0],
	slategrey: [112, 128, 144],
	slategray: [112, 128, 144],
};

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

/** A number that may be written as a percentage, as its 0..1 or 0..`scale` value. */
function num(token, scale = 1) {
	const raw = String(token).trim();
	if (raw.endsWith("%")) return (parseFloat(raw) / 100) * scale;
	return parseFloat(raw);
}

/**
 * A CSS colour as `{ rgb: [r, g, b], alpha }`, or null if this notation is not one we parse.
 *
 * `transparent` parses as black at alpha 0 rather than as null: it is a real value the stylesheet
 * sets (the high-contrast card fill), and composited over anything it correctly disappears.
 */
export function parseColor(value) {
	if (value == null) return null;
	const raw = String(value).trim().toLowerCase();
	if (!raw) return null;
	if (raw === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
	if (NAMED[raw]) return { rgb: NAMED[raw].slice(), alpha: 1 };

	if (raw.startsWith("#")) {
		let hex = raw.slice(1);
		if (hex.length === 3 || hex.length === 4) hex = hex.split("").map(c => c + c).join("");
		if (hex.length !== 6 && hex.length !== 8) return null;
		if (!/^[0-9a-f]+$/.test(hex)) return null;
		const part = i => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		return { rgb: [part(0), part(1), part(2)], alpha: hex.length === 8 ? part(3) / 255 : 1 };
	}

	const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(raw);
	if (!fn) return null;
	// Both the legacy `a, b, c, d` and the modern `a b c / d` forms, in one split.
	const parts = fn[2].split(/[,/]|\s+/).map(s => s.trim()).filter(Boolean);
	if (parts.length < 3) return null;
	const alpha = parts.length > 3 ? num(parts[3]) : 1;
	if (!Number.isFinite(alpha)) return null;

	if (fn[1].startsWith("rgb")) {
		const rgb = parts.slice(0, 3).map(p => num(p, 255));
		if (rgb.some(c => !Number.isFinite(c))) return null;
		return { rgb, alpha };
	}
	const h = parseFloat(parts[0].replace(/deg$/, ""));
	const s = num(parts[1]);
	const l = num(parts[2]);
	if (![h, s, l].every(Number.isFinite)) return null;
	return { rgb: hslToRgb(h, s, l), alpha };
}

/** `colour` composited over `backdrop`, both as parsed colours; returns an opaque rgb triple. */
function over(colour, backdrop) {
	const a = colour.alpha;
	return colour.rgb.map((c, i) => a * c + (1 - a) * backdrop.rgb[i]);
}

/** WCAG relative luminance of an opaque rgb triple. */
function relativeLuminance(rgb) {
	const [r, g, b] = rgb.map(channel => {
		const c = channel / 255;
		return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The WCAG contrast ratio between two CSS colours, 1..21.
 *
 * A translucent foreground is composited over the background first, which is the only reading of
 * "the contrast of this hairline" that means anything. A translucent BACKGROUND is composited over
 * white, since that is the paper the high-contrast mode paints.
 *
 * Throws on a colour it cannot parse rather than returning a number: every caller is asserting a
 * threshold, and a silent 1:1 or 21:1 for a typo would either cry wolf or wave the typo through.
 */
export function contrastRatio(foreground, background) {
	const fg = parseColor(foreground);
	const bg = parseColor(background);
	if (!fg) throw new Error(`contrastRatio: cannot parse foreground "${foreground}"`);
	if (!bg) throw new Error(`contrastRatio: cannot parse background "${background}"`);
	const white = { rgb: [255, 255, 255], alpha: 1 };
	const ground = bg.alpha < 1 ? { rgb: over(bg, white), alpha: 1 } : bg;
	const ink = fg.alpha < 1 ? { rgb: over(fg, ground), alpha: 1 } : fg;
	const l1 = relativeLuminance(ink.rgb);
	const l2 = relativeLuminance(ground.rgb);
	return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The ratio rounded the way the stylesheet's comments write it, for a readable failure message. */
export function ratioText(foreground, background) {
	return `${contrastRatio(foreground, background).toFixed(2)}:1`;
}
