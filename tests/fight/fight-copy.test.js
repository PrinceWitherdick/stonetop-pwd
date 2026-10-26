import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { namesPhrase, fighterReadout, gangedBadge, clusterFacts, clusterRuleKeys, aidsItselfAgainst } from "../../module/fight/fight-copy.js";
import { engage, HEROES, FOES } from "../../module/fight/engagements.js";
import { FIGHT_RULES } from "../../module/fight/fight-rules.js";

// The Fight tab's own computed lines, rendered through the real language file.

const ROOT = path.resolve(import.meta.dirname, "../..");
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8"));

// Fails loudly on a key the language file does not have, rather than printing the key.
const format = (key, data = {}) => {
	const value = key.split(".").reduce((node, part) => node?.[part], EN);
	if (typeof value !== "string") throw new Error(`missing string ${key}`);
	return value.replace(/\{(\w+)\}/g, (m, name) => (name in data ? String(data[name]) : m));
};

const SIZE = 100;
const grid = { size: SIZE };
const at = (id, side, col, row, extra = {}) => ({ id, side, name: id, bodies: 1, rect: { x: col * SIZE, y: row * SIZE, w: SIZE, h: SIZE }, ...extra });
const NAMES = { bram: "Bram", aeliana: "Aeliana", cadi: "Cadi", crinwin: "Crinwin", wolf: "Wolf", crew: "Rhianna's crew", horde: "Crinwin horde" };
const nameOf = id => NAMES[id] ?? id;

describe("a crowd, and a group of followers aiding itself (p.414)", () => {
	it("says when more are on one fighter than can reach them", () => {
		const result = engage({ grid, fighters: [at("bram", HEROES, 0, 0), at("horde", FOES, 1, 0, { bodies: 12 })] });
		expect(clusterFacts(result.clusters[0], result.byFighter, nameOf, format)).toContain("+7 damage on Bram (8 of 12 foes can reach)");
	});

	it("says a group of followers on a single foe, or on a group half its size, aids itself", () => {
		const bodies = { crew: 6, crinwin: 1, horde: 3, big: 4 };
		const bodiesOf = id => bodies[id] ?? 1;
		const onOne = engage({ grid, fighters: [at("crew", HEROES, 0, 0, { bodies: 6 }), at("crinwin", FOES, 1, 0)] });
		expect(aidsItselfAgainst(onOne.byFighter.crew, 6, bodiesOf)).toEqual(["crinwin"]);
		expect(clusterFacts(onOne.clusters[0], onOne.byFighter, nameOf, format, bodiesOf))
			.toContain("Rhianna's crew outnumbers Crinwin: they aid themselves, and the GM picks advantage or more done");
		expect(clusterRuleKeys(onOne.clusters[0], onOne.byFighter, bodiesOf)).toContain("oneRollsOthersAid");
		const onHalf = engage({ grid, fighters: [at("crew", HEROES, 0, 0, { bodies: 6 }), at("horde", FOES, 1, 0, { bodies: 3 })] });
		expect(aidsItselfAgainst(onHalf.byFighter.crew, 6, bodiesOf)).toEqual(["horde"]);
		const onMore = engage({ grid, fighters: [at("crew", HEROES, 0, 0, { bodies: 6 }), at("big", FOES, 1, 0, { bodies: 4 })] });
		expect(aidsItselfAgainst(onMore.byFighter.crew, 6, bodiesOf)).toBeNull();
		expect(aidsItselfAgainst(onOne.byFighter.crinwin, 1, bodiesOf)).toBeNull();
	});
});

describe("namesPhrase", () => {
	it("joins a few names the house way", () => {
		expect(namesPhrase(["Bram"], format)).toBe("Bram");
		expect(namesPhrase(["Bram", "Aeliana"], format)).toBe("Bram & Aeliana");
		expect(namesPhrase(["Bram", "Aeliana", "Cadi"], format)).toBe("Bram, Aeliana & Cadi");
	});

	it("counts the rest of a crowd instead of naming them all", () => {
		expect(namesPhrase(["A", "B", "C", "D", "E"], format)).toBe("A, B & 3 others");
	});

	it("drops blanks", () => {
		expect(namesPhrase(["", "Bram", null], format)).toBe("Bram");
		expect(namesPhrase(undefined, format)).toBe("");
	});
});

describe("fighter readouts and badges", () => {
	const result = engage({
		grid,
		fighters: [at("bram", HEROES, 0, 1), at("aeliana", HEROES, 0, 3), at("cadi", HEROES, 8, 8), at("crinwin", FOES, 0, 2), at("wolf", FOES, 1, 0)],
		ranged: [{ from: "cadi", to: "crinwin" }, { from: "bram", to: "wolf" }],
	});

	it("says who a hero is fighting and shooting at", () => {
		expect(fighterReadout(result.byFighter.bram, HEROES, nameOf, format)).toBe("fighting Crinwin & Wolf");
		expect(fighterReadout(result.byFighter.cadi, HEROES, nameOf, format)).toBe("shooting at Crinwin");
	});

	it("says who a foe is fought and shot at by", () => {
		expect(fighterReadout(result.byFighter.crinwin, FOES, nameOf, format)).toBe("fought by Bram & Aeliana; shot at by Cadi");
	});

	it("says nothing for a fighter who is not engaged", () => {
		const alone = engage({ grid, fighters: [at("bram", HEROES, 0, 0)] });
		expect(fighterReadout(alone.byFighter.bram, HEROES, nameOf, format)).toBe("");
		expect(fighterReadout(undefined, HEROES, nameOf, format)).toBe("");
	});

	it("badges a foe, and a hero, by everyone attacking them", () => {
		expect(gangedBadge(result.byFighter.crinwin, FOES, format)).toEqual({ count: 3, label: "Fought by 3" });
		expect(gangedBadge(result.byFighter.bram, HEROES, format)).toEqual({ count: 2, label: "Facing 2" });
		expect(gangedBadge(result.byFighter.aeliana, HEROES, format)).toBeNull();
	});
});

describe("engagement lines", () => {
	it("names the p.414 bonus on each fighter being ganged up on", () => {
		const result = engage({ grid, fighters: [at("bram", HEROES, 0, 0), at("aeliana", HEROES, 2, 0), at("crinwin", FOES, 1, 0)] });
		expect(clusterFacts(result.clusters[0], result.byFighter, nameOf, format)).toEqual(["+1 damage on Crinwin (2 attackers)"]);
		expect(clusterRuleKeys(result.clusters[0], result.byFighter)).toEqual(["oneRollsOthersAid", "pileOnDamage"]);
	});

	it("names it on a hero facing several foes", () => {
		const result = engage({ grid, fighters: [at("cadi", HEROES, 1, 0), at("crinwin", FOES, 0, 0), at("wolf", FOES, 2, 0)] });
		expect(clusterFacts(result.clusters[0], result.byFighter, nameOf, format)).toEqual(["+1 damage on Cadi (2 foes)"]);
		expect(clusterRuleKeys(result.clusters[0], result.byFighter)).toEqual(["engagesMultiple", "pileOnDamage", "hurtMultiple"]);
	});

	it("says nothing extra about a fight one on one", () => {
		const result = engage({ grid, fighters: [at("bram", HEROES, 0, 0), at("crinwin", FOES, 1, 0)] });
		expect(clusterFacts(result.clusters[0], result.byFighter, nameOf, format)).toEqual([]);
		expect(clusterRuleKeys(result.clusters[0], result.byFighter)).toEqual([]);
	});

	it("gives the group-against-group numbers, with the book's group passages (p.416)", () => {
		const outnumbered = engage({ grid, fighters: [at("crew", HEROES, 0, 0, { bodies: 6 }), at("horde", FOES, 1, 0, { bodies: 20 })] });
		const cluster = outnumbered.clusters[0];
		// No pile-on line on either group: a crew and a horde are each several foes, not one.
		expect(clusterFacts(cluster, outnumbered.byFighter, nameOf, format)).toEqual([
			"Group against group, 6 to 20: +2 damage and armor for the foes",
		]);
		expect(clusterRuleKeys(cluster, outnumbered.byFighter)).toEqual([
			"groupAsOne", "groupOutnumbers", "groupCasualties", "routed",
		]);

		const even = engage({ grid, fighters: [at("crew", HEROES, 0, 0, { bodies: 6 }), at("horde", FOES, 1, 0, { bodies: 7 })] });
		expect(clusterFacts(even.clusters[0], even.byFighter, nameOf, format).at(-1))
			.toBe("Group against group, 6 to 7: neither side outnumbers the other");
		expect(clusterRuleKeys(even.clusters[0], even.byFighter)).not.toContain("groupOutnumbers");
	});

	// FGT-6: a hero in contact with the foes' group holds one of them out of the ratio, and the tab says so.
	it("says which hero holds one of the foes' group out of the group fight", () => {
		const result = engage({
			grid,
			fighters: [at("crew", HEROES, 0, 0, { bodies: 6 }), at("bram", HEROES, 2, 0), at("horde", FOES, 1, 0, { bodies: 20 })],
		});
		const facts = clusterFacts(result.clusters[0], result.byFighter, nameOf, format);
		expect(facts.slice(-2)).toEqual([
			"Group against group, 6 to 19: +2 damage and armor for the foes",
			"Bram holds one of Crinwin horde out of the group fight",
		]);
	});

	it("quotes p.416 on individuals when a PC is in the group scrum", () => {
		const result = engage({
			grid,
			fighters: [at("crew", HEROES, 0, 0, { bodies: 6 }), at("bram", HEROES, 1, 1), at("horde", FOES, 1, 0, { bodies: 12 })],
		});
		expect(clusterRuleKeys(result.clusters[0], result.byFighter)).toContain("engagedByPcs");
	});

	it("only ever asks for passages the rules file has", () => {
		const result = engage({
			grid,
			fighters: [at("crew", HEROES, 0, 0, { bodies: 6 }), at("bram", HEROES, 1, 1), at("horde", FOES, 1, 0, { bodies: 12 }), at("aeliana", HEROES, 2, 0)],
		});
		for (const key of clusterRuleKeys(result.clusters[0], result.byFighter)) expect(FIGHT_RULES[key], key).toBeTruthy();
	});
});

describe("the fight strings", () => {
	it("carry no em dashes", () => {
		const walk = node => (typeof node === "string" ? [node] : Object.values(node).flatMap(walk));
		for (const text of walk(EN.stonetop.fight)) {
			expect(text).not.toContain("—");
			expect(text).not.toContain("&mdash;");
		}
	});
});
