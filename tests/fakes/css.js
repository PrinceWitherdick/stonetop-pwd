/**
 * Reading the shipped stylesheet and templates from a test.
 *
 * A family of tests asserts on what a CSS rule DECLARES rather than on how it renders — the traps
 * they guard (a mask with no `mask-size`, a modifier that sorts before its base, a glyph whose
 * aspect ratio no longer matches its viewBox) all fail silently in a browser: the element still
 * lays out, still hovers, still clicks, and nothing is logged. Each of those tests had grown its
 * own copy of the reader and the selector scan, and they had drifted into three different
 * implementations of what looked like one function.
 *
 * TWO scans live here, because the tests genuinely want two different questions answered, and the
 * difference is not cosmetic — see `declarations` and `soleRule`.
 *
 * Both scan the PRELUDE by splitting it on commas and comparing whole entries, rather than by
 * pattern-matching the selector inside it. The regex form several copies had used
 * (`(^|[,}])\s*<sel>\s*\{`) silently only matched a selector that happened to be the LAST entry
 * before the brace, so `.stonetop-holy-light` went unfound in
 * `.stonetop-holy-light, .stonetop-condemn { … }` while `.stonetop-condemn` was found — making an
 * assertion pass or fail on the ORDER the selectors were listed in.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Read a repo file as text, by repo-relative path. */
export function readRepo(rel) {
	return fs.readFileSync(path.resolve(ROOT, rel), "utf8");
}

/** An absolute path to a repo file, by repo-relative path. Local: nothing outside needs one. */
function repoPath(rel) {
	return path.resolve(ROOT, rel);
}

/**
 * Does this repo-relative path exist on disk?
 *
 * The other half of what these tests need alongside `readRepo`: several assert that a path
 * NAMED in source (a sheet's `template`, a preloaded partial, a deleted template that must stay
 * deleted) really is or is not a file. Doing that by hand meant every such test carrying its own
 * `fs`, `path` and `fileURLToPath` imports plus a `HERE` whose `../..` depth had to match where
 * the file happened to sit — which is the drift this module exists to stop.
 */
export function repoFileExists(rel) {
	return fs.existsSync(repoPath(rel));
}

/**
 * Source with its comments taken out — Handlebars, block and line — so a guard reads the CODE
 * rather than the prose above it.
 *
 * The tests that need this are the ones asserting a thing is NOT done any more (no `target`,
 * no `<a>`, no chevron bullet), and those files invariably explain the very practice they
 * forbid in the comment right above the replacement. Left in, the comment answers for the
 * code and the guard passes on its own rationale.
 *
 * One implementation rather than the copy each such test used to carry: they had drifted into
 * stripping different subsets, so which comment syntax was honoured depended on which file you
 * were in.
 */
export function stripComments(src) {
	return src
		.replace(/\{\{!--[\s\S]*?--\}\}/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
}

/**
 * The stylesheet with comments stripped — a commented-out rule must not answer for a live one,
 * and these comments are long and full of commas and braces, so a selector list read out of the
 * raw text would swallow the paragraph above its rule.
 *
 * Block comments only, deliberately: `//` is not a comment in CSS, and a `url(//host/…)` or a
 * data URI run through `stripComments` would lose the rest of its line.
 */
export function readCss(rel = "styles/stonetop.css") {
	return readRepo(rel).replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every rule whose prelude names `selector` as a whole comma-separated entry, in source order. */
function rulesNaming(css, selector) {
	const found = [];
	for (const [, prelude, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (prelude.split(",").map(s => s.trim()).includes(selector)) found.push({ prelude, body });
	}
	return found;
}

/**
 * EVERY declaration that reaches `selector`, across every rule that names it — including the
 * rules where it is one entry in a shared selector list — joined.
 *
 * This is what most assertions want. Two surfaces that share an affordance share its declarations
 * (`.stonetop-holy-light, .stonetop-condemn { … }` neutralises both glyphs' button chrome, and the
 * masked glyphs share their mask defaults), so a rule matters here whether the selector stands
 * alone before the brace or sits in a group. Asking only after the standalone rule would find
 * nothing but the local overrides beside it.
 *
 * Returns null when no rule names the selector at all, so "the rule is gone entirely" still fails
 * rather than quietly matching an empty string.
 */
export function declarations(css, selector) {
	const found = rulesNaming(css, selector).map(r => r.body);
	return found.length ? found.join("\n") : null;
}

/**
 * What is written about this surface ITSELF: the rules whose prelude is the selector and nothing
 * else — falling back to `declarations` when it has no rule of its own.
 *
 * This is the tool for a NEGATIVE assertion ("positioned, but must NOT clip"; "must NOT round its
 * own corners"). The union is wrong there, because it drags in the shared base rule the surface
 * sits in alongside its siblings — and those bases legitimately declare the very properties the
 * local rule is being checked for the absence of. `.stonetop-follower-portrait-img` is the case
 * that proves it: its own rule correctly sets no radius, while the eight-selector base it shares
 * sets `border-radius: 0` to kill core's 2px.
 *
 * The fallback matters just as much: a surface can be styled ENTIRELY through shared lists
 * (`.stonetop-npc-portrait` is), and answering null for one would silently turn every assertion
 * about it into a vacuous pass.
 */
export function ownRule(css, selector) {
	const own = rulesNaming(css, selector).filter(r => r.prelude.trim() === selector).map(r => r.body);
	return own.length ? own.join("\n") : declarations(css, selector);
}
