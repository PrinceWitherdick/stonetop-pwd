import { describe, it, expect } from "vitest";
import { readCss, ownRule, declared } from "../fakes/css.js";
import { contrastRatio } from "../fakes/contrast.js";

// The table moment band (module/moments/moment-overlay.js, the TABLE MOMENTS block). It sits on
// <body>, outside `.stonetop`, so the blanket Reduce Motion rule never reaches it: every animation
// has to gate itself on `stonetop-less-motion` (on when the OS or the setting asks), or a reader who
// asked for stillness gets a curtain sweeping across their screen. It also must never eat a click.

const CSS = readCss();

/** Every declaration in the file, with the preludes of the blocks around it, outermost first. */
function scopedDeclarations(css) {
	const out = [];
	const stack = [];
	let start = 0;
	for (let i = 0; i < css.length; i++) {
		const ch = css[i];
		if (ch === "{") {
			stack.push(css.slice(start, i).trim().replace(/\s+/g, " "));
			start = i + 1;
		} else if (ch === "}" || ch === ";") {
			const text = css.slice(start, i).trim();
			const colon = text.indexOf(":");
			if (colon > 0 && stack.length && !text.includes("{")) {
				out.push({ prop: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim().replace(/\s+/g, " "), scope: [...stack] });
			}
			if (ch === "}") stack.pop();
			start = i + 1;
		}
	}
	return out;
}

const MOMENT_ANIMATIONS = scopedDeclarations(CSS)
	.filter(d => /^animation(-name)?$/.test(d.prop) && /\bstonetop-moment-/.test(d.value));

describe("the table moment's motion", () => {
	it("animates at all (the scan found its rules)", () => {
		expect(MOMENT_ANIMATIONS.length).toBeGreaterThanOrEqual(4);
	});

	it("plays only under :root:not(.stonetop-less-motion)", () => {
		for (const { value, scope } of MOMENT_ANIMATIONS) {
			for (const selector of scope.at(-1).split(",")) {
				expect(selector.trim(), `${value} is not gated on the less-motion class`).toMatch(/^:root:not\(\.stonetop-less-motion\) /);
			}
		}
	});

	it("names a keyframe that exists for every moment animation", () => {
		// Not the `--stonetop-moment-out-at` custom property the fade's delay reads.
		const names = new Set(MOMENT_ANIMATIONS.flatMap(d => d.value.match(/(?<!-)stonetop-moment-[a-z-]+/g)));
		for (const name of names) expect(CSS, name).toContain(`@keyframes ${name} {`);
	});

	it("fades out under the name the script waits for", () => {
		expect(MOMENT_ANIMATIONS.some(d => /\bstonetop-moment-out\b/.test(d.value) && d.value.includes("var(--stonetop-moment-out-at"))).toBe(true);
	});
});

describe("the table moment's box", () => {
	const root = ownRule(CSS, "#stonetop-moment");

	it("takes no pointer and sits above the windows by the token", () => {
		expect(declared(root, "pointer-events")).toBe("none");
		expect(declared(root, "z-index")).toBe("var(--st-z-above-windows)");
		expect(declared(root, "position")).toBe("fixed");
	});

	it("writes no four-digit z-index of its own anywhere in its rules", () => {
		const own = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /stonetop-moment/.test(sel));
		expect(own.length).toBeGreaterThan(5);
		for (const [, sel, body] of own) expect(body, sel).not.toMatch(/z-index:\s*\d{4}/);
	});

	it("reads bone on umber at AAA in every palette, since it is self-coloured", () => {
		const ground = declared(root, "--stonetop-moment-ground");
		const ink = declared(root, "--stonetop-moment-ink");
		expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(7);
		// The icon is not text, but it still has to be seen: 3:1 for a graphic.
		expect(contrastRatio(declared(root, "--stonetop-moment-rule"), ground)).toBeGreaterThanOrEqual(3);
	});

	it("lines the icon up on the title's line, not the middle of title and sub", () => {
		expect(declared(ownRule(CSS, ".stonetop-moment-band"), "align-items")).toBe("flex-start");
		const icon = ownRule(CSS, "#stonetop-moment .stonetop-moment-icon");
		const title = ownRule(CSS, ".stonetop-moment-title");
		expect(declared(icon, "font-size")).toBe(declared(title, "font-size"));
		expect(declared(icon, "line-height")).toBe(declared(title, "line-height"));
	});

	it("centres the small band by its margins, which the rise's translate cannot overwrite", () => {
		const small = ownRule(CSS, ".stonetop-moment--small .stonetop-moment-band");
		expect(declared(small, "margin")).toBe("0 auto");
		expect(declared(small, "translate")).toBeNull();
	});
});
