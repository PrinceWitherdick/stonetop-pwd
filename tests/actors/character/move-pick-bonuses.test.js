// What a ROLLER brings to another move's printed list (module/actors/character/move-pick-bonuses.js).
//
// From the 2026-09-25 Fox audit: Perceptive ("When you Seek Insight, you may ask 1 additional
// question. Even on a 6-, you can ask 1 question") was never counted. The Seek Insight card's caps
// are stamped from the move's prose alone (3 on a 10+, 1 on a 7-9, no list on a 6-), so a
// Perceptive Fox's 4th question let go of her 1st, and her miss showed nothing to ask.

import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyPickBonuses, movePickBonusesFor, withMovePickBonuses, MOVE_PICK_BONUSES } from "../../../module/actors/character/move-pick-bonuses.js";
import { pickableMoveDescription, readPickListStamp } from "../../../module/utils/chat.js";
import { moveCardBody } from "../../../module/utils/move-tiers.js";
import { stripHtmlToText } from "../../../module/utils/strings.js";

const ROOT = new URL("../../../packs/src/stonetop-items/", import.meta.url);
const doc = rel => JSON.parse(readFileSync(new URL(rel, ROOT), "utf8"));
const SEEK   = doc("basic-moves/seek-insight.json");
const FORAGE = doc("expedition-moves/forage.json");

const openTag = html => /<ul class="stonetop-picklist"[^>]*>/.exec(html)?.[0] ?? "";
const attr = (tag, name) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const rows = html => (/<ul class="stonetop-picklist"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1].match(/<li\b/g) ?? []).length;

const SCOPE = "stonetop-pwd";
const move = (name, { learned = true } = {}) => ({ type: "move", name, system: {}, flags: learned ? {} : { [SCOPE]: { learned: false } } });
const character = ({ items = [], playbook = "The Fox", background = null } = {}) => ({
	type: "character", system: { playbook: { name: playbook } }, items,
	flags: { [SCOPE]: background ? { background: { selected: background } } : {} },
});
const PERCEPTIVE = MOVE_PICK_BONUSES.find(b => b.ownsLearned === "Perceptive");

describe("applyPickBonuses", () => {
	const seek = pickableMoveDescription(SEEK.system.description);

	it("starts from the book's Seek Insight stamp: 3 on a 10+, 1 on a 7-9, no list on a miss", () => {
		const tag = openTag(seek);
		expect(attr(tag, "data-pick-max-success")).toBe("3");
		expect(attr(tag, "data-pick-max-partial")).toBe("1");
		expect(attr(tag, "data-pick-tiers")).toBe("success partial");
	});

	it("counts Perceptive: 4 on a 10+, 2 on a 7-9, and 1 even on a 6-", () => {
		const tag = openTag(applyPickBonuses(seek, [PERCEPTIVE]));
		expect(attr(tag, "data-pick-max-success")).toBe("4");
		expect(attr(tag, "data-pick-max-partial")).toBe("2");
		expect(attr(tag, "data-pick-max-failure")).toBe("1");
		expect(attr(tag, "data-pick-tiers")).toBe("success partial failure");
	});

	it("spreads a flat cap over the tiers, so the miss floor does not lift the hit", () => {
		const flat = '<ul class="stonetop-picklist" data-pick-max="2" data-pick-tiers="success partial"><li>a</li><li>b</li><li>c</li></ul>';
		const tag = openTag(applyPickBonuses(flat, [{ plus: 1, missFloor: 1 }]));
		expect(attr(tag, "data-pick-max")).toBeNull();
		expect(attr(tag, "data-pick-max-success")).toBe("3");
		expect(attr(tag, "data-pick-max-partial")).toBe("3");
		expect(attr(tag, "data-pick-max-failure")).toBe("1");
	});

	it("adds options at the END, numbered on from the printed ones", () => {
		const out = applyPickBonuses(seek, [{ addOptions: ["What opportunity does no one else see?"] }]);
		expect(rows(out)).toBe(7);
		expect(out).toContain('data-index="6"><span>What opportunity does no one else see?</span>');
		// The count is the move's own: an added question is one more to choose FROM, not one more to ask.
		expect(attr(openTag(out), "data-pick-max-success")).toBe("3");
	});

	it("leaves a card with no tickable list alone", () => {
		expect(applyPickBonuses("<p>No list.</p>", [PERCEPTIVE])).toBe("<p>No list.</p>");
	});

	it("survives the ladder moving the list below it on the real card body", () => {
		const body = moveCardBody(SEEK.system.description, SEEK.system.moveResults);
		expect(attr(openTag(applyPickBonuses(body, [PERCEPTIVE])), "data-pick-max-failure")).toBe("1");
	});
});

describe("movePickBonusesFor", () => {
	it("counts a LEARNED Perceptive only", () => {
		expect(movePickBonusesFor(character({ items: [move("Perceptive")] }), "Seek Insight")).toEqual([PERCEPTIVE]);
		expect(movePickBonusesFor(character({ items: [move("Perceptive", { learned: false })] }), "Seek Insight")).toEqual([]);
		expect(movePickBonusesFor(character({ items: [move("Perceptive")] }), "Know Things")).toEqual([]);
	});

	it("gives The Natural's question to a Fox who took that background, and to no one else", () => {
		const natural = movePickBonusesFor(character({ background: "the-natural" }), "Seek Insight");
		expect(natural.flatMap(b => b.addOptions)).toEqual(["What opportunity does no one else see?"]);
		expect(movePickBonusesFor(character({ background: "a-life-of-crime" }), "Seek Insight")).toEqual([]);
		expect(movePickBonusesFor(character({ playbook: "The Heavy", background: "the-natural" }), "Seek Insight")).toEqual([]);
	});

	// Heavy audit (2026-09-25): Situational Awareness's three questions were never on the list.
	it("adds Situational Awareness's three questions for a Heavy who LEARNED it, without raising the count", () => {
		const heavy = learned => character({ playbook: "The Heavy", items: [move("Situational Awareness", { learned })] });
		const bonuses = movePickBonusesFor(heavy(true), "Seek Insight");
		expect(bonuses.flatMap(b => b.addOptions)).toEqual([
			"Who or what here is the biggest threat?", "What is my enemy's true position?", "What here can I use as a weapon?",
		]);
		const out = applyPickBonuses(pickableMoveDescription(SEEK.system.description), bonuses);
		expect(rows(out)).toBe(9);
		expect(attr(openTag(out), "data-pick-max-success")).toBe("3");
		expect(movePickBonusesFor(heavy(false), "Seek Insight")).toEqual([]);
	});

	// Ranger audit M1: Predator's two questions were never on the list.
	it("adds Predator's two questions for a Ranger who LEARNED it, without raising the count", () => {
		const ranger = learned => character({ playbook: "The Ranger", items: [move("Predator", { learned })] });
		const bonuses = movePickBonusesFor(ranger(true), "Seek Insight");
		expect(bonuses.flatMap(b => b.addOptions)).toEqual([
			"Who or what here is the easiest prey?", "How is ________ weak or vulnerable?",
		]);
		const out = applyPickBonuses(pickableMoveDescription(SEEK.system.description), bonuses);
		expect(rows(out)).toBe(8);
		expect(attr(openTag(out), "data-pick-max-success")).toBe("3");
		expect(movePickBonusesFor(ranger(false), "Seek Insight")).toEqual([]);
	});

	it("reads Survivalist on Forage: one more pick, 1 even on a 6-, and its added option", () => {
		const [b] = movePickBonusesFor(character({ playbook: "The Ranger", items: [move("Survivalist")] }), "Forage");
		const tag = openTag(applyPickBonuses(pickableMoveDescription(FORAGE.system.description), [b]));
		expect(attr(tag, "data-pick-max-success")).toBe("3");
		expect(attr(tag, "data-pick-max-partial")).toBe("2");
		expect(attr(tag, "data-pick-max-failure")).toBe("1");
	});
});

describe("withMovePickBonuses", () => {
	beforeEach(() => {
		globalThis.game ??= {};
		globalThis.game.i18n ??= { format: vi.fn((k, d) => `${k}:${JSON.stringify(d)}`), localize: k => k };
	});

	it("names what changed the count under the list", () => {
		const out = withMovePickBonuses(pickableMoveDescription(SEEK.system.description),
			character({ items: [move("Perceptive")] }), "Seek Insight");
		expect(out).toContain("stonetop-pick-bonus-note");
		expect(stripHtmlToText(out)).toContain("Perceptive");
	});

	it("changes nothing for a roller who brings nothing", () => {
		const html = pickableMoveDescription(SEEK.system.description);
		expect(withMovePickBonuses(html, character(), "Seek Insight")).toBe(html);
	});
});

// Judge audit (2026-09-25): "When you Seek Insight, you can always ask 'What here is tainted by
// chaos?' for free, even on a 6-" (Hound of Aratis, and five more of its shape) did nothing. The
// card showed the book's 3 / 1 / nothing, and the free question nowhere.
describe("free questions", () => {
	// What a roll card shows on `tier`, as the client reads it: the list's cap there (null where
	// stonetop.js hides the list, a tier its stamp does not name), how many boxes it has, and the
	// free-question lines, which sit OUTSIDE the list so its tier-hiding cannot take them along.
	const tierView = (html, tier) => {
		const list = /<ul class="stonetop-picklist"([^>]*)>([\s\S]*?)<\/ul>/.exec(html);
		const { caps, tiers } = readPickListStamp(list[1]);
		const outside = html.replace(list[0], "");
		return {
			cap:   tiers.length && !tiers.includes(tier) ? null : caps[tier],
			boxes: (list[2].match(/stonetop-picklist-check/g) ?? []).length,
			free:  [...outside.matchAll(/<p class="stonetop-free-question"[^>]*>([\s\S]*?)<\/p>/g)].map(m => stripHtmlToText(m[1]).trim()),
		};
	};
	const card = actor => withMovePickBonuses(
		moveCardBody(SEEK.system.description, SEEK.system.moveResults, { pickable: true }), actor, "Seek Insight");
	const judge = (...names) => character({ playbook: "The Judge", items: names.map(n => move(n)) });
	const HOUND = "Free question (Hound of Aratis): What here is tainted by chaos?";

	// The Would-Be Hero's asterisk crosses off "Would-be" when Voice of Experience's free question is asked,
	// so each line names the move that granted it, for a card handler to find.
	it("names its granting move on the line, for a handler to find (Voice of Experience)", () => {
		const hero = character({ playbook: "The Would-Be Hero", items: [move("Voice of Experience")] });
		expect(card(hero)).toContain('<p class="stonetop-free-question" data-free-question="Voice of Experience">');
	});

	it("counts a LEARNED Hound of Aratis only", () => {
		expect(movePickBonusesFor(judge("Hound of Aratis"), "Seek Insight").map(b => b.freeQuestion))
			.toEqual(["What here is tainted by chaos?"]);
		const idle = character({ playbook: "The Judge", items: [move("Hound of Aratis", { learned: false })] });
		expect(movePickBonusesFor(idle, "Seek Insight")).toEqual([]);
		expect(card(idle)).not.toContain("stonetop-free-question");
	});

	it("shows the free question on every tier, the 6- included, without touching the list's caps", () => {
		const html = card(judge("Hound of Aratis"));
		expect(tierView(html, "success")).toEqual({ cap: 3, boxes: 6, free: [HOUND] });
		expect(tierView(html, "partial")).toEqual({ cap: 1, boxes: 6, free: [HOUND] });
		// No list on a 6-, as the book has it: the free question is the only thing to ask.
		expect(tierView(html, "failure")).toEqual({ cap: null, boxes: 6, free: [HOUND] });
		// Not a box, so nothing a tick on it could count toward the cap.
		expect(html).not.toMatch(/<input[^>]*>\s*<span>What here is tainted by chaos\?/);
	});

	it("is not one of the count beside a move that raises it: Perceptive's 4 / 2 / 1 stand", () => {
		const html = card(judge("Hound of Aratis", "Perceptive"));
		expect(tierView(html, "success")).toEqual({ cap: 4, boxes: 6, free: [HOUND] });
		expect(tierView(html, "partial")).toEqual({ cap: 2, boxes: 6, free: [HOUND] });
		expect(tierView(html, "failure")).toEqual({ cap: 1, boxes: 6, free: [HOUND] });
		expect(stripHtmlToText(html)).toContain("Perceptive: 1 more on a hit, and 1 even on a 6-.");
	});

	it("gives each of two free-question moves its own line, in table order", () => {
		const html = card(judge("Vision Unclouded", "Hound of Aratis"));
		expect(tierView(html, "failure").free).toEqual([
			HOUND, "Free question (Vision Unclouded): What here is hidden by illusion or magic?",
		]);
		expect(tierView(html, "success").cap).toBe(3);
	});

	it("reads other playbooks' too: the Ranger's Sniff Out Corruption, and Expert Tracker's narrower trigger", () => {
		const ranger = character({ playbook: "The Ranger", items: [move("Sniff Out Corruption"), move("Expert Tracker")] });
		expect(tierView(card(ranger), "failure").free).toEqual([
			"Free question (Sniff Out Corruption): What here stinks of the unnatural?",
			"Free question (Expert Tracker, when you Seek Insight by searching for or studying the signs left by passing creatures): What happened here recently?",
		]);
	});

	it("rides only the move it names", () => {
		expect(movePickBonusesFor(judge("Hound of Aratis"), "Know Things")).toEqual([]);
	});

	// Seeker audit (2026-09-26): Let's Make a Deal's added question, Deep Insight's extra question "not
	// limited to the list" and Well Versed's Know Things follow-up (both "even on a 6-") did nothing.
	it("reads the Seeker's: Let's Make a Deal's option, Deep Insight's question, Well Versed's follow-up", () => {
		const seeker = (...names) => character({ playbook: "The Seeker", items: names.map(n => (typeof n === "string" ? move(n) : n)) });
		const html = card(seeker("Let's Make a Deal", "Deep Insight"));
		expect(tierView(html, "success")).toEqual({ cap: 3, boxes: 7, free: [
			"Free question (Deep Insight, when you Seek Insight about something magical): one additional question, not limited to the list",
		] });
		expect(stripHtmlToText(html)).toContain("What do they really want or need?");
		expect(tierView(html, "failure").free).toHaveLength(1);

		// Know Things prints no list, so the follow-up goes at the end of the card.
		const know = withMovePickBonuses("<p>Know Things.</p>", seeker("Well Versed"), "Know Things");
		expect(stripHtmlToText(know)).toContain("Free question (Well Versed, when you Know Things about one of your topics): a follow-up question of your choice");
		expect(withMovePickBonuses("<p>Know Things.</p>", seeker(move("Well Versed", { learned: false })), "Know Things")).toBe("<p>Know Things.</p>");
		expect(movePickBonusesFor(seeker(move("Let's Make a Deal", { learned: false })), "Seek Insight")).toEqual([]);
	});

	// Coverage pass (2026-10-16): the Marshal's Like an Open Book (Book I p.127), "When you Take the Measure of
	// someone who fears or respects you, your second question can be anything you want."
	it("reads the Marshal's Like an Open Book on Take the Measure, for a LEARNED move only", () => {
		const marshal = (...items) => character({ playbook: "The Marshal", items });
		const measure = doc("playbook-moves/the-marshal/take-the-measure.json").system.description;
		const html = withMovePickBonuses(pickableMoveDescription(measure), marshal(move("Like an Open Book")), "Take the Measure");
		expect(stripHtmlToText(html)).toContain("Like an Open Book, when you Take the Measure of someone who fears or respects you: your second question can be anything you want.");
		expect(withMovePickBonuses("<p>Take the Measure.</p>", marshal(move("Like an Open Book", { learned: false })), "Take the Measure")).toBe("<p>Take the Measure.</p>");
	});
});

// The added options are the granting text's own words, retyped in the table. Pinned here so a
// reworded source fails a test instead of quietly offering a stale option.
describe("MOVE_PICK_BONUSES quotes its sources", () => {
	const SOURCES = {
		"Survivalist":  () => doc("playbook-moves/the-ranger/survivalist.json").system.description,
		"Perceptive":   () => doc("playbook-moves/the-fox/perceptive.json").system.description,
		"the-natural":  () => doc("playbooks/the-fox.json").flags.stonetop.backgrounds.find(b => b.slug === "the-natural").description,
		"Situational Awareness": () => doc("playbook-moves/the-heavy/situational-awareness.json").system.description,
		"Hound of Aratis":       () => doc("playbook-moves/the-judge/hound-of-aratis.json").system.description,
		"Vision Unclouded":      () => doc("playbook-moves/the-judge/vision-unclouded.json").system.description,
		"Predator":              () => doc("playbook-moves/the-ranger/predator.json").system.description,
		"Sniff Out Corruption":  () => doc("playbook-moves/the-ranger/sniff-out-corruption.json").system.description,
		"Expert Tracker":        () => doc("playbook-moves/the-ranger/expert-tracker.json").system.description,
		"Attuned":               () => doc("playbook-moves/the-seeker/attuned.json").system.description,
		"Let's Make a Deal":     () => doc("playbook-moves/the-seeker/let-s-make-a-deal.json").system.description,
		"Deep Insight":          () => doc("playbook-moves/the-seeker/deep-insight.json").system.description,
		"Well Versed":           () => doc("playbook-moves/the-seeker/well-versed.json").system.description,
		"Voice of Experience":   () => doc("playbook-moves/the-would-be-hero/voice-of-experience.json").system.description,
		"Glorious Servant":      () => doc("playbook-moves/the-lightbearer/glorious-servant.json").system.description,
		"Empowered Invocations": () => doc("playbook-moves/the-lightbearer/empowered-invocations.json").system.description,
		"Like an Open Book":     () => doc("playbook-moves/the-marshal/like-an-open-book.json").system.description,
	};
	for (const b of MOVE_PICK_BONUSES) {
		const key = b.ownsLearned ?? b.background.slug;
		it(`${key} on ${b.move}`, () => {
			const html = SOURCES[key]();
			const text = stripHtmlToText(html).replace(/[“”]/g, '"');
			expect(text).toContain(b.move);
			// An option is quoted in the source's prose ("add 'X' to the list"), or is one whole
			// bullet of the source's own list (Situational Awareness).
			const bullets = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => stripHtmlToText(m[1]).trim());
			for (const option of b.addOptions ?? []) {
				expect(text.includes(`"${option}"`) || bullets.includes(option), option).toBe(true);
			}
			// A free question is quoted in the source, which says it is free even on a miss, and a
			// narrower trigger is the source's own words. One the roller chooses (Deep Insight's, Well
			// Versed's) is not quoted: the line is the source's own description of it.
			if (b.freeQuestion) {
				if (text.includes(`"${b.freeQuestion}"`)) expect(text).toContain(`"${b.freeQuestion}" for free, even on a 6-.`);
				else {
					expect(text).toContain(b.freeQuestion);
					// A line of its own (Like an Open Book's second question opened up) is no extra question.
					if (!b.lineKey) expect(text).toMatch(/even on a 6-/i);
				}
				if (b.when) expect(text).toContain(`When you ${b.when},`);
			}
		});
	}
});

// Lightbearer audit B3: Invoke the Sun God's consequence list. The book caps it 1 on a 10+ and 2 on a
// 7-9 ("you and the GM each choose 1"). Empowered Invocations: "choose an extra consequence before you
// roll"; Glorious Servant: "on a 7-9, you choose a consequence but the GM does not".
describe("Invoke the Sun God's consequence caps", () => {
	const INVOKE = doc("playbook-moves/the-lightbearer/invoke-the-sun-god.json");
	const card = () => pickableMoveDescription(INVOKE.system.description);
	const lb = items => character({ items, playbook: "The Lightbearer" });
	const caps = html => {
		const tag = openTag(html);
		return { success: attr(tag, "data-pick-max-success"), partial: attr(tag, "data-pick-max-partial") };
	};

	beforeEach(() => {
		globalThis.game ??= {};
		globalThis.game.i18n ??= { format: vi.fn((k, d) => `${k}:${JSON.stringify(d)}`), localize: k => k };
	});

	it("starts at the book's 1 on a 10+ and 2 on a 7-9", () => {
		expect(caps(card())).toEqual({ success: "1", partial: "2" });
	});

	it("adds 1 on each tier when THIS roll was empowered, and names it", () => {
		const who = lb([move("Empowered Invocations")]);
		const out = withMovePickBonuses(card(), who, "Invoke the Sun God", { empowered: true });
		expect(caps(out)).toEqual({ success: "2", partial: "3" });
		expect(stripHtmlToText(out)).toContain("Empowered");
		// Learned, but not chosen for this roll: the book's caps stand.
		expect(caps(withMovePickBonuses(card(), who, "Invoke the Sun God"))).toEqual({ success: "1", partial: "2" });
	});

	it("takes the GM's choice off the 7-9 with Glorious Servant learned, and only learned", () => {
		expect(caps(withMovePickBonuses(card(), lb([move("Glorious Servant")]), "Invoke the Sun God")))
			.toEqual({ success: "1", partial: "1" });
		expect(caps(withMovePickBonuses(card(), lb([move("Glorious Servant", { learned: false })]), "Invoke the Sun God")))
			.toEqual({ success: "1", partial: "2" });
	});

	it("lowers first and adds after, with both: 2 and 2", () => {
		const who = lb([move("Glorious Servant"), move("Empowered Invocations")]);
		expect(caps(withMovePickBonuses(card(), who, "Invoke the Sun God", { empowered: true })))
			.toEqual({ success: "2", partial: "2" });
	});

	it("gates the Empowered row on the roll's own context", () => {
		const who = lb([move("Empowered Invocations")]);
		expect(movePickBonusesFor(who, "Invoke the Sun God", { empowered: true }).map(b => b.ownsLearned)).toEqual(["Empowered Invocations"]);
		expect(movePickBonusesFor(who, "Invoke the Sun God", { empowered: false })).toEqual([]);
	});
});
