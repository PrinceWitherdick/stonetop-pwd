import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { pickLimitsFrom } from "../../module/utils/move-picks.js";

// How many of a move's printed options you may take is printed too, in the lead-in above the
// list. It is read from there rather than restated anywhere, so it cannot drift from the move —
// but reading prose is a guess, and the guess is DELIBERATELY TIMID: a cap that is too low
// blocks a player from taking what the move grants, which is worse than no cap at all.

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("pickLimitsFrom", () => {
	it("reads a flat count", () => {
		expect(pickLimitsFrom("When you help someone who has not yet rolled, the GM picks 1:")).toBe(1);
		expect(pickLimitsFrom("you can ask the GM 2 of the following and get a useful answer:")).toBe(2);
		expect(pickLimitsFrom("take turns asking a PC or NPC one of the following.")).toBe(1);
	});

	it("ties each count to the tier it follows", () => {
		expect(pickLimitsFrom("on a 10+, deal your damage and pick 2; on a 7-9, deal damage and pick 1:"))
			.toEqual({ success: 2, partial: 1 });
		// "10+" ends in a non-word character, so a `\b` after it can never match — the bug this
		// case exists for read every tiered move as "only the 7-9 is capped".
		expect(pickLimitsFrom("on a 10+, pick 2; on a 7-9, pick 1:")).toEqual({ success: 2, partial: 1 });
		expect(pickLimitsFrom("on a 6-, your time has come, choose 1:")).toEqual({ failure: 1 });
	});

	it("reads tiers written with an en dash, as the book writes them", () => {
		// Raw "7&ndash;9" is not "7-9" to any pattern here. Left undecoded, the preceding
		// "on a 10+" swallows the 7-9's own count and caps the strong hit with it.
		expect(pickLimitsFrom("on a 10+, your actions are your own; on a 7&ndash;9, choose 1:"))
			.toEqual({ partial: 1 });
	});

	it("will not read a per-person count as a cap on the list", () => {
		// Two get chosen, and how many people are choosing is not something this can count.
		// Per SEGMENT, so the plain "choose 1" on the tier beside it survives.
		expect(pickLimitsFrom("on a 10+, you must choose 1 consequence; on a 7-9, you and the GM each choose 1."))
			.toEqual({ success: 1 });
		expect(pickLimitsFrom("you and the GM each pick 1 from the list:")).toBeNull();
	});

	it("falls back to the flat count when the tiers carry none of their own", () => {
		expect(pickLimitsFrom("they pick 1 from the list below; on a 10+, you also have advantage."))
			.toBe(1);
	});

	// "Unbounded" is read against the TIER'S OWN sentence, not the whole lead-in. A tier that
	// hands over the entire list is not a tier without a count — it is a different tier, and it
	// has no business speaking for its neighbours.
	it("caps the tiers that state a count, even when another grants the whole list", () => {
		// Dark Succor and Undying, as the book prints them. That closing "all 3 apply" used to
		// veto the two real counts along with itself: a player who rolled a 10+ saw no cap and no
		// "0/1" over their boxes, on a move whose own text says choose 1.
		expect(pickLimitsFrom("on a 10+, choose 1; on a 7-9, choose 2; on a 6-, all 3 apply:"))
			.toEqual({ success: 1, partial: 2 });
		expect(pickLimitsFrom("on a 10+, regain half your max HP and choose 1; on a 7-9, regain half your max HP and choose 2; on a 6-, either regain 1 HP and all 3 apply, or give up this insert."))
			.toEqual({ success: 1, partial: 2 });
	});

	it("still leaves the unbounded tier itself uncapped", () => {
		// Naming only the tiers that answered is what frees the 6- to take the whole list.
		expect(pickLimitsFrom("on a 10+, choose 1; on a 6-, all 3 apply:")).toEqual({ success: 1 });
	});

	it("refuses to cap what it cannot read confidently", () => {
		// Spent one at a time for as long as the resource lasts.
		expect(pickLimitsFrom("hold 2 Resolve. You can spend your Resolve 1-for-1 to:")).toBeNull();
		// A tally, not a choice.
		expect(pickLimitsFrom('Answer these questions as a group. For each "yes," everyone marks XP.')).toBeNull();
		// A move that ADDS to a question list rather than choosing from it.
		expect(pickLimitsFrom("When you Seek Insight, add the following to the list of questions you can ask:")).toBeNull();
		// "both apply" on the better tier would make any single number a cap that blocks it. The
		// count here hangs off no tier the card models ("on a 7+" spans two), so there is nothing
		// to attach it to and the whole move stays free rather than guessing.
		expect(pickLimitsFrom("they pick 1; on a 10+, as a 7-9, but both apply.")).toBeNull();
		// Danu's Grasp in full, which is where that sentence comes from.
		expect(pickLimitsFrom("on a 7+, roots, vines, and earth pull at them, and they pick 1; on a 10+, as a 7-9, but both apply.")).toBeNull();
		// The one shipped move whose rules DO let you go over the count — the extra options are
		// paid for, not forbidden — so it must reach the card with no cap at all.
		expect(pickLimitsFrom("the world becomes clear and pick 1. For each additional option you pick, lose 1d4 HP:")).toBeNull();
		// Two different numbers with no tier to hang them on.
		expect(pickLimitsFrom("pick 1 of these, then choose 3 of these:")).toBeNull();
		// No count at all.
		expect(pickLimitsFrom("hold Preparation based on the amount of time you devote:")).toBeNull();
		expect(pickLimitsFrom("")).toBeNull();
	});
});

// The whole point of the guard: what the parse ACTUALLY derives for the shipped moves, pinned so
// a change to the reader (or to a move's text) shows up here as a diff rather than as a table
// quietly unable to tick what its move allows.
describe("what the shipped moves derive", () => {
	const strip = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	const derived = new Map();
	const walk = d => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) { walk(p); continue; }
			if (!e.name.endsWith(".json")) continue;
			let j; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
			if (j?.type !== "move") continue;
			const desc = j.system?.description ?? "";
			const ul = /<ul\b[^>]*>([\s\S]*?)<\/ul>/i.exec(desc);
			if (!ul || /<ul\b/i.test(ul[1]) || !/<li\b/i.test(ul[1])) continue;
			derived.set(j.name, pickLimitsFrom(strip(desc.slice(0, ul.index))));
		}
	};
	walk(path.resolve(HERE, "../../packs/src/stonetop-items"));

	it.each([
		["Aid", 1], ["Censure", 1], ["Mighty Thews", 1], ["Keep Company", 1], ["Read the Land", 1],
		["Up With People", 1], ["Under Your Skin", 1], ["Rapier Wit", 1], ["Make Camp", 1],
		["Meet with Disaster", 1], ["Stentorian", 1], ["Alpha", 1], ["Clash", { success: 1 }],
		["Magpie", 2], ["Warden of the Wild", 2],
		["Ambush", { success: 2, partial: 1 }], ["Forage", { success: 2, partial: 1 }],
		["Burgle", { success: 2, partial: 1 }], ["Call the Shot", { success: 2, partial: 1 }],
		["Muster", { success: 2, partial: 1 }], ["Seek Insight", { success: 3, partial: 1 }],
		["Interfere", { success: 1, partial: 1 }], ["Urges", { partial: 1 }],
		// "you and the GM each choose 1": two get chosen on a 7-9, so only its 10+ is capped.
		["Invoke the Sun God", { success: 1 }],
		["Death's Door", { failure: 1 }], ["Let Fly", { partial: 1 }], ["Deploy", { partial: 1 }],
		// Both close on "all 3 apply", which speaks for its own 6- and not for the tiers above it.
		["Dark Succor", { success: 1, partial: 2 }], ["Undying", { success: 1, partial: 2 }],
	])("%s caps at %o", (name, expected) => {
		expect(derived.has(name), `${name} prints no option list`).toBe(true);
		expect(derived.get(name)).toEqual(expected);
	});

	// Left uncapped on purpose — each says "as often as you like" in its own way, or says
	// nothing this reader is willing to guess at.
	it.each([
		"Anger is a Gift", "Defend", "Silver Tongued", "We Happy Few", "Strengthen Your Bond",
		"End of Session", "Situational Awareness", "Predator", "Order Followers", "Outfit",
		"Bolster", "Danu's Grasp", "Disembodied", "Denouement",
		"Take the Measure",
	])("%s ticks freely", name => {
		expect(derived.has(name), `${name} prints no option list`).toBe(true);
		expect(derived.get(name)).toBeNull();
	});
});
