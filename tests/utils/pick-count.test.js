import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import { pickCountLabel } from "../../module/utils/move-picks.js";
import { pickListsHtml, normalizePickPools, tierPickCounts } from "../../module/utils/roll-engine.js";
import { pickableMoveDescription } from "../../module/utils/chat.js";
import { parseArcanumMoves } from "../../module/data/arcana-moves.js";
import { paintPickTally, pickLimitFor, wirePickTally, releaseOverLimit, PICK_TALLY_CLASS } from "../../module/utils/pick-tally.js";
import { pickLimitsFrom } from "../../module/utils/move-picks.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A move that sends its options to chat says how many you may take ONCE, in prose — a lead-in
// above the printed list, or the result line's "Pick 2 from the list below". By the third box a
// player has lost count of what they ticked. The tally above the list says both numbers as one:
// "1/3 options selected".
//
// The tally is painted on the client (stonetop.js#_paintPickCount), because it is derived state
// and would go stale in the message the instant anyone ticked a box. Its denominator is the same
// `data-pick-max*` the cap is enforced from, so the number shown and the number enforced cannot
// drift.

describe("pickCountLabel", () => {
	it("says both numbers when the move's count is known", () => {
		expect(pickCountLabel(0, 1)).toBe("0/1 options selected");
		expect(pickCountLabel(1, 3)).toBe("1/3 options selected");
		expect(pickCountLabel(3, 3)).toBe("3/3 options selected");
	});

	// Better an honest count than a made-up cap: a move whose text move-picks.js would not read
	// confidently ticks freely, and the tally still tells the player where they are.
	it("drops the denominator when nothing knows the cap", () => {
		expect(pickCountLabel(0, null)).toBe("0 options selected");
		expect(pickCountLabel(2, 0)).toBe("2 options selected");
		expect(pickCountLabel(2, undefined)).toBe("2 options selected");
	});

	it("never emits a stray NaN", () => {
		expect(pickCountLabel(undefined, "two")).toBe("0 options selected");
		expect(pickCountLabel(-4, 2)).toBe("0/2 options selected");
	});
});

describe("pickListsHtml stamps the count the result line states", () => {
	const OPTIONS = ["Owain calls for folks to do something", "Wini acts out", "Crinwin jumps your crew"];

	// A love letter draws every tier from ONE list and the tier only says how many to take, so the
	// cap is stamped per tier and read live off the card — a GM Shift Up/Down moves it with the
	// result, exactly as the wording above the list moves.
	it("per tier for a shared pool, so a shift moves the cap with the tier", () => {
		const html = pickListsHtml(normalizePickPools(OPTIONS), "success", { success: 2, partial: 1, failure: 0 });
		expect(html).toContain('data-pick-max-success="2"');
		expect(html).toContain('data-pick-max-partial="1"');
		// A tier that takes none stamps nothing rather than a zero, which would read as a cap of 0.
		expect(html).not.toContain("data-pick-max-failure");
		// One list, not three.
		expect((html.match(/stonetop-picklist"/g) ?? []).length).toBe(1);
	});

	// A homefront move names a different pool per tier, and each list is only ever shown on its
	// own tier — so a flat cap is right there, and no tier lookup is needed to read it.
	it("flat for a per-tier pool, which is only ever shown on its own tier", () => {
		const pools = normalizePickPools({ success: OPTIONS, partial: OPTIONS, failure: ["A consequence"] });
		const html = pickListsHtml(pools, "partial", { success: 2, partial: 1 });
		expect(html).toContain('<ul class="stonetop-picklist" data-pick-max="2"');
		expect(html).toContain('<ul class="stonetop-picklist" data-pick-max="1"');
		// The 6- pool says how many in its own result text, so it carries no count and ticks free.
		expect(html).toContain('<ul class="stonetop-picklist">');
	});

	it("stamps nothing when no tier declares a count", () => {
		expect(pickListsHtml(normalizePickPools(OPTIONS), "success")).not.toContain("data-pick-max");
		expect(pickListsHtml(normalizePickPools(OPTIONS), "success", {})).not.toContain("data-pick-max");
	});

	it("still renders the options themselves either way", () => {
		const html = pickListsHtml(normalizePickPools(OPTIONS), "success", { success: 2 });
		expect((html.match(/stonetop-picklist-check/g) ?? []).length).toBe(3);
		expect(html).toContain('data-index="2"');
	});

	// The other writer of the same attribute, so the two sources stay one reader's problem.
	it("is the same attribute a printed move's list carries", () => {
		const censure = "<p>When you denounce someone, they pick 1:</p><ul><li>Ashamed</li><li>Doubtful</li></ul>";
		expect(pickableMoveDescription(censure)).toContain('data-pick-max="1"');
	});
});

// The two ways a move says how many, and the one shape they both come out as. A love letter
// DECLARES the number (its builder asks for it per tier); a homefront move states it inside the
// tier's own result text and carries no field at all — which is exactly the case that used to
// leave the steading's moves with a tally and no denominator.
describe("tierPickCounts reads the count either way a move states it", () => {
	it("takes a declared count (a love letter's builder asks for one per tier)", () => {
		const counts = tierPickCounts({
			success: { value: "", pick: 2 },
			partial: { value: "", pick: 1 },
			failure: { value: "", pick: 0 },
		});
		expect(counts).toEqual({ success: 2, partial: 1, failure: 0 });
	});

	// Pull Together, Deploy and Muster, as the steading sheet actually writes them.
	it("reads it out of the tier's own prose when no count was declared", () => {
		const counts = tierPickCounts({
			success: { value: "the job gets done." },
			partial: { value: "the job gets done, but pick 1." },
			failure: { value: "the GM chooses 2 consequences." },
		});
		expect(counts.partial).toBe(1);
		expect(counts.failure).toBe(2);
		// A tier that offers no choice reads as no cap, not as a cap of nothing.
		expect(counts.success).toBe(0);
	});

	it("prefers the declared count over the prose when a move has both", () => {
		expect(tierPickCounts({ partial: { value: "pick 1.", pick: 3 } }).partial).toBe(3);
	});

	it("stays at 0 for prose no reader should guess at", () => {
		const counts = tierPickCounts({
			success: { value: "spend Readiness 1-for-1 to do any of these." },
			partial: { value: "the GM makes a move." },
		});
		expect(counts.success).toBe(0);
		expect(counts.partial).toBe(0);
	});

	it("survives a move with no results at all", () => {
		expect(tierPickCounts(null)).toEqual({ success: 0, partial: 0, failure: 0 });
	});
});

// Every surface a move's option list can appear on, and the one that used to be missed.
describe("every move source reaches a tickable, tallied list", () => {
	// A move with no roll posts through StonetopItem#roll from the HOTBAR and from the NPC and
	// monster sheets. It used to post the same text the Moves tab's name-click posts, minus the
	// boxes — so Mighty Thews dragged to the bar offered a "pick 1" nobody could tick.
	it("including a description-only move rolled from the hotbar", () => {
		const item = read("module/item/StonetopItem.js");
		const at = item.indexOf("if (descriptionOnly) {");
		expect(at).toBeGreaterThan(-1);
		expect(item.slice(at, at + 1200)).toContain("moveCardBody(this.system?.description");
	});

	// The steading's homefront moves hand rollStat a pool per tier and state their count in the
	// tier's result text, so they reach the same list and the same reader as everything else.
	it("including the steading's homefront moves", () => {
		const sheet = read("module/actors/steading/StonetopSteadingSheet.js");
		expect(sheet).toContain("pickOptions: flow.pickPools");
		const engine = read("module/utils/roll-engine.js");
		expect(engine).toContain("pickListsHtml(pickPools, result.key, tierPickCounts(moveResults))");
	});

	// An arcanum's mystery is the one move whose list is NOT on a chat card: it picks in the
	// guided dialog and posts what was chosen. Same readout, from the same helper.
	it("including an arcanum mystery, which picks in its dialog", () => {
		const sheet = read("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain('wirePickTally(html[0]?.querySelector(".stonetop-homestead-choice-list"), guide.pickMax, { enforce: true })');
		expect(sheet).toContain("pickMax:    move.pickMax");
	});

	it("and a mystery's cap comes off its own printed lead-in", () => {
		const back = "<h3>Moves</h3>"
			+ "<p><strong>□ EYE OF THE STORM</strong><br>When you call the storm, choose 2:</p>"
			+ "<ul><li>It is quick</li><li>It is quiet</li><li>It spares your own</li></ul>";
		const [move] = parseArcanumMoves(back);
		expect(move.picks).toHaveLength(3);
		expect(move.pickMax).toBe(2);
	});

	it("but a mystery whose lead-in names no number stays uncapped", () => {
		const back = "<h3>Moves</h3>"
			+ "<p><strong>□ MANY GUISES</strong><br>Spend Guise, 1-for-1, to:</p>"
			+ "<ul><li>Look like another</li><li>Sound like another</li></ul>";
		expect(parseArcanumMoves(back)[0].pickMax).toBe(0);
	});

	// A mystery is picked in the dialog BEFORE the dice, so a per-tier count collapses to its
	// HIGHEST: at the moment the boxes are ticked, which tier applies is not yet known. Too loose
	// lets a player tick one more than their roll turned out to allow, with the move's own text
	// beside them saying so; too tight would refuse them what a strong hit plainly grants.
	it("and a tiered mystery takes the most generous tier's count", () => {
		const back = "<h3>Moves</h3>"
			+ "<p><strong>□ EYE OF THE STORM</strong><br>Roll +CON: on a 10+, the elements calm, and choose 2 from the list below; on a 7-9, the elements calm, and choose 1.</p>"
			+ "<ul><li>No harm comes to you</li><li>It lasts a while</li><li>You bend it to a purpose</li></ul>";
		expect(parseArcanumMoves(back)[0].pickMax).toBe(2);
	});
});

// What the parse ACTUALLY derives for the shipped mysteries, pinned the way the moves are in
// tests/utils/move-picks.test.js — so a change to the reader shows up here as a diff rather than
// as a dialog quietly unable to tick what its card allows.
describe("what the shipped mysteries derive", () => {
	const derived = new Map();
	const walk = d => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) { walk(p); continue; }
			if (!e.name.endsWith(".json")) continue;
			let j; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
			const back = j?.flags?.stonetop?.back?.description ?? "";
			if (!back) continue;
			for (const m of parseArcanumMoves(back)) {
				if (m.picks.length) derived.set(`${j.name} :: ${m.name}`, m.pickMax);
			}
		}
	};
	walk(path.resolve(HERE, "../../packs/src/stonetop-arcana"));

	it.each([
		// Two state a count per tier; the rest state one flat ("choose 1", "choose one").
		["Azure Hand :: EYE OF THE STORM", 2],
		["Demonhide Cloak :: THE FLESH REMEMBERS", 1],
		["Azure Hand :: RESONANCE", 1],
		["Shield of the Wisent Witch :: SPIRITS OF THE HERD", 1],
		["Staff of the Lidless Orb :: POWER OF THE LIDLESS ORB", 1],
		["Whispering Rocks :: SHADOW MAGIC", 1],
	])("%s caps at %i", (name, expected) => {
		expect(derived.has(name), `${name} prints no option list`).toBe(true);
		expect(derived.get(name)).toBe(expected);
	});

	it.each([
		// A resource spent one at a time, a move that ADDS to another's list, and a d4 assignment
		// table that is not a choice at all.
		"Demonhide Cloak :: UNHOLY VISAGE",
		"Storm Markings :: CHOSEN OF THE STORM-BRINGER",
		"Ring of Daagon :: CALL UP THE DEEP ONES",
	])("%s ticks freely", name => {
		expect(derived.has(name), `${name} prints no option list`).toBe(true);
		expect(derived.get(name)).toBe(0);
	});

	it("covers every shipped mystery that prints a list", () => {
		expect(derived.size).toBe(9);
	});
});

// The suite runs on `environment: "node"` with no jsdom, so the readout is exercised against a
// stand-in for a list and the boxes in it. That covers the whole of what pick-tally.js does — it
// finds or makes one element, writes text into it, and repaints on change — and the parts it
// cannot see (which list the chat wiring hands over, and when) are asserted on the source below.

/** An element, as far as pick-tally.js is concerned. */
function makeEl(tag = "div") {
	const classes = new Set();
	const el = {
		tagName: tag.toUpperCase(),
		children: [],
		parentNode: null,
		dataset: {},
		textContent: "",
		checked: false,
		listeners: [],
		classList: {
			add:      c => classes.add(c),
			remove:   c => classes.delete(c),
			contains: c => classes.has(c),
			toggle:   (c, on) => (on ? classes.add(c) : classes.delete(c)),
		},
		get className() { return [...classes].join(" "); },
		set className(v) {
			classes.clear();
			for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c);
		},
		get previousElementSibling() {
			const kids = el.parentNode?.children ?? [];
			return kids[kids.indexOf(el) - 1] ?? null;
		},
		// The selector is ignored: every INPUT child of a pick list IS one of its boxes.
		querySelectorAll: () => el.children.filter(c => c.tagName === "INPUT"),
		insertBefore(node, ref) {
			node.parentNode = el;
			const at = el.children.indexOf(ref);
			el.children.splice(at < 0 ? el.children.length : at, 0, node);
			return node;
		},
		addEventListener: (type, fn) => el.listeners.push({ type, fn }),
		fire: (type, target) => el.listeners.filter(l => l.type === type).forEach(l => l.fn({ target })),
	};
	el.ownerDocument = { createElement: makeEl };
	return el;
}

/** A list of boxes inside a parent, ticked as given. */
function fakeList(ticks) {
	const parent = makeEl("div");
	const list = makeEl("ul");
	list.parentNode = parent;
	parent.children.push(list);
	const boxes = ticks.map(on => {
		const box = makeEl("input");
		box.checked = on;
		box.parentNode = list;
		list.children.push(box);
		return box;
	});
	return { parent, list, boxes };
}

const readoutOf = parent => parent.children.find(c => c.classList.contains(PICK_TALLY_CLASS)) ?? null;

/**
 * A pick list as `pickLimitFor` sees it: the `data-pick-max*` it carries, and the card around it.
 * `tier` is the result line's class on a card that rolled; `card: false` is the Moves tab's
 * printed move, posted to a `.stonetop-chat-move` that has no result line to read at all.
 */
function fakePickList(dataset, { card = true, tier = null } = {}) {
	const result = tier ? { classList: { contains: c => c === tier } } : null;
	const cardEl = { querySelector: sel => (sel === ".stonetop-roll-result" ? result : null) };
	return { dataset, closest: sel => (card && sel === ".stonetop-roll-card" ? cardEl : null) };
}

describe("pickLimitFor", () => {
	it("takes a flat cap as stated, whatever the card rolled", () => {
		expect(pickLimitFor(fakePickList({ pickMax: "2" }, { tier: "failure" }))).toBe(2);
	});

	it("reads a per-tier cap against the tier the card actually rolled", () => {
		const forage = { pickMaxSuccess: "2", pickMaxPartial: "1" };
		expect(pickLimitFor(fakePickList(forage, { tier: "success" }))).toBe(2);
		expect(pickLimitFor(fakePickList(forage, { tier: "partial" }))).toBe(1);
	});

	// The 6- hands over the whole list, and the 10+'s 2 has no business capping it.
	it("leaves a rolled tier that stamped no count of its own ticking free", () => {
		expect(pickLimitFor(fakePickList({ pickMaxSuccess: "2" }, { tier: "failure" }))).toBeNull();
	});

	// The Moves tab posts a move's printed list on a card that never rolled, so a move stating
	// its count per tier arrives with both counts and no tier to choose between them. Reading
	// nothing there loses the cap AND the tally's denominator, which is what left Clash,
	// Interfere, Seek Insight, The Hammer and the Book, Work With What You've Got and Formidable
	// ticking free under a bare "0 options selected".
	it("stands in the most generous tier when no roll says which applies", () => {
		expect(pickLimitFor(fakePickList({ pickMaxSuccess: "2", pickMaxPartial: "1" }, { card: false }))).toBe(2);
		expect(pickLimitFor(fakePickList({ pickMaxPartial: "1" }, { card: false }))).toBe(1);
	});

	// Same reasoning as data/arcana-moves.js, where a mystery is picked in its dialog BEFORE the
	// dice: too loose lets a player tick one more than a weak hit turned out to allow, with the
	// move's own ladder printed beside them saying so; too tight refuses what a 10+ plainly grants.
	it("stands in the maximum on a card whose result line is not there either", () => {
		expect(pickLimitFor(fakePickList({ pickMaxSuccess: "1", pickMaxPartial: "3" }))).toBe(3);
	});

	it("caps nothing when nothing was stamped", () => {
		expect(pickLimitFor(fakePickList({}, { card: false }))).toBeNull();
		expect(pickLimitFor(fakePickList({ pickMax: "0" }, { tier: "success" }))).toBeNull();
		expect(pickLimitFor(null)).toBeNull();
	});

	// End to end on the move that regressed: its own shipped text, through the composer the Moves
	// tab posts with, into the reader the boxes are enforced by.
	it("caps Clash's printed list, as posted from the Moves tab", () => {
		const clash = "<p>When you fight, roll +STR: on a 10+, it works and pick 1:</p>"
			+ "<ul><li>Avoid your enemy's attack</li><li>Strike hard and fast</li></ul>";
		const html = pickableMoveDescription(clash);
		const dataset = {};
		for (const [, tier, n] of html.matchAll(/data-pick-max-(success|partial|failure)="(\d+)"/g)) {
			dataset[`pickMax${tier[0].toUpperCase()}${tier.slice(1)}`] = n;
		}
		expect(dataset).toEqual({ pickMaxSuccess: "1" });
		expect(pickLimitFor(fakePickList(dataset, { card: false }))).toBe(1);
	});
});

describe("paintPickTally", () => {
	it("puts the tally immediately before the list it counts", () => {
		const { parent, list } = fakeList([false, false, false]);
		paintPickTally(list, 2);
		expect(parent.children[0].textContent).toBe("0/2 options selected");
		expect(parent.children[1]).toBe(list);
	});

	it("counts the ticks, not the options", () => {
		const { parent, list } = fakeList([true, false, true]);
		paintPickTally(list, 3);
		expect(readoutOf(parent).textContent).toBe("2/3 options selected");
	});

	it("says the list is full, so the next tick's release is not a surprise", () => {
		const { parent, list } = fakeList([true, true, false]);
		paintPickTally(list, 2);
		expect(readoutOf(parent).classList.contains("is-full")).toBe(true);
	});

	it("drops is-full again when a tick is let go", () => {
		const { parent, list, boxes } = fakeList([true, true]);
		paintPickTally(list, 2);
		boxes[0].checked = false;
		paintPickTally(list, 2);
		expect(readoutOf(parent).classList.contains("is-full")).toBe(false);
		expect(readoutOf(parent).textContent).toBe("1/2 options selected");
	});

	// Repainted many times over one card's life — every tick, and every re-render.
	it("reuses the readout rather than stacking a second above the first", () => {
		const { parent, list } = fakeList([false]);
		paintPickTally(list, 1);
		paintPickTally(list, 1);
		paintPickTally(list, 1);
		expect(parent.children.filter(c => c.classList.contains(PICK_TALLY_CLASS))).toHaveLength(1);
	});

	it("has nothing to say about a list with no boxes, and makes nothing", () => {
		const { parent, list } = fakeList([]);
		expect(paintPickTally(list, 2)).toBeNull();
		expect(parent.children).toHaveLength(1);
	});

	it("does not throw on a list that is not there", () => {
		expect(paintPickTally(null, 2)).toBeNull();
	});
});

describe("wirePickTally", () => {
	// One listener on the LIST, not one per box: a change bubbles, so the count is right however
	// many boxes there are and whatever else changed them.
	it("repaints when a box in the list changes", () => {
		const { parent, list, boxes } = fakeList([false, false]);
		wirePickTally(list, 2);
		expect(readoutOf(parent).textContent).toBe("0/2 options selected");
		boxes[1].checked = true;
		list.fire("change", boxes[1]);
		expect(readoutOf(parent).textContent).toBe("1/2 options selected");
	});

	it("binds once, however many times the dialog re-renders", () => {
		const { list } = fakeList([false]);
		wirePickTally(list, 1);
		wirePickTally(list, 1);
		expect(list.listeners).toHaveLength(1);
	});

	// A dialog's boxes have no handler of their own, so this listener is also where the cap is
	// kept — a mystery that says "choose 2" must not quietly submit three.
	it("enforces the cap when asked, and the tally reflects the release", () => {
		const { parent, list, boxes } = fakeList([true, true, false]);
		wirePickTally(list, 2, { enforce: true });
		boxes[2].checked = true;
		list.fire("change", boxes[2]);
		expect(boxes.map(b => b.checked)).toEqual([false, true, true]);
		expect(readoutOf(parent).textContent).toBe("2/2 options selected");
	});

	it("leaves the boxes alone when not asked to enforce", () => {
		const { list, boxes } = fakeList([true, true, false]);
		wirePickTally(list, 2);
		boxes[2].checked = true;
		list.fire("change", boxes[2]);
		expect(boxes.map(b => b.checked)).toEqual([true, true, true]);
	});
});

// Releasing is NOT permission to exceed the count — it never leaves the list over the cap. It is
// only what a click PAST the cap means: honour it, drop the oldest. The click always lands, which
// is what makes a "pick 1" behave like the radio a reader expects, and — since the cap is read
// from prose rather than authored — means a misread can only ever change WHICH options are held,
// never block a player from taking what their move grants.
describe("releaseOverLimit", () => {
	it("makes a pick-1 behave like a radio", () => {
		const { list, boxes } = fakeList([true, false]);
		releaseOverLimit(list, boxes[1], 1);
		boxes[1].checked = true;
		expect(boxes.map(b => b.checked)).toEqual([false, true]);
	});

	// The new tick is excluded from the candidates BEFORE the count. Skipping it inside the loop
	// would spare it and release one fewer than needed, leaving the list one over its limit.
	it("releases enough even when the new tick is also the earliest", () => {
		const { list, boxes } = fakeList([true, true, true]);
		const released = releaseOverLimit(list, boxes[0], 2);
		expect(released).toEqual([boxes[1]]);
		expect(boxes.map(b => b.checked)).toEqual([true, false, true]);
	});

	it("hands back what it let go, so a caller can undo its own styling", () => {
		const { list, boxes } = fakeList([true, true, false]);
		expect(releaseOverLimit(list, boxes[2], 2)).toEqual([boxes[0]]);
	});

	it("never leaves a list over its cap", () => {
		const { list, boxes } = fakeList([true, true, true, true]);
		releaseOverLimit(list, boxes[3], 2);
		expect(boxes.filter(b => b.checked)).toHaveLength(2);
	});

	// An uncapped list is left entirely alone — which is the whole safety valve behind reading a
	// count from prose. See the Disembodied case below.
	it("does nothing without a cap", () => {
		const { list, boxes } = fakeList([true, true, true]);
		expect(releaseOverLimit(list, boxes[2], 0)).toEqual([]);
		expect(releaseOverLimit(list, boxes[2], null)).toEqual([]);
		expect(boxes.every(b => b.checked)).toBe(true);
	});

	it("does not throw on a list that is not there", () => {
		expect(releaseOverLimit(null, null, 2)).toEqual([]);
	});

	// WHICH lead-ins get a cap at all is the reader's business, pinned against every shipped move
	// in tests/utils/move-picks.test.js — the one whose rules genuinely let you go over (the
	// Ghost's Disembodied, "for each additional option you pick, lose 1d4 HP") is refused a cap
	// there, so it arrives here with none and this releases nothing.
	it("is what an uncapped move relies on to stay uncapped", () => {
		const { list, boxes } = fakeList([true, true, true]);
		expect(releaseOverLimit(list, boxes[2], pickLimitsFrom("pick 1. For each additional option you pick, lose 1d4 HP:"))).toEqual([]);
		expect(boxes.every(b => b.checked)).toBe(true);
	});
});

describe("the chat card's tally rides the wiring that is already there", () => {
	const SRC = read("stonetop.js");

	it("reads its denominator from the one cap reader, so shown and enforced agree", () => {
		const at = SRC.indexOf("function _paintPickCount");
		expect(at).toBeGreaterThan(-1);
		expect(SRC.slice(at, at + 400)).toContain("paintPickTally(list, pickLimitFor(list))");
	});

	// The same release the dialog uses, so the two surfaces cannot drift on what a click past
	// the cap does. All this surface adds is dropping the released row's picked styling.
	it("releases an over-cap tick through the shared rule", () => {
		const at = SRC.indexOf("function _releasePicksOverLimit");
		expect(at).toBeGreaterThan(-1);
		const body = SRC.slice(at, at + 400);
		expect(body).toContain("releaseOverLimit(list, justChecked, pickLimitFor(list))");
		expect(body).toContain('classList.remove("is-picked")');
	});

	// After the release, not before — a tick that pushed the list over its cap has just let an
	// earlier one go, and a tally painted first would read one too many.
	it("repaints after a tick, once the over-limit release has run", () => {
		const at = SRC.indexOf("if (box.checked) _releasePicksOverLimit(box);");
		expect(at).toBeGreaterThan(-1);
		expect(SRC.slice(at, at + 400)).toContain("_paintPickCount(box.closest");
	});

	// The wiring loop skips a box that is already wired, which on a re-render is every box on the
	// card — so a tally painted inside it would never update after a GM's Shift Up/Down.
	it("paints outside the loop that skips already-wired boxes", () => {
		const wire = SRC.indexOf("function _chatWireRollCardPicks");
		const paint = SRC.indexOf("_paintPickCount(list)", wire);
		expect(paint).toBeGreaterThan(SRC.indexOf('box.dataset.picksWired = "1"', wire));
		expect(SRC.slice(wire)).toContain('new Set(boxes.map(b => b.closest(".stonetop-picklist")))');
	});

	it("is styled in every home the checklist has, chat and dialog alike", () => {
		const css = read("styles/stonetop.css");
		const homes = ":is(.stonetop-roll-card-picklist, .stonetop-chat-move-description, .stonetop-roll-card-description)";
		expect(css).toContain(`${homes} .stonetop-picklist-count`);
		expect(css).toContain(`${homes} .stonetop-picklist-count.is-full`);
		expect(css).toContain(".stonetop-homestead-reference .stonetop-picklist-count");
		expect(css).toContain(".stonetop-homestead-reference .stonetop-picklist-count.is-full");
	});
});

