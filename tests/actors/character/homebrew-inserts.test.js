import { describe, it, expect } from "vitest";
import {
	insertOpening, listAllowance, listRequirement, optionCount, picksMade, pickedLabels, insertFormGear, flagOverPicks, insertTabKey, plainOption,
} from "../../../module/actors/character/homebrew-inserts.js";
import { insertGearFromOption } from "../../../module/playbooks/insert-gear.js";
import { weaponMetaFromNote } from "../../../module/data/weapon-from-note.js";
import { normalizeBundle, bundleToItemData } from "../../../module/playbooks/homebrew-bundle.js";

// An original insert (none of it from a published playbook): the Tester's Toolbox, opened by Tooled
// Up, with gadgets to tick (a weapon, an armor, a trait printed ticked) and tricks of its own.
const { bundle } = normalizeBundle({
	format: "stonetop-homebrew-playbook", version: 1,
	playbook: {
		name: "The Tester",
		inserts: [{
			name: "Tester's Toolbox", unlockedBy: "Tooled Up", form: { enabled: true },
			lists: [
				{ title: "Gadgets", pick: 2, bonusPicks: [{ move: "Extra Gear", count: 1 }], options: [
					{ description: "Spring Fist: d6+1 (close, forceful)" },
					{ description: "Tin Plate: Armor 1" },
					{ description: "Brass Knuckle Plates: +1 armor" },
					{ description: "Wind-up wings: allow short hops" },
					{ description: "humming", preselected: true },
					{ description: "Something else", freeText: true },
				] },
				{ title: "Tricks", kind: "moves", pick: 1, perUnlock: 1 },
			],
		}],
	},
	moves: [{ name: "Tooled Up", repeatMax: 3 }, { name: "Extra Gear", insert: "tester-s-toolbox", insertList: "tricks" }],
});
const INSERT = bundleToItemData(bundle, { slug: "homebrew-the-tester" }).playbook.flags.stonetop.inserts[0];
const [GADGETS, TRICKS] = INSERT.lists;
const move = (name, extra = {}) => ({ type: "move", name, flags: {}, ...extra });
const opt = label => GADGETS.options.find(o => plainOption(o.description).startsWith(label));

describe("whether an insert is open", () => {
	it("opens with a learned copy of its move, and counts the copies", () => {
		expect(insertOpening(INSERT, [])).toEqual({ open: false, copies: 0 });
		expect(insertOpening(INSERT, [move("Tooled Up"), move("tooled up")])).toEqual({ open: true, copies: 2 });
		// A copy switched off (its granter unlearned) doesn't open it.
		expect(insertOpening(INSERT, [move("Tooled Up", { flags: { "stonetop-pwd": { learned: false } } })]).open).toBe(false);
	});

	it("is open to everyone when no move opens it", () => {
		expect(insertOpening({ ...INSERT, unlockedBy: "" }, [])).toEqual({ open: true, copies: 1 });
	});
});

describe("how many picks a list allows", () => {
	it("its own count, more per extra copy of the opening move, more for a learned bonus move", () => {
		expect(listAllowance(TRICKS, 1, [])).toBe(1);
		expect(listAllowance(TRICKS, 3, [])).toBe(3);
		expect(listAllowance(GADGETS, 1, [])).toBe(2);
		expect(listAllowance(GADGETS, 1, [move("Extra Gear")])).toBe(3);
	});
});

describe("what has been picked", () => {
	const slug = GADGETS.slug;
	it("a printed-ticked option counts as ticked until it's unticked, and costs no pick", () => {
		const humming = opt("humming");
		expect(optionCount({}, slug, humming)).toBe(1);
		expect(optionCount({ [`${slug}:${humming.slug}`]: 0 }, slug, humming)).toBe(0);
		const counts = { [`${slug}:${opt("Spring Fist").slug}`]: 1 };
		expect(picksMade(INSERT, GADGETS, counts, {})).toBe(1);
		expect(pickedLabels(INSERT, GADGETS, counts, {})).toEqual(["Spring Fist: d6+1 (close, forceful)", "humming"]);
	});

	it("a write-in is a tick with a blank, and counts when ticked", () => {
		const other = opt("Something else");
		expect(other.description).toMatch(/___$/);
		expect(picksMade(INSERT, GADGETS, { [`${slug}:${other.slug}`]: 1 }, { [`${slug}:${other.slug}`]: "a periscope" })).toBe(1);
	});

	it("a typed write-in (an insert stored before write-ins became blanks) counts once it has words", () => {
		const legacy = { ...GADGETS, options: [...GADGETS.options, { slug: "old-write-in", description: "Something else", type: "text" }] };
		expect(picksMade(INSERT, legacy, {}, { [`${slug}:old-write-in`]: "a periscope" })).toBe(1);
	});

	it("over the count is flagged on every pick, never refused", () => {
		const entry = { options: [{ count: 1 }, { count: 0 }, { count: 1 }] };
		flagOverPicks(entry, { allowance: 1, made: 2, listTitle: "Gadgets" });
		expect(entry.options.map(o => !!o.caution)).toEqual([true, false, true]);
		const fine = { options: [{ count: 1 }] };
		flagOverPicks(fine, { allowance: 2, made: 1, listTitle: "Gadgets" });
		expect(fine.options[0].caution).toBeUndefined();
	});
});

describe("what the form gives while worn", () => {
	const ticked = (...labels) => Object.fromEntries(labels.map(l => [`${GADGETS.slug}:${opt(l).slug}`, 1]));

	it("reads a weapon, an armor and an armor bonus off the options' words; a trait gives nothing", () => {
		expect(insertGearFromOption("Razor Claws: d8+2 (close, messy)")).toEqual({ kind: "weapon", name: "Razor Claws", note: "damage d8+2, close, messy" });
		expect(insertGearFromOption("Chitinous Shell or Thick Hide: Armor 2")).toEqual({ kind: "armor", name: "Chitinous Shell or Thick Hide", armor: { base: 2 } });
		expect(insertGearFromOption("Plates: +1 armor")).toEqual({ kind: "armor", name: "Plates", armor: { modifier: 1 } });
		expect(insertGearFromOption("Leathery Wings: allow for short bouts of flight")).toBeNull();
		expect(insertGearFromOption("Regeneration: +4HP/heal injuries on Recovery")).toBeNull();
	});

	it("a weapon's note is read by the shared tag-line reader, its own die and all", () => {
		const meta = weaponMetaFromNote("Razor Claws", insertGearFromOption("Razor Claws: d8+2 (close, messy)").note);
		expect(meta).toMatchObject({ damageDie: "d8+2", range: ["close"], tags: ["messy"] });
		expect(weaponMetaFromNote("Horns", insertGearFromOption("Horns: d8+3 (close, 2 piercing)").note)).toMatchObject({ damageDie: "d8+3", piercing: 2 });
	});

	it("only while worn, only from an open insert, only for ticked options", () => {
		const counts = ticked("Spring Fist", "Tin Plate", "Wind-up");
		expect(insertFormGear(INSERT, { counts, open: true, wearing: false })).toEqual([]);
		expect(insertFormGear(INSERT, { counts, open: false, wearing: true })).toEqual([]);
		const gear = insertFormGear(INSERT, { counts, open: true, wearing: true });
		expect(gear.map(g => [g.name, g.kind])).toEqual([["Spring Fist", "weapon"], ["Tin Plate", "armor"]]);
		expect(gear[1]).toMatchObject({ armor: { base: 1 }, note: null });
		expect(gear[0].slug).toBe(`hbinsert:tester-s-toolbox:gadgets:${opt("Spring Fist").slug}`);
	});

	it("never from an insert with no form", () => {
		const counts = ticked("Spring Fist");
		expect(insertFormGear({ ...INSERT, form: { enabled: false } }, { counts, open: true, wearing: true })).toEqual([]);
	});

	it("names each insert's tab", () => {
		expect(insertTabKey(INSERT.key)).toBe("hb-insert-tester-s-toolbox");
	});
});

describe("the picks a list still owes", () => {
	it("owes a list's minimum, not its most: \"pick 1 or 2\" owes one", () => {
		expect(listRequirement({ pick: 2, min: 1 }, 2)).toBe(1);
		expect(listRequirement({ pick: 2, min: 2 }, 2)).toBe(2);
	});

	it("owes every extra a move or a second copy of the opening move gives", () => {
		expect(listRequirement({ pick: 2, min: 1 }, 4)).toBe(3);
	});

	it("owes the whole count of a list with no minimum", () => {
		expect(listRequirement({ pick: 1, min: 0 }, 1)).toBe(1);
	});
});
