import { describe, it, expect } from "vitest";
import { readRepo, readCss, declarations, ownRule } from "../fakes/css.js";

// Source scan over the real stylesheet, guarding the parts of the portrait-frame feature that
// live in CSS and fail SILENTLY when they regress.
//
// Two distinct hazards:
//  1. a clipping box that lost `position: relative`, which lets a framed image (sized to several
//     hundred percent) position itself against the sheet window instead. The follower card is the
//     nastiest: it already had `overflow: hidden` and a radius, so it looks finished, and it
//     appears to work on a FALLEN card because `.is-dead` sets a `filter`, which creates a
//     containing block by accident.
//  2. a selector still naming the element the class used to sit on. When the surface class moved
//     from the <img> to a wrapping <span>, `img.steading-player-portrait` and
//     `.stonetop-rel-portrait[data-name]` stopped matching anything at all. Nothing throws; the
//     hover preview and the GM's only route to re-pick a resident's photo just stop working.

const CSS = readCss();

/**
 * What a surface declares about ITSELF, so a rule can be asserted on in isolation. That is what
 * most of the assertions here want, and what the NEGATIVE ones require — several check that a box
 * is positioned but does not clip, or that an image does not round its own corners, and a union
 * over the shared bases would answer for the siblings instead. See fakes/css.js.
 */
const block = (selector) => ownRule(CSS, selector);

/**
 * EVERY declaration that reaches `selector`, including the rules where it is one entry in a
 * shared selector list: two surfaces that share one affordance share its declarations, and asking
 * after only the standalone rule would find nothing but the local overrides beside it.
 */
const allDeclarations = (selector) => declarations(CSS, selector) ?? "";

describe("the clipping boxes a chosen frame paints inside", () => {
	// Guard the scan itself: the day the CSS is reshuffled, a lookup that quietly returns null
	// would make every assertion below pass vacuously.
	it("finds every surface rule it is about to assert on", () => {
		for (const sel of [".stonetop-rel-portrait", ".stonetop-follower-portrait",
			".steading-member-avatar", ".steading-player-portrait", ".stonetop-follower-portrait-img",
			".stonetop-npc-portrait"]) {
			expect(block(sel), `no declaration block found for ${sel}`).toBeTruthy();
		}
	});

	it.each([
		[".stonetop-rel-portrait"],
		[".steading-member-avatar"],
		[".steading-player-portrait"],
		// The NPC sheet header. The class it clips under is the WRAPPER's, not .stonetop-portrait,
		// which the no-art placeholder also wears and which must stay a flex centring box.
		[".stonetop-npc-portrait"],
	])("%s establishes a containing block and clips", (sel) => {
		const b = block(sel);
		expect(b).toMatch(/position:\s*relative/);
		expect(b).toMatch(/overflow:\s*hidden/);
	});

	it("keeps the follower portrait positioned but UNCLIPPED, with the mask on its inner span", () => {
		// The odd one out, deliberately: the crop pip hangs 1px past the padding box to sit flush
		// with the border-box corner, and overflow clips at the PADDING edge, so this box must not
		// clip. The mask moved to .stonetop-follower-portrait-clip. Getting this wrong is not
		// subtle — an unclipped framed portrait is several hundred percent of its box and paints
		// over whatever is above it.
		const box = block(".stonetop-follower-portrait");
		expect(box).toMatch(/position:\s*relative/);
		expect(box).not.toMatch(/overflow:\s*hidden/);
		const clip = block(".stonetop-follower-portrait-clip");
		expect(clip, "the follower's mask is gone").toBeTruthy();
		expect(clip).toMatch(/overflow:\s*hidden/);
		expect(clip).toMatch(/border-radius:/);
		expect(clip).toMatch(/position:\s*absolute/);
	});

	it("keeps the follower portrait SQUARE, matching the character sheet's own avatar", () => {
		// A hand-framed face is a square rect (portrait-frame.js suggestSquare), so a square box
		// shows all of it while a circle mask discards the ~21% outside the inscribed disc. Both
		// the box and its mask have to agree, or the ring and the picture disagree at the corners.
		// The small roster avatars stay round on purpose, so this is asserted per-surface.
		for (const sel of [".stonetop-follower-portrait", ".stonetop-follower-portrait-clip"]) {
			expect(block(sel), `${sel} went back to a circle`).not.toMatch(/border-radius:\s*50%/);
			expect(block(sel)).toMatch(/border-radius:\s*calc\(|border-radius:\s*var\(--st-radius\)/);
		}
		for (const sel of [".stonetop-rel-portrait", ".steading-member-avatar", ".steading-player-portrait"]) {
			expect(block(sel), `${sel} is meant to stay circular`).toMatch(/border-radius:\s*50%/);
		}
	});

	// Every pip — the follower card's two and the sheet headers' two — shares one declaration
	// block, so each SURFACE is asserted through its own selector: the day they are split apart,
	// whichever one loses the pinning has to fail here rather than quietly render as an ellipse.
	// Each surface has one class all its pips are styled through (their own classes exist for the
	// JS to bind to), which is the class asserted here.
	it.each([
		[".stonetop-follower-portrait-pip"],
		[".stonetop-header-pip"],
	])("pins %s against core's button rule", (sel) => {
		// Core styles a bare `button` with `height: var(--button-size)` AND
		// `min-height: var(--button-size)` (28px), plus padding and a gap. min-height BEATS
		// height, so a 20px pip renders 20x28: an ellipse, with its glyph centred in a box
		// taller than the circle that is actually visible. Verified against the real
		// foundry2.css, where a plain 20x20 button measures 20x28.
		const b = allDeclarations(sel);
		expect(b, "the crop pip rule is gone").toBeTruthy();
		expect(b).toMatch(/min-height:\s*0/);
		expect(b).toMatch(/padding:\s*0/);
	});

	// Both pips on a surface are absolutely positioned into the same bottom-right corner by the
	// shared block, so ONLY a `right` of its own keeps the Tokenizer pip from sitting exactly on
	// top of the crop pip. Two single-class selectors tie on specificity, so it must also come
	// LATER in the file than the shared block that gives every pip `right: -1px` / `right: 6px`.
	it.each([
		[".stonetop-follower-portrait-tokenize", ".stonetop-follower-portrait-pip"],
		[".stonetop-portrait-tokenize-pip", ".stonetop-header-pip"],
	])("moves %s out from under the crop pip", (tokenize, shared) => {
		const own = block(tokenize);
		expect(own, `${tokenize} has no rule of its own, so it stacks on the crop pip`).toBeTruthy();
		expect(own).toMatch(/right:\s*\d/);
		// The last rule that positions the shared class — whichever it is, and there are several
		// rules on each of these classes — has to come BEFORE the override, or the tie is lost.
		const positioning = [...CSS.matchAll(/([^{}]*)\{([^}]*)\}/g)]
			.filter((m) => m[1].includes(shared) && /right:/.test(m[2]));
		expect(positioning.length, `nothing positions ${shared}`).toBeGreaterThan(0);
		const lastShared = positioning[positioning.length - 1].index;
		expect(CSS.indexOf(`${tokenize} {`)).toBeGreaterThan(lastShared);
	});

	it("gives the sheet headers' pip a positioned, unclipped box to sit in", () => {
		// The pip is absolutely positioned, so the slot has to be its containing block or it
		// escapes to the sheet window. Unclipped for the same reason the follower card's wrapper
		// is: the NPC's own portrait span is `overflow: hidden` (a framed face is positioned at
		// several hundred percent inside it), which is exactly why the slot wraps that span
		// rather than being it.
		const slot = block(".stonetop-portrait-slot");
		expect(slot, "the header portrait's slot is gone").toBeTruthy();
		expect(slot).toMatch(/position:\s*relative/);
		expect(slot).not.toMatch(/overflow:\s*hidden/);
	});

	it("does not round the follower's inner image, which would clip the face on a framed portrait", () => {
		// At 250% of its box a 50% radius is a huge ellipse whose curve cuts through pixels well
		// inside the visible circle. The wrapper's own radius already masks it.
		expect(block(".stonetop-follower-portrait-img")).not.toMatch(/border-radius/);
	});
});

describe("the follower portrait's markup contract", () => {
	const HBS = readRepo("templates/actor/partials/tab-followers.hbs");

	it("wraps the portrait image in the clip span", () => {
		// The box deliberately does not clip, so this span is the only thing keeping a framed
		// portrait inside its circle. Losing it does not degrade quietly: the image is sized to
		// several hundred percent and paints across the sheet.
		expect(HBS).toMatch(/<span class="stonetop-follower-portrait-clip"><img class="stonetop-follower-portrait-img"/);
	});

	it("keeps the crop pip a sibling of the clip, not inside it", () => {
		// Inside the clip the pip would be masked to the circle again, which is the whole thing
		// the restructure was for.
		const clipEnd = HBS.indexOf("</span>", HBS.indexOf("stonetop-follower-portrait-clip"));
		const pipAt = HBS.indexOf("stonetop-follower-portrait-frame");
		expect(clipEnd).toBeGreaterThan(-1);
		expect(pipAt).toBeGreaterThan(clipEnd);
	});
});

describe("the NPC header portrait's markup contract", () => {
	const HBS = readRepo("templates/actor/npc.hbs");

	it("puts .stonetop-portrait on the clipping box, not on the image", () => {
		// Three things find the slot by that class and would break quietly if it moved to the
		// <img>: the play-mode popout and the edit-mode framer button (utils/actor-portrait-picker.js),
		// and the broken-art guard (utils/sheet-chrome.js), which removes the whole slot.
		// The image inside carries its own class so it can join the shared crop rule.
		const boxes = HBS.match(/class="stonetop-portrait stonetop-npc-portrait stonetop-portrait-box"/g);
		expect(boxes, "the play-mode and edit-mode portrait boxes").toHaveLength(2);
		expect(HBS).toMatch(/<img class="stonetop-npc-portrait-img"/);
		// The no-art placeholder is the third .stonetop-portrait slot, and is a span too.
		expect(HBS).toMatch(/<span class="stonetop-portrait stonetop-npc-portrait-placeholder"/);
	});

	// Guarded across all three sheets that own a header portrait, because all three now depend
	// on it: ActorSheet.activateListeners binds `img[data-edit]` to Foundry's own file picker,
	// that binding is registered before ours and cannot be called off from a listener, and so
	// while the attribute is present the portrait click in edit mode can only ever reach the raw
	// file browser — never the People of Stonetop gallery. The gallery carries "Browse files…"
	// and "Use default" of its own, so nothing the attribute reached is lost by dropping it.
	//
	// Comments are stripped first: these templates explain the absence, and the explanation
	// names the attribute.
	it.each([
		["templates/actor/npc.hbs"],
		["templates/actor/monster.hbs"],
		["templates/actor/partials/actor-header.hbs"],
	])("%s carries NO data-edit, so the portrait click is ours in both modes", (file) => {
		const markup = readRepo(file)
			.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
		expect(markup).toMatch(/stonetop-portrait/);
		expect(markup).not.toMatch(/data-edit/);
	});
});

describe("the monster header portrait's markup contract", () => {
	const HBS = readRepo("templates/actor/monster.hbs");

	it("draws ONE slot for both modes, so locking the sheet cannot re-crop a framed face", () => {
		// The monster header used to branch on edit mode before it branched on the frame, and the
		// edit-mode branch drew the raw `actor.img` — so unlocking a monster whose face had been
		// framed swapped the chosen square for the whole illustration. A single slot is what makes
		// that unrepresentable; the modes now differ only in what getData hands the unframed
		// branch (stonetop.headerImg) and whether the slot is drawn at all (stonetop.showPortrait).
		const slots = HBS.match(/class="stonetop-portrait-slot"/g) ?? [];
		expect(slots).toHaveLength(1);
		expect(HBS).toMatch(/\{\{#if stonetop\.portraitFramed\}\}/);
		expect(HBS).toMatch(/<span class="stonetop-portrait stonetop-portrait-clip"/);
	});
});

describe("the header portrait's crop pip", () => {
	// Comments stripped: these templates discuss the pip and the corner it sits in.
	const markup = (file) => readRepo(file)
		.replace(/\{\{!--[\s\S]*?--\}\}/g, "");

	it.each([
		["templates/actor/npc.hbs"],
		["templates/actor/monster.hbs"],
		["templates/actor/partials/actor-header.hbs"],
	])("%s draws the pip with EVERY portrait slot, so it is there in both modes", (file) => {
		// Counted against the slots rather than merely "the partial is included somewhere": the
		// NPC header renders a slot per mode, so a pip added to only one of them would still
		// pass an it-appears check while vanishing the moment the sheet is locked or unlocked.
		// Framing is not an edit-mode act — it is a reading choice about a picture that already
		// exists, and the person adjusting it is usually looking at the sheet, not editing it.
		const src = markup(file);
		const slots = src.match(/class="stonetop-portrait-slot"/g) ?? [];
		const pips = src.match(/stonetop\.portrait-frame-pip/g) ?? [];
		expect(slots.length, "no portrait slot in this header").toBeGreaterThan(0);
		expect(pips.length).toBe(slots.length);
	});

	it("sits in the bottom-RIGHT, the same corner the follower card puts it in", () => {
		// One affordance, one place. The shared rule anchors both pips bottom-right; the header's
		// own rule only insets it off that corner, so a stray `left` would silently move it to
		// the other side on the sheets while leaving the cards where they are. Asserted across
		// every rule that reaches the pip, since the anchor and the inset live in different ones.
		const all = allDeclarations(".stonetop-header-pip");
		expect(all, "the crop pip has no rule at all").toBeTruthy();
		expect(all, "anchored to the left edge somewhere").not.toMatch(/(^|;|\s)left:/);
		// Positive inset off the right/bottom edges, rather than the card's flush -1px.
		expect(all).toMatch(/right:\s*\d/);
		expect(all).toMatch(/bottom:\s*\d/);
	});
});

describe("selectors that would break silently", () => {
	it("no longer qualifies the PC portrait as an img", () => {
		expect(CSS).not.toMatch(/img\.steading-player-portrait\b/);
	});

	it("no longer selects the relationship portrait by [data-name]", () => {
		// data-name stays on the inner image, so a class-on-span selector matches nothing.
		expect(CSS).not.toMatch(/\.stonetop-rel-portrait\[data-name\]/);
	});

	// The rule is identified by its opening declarations plus one selector that must be in its
	// list — so this still finds it if the block moves, and fails loudly if it stops existing. The
	// selector anchor is not decoration: the header portrait and the Actors sidebar row open with
	// these same two declarations, and without it this matched whichever rule came first in the
	// file. The tail is captured separately rather than anchored to `}`, so a declaration added to
	// the rule does not silently unmatch it.
	const sharedCropRule = () =>
		CSS.match(/([^{}]*\.stonetop-rel-portrait-img[^{}]*)\{\s*object-fit:\s*cover;\s*object-position:\s*center top;([^{}]*)\}/);

	it("keeps the shared crop rule pointed at every inner image", () => {
		const m = sharedCropRule();
		expect(m, "the shared cover/center-top rule is gone").toBeTruthy();
		const selectors = m[1].split(",").map((s) => s.trim()).filter(Boolean);
		expect(selectors).toHaveLength(8);
		for (const sel of [".steading-member-avatar-img", ".steading-player-portrait-img",
			".stonetop-follower-portrait-img", ".stonetop-npc-portrait-img",
			// The character and monster headers' framed portrait. It joined this rule when those
			// two headers started painting the crop; without it core's black img border draws
			// inside the clipping box, which is the whole reason this list exists.
			".stonetop-portrait-img",
			".stonetop-rel-portrait-img",
			// A group follower's roster row (the crew's individuals and members, a custom group's
			// members). Same 26px clipping disc as the relationship portrait, so it needs the same
			// two fixes: core's black img border, and no radius on a framed image.
			".stonetop-roster-avatar-img"]) {
			expect(selectors, `${sel} missing from the shared crop rule`).toContain(sel);
		}
		// The gallery tile is NOT a frame site (a tile shows source art, not a person's
		// portrait), so its selector is deliberately unchanged.
		expect(selectors.some((s) => s.includes("stonetop-people-pick"))).toBe(true);
	});

	it("kills core's black image border on every portrait inside a clipping box", () => {
		// Core v13 ships `body.game .app img { border: 1px solid var(--color-border-dark);
		// border-radius: 2px }` in @layer compatibility. Without these two declarations the
		// 20px inner image draws a black SQUARE inside the 22px round avatar — the middle of
		// each of its four edges falls inside the circle, the corners get masked — and the
		// image also loses 2px of box to a border it never wanted, exposing the wrapper's pale
		// plate as a second ring. Reproduced against the real foundry2.css.
		const m = sharedCropRule();
		expect(m, "the shared cover/center-top rule is gone").toBeTruthy();
		expect(m[2], "core's img border is back inside every portrait circle").toMatch(/border:\s*none/);
		expect(m[2], "core's 2px img radius is back").toMatch(/border-radius:\s*0/);
	});
});

describe("an unframed portrait is cropped the same way whoever supplied the art", () => {
	// The two surfaces that draw an actor's picture as a bare <img>, outside any clipping box: the
	// sheet header and the Actors sidebar row. Both used to be `object-fit: contain` with an
	// `[src*="/assets/bestiary/"]` exception cropping the shipped Book II illustrations, which
	// letterboxed to a thin strip otherwise. That made the crop a property of the ASSET FOLDER —
	// the same tall figure landed on its face if it shipped with the system and shrank into a
	// letterbox if a GM had browsed to it — while the NPC header, whose inner image has always sat
	// on the shared crop rule, cropped both.
	it.each([
		[".stonetop-portrait"],
		["#actors .directory-item img"],
	])("%s crops top-anchored, like every clipping box in the system", (selector) => {
		const declarations = block(selector);
		expect(declarations, `${selector} is gone`).toBeTruthy();
		expect(declarations).toMatch(/object-fit:\s*cover/);
		expect(declarations).toMatch(/object-position:\s*center top/);
	});

	it("keeps no object-fit exception scoped to an asset path", () => {
		// A path-scoped rule is invisible to the person it fails: nothing is broken, the picture is
		// just smaller than the one beside it, and no amount of reading the header markup explains
		// why. The answer for art the blind crop guesses wrong on is the frame pip on the picture.
		expect(CSS).not.toMatch(/\[src\*=\s*["']?[^"'\]]*\/assets\/bestiary\//);
	});
});
