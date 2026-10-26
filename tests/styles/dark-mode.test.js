import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { declarations, readCss, readRepo, repoFileExists, ownRule } from "../fakes/css.js";
import { fakeEl } from "../fakes/dom.js";
import { contrastRatio, parseColor, ratioText } from "../fakes/contrast.js";
import { applySheetContrast, watchFoundryTheme } from "../../module/settings.js";

/**
 * The dark ("Lamplit") palette, checked against the arithmetic it claims.
 *
 * Same discipline as tests/styles/high-contrast.test.js: nothing here reads the ratios written in
 * the stylesheet's comments. Every one is re-derived from the values in the file, so a hex warmed
 * to taste until it no longer clears its bar fails here rather than in front of a reader.
 *
 * The bars:
 *   · Dark: 4.5:1 for text (WCAG AA) on the LIGHTER of the page and the panel, since here the
 *     panels are the raised, lighter surface; 3:1 for a boundary.
 *   · Dark + High Contrast: 7:1 (AAA) on the page, the panel AND the painted grain at both of its
 *     extremes, and no ink brighter than ~0.9 relative luminance nor any page darker than ~0.004,
 *     because pure white on pure black is the halation a dark palette exists to avoid.
 *   · The dead: 4.5:1 on their neutral black, and the ink genuinely neutral, which is the whole of
 *     what "colder" means once "darker" alone turns out to be a 1.1:1 difference.
 */

const CSS = readCss();
const DARK = ":root.stonetop-dark";
const DARK_HC = ":root.stonetop-dark.stonetop-high-contrast";
const HIGH = ":root.stonetop-high-contrast";
const FLAT = ":root.stonetop-no-texture";
const SLATE = ":root.stonetop-dark.stonetop-slate";
const SLATE_HC = ":root.stonetop-dark.stonetop-slate.stonetop-high-contrast";

/** Every `--custom-property: value` a rule body declares, as a Map. */
function customProperties(body) {
	const out = new Map();
	if (!body) return out;
	for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out.set(m[1].trim(), m[2].trim());
	return out;
}

const D = customProperties(ownRule(CSS, DARK));
const DH = customProperties(ownRule(CSS, DARK_HC));
const HC = customProperties(ownRule(CSS, HIGH));
const S = customProperties(ownRule(CSS, SLATE));
const SH = customProperties(ownRule(CSS, SLATE_HC));

/** The dark section: from its first rule to the accessibility block's no-texture rule. */
const SECTION = CSS.slice(CSS.indexOf(`${DARK} {`), CSS.indexOf(FLAT));
const RULES = [...SECTION.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2]]);

/** Tokens read as TEXT, and tokens that are a boundary or a mark. */
const INK = name => /(^--st-text(-|$)|^--color-text-|-text$|-ink$|hyperlink)/.test(name);
const BOUNDARY = name => /(-border$|-rule$|^--color-border-)/.test(name);

const lum = value => {
	const { rgb } = parseColor(value);
	const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
	return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
};
const hex = rgb => "#" + rgb.map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");

/**
 * What the four surfaces actually paint: the grain inverted against white (`difference`), then the
 * tint SCREENED over it. sheet-bg.webp's mean pixel is rgb(251, 250, 250) and its darkest has
 * relative luminance 0.936 (about rgb(248, 248, 248)); "Paper Texture" off is a flat white sheet.
 */
const GRAIN = { mean: [251, 250, 250], darkest: [248, 248, 248], off: [255, 255, 255] };
function painted(tint, grain) {
	const t = parseColor(tint).rgb;
	return hex(t.map((c, i) => 255 - (255 - c) * (255 - (255 - grain[i])) / 255));
}

describe("the dark palette", () => {
	it("parses at all (guards every scan below)", () => {
		expect(D.size, "the dark block declares no custom properties").toBeGreaterThan(40);
		expect(DH.size, "the dark + high contrast block declares no custom properties").toBeGreaterThan(30);
		expect(D.get("--st-page")).toBeTruthy();
		expect(D.get("--stonetop-bg")).toBeTruthy();
		expect(RULES.length, "the dark section did not parse into rules").toBeGreaterThan(8);
	});

	// Before the accessibility block, whose tests treat everything from the no-texture rule to the
	// end as white paper, and whose "sits last" guard would otherwise have to make room for it.
	it("sits before the accessibility block, not inside it", () => {
		const at = CSS.indexOf(`${DARK} {`);
		expect(at).toBeGreaterThan(-1);
		expect(at, "the dark section moved after the no-texture rule").toBeLessThan(CSS.indexOf(FLAT));
		expect(CSS.indexOf(`${DARK_HC} {`)).toBeLessThan(CSS.indexOf(FLAT));
	});

	it("keeps the panel a step LIGHTER than the page, the raised-surface convention", () => {
		const page = D.get("--st-page"), panel = D.get("--stonetop-bg");
		expect(lum(panel)).toBeGreaterThan(lum(page));
		expect(contrastRatio(page, panel), "page and panel have become one colour").toBeGreaterThan(1.05);
		// And the page is a dark GREY, not black: the halation floor.
		expect(lum(page)).toBeGreaterThan(0.004);
	});

	it("gives every step of the ink ramp 4.5:1 on the lighter of page and panel", () => {
		const grounds = [D.get("--st-page"), D.get("--stonetop-bg")];
		for (const name of ["--st-text", "--st-text-body", "--st-text-secondary", "--st-text-muted", "--st-text-faint"]) {
			const ink = D.get(name);
			expect(ink, `${name} is not re-pointed, so it stays paper-dark on the dark page`).toBeTruthy();
			for (const g of grounds) {
				expect(contrastRatio(ink, g), `${name} (${ink}) is ${ratioText(ink, g)} on ${g}`)
					.toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("keeps the ramp a ramp, brightest first", () => {
		const steps = ["--st-text", "--st-text-body", "--st-text-secondary", "--st-text-muted", "--st-text-faint"]
			.map(name => lum(D.get(name)));
		for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
	});

	it("gives every ink it re-points 4.5:1 and every boundary 3:1", () => {
		const panel = D.get("--stonetop-bg");
		let checked = 0;
		for (const [name, value] of D) {
			if (!parseColor(value) || parseColor(value).alpha < 1) continue;
			const bar = INK(name) ? 4.5 : BOUNDARY(name) ? 3 : null;
			if (!bar || /^--st-btn-primary-border/.test(name)) continue;
			checked++;
			expect(contrastRatio(value, panel), `${name} (${value}) is ${ratioText(value, panel)}`)
				.toBeGreaterThanOrEqual(bar);
		}
		expect(checked, "the scan found no inks at all").toBeGreaterThan(15);
	});

	it("keeps the primary button's bone label readable on its near-black fill", () => {
		expect(contrastRatio(D.get("--st-btn-primary-text"), D.get("--st-btn-primary-bg"))).toBeGreaterThanOrEqual(7);
		expect(lum(D.get("--st-btn-primary-bg")), "the button is no longer darker than the page")
			.toBeLessThan(lum(D.get("--st-page")));
	});

	it("re-points core's colour names on the window roots and the chat cards, never at :root", () => {
		const stranded = [...D.keys()].filter(n => n.startsWith("--color-") && !/^--color-the-/.test(n));
		expect(stranded, "core names set on :root are shadowed by core's own element declarations").toEqual([]);
		const tier = RULES.filter(([sel, body]) => /--color-text-dark-primary\s*:/.test(body)
			&& /\.stonetop\b/.test(sel) && /#chat/.test(sel) && !/past-death/.test(sel));
		expect(tier.length, "no dark rule re-declares core's text colours on the roots and cards").toBeGreaterThanOrEqual(1);
		// Only the Stonetop cards: a plain message keeps core's parchment, and bone ink on it vanishes.
		for (const [sel] of tier) expect(sel).toMatch(/\.message:is\(:has\(/);
	});

	// Core inks the message header with a fixed #444, and a roll card is posted as the FLAVOR, which
	// core draws inside that header: speaker, time, trash can and the formula chip went near-black.
	it("re-inks the chat cards' header, and the card posted as its flavor, from the ramp", () => {
		const header = RULES.find(([sel]) => /#chat/.test(sel) && /\.message-header\s*$/.test(sel));
		expect(header, "the speaker and timestamp keep core's #444 on the dark paper").toBeTruthy();
		expect(header[1]).toMatch(/color:\s*var\(--st-text-secondary\)/);
		const flavor = RULES.find(([sel]) => /#chat/.test(sel) && /\.message-header \.flavor-text\s*$/.test(sel));
		expect(flavor, "a card in the flavor inherits the header's #444").toBeTruthy();
		expect(flavor[1]).toMatch(/color:\s*var\(--st-text-body\)/);
		// Zero weight, so the undead insert's own header ink still wins; only our cards, never a plain message.
		for (const [sel] of [header, flavor]) {
			expect(sel).toMatch(/^:where\(:root\.stonetop-dark\)/);
			expect(sel).toMatch(/\.message:is\(:has\(/);
		}
	});
});

describe("the lamplit paper", () => {
	const tint = D.get("--st-paper-tint");

	it("lands the painted grain on the page token", () => {
		expect(tint, "the dark block names no paper tint").toBeTruthy();
		const mean = painted(tint, GRAIN.mean);
		expect(contrastRatio(mean, D.get("--st-page")), `the grain paints ${mean}, not ${D.get("--st-page")}`)
			.toBeLessThan(1.05);
	});

	it("keeps the spirals faint: well under 1.2:1 across the grain, and with the grain off", () => {
		const [mean, darkest, off] = [GRAIN.mean, GRAIN.darkest, GRAIN.off].map(g => painted(tint, g));
		expect(contrastRatio(mean, darkest)).toBeLessThan(1.2);
		expect(contrastRatio(mean, off)).toBeLessThan(1.2);
	});

	it("keeps the whole ramp readable at both extremes of the grain", () => {
		for (const g of Object.values(GRAIN)) {
			const ground = painted(tint, g);
			for (const name of ["--st-text", "--st-text-muted", "--st-text-faint"]) {
				expect(contrastRatio(D.get(name), ground)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	// The four surfaces the light paper is painted on, each restated behind a zero-weight :where()
	// so a surface that already out-specifies it (a love letter, a dead character's black) keeps
	// its own look.
	it("repaints every surface the grain is painted on, and adds no weight doing it", () => {
		const paints = RULES.filter(([, body]) => /#fff\s+var\(--st-inverted-paper\)/.test(body));
		const selectors = paints.map(([sel]) => sel).join("\n");
		for (const surface of [/\.stonetop:not\(/, /\.stonetop-themed \.window-content/,
			/\.message:has\(\.stonetop-roll-card\)/, /\.message:has\(\.stonetop-dying-card\)/]) {
			expect(selectors, `${surface.source} keeps the white paper in dark mode`).toMatch(surface);
		}
		for (const [sel, body] of paints) {
			for (const one of sel.split(/,(?![^(]*\))/)) {
				expect(one.trim(), "a paint rule weighs more than the rule it replaces").toMatch(/^:where\(:root\.stonetop-dark\)/);
			}
			expect(body, "the blend list no longer matches the layers").toMatch(/background-blend-mode:[^;]*screen,\s*difference;/);
		}
	});

	// Paper Texture Transparency reaches the dark papers too: the wash on top, unblended, one blend
	// mode per layer.
	it("lays the Paper Texture Transparency wash over the lamplit grain", () => {
		const paints = RULES.filter(([, body]) => /#fff\s+var\(--st-inverted-paper\)/.test(body));
		for (const [sel, body] of paints) {
			expect(body, `${sel} leaves the transparency slider out`).toMatch(/var\(--st-paper-veil-layer\),\s*linear-gradient\(var\(--st-paper-tint\)/);
			const background = /background:([^;]*);/.exec(body)[1];
			// Top-level commas only: the layers' own functions nest theirs.
			let depth = 0;
			let layers = 1;
			for (const ch of background) {
				if (ch === "(") depth++;
				else if (ch === ")") depth--;
				else if (ch === "," && depth === 0) layers++;
			}
			const modes = /background-blend-mode:([^;]*);/.exec(body)[1].split(",").length;
			expect(modes, `${sel}: one blend mode per layer`).toBe(layers);
		}
	});

	it("never touches the grain tokens, which answer to Paper Texture alone", () => {
		for (const map of [D, DH]) {
			expect(map.has("--stonetop-bg-texture")).toBe(false);
			expect(map.has("--st-inverted-paper")).toBe(false);
		}
	});
});

describe("the art", () => {
	const ICONS = {
		"--stonetop-spiral-icon": "steading/check-spiral-light.svg",
		"--stonetop-question-spiral-icon": "steading/question-spiral-light.svg",
		"--stonetop-checkbox-icon": "steading/checkbox-light.svg",
		"--stonetop-checkbox-checked-icon": "steading/checkbox-checked-light.svg",
		"--stonetop-checkbox-partial-icon": "steading/checkbox-partial-light.svg",
		"--stonetop-diamond-icon": "playbooks/diamond-light.svg",
		"--stonetop-diamond-selected-icon": "playbooks/diamond_selected-light.svg",
		"--stonetop-playbook-arrow-icon": "playbooks/arrow_icon-light.svg",
		"--stonetop-blood-icon": "playbooks/blood-light.svg",
		"--stonetop-blood-filled-icon": "playbooks/blood-filled-light.svg",
		"--stonetop-blood-dotted-icon": "playbooks/blood-dotted-light.svg",
	};

	it("swaps every piece of fixed near-black art for a twin that exists", () => {
		for (const [token, file] of Object.entries(ICONS)) {
			expect(D.get(token), `${token} is not swapped, so it paints black on the dark page`).toContain(file);
			expect(repoFileExists(`assets/icons/${file}`), `${file} is missing`).toBe(true);
		}
	});

	// A twin is a recolour and nothing else: same path, same viewBox, so anything using the art as a
	// MASK is unaffected by which file it reads.
	it("makes each twin a recolour of its original and nothing more", () => {
		for (const file of Object.values(ICONS)) {
			const twin = readRepo(`assets/icons/${file}`);
			const original = readRepo(`assets/icons/${file.replace("-light.svg", ".svg")}`);
			const shape = svg => svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<title>[^<]*<\/title>/g, "")
				.replace(/(fill|stroke)="#[0-9a-f]{3,6}"/gi, "$1=\"X\"").replace(/\s+/g, " ").trim();
			expect(shape(twin), `${file} is not a recolour of its original`).toBe(shape(original));
		}
	});

	it("paints the blood marks at 3:1 or better on the dark page", () => {
		const page = D.get("--st-page");
		for (const file of ["blood-light.svg", "blood-filled-light.svg"]) {
			const fill = /(?:fill|stroke)="(#[0-9a-f]{6})"/i.exec(readRepo(`assets/icons/playbooks/${file}`))[1];
			expect(contrastRatio(fill, page), `${file} is ${ratioText(fill, page)}`).toBeGreaterThanOrEqual(3);
		}
	});

	// A background that spells one of these urls out again is a mark the swap cannot reach.
	it("leaves no background painting the art from a literal url", () => {
		const literal = /^\s*background(-image)?\s*:[^;]*url\(['"]?[^)'"]*\/(checkbox|checkbox-checked|question-spiral|arrow_icon)\.svg/gm;
		expect([...CSS.matchAll(literal)].map(m => m[0].trim())).toEqual([]);
	});

	// The two panels that were ALWAYS dark invert the ink spiral with a filter; the swap would hand
	// them bone, which the filter turns back to black. They are pinned to the ink original.
	it("keeps the always-dark panels on the ink spiral their filter inverts", () => {
		const pin = RULES.find(([sel]) => /stonetop-basic-move-panel/.test(sel) && /stonetop-rel-value/.test(sel));
		expect(pin, "the pin for the always-dark panels is gone").toBeTruthy();
		expect(pin[1]).toMatch(/--stonetop-spiral-icon:\s*url\([^)]*check-spiral\.svg/);
	});
});

describe("the dead, darker and colder", () => {
	const rule = RULES.find(([sel]) => /stonetop-past-death/.test(sel));
	const dead = customProperties(rule?.[1]);
	const paper = "#0e0e0e";

	it("has its own rule, heavier than the past-death sheet's", () => {
		expect(rule, "the dark palette does not reach a dead character's sheet").toBeTruthy();
		expect(rule[0]).toMatch(/^:root\.stonetop-dark \.vtt \.stonetop\.app\.stonetop-past-death\.window-app \.window-content$/);
	});

	it("sits BELOW the lamplit page, and on neutral black", () => {
		expect(lum(dead.get("--st-page"))).toBeLessThan(lum(D.get("--st-page")));
		const { rgb } = parseColor(dead.get("--st-page"));
		expect(Math.max(...rgb) - Math.min(...rgb), "the dead page has picked up a hue").toBeLessThanOrEqual(2);
		// The lift every dead surface builds from comes DOWN in the dark palette.
		const base = customProperties(ownRule(CSS, ":root")).get("--st-black-lift")
			?? /--st-black-lift:\s*([^;]+);/.exec(CSS)[1];
		const alpha = v => Number(/,\s*([\d.]+)\)\s*$/.exec(v)[1]);
		expect(alpha(D.get("--st-black-lift"))).toBeLessThan(alpha(base));
	});

	it("reads its ink in neutral grey, not the living's bone, at 4.5:1 or better", () => {
		let checked = 0;
		for (const [name, value] of dead) {
			if (!INK(name) || !parseColor(value)) continue;
			checked++;
			const { rgb } = parseColor(value);
			expect(Math.max(...rgb) - Math.min(...rgb), `${name} (${value}) is warm, not cold`).toBeLessThanOrEqual(2);
			expect(contrastRatio(value, paper), `${name} (${value}) is ${ratioText(value, paper)}`).toBeGreaterThanOrEqual(4.5);
		}
		expect(checked).toBeGreaterThanOrEqual(6);
	});
});

describe("love letters and threat cards, on darker parchment", () => {
	const rule = RULES.find(([sel]) => /stonetop-love-letter/.test(sel) && /threat-card/.test(sel) && !/high-contrast/.test(sel));
	const tc = customProperties(rule?.[1]);

	it("darkens the shared --tc-* paper for both", () => {
		expect(rule, "the dark palette leaves the letters and threat cards on light paper").toBeTruthy();
		for (const name of ["--tc-paper", "--tc-paper-hi", "--tc-paper-lo", "--tc-ink", "--tc-ink-soft", "--tc-rule-hard"]) {
			expect(tc.has(name), `${name} is not re-pointed`).toBe(true);
		}
	});

	it("still reads as a separate sheet laid on the page", () => {
		expect(lum(tc.get("--tc-paper"))).toBeGreaterThan(lum(D.get("--st-page")));
		expect(contrastRatio(tc.get("--tc-paper"), D.get("--st-page"))).toBeGreaterThan(1.2);
		expect(contrastRatio(tc.get("--tc-rule-hard"), D.get("--st-page"))).toBeGreaterThanOrEqual(3);
	});

	it("keeps its ink readable on every stop of the paper", () => {
		for (const stop of ["--tc-paper", "--tc-paper-hi", "--tc-paper-lo"]) {
			expect(contrastRatio(tc.get("--tc-ink"), tc.get(stop))).toBeGreaterThanOrEqual(7);
			expect(contrastRatio(tc.get("--tc-ink-soft"), tc.get(stop))).toBeGreaterThanOrEqual(4.5);
		}
	});

	// The seal stays maroon; its label used to borrow the paper's highlight, which is now dark.
	it("keeps the seal's label light on the maroon", () => {
		const seal = /--ll-accent:\s*(#[0-9a-f]{6})/i.exec(CSS)[1];
		expect(tc.get("--ll-seal-text")).toBeTruthy();
		expect(contrastRatio(tc.get("--ll-seal-text"), seal)).toBeGreaterThanOrEqual(4.5);
		// And on paper nothing moved: the seal text IS the highlight there.
		expect(CSS).toMatch(/--ll-seal-text:\s*var\(--tc-paper-hi\)/);
		expect(CSS, "a seal label still reads the paper highlight directly").not.toMatch(/color:\s*var\(--tc-paper-hi\)/);
	});
});

describe("dark + high contrast", () => {
	const page = DH.get("--st-page"), panel = DH.get("--stonetop-bg");
	const grounds = () => [page, panel, ...Object.values(GRAIN).map(g => painted(DH.get("--st-paper-tint"), g))];

	// High contrast's own values are pitched for WHITE paper and come later in the file; any it
	// re-points that this block does not restate lands dark ink on the dark page.
	it("restates every token the high-contrast palette re-points", () => {
		const missing = [...HC.keys()].filter(name => !name.startsWith("--stonetop-fight-") && !DH.has(name));
		expect(missing, `left to high contrast's white-paper values: ${missing.join(", ")}`).toEqual([]);
	});

	it("gives every ink 7:1 on the page, the panel and both extremes of the grain", () => {
		let checked = 0;
		for (const [name, value] of DH) {
			if (!INK(name) || !parseColor(value)) continue;
			checked++;
			for (const g of grounds()) {
				expect(contrastRatio(value, g), `${name} (${value}) is ${ratioText(value, g)} on ${g}`)
					.toBeGreaterThanOrEqual(7);
			}
		}
		expect(checked).toBeGreaterThanOrEqual(15);
	});

	it("stops short of white on black, the halation case", () => {
		for (const [name, value] of DH) {
			if (!INK(name) || !parseColor(value)) continue;
			expect(lum(value), `${name} (${value}) is effectively white`).toBeLessThan(0.9);
		}
		expect(lum(page), "the page is effectively black").toBeGreaterThan(0.004);
	});

	it("outweighs both single-class palettes on the window roots and the letters", () => {
		// Core's names on the roots read the palette's tokens, so this block re-points them by
		// re-pointing those; a literal left on the roots rule would pin one palette's value.
		const roots = RULES.find(([sel, body]) => sel.startsWith(DARK) && !sel.startsWith(DARK_HC)
			&& /--color-text-dark-primary/.test(body) && /#chat/.test(sel));
		expect(roots, "the dark palette does not reach core's names on the roots").toBeTruthy();
		// High contrast's own roots rule ties with the plain dark line and comes later; without a
		// heavier line here, "dark-high" reads black ink on its dark page (1.1:1).
		expect(roots[0], "dark + high contrast leaves core's names at high contrast's black")
			.toContain(`${DARK_HC} :is(.app, .application, .window-app):is(.stonetop, .stonetop-themed)`);
		for (const [, value] of customProperties(roots[1])) {
			expect(value, "core's names on the roots pin a literal").toMatch(/^var\(--/);
		}
		for (const name of ["--st-text", "--st-text-emphatic", "--st-link-ink", "--st-rule-dark"]) {
			expect(DH.has(name), `${name} keeps the plain dark value in dark + high contrast`).toBe(true);
		}
		const letters = RULES.find(([sel]) => sel.startsWith(DARK_HC) && /threat-card/.test(sel));
		expect(letters, "the letters keep high contrast's paper-dark rules").toBeTruthy();
		for (const name of ["--tc-rule", "--tc-rule-hard", "--tc-ink-soft"]) expect(letters[1]).toContain(name);
		const ring = RULES.find(([sel]) => sel.startsWith(DARK_HC) && /focus-visible/.test(sel));
		expect(ring, "the focus ring stays high contrast's navy, under 2:1 here").toBeTruthy();
	});
});

// The first dialog migrated, after it was reported unreadable: bone ink on a 55% white wash,
// dark-brown date headings on the dark page, white search and filter boxes. A literal written for
// paper anywhere in its rules brings one of those back.
describe("the ledger window", () => {
	const RULE = /([^{}]+)\{([^{}]*)\}/g;
	const ledger = [...CSS.matchAll(RULE)]
		.filter(([, sel]) => /\.stonetop-ledger-(toolbar|search|sort|noun|delete-selected|date-header|entry)\b/.test(sel)
			&& !/\.stonetop-ledger-row-check|\.stonetop-ledger-edit-check|\.stonetop-ledger-select-all\b/.test(sel));

	it("paints no colour the dark palette cannot turn over", () => {
		expect(ledger.length, "the ledger's rules did not parse").toBeGreaterThan(8);
		for (const [, sel, body] of ledger) {
			expect(body, `${sel.trim()} paints a paper-only literal`)
				.not.toMatch(/#fff\b|#a02020|#2f2a24|rgba\(\s*(0|255)\s*,\s*(0|255)\s*,\s*(0|255)\s*,/i);
		}
	});

	it("lifts its red and its headings on the dark page", () => {
		const panel = D.get("--stonetop-bg");
		for (const name of ["--st-danger-ink", "--st-heading-ink"]) {
			expect(D.get(name), `${name} is not re-pointed`).toBeTruthy();
			expect(DH.get(name), `${name} is not restated for dark + high contrast`).toBeTruthy();
			expect(contrastRatio(D.get(name), panel)).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(DH.get(name), DH.get("--st-page"))).toBeGreaterThanOrEqual(7);
		}
	});
});

// The ~180 colours written for white paper that the palette could not reach when it shipped: near-
// black inks on the dark page (1.2:1 at worst), bone ink on white wells (1.26:1 on a solid one), and
// pale popups glaring off it. They read the ink and paper channels now, or a LIFT: a token declared
// only in the dark blocks and read with the old literal as its fallback, so paper paints the literal.
describe("the colours written for white paper", () => {
	const RULE = /([^{}]+)\{([^{}]*)\}/g;
	const SCOPED = /stonetop-dark|theme-dark|stonetop-high-contrast|past-death|^@|^from$|^to$|%$/;
	// Surfaces that are light ON PURPOSE, or always dark, so the scan cannot read them: art drawn for
	// white, a switch's thumb, the journey's chips standing on its map, and the death dialogs and
	// drips, whose pale ink sits on their own dark wash. And the timeline's layout strip, white and
	// slate in every palette with its own fixed slate ink.
	const KEPT = /stonetop-gm-diagram-img|stonetop-image-zoom-view|stonetop-toggle-thumb|stonetop-journey|deathsdoor-dialog|death-drip|stonetop-timeline-orient/;
	const stripVars = v => v.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, "");
	// hsl() too: the first pass read hex and rgba only, and some thirty pale hsl() hovers, chips and
	// selections sat out of its sight with bone ink on them, the Followers tab's among them.
	const literals = v => (stripVars(v).match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(white|black)\b/gi) || [])
		.filter(v => parseColor(v));
	const values = (body, prop) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))].map(m => m[1]);
	const GROUND = "background(?:-color|-image)?";
	const norm = sel => sel.replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " ");
	const paper = [...CSS.slice(0, CSS.indexOf(`${DARK} {`)).matchAll(RULE)]
		.map(([, sel, body]) => [sel.trim().replace(/\s+/g, " "), body])
		.filter(([sel]) => !SCOPED.test(sel) && !KEPT.test(sel));
	// A rule the dark section answers selector for selector (the Followers tab's washes, the undead
	// tag's lettering) is turned over there, so its paper literal is not a miss.
	const TURNED = new Set(RULES.flatMap(([sel]) => norm(sel).split(/,\s*/))
		.filter(s => s.startsWith(":where(:root.stonetop-dark) "))
		.map(s => s.slice(":where(:root.stonetop-dark) ".length)));
	const turned = sel => norm(sel).split(/,\s*/).every(s => TURNED.has(s));
	// An opaque literal ground pins the rule's paper in every palette, and its ink with it.
	const pinned = body => values(body, GROUND).some(v => literals(v).some(c => parseColor(c).alpha > 0.5));

	it("scanned the file at all", () => {
		expect(paper.length).toBeGreaterThan(3000);
	});

	// Whether or not the rule names a ground: a token fill turns dark with the page and a wash
	// lets it through, so a near-black ink is a miss on either. (The first pass skipped any rule
	// with a background at all, and a `transparent` pill kept its `color: #000`.)
	it("paints no near-black ink straight onto the page", () => {
		const offenders = paper.filter(([sel, body]) => !turned(sel) && !pinned(body)
			&& values(body, "color").some(v => literals(v).some(c => lum(c) < 0.2 && parseColor(c).alpha > 0.4)));
		expect(offenders.map(([sel]) => sel)).toEqual([]);
	});

	it("leaves no white well under ink the palette turns to bone", () => {
		const offenders = paper.filter(([sel, body]) => !turned(sel) && values(body, GROUND)
			.some(v => literals(v).some(c => lum(c) > 0.5 && parseColor(c).alpha > 0.2)));
		expect(offenders.map(([sel]) => sel)).toEqual([]);
	});

	// A lift with no fallback paints nothing at all on paper.
	it("reads every lift with the paper literal as its fallback", () => {
		// (Inside the dark section a bare read is fine: the lift is always set there.)
		const bare = paper.flatMap(([, body]) => [...body.matchAll(/var\((--st-on-dark-[a-z-]+)\s*\)/g)].map(m => m[0]));
		expect(bare).toEqual([]);
	});

	it("declares the lifts in the dark blocks alone, and every one it reads", () => {
		const read = new Set([...CSS.matchAll(/var\((--st-on-dark-[a-z-]+)\s*,/g)].map(m => m[1]));
		expect(read.size).toBeGreaterThan(10);
		for (const name of read) expect(D.has(name), `${name} is read but the dark palette never sets it`).toBe(true);
		const light = [...CSS.matchAll(RULE)].filter(([, sel, body]) => !/stonetop-dark/.test(sel) && /--st-on-dark-[a-z-]+\s*:/.test(body));
		expect(light.map(([sel]) => sel.trim()), "a lift declared on paper overrides the literal it falls back to").toEqual([]);
	});

	it("lifts every ink to 4.5:1 on the panel and on the raised well, and 7:1 in dark + high contrast", () => {
		const isInk = name => /^--st-on-dark-(danger|caution|ok|umber|attack-)/.test(name);
		let checked = 0;
		for (const [name, value] of D) {
			if (!isInk(name)) continue;
			checked++;
			for (const g of [D.get("--stonetop-bg"), D.get("--st-on-dark-raised")]) {
				expect(contrastRatio(value, g), `${name} (${value}) is ${ratioText(value, g)} on ${g}`).toBeGreaterThanOrEqual(4.5);
			}
			const high = DH.get(name);
			expect(high, `${name} is not restated for dark + high contrast`).toBeTruthy();
			for (const g of grounds7()) {
				expect(contrastRatio(high, g), `${name} (${high}) is ${ratioText(high, g)} on ${g}`).toBeGreaterThanOrEqual(7);
			}
		}
		expect(checked).toBeGreaterThanOrEqual(10);
	});

	it("keeps the whole ramp readable on the raised well", () => {
		for (const name of ["--st-text", "--st-text-muted", "--st-text-faint"]) {
			expect(contrastRatio(D.get(name), D.get("--st-on-dark-raised"))).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(DH.get(name), DH.get("--st-on-dark-raised"))).toBeGreaterThanOrEqual(7);
		}
	});

	it("keeps each roll card's result label readable on its own opaque fill", () => {
		for (const tier of ["failure", "partial", "success"]) {
			const fill = D.get(`--st-on-dark-${tier}-bg`);
			expect(parseColor(fill).alpha, `the ${tier} label is see-through`).toBe(1);
			expect(contrastRatio(D.get(`--st-tier-${tier}-text`), fill)).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(DH.get(`--st-tier-${tier}-text`), fill)).toBeGreaterThanOrEqual(7);
		}
	});

	// Core's compatibility layer paints every AppV1 button cream; under bone ink that was 1.5:1.
	// The dark rule that replaces it must weigh nothing, or it repaints every button that sets its
	// own fill or ink (a red Delete went bone when it weighed (0,1,1)).
	it("repaints core's cream buttons in our windows, and weighs nothing doing it", () => {
		const fill = RULES.find(([sel, body]) => /:where\(button, a\.button\)/.test(sel) && /background:/.test(body));
		expect(fill, "core's cream buttons stand on the dark page").toBeTruthy();
		const outside = fill[0].replace(/:where\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, "").trim();
		expect(outside, "the cream-button rule carries weight outside :where()").toBe("");
		expect(fill[1]).toMatch(/background:\s*var\(--st-on-dark-raised\)/);
		expect(fill[1]).toMatch(/color:\s*var\(--st-text\)/);
		expect(fill[0], "the rule reaches the window title bar's buttons too").toContain(".window-content");
	});

	it("gives a grey rule an edge at 3:1", () => {
		expect(contrastRatio(D.get("--st-on-dark-rule"), D.get("--stonetop-bg"))).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(DH.get("--st-on-dark-rule"), DH.get("--stonetop-bg"))).toBeGreaterThanOrEqual(3);
	});
});

// The Followers tab's pale fills are written in hsl(), which the scan above does not read, so its
// card header bands, pills and move bars stayed near-white under bone ink (reported in slate). Each
// pale hsl() fill on a follower surface has a dark rule for the same selector.
describe("the followers tab", () => {
	const RULE = /([^{}]+)\{([^{}]*)\}/g;
	const norm = sel => sel.replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " ");
	const FOLLOWER = /stonetop-follower-|stonetop-of-readout|stonetop-ff-option/;
	const paleHsl = body => [...body.matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/g)]
		.some(([, v]) => [...v.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, "").matchAll(/hsla?\([^)]*?\s(\d+(?:\.\d+)?)%\s*(?:\/[^)]*)?\)/g)].some(m => +m[1] > 75));
	const pale = [...CSS.slice(0, CSS.indexOf(`${DARK} {`)).matchAll(RULE)]
		.map(([, sel, body]) => [norm(sel), body])
		.filter(([sel, body]) => FOLLOWER.test(sel) && !/stonetop-dark|past-death|high-contrast/.test(sel) && paleHsl(body));
	const dark = new Set(RULES.flatMap(([sel]) => norm(sel).split(/,\s*/))
		.filter(s => s.startsWith(":where(:root.stonetop-dark) "))
		.map(s => s.slice(":where(:root.stonetop-dark) ".length)));

	it("found the pale fills", () => {
		expect(pale.length).toBeGreaterThan(8);
	});

	it("turns every one of them over in dark", () => {
		const missing = pale.flatMap(([sel]) => sel.split(/,\s*/)).filter(s => !dark.has(s));
		expect(missing).toEqual([]);
	});
});

// Core declares its placeholder ink on each input, not on the window, as a dark grey under the forced
// light theme: the relationship board's empty notes read about 2:1 in dark until it was re-pointed.
describe("placeholders", () => {
	it("re-points core's placeholder ink on the fields themselves", () => {
		const rule = RULES.find(([sel, body]) => /\(input, textarea\)$/.test(sel) && /--input-placeholder-color\s*:/.test(body));
		expect(rule, "no dark rule re-points --input-placeholder-color on the inputs").toBeTruthy();
		expect(rule[1]).toMatch(/--input-placeholder-color:\s*var\(--st-text-muted\)/);
		for (const pal of [D, DH, S, SH]) {
			const muted = pal.get("--st-text-muted") ?? D.get("--st-text-muted");
			const panel = pal.get("--stonetop-bg") ?? D.get("--stonetop-bg");
			expect(contrastRatio(muted, panel)).toBeGreaterThanOrEqual(4.5);
		}
	});
});

// A threat, site or hazard card carries its stone INLINE, and the stones are dark greys and browns
// picked for parchment: #6e3b3b lettering on the darkened card was 1.3:1. An inline property cannot
// be re-pointed by a dark rule, so the card carries the raw stone and the stylesheet derives the
// accent from it, on the same element, mixed into the card's ink by the amount each palette asks.
describe("the threat cards' accent", () => {
	const TEMPLATES = ["templates/journal/partials/threat-card.hbs", "templates/journal/partials/site-card.hbs",
		"templates/journal/partials/hazard-card.hbs", "templates/dialogs/create-threat.hbs",
		"templates/actor/partials/gm-toolkit-tab-threats.hbs"];
	const STONES = [
		...[...readRepo("module/threats/threat-types.js").matchAll(/accent:\s*"(#[0-9a-f]{6})"/gi)].map(m => m[1]),
		readRepo("module/sites/site-view.js").match(/SITE_ACCENT = "(#[0-9a-f]{6})"/i)?.[1],
		readRepo("module/hazards/hazard-data.js").match(/HAZARD_ACCENT = "(#[0-9a-f]{6})"/i)?.[1],
	];
	const CARD = customProperties(declarations(CSS, ":root.stonetop-dark .stonetop .threat-card"));
	const mix = (stone, ink, p) => hex(parseColor(stone).rgb.map((c, i) => c * p + parseColor(ink).rgb[i] * (1 - p)));

	it("is handed over raw, never as the property the rules read", () => {
		for (const path of TEMPLATES) {
			const src = readRepo(path);
			expect(src, path).toMatch(/--threat-accent-raw:\s*\{\{this\.accent\}\}/);
			expect(src, path).not.toMatch(/--threat-accent:/);
		}
	});

	it("is derived on the elements that carry it, the raw stone exactly on paper", () => {
		const rule = CSS.match(/:is\(\.threat-card, \.create-threat, \.steading-threat-type-list > li\) \{([^}]*)\}/)?.[1];
		expect(rule, "the rule that derives --threat-accent").toBeTruthy();
		expect(rule).toMatch(/--threat-accent:\s*color-mix\(in srgb, var\(--threat-accent-raw\) var\(--st-on-dark-accent-mix, 100%\)/);
	});

	it("clears 4.5:1 on every stop of the dark card, and 7:1 in dark + high contrast", () => {
		expect(STONES.length).toBeGreaterThanOrEqual(10);
		expect(CARD.get("--tc-ink"), "the dark card's ink").toBeTruthy();
		const stops = ["--tc-paper", "--tc-paper-hi", "--tc-paper-lo"].map(name => CARD.get(name));
		for (const [pal, floor] of [[D, 4.5], [DH, 7]]) {
			const p = parseFloat(pal.get("--st-on-dark-accent-mix")) / 100;
			expect(p, "the mix is not set").toBeGreaterThan(0);
			for (const stone of STONES) {
				const ink = mix(stone, CARD.get("--tc-ink"), p);
				for (const g of stops) expect(contrastRatio(ink, g), `${stone} as ${ink} on ${g}`).toBeGreaterThanOrEqual(floor);
			}
		}
	});
});

// A relationship-map colour the table chose is stored deepened for paper (relmap-ink.js#boardGrounds),
// so on the dark board soot, charcoal and every "deep" swatch were dark on dark, and high contrast's
// own darkening toward black matched under dark + high contrast as well.
describe("the relationship map's chosen colours", () => {
	const lifted = RULES.filter(([sel, body]) => /relmap-(line|head|ink)--custom/.test(sel) && /--relmap-ink:/.test(body));

	it("are lifted to a lightness floor in their own hue on the dark board", () => {
		const dark = lifted.find(([sel]) => sel.startsWith(":where(:root.stonetop-dark)"));
		expect(dark, "no dark rule lifts the custom inks").toBeTruthy();
		expect(dark[1]).toMatch(/oklch\(from var\(--relmap-ink-raw[^)]*\)\) max\(l, 0\.\d+\) c h\)/);
	});

	it("outweigh high contrast's darkening under dark + high contrast", () => {
		const high = lifted.find(([sel]) => sel.startsWith(DARK_HC));
		expect(high, "high contrast still darkens the custom inks on the dark board").toBeTruthy();
		expect(high[1]).not.toMatch(/#000|black/);
	});

	it("sit behind @supports, so a browser without relative colour keeps the stored line", () => {
		const at = CSS.indexOf("@supports (color: oklch(from red l c h))");
		expect(at).toBeGreaterThan(CSS.indexOf(`${DARK} {`));
		expect(CSS.indexOf(".stonetop-relmap-line--custom", at)).toBeGreaterThan(at);
	});
});

// `var(--name, #literal)` paints the literal in EVERY palette when nothing declares the name: three
// were stranded that way (`--st-text-strong`, `--stonetop-armor-boost`, and core's absent
// `--color-text-bad`), as `--color-border-light` was before them.
describe("colour fallbacks", () => {
	// Core's own names, declared in foundry2.css; set inline per element; or answered by a rule.
	const KNOWN = new Set([
		"--color-warm-1", "--color-border-light-2", "--color-underline-header", "--color-border-dark-5",
		"--color-border-dark-tertiary", "--color-light-1", "--color-level-success",
		"--site-accent",       // the journey pin's stone, inline, on the map
		"--st-heart",          // a filled heart, 3:1 as a mark on both papers
		"--color-text-bad",    // journal pages keep core's paper; our sheets' dark rule re-inks it
	]);

	it("only fall back for names something declares", () => {
		const declared = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
		const stranded = [...CSS.matchAll(/var\(\s*(--[\w-]+)\s*,\s*(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|white\b|black\b)/gi)]
			.map(m => m[1])
			.filter(name => !declared.has(name) && !KNOWN.has(name) && !name.startsWith("--st-on-dark-"));
		expect([...new Set(stranded)]).toEqual([]);
	});
});

// Slate is the dark palette re-pointed cool, worn as a third class beside `.stonetop-dark`. Every
// bar the lamplit palette answers to, it answers to as well.
describe("the slate palette", () => {
	const RAMP = ["--st-text", "--st-text-body", "--st-text-secondary", "--st-text-muted", "--st-text-faint"];
	const pick = (map, base, name) => map.get(name) ?? base.get(name);
	const ground = (map, base) => [pick(map, base, "--st-page"), pick(map, base, "--stonetop-bg"),
		pick(map, base, "--st-on-dark-raised"), ...Object.values(GRAIN).map(g => painted(pick(map, base, "--st-paper-tint"), g))];

	it("comes after dark + high contrast, which it ties with, and its own high contrast after it", () => {
		expect(S.size).toBeGreaterThan(20);
		expect(SH.size).toBeGreaterThan(15);
		expect(CSS.indexOf(`${SLATE} {`)).toBeGreaterThan(CSS.indexOf(`${DARK_HC} {`));
		expect(CSS.indexOf(`${SLATE_HC} {`)).toBeGreaterThan(CSS.indexOf(`${SLATE} {`));
		expect(CSS.indexOf(`${SLATE_HC} {`), "slate moved after the no-texture rule").toBeLessThan(CSS.indexOf(FLAT));
	});

	it("is cool, not warm: a page with more blue in it than red", () => {
		for (const name of ["--st-page", "--stonetop-bg", "--st-text"]) {
			const [r, , b] = parseColor(S.get(name)).rgb;
			expect(b, `${name} (${S.get(name)}) is not blue-grey`).toBeGreaterThan(r);
		}
	});

	it("keeps the panel a step lighter than the page, and the grain landing on the page", () => {
		expect(lum(S.get("--stonetop-bg"))).toBeGreaterThan(lum(S.get("--st-page")));
		expect(lum(S.get("--st-page"))).toBeGreaterThan(0.004);
		const mean = painted(S.get("--st-paper-tint"), GRAIN.mean);
		expect(contrastRatio(mean, S.get("--st-page")), `the grain paints ${mean}`).toBeLessThan(1.05);
	});

	it("gives the ramp 4.5:1 on the page, the panel, the raised well and the grain, brightest first", () => {
		let last = Infinity;
		for (const name of RAMP) {
			expect(S.get(name), `${name} is left warm`).toBeTruthy();
			for (const g of ground(S, D)) {
				expect(contrastRatio(S.get(name), g), `${name} is ${ratioText(S.get(name), g)} on ${g}`).toBeGreaterThanOrEqual(4.5);
			}
			expect(lum(S.get(name))).toBeLessThan(last);
			last = lum(S.get(name));
		}
	});

	it("gives a rule 3:1 and the button's label 7:1 on a fill darker than the page", () => {
		const panel = S.get("--stonetop-bg");
		for (const name of ["--st-on-dark-rule", "--st-btn-primary-border"]) {
			expect(contrastRatio(S.get(name), panel), `${name} is ${ratioText(S.get(name), panel)}`).toBeGreaterThanOrEqual(3);
		}
		expect(contrastRatio(S.get("--st-btn-primary-text"), S.get("--st-btn-primary-bg"))).toBeGreaterThanOrEqual(7);
		expect(lum(S.get("--st-btn-primary-bg"))).toBeLessThan(lum(S.get("--st-page")));
	});

	it("keeps every lifted hue readable on its page and its raised well", () => {
		for (const [name, value] of D) {
			if (!/^--st-on-dark-(danger|caution|ok|umber|attack-)/.test(name)) continue;
			for (const g of [S.get("--stonetop-bg"), S.get("--st-on-dark-raised")]) {
				expect(contrastRatio(value, g), `${name} is ${ratioText(value, g)} on ${g}`).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	// In "slate-high" both this block and dark + high contrast match at (0,3,0), and slate comes
	// later, so anything they both set must be restated at (0,4,0) or slate's 4.5:1 value wins.
	it("restates in slate + high contrast every token slate and dark + high contrast both set", () => {
		const missing = [...S.keys()].filter(name => DH.has(name) && !SH.has(name));
		expect(missing, `left at plain slate's values in slate-high: ${missing.join(", ")}`).toEqual([]);
	});

	it("gives slate + high contrast 7:1 on every ground, short of white on black", () => {
		const grounds = ground(SH, DH);
		for (const name of RAMP) {
			const ink = SH.get(name);
			for (const g of grounds) {
				expect(contrastRatio(ink, g), `${name} (${ink}) is ${ratioText(ink, g)} on ${g}`).toBeGreaterThanOrEqual(7);
			}
			expect(lum(ink), `${name} is effectively white`).toBeLessThan(0.9);
		}
		expect(lum(SH.get("--st-page")), "the page is effectively black").toBeGreaterThan(0.004);
		expect(contrastRatio(SH.get("--st-on-dark-rule"), SH.get("--stonetop-bg"))).toBeGreaterThanOrEqual(3);
	});

	// The dead keep their neutral black; on slate that is still a step BELOW the page.
	it("keeps a dead character's page below the slate page", () => {
		const dead = customProperties(RULES.find(([sel]) => /stonetop-past-death/.test(sel))?.[1]);
		expect(lum(dead.get("--st-page"))).toBeLessThan(lum(S.get("--st-page")));
		expect(lum(dead.get("--st-page"))).toBeLessThan(lum(SH.get("--st-page")) + 0.001);
	});
});

/** Dark + high contrast's grounds: the page, the panel and the grain at both extremes. */
function grounds7() {
	const tint = DH.get("--st-paper-tint");
	return [DH.get("--st-page"), DH.get("--stonetop-bg"), ...Object.values(GRAIN).map(g => painted(tint, g))];
}

describe("the setting", () => {
	let saved;
	beforeEach(() => { saved = globalThis.document; globalThis.document = { documentElement: fakeEl() }; });
	afterEach(() => { globalThis.document = saved; });
	const classes = () => globalThis.document.documentElement.classes;

	it("wears high contrast over any page when the checkbox is ticked", () => {
		for (const [page, dark, slate] of [["normal", false, false], ["dark", true, false], ["slate", true, true]]) {
			applySheetContrast(page, true);
			expect(classes().includes("stonetop-high-contrast"), `${page}: high contrast`).toBe(true);
			expect(classes().includes("stonetop-dark"), `${page}: dark`).toBe(dark);
			expect(classes().includes("stonetop-slate"), `${page}: slate`).toBe(slate);
			applySheetContrast(page, false);
			expect(classes().includes("stonetop-high-contrast"), `${page}: unticked`).toBe(false);
			expect(classes().includes("stonetop-dark"), `${page}: dark kept`).toBe(dark);
		}
	});

	// A value stored before the split ("dark-high") never reaches here: Ready splits it first.
	it("turns the dark axes on for every palette, and none for anything else", () => {
		const expected = {
			normal: [false, false, false], dark: [false, true, false], slate: [false, true, true],
			high: [false, false, false], "dark-high": [false, false, false],
			"": [false, false, false], DARK: [false, false, false], "dark high": [false, false, false], SLATE: [false, false, false],
		};
		for (const [value, [hc, dark, slate]] of Object.entries(expected)) {
			applySheetContrast(value, false);
			expect(classes().includes("stonetop-high-contrast"), `${value}: high contrast`).toBe(hc);
			expect(classes().includes("stonetop-dark"), `${value}: dark`).toBe(dark);
			expect(classes().includes("stonetop-slate"), `${value}: slate`).toBe(slate);
		}
		for (const junk of [undefined, null, 0]) {
			applySheetContrast(junk);
			expect(classes().includes("stonetop-dark")).toBe(false);
		}
	});

	describe("following Foundry", () => {
		let savedGame, savedMatch;
		const foundry = (applications, osDark = false) => {
			globalThis.game = { settings: { get: (scope, key) => {
				if (scope === "core" && key === "uiConfig") return { colorScheme: { applications, interface: "" } };
				return scope === "stonetop-pwd" ? globalThis.__contrast : undefined;
			} } };
			globalThis.matchMedia = query => ({ matches: osDark && /dark/.test(query), addEventListener() {} });
		};
		beforeEach(() => { savedGame = globalThis.game; savedMatch = globalThis.matchMedia; });
		afterEach(() => { globalThis.game = savedGame; globalThis.matchMedia = savedMatch; delete globalThis.__contrast; });
		const on = () => ({ hc: classes().includes("stonetop-high-contrast"), dark: classes().includes("stonetop-dark"),
			slate: classes().includes("stonetop-slate") });

		it("is Lamplit when Foundry's applications are dark and paper when they are light", () => {
			foundry("dark");
			applySheetContrast("auto", false);
			expect(on()).toEqual({ hc: false, dark: true, slate: false });
			applySheetContrast("auto", true);
			expect(on()).toEqual({ hc: true, dark: true, slate: false });
			foundry("light");
			applySheetContrast("auto", false);
			expect(on()).toEqual({ hc: false, dark: false, slate: false });
			applySheetContrast("auto", true);
			expect(on()).toEqual({ hc: true, dark: false, slate: false });
		});

		// Core's blank "browser default" follows the OS, and so does this.
		it("follows the OS when Foundry is left at its browser default", () => {
			foundry("", true);
			applySheetContrast("auto");
			expect(on().dark).toBe(true);
			foundry("", false);
			applySheetContrast("auto");
			expect(on().dark).toBe(false);
		});

		it("reads as paper before there is a game to ask", () => {
			globalThis.game = undefined;
			globalThis.matchMedia = undefined;
			applySheetContrast("auto");
			expect(on()).toEqual({ hc: false, dark: false, slate: false });
		});

		it("repaints when Foundry's theme changes, and only for a reader on auto", () => {
			const handlers = [];
			const hooks = { on: (name, fn) => handlers.push([name, fn]) };
			foundry("light");
			globalThis.__contrast = "auto";
			applySheetContrast("auto");
			watchFoundryTheme(hooks);
			const fire = key => handlers.filter(([n]) => n === "clientSettingChanged").forEach(([, fn]) => fn(key));
			foundry("dark");
			fire("core.somethingElse");
			expect(on().dark, "an unrelated setting repainted the sheet").toBe(false);
			fire("core.uiConfig");
			expect(on().dark).toBe(true);
			// A reader who chose a palette keeps it, whatever Foundry does.
			globalThis.__contrast = "slate";
			applySheetContrast("slate");
			foundry("light");
			fire("core.uiConfig");
			expect(on()).toEqual({ hc: false, dark: true, slate: true });
		});
	});

	it("has a label for every page, and for the High Contrast checkbox", () => {
		const en = JSON.parse(readRepo("languages/en.json"));
		const labels = en.stonetop?.settings?.sheetContrast ?? {};
		for (const key of ["normal", "dark", "slate", "auto"]) expect(labels[key], key).toBeTruthy();
		expect(en.stonetop?.settings?.highContrast?.name).toBeTruthy();
		expect(en.stonetop?.settings?.highContrast?.hint).toBeTruthy();
	});

	// The setting's label is "Dark Mode" (key still `sheetContrast`), so a search for "dark" finds
	// it. High contrast is its own checkbox (2026-10-04), so no page carries it as a choice.
	it("offers every page on the setting, and no high-contrast combination", () => {
		const src = readRepo("module/settings.js");
		const choices = src.match(/register\(SYSTEM_ID, "sheetContrast"[\s\S]*?choices: \{([^}]*)\}/)?.[1] ?? "";
		for (const value of ["normal", "dark", "slate", "auto"]) expect(choices, value).toContain(`"${value}":`);
		expect(choices).not.toMatch(/high/i);
	});
});
