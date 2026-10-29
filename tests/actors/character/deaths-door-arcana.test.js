import { describe, it, expect, vi } from "vitest";
import { readRepo } from "../../fakes/css.js";
import {
	DEATHS_DOOR_ARCANA, dictatedFates, heldDeathsDoorDictates, suggestedDictate,
} from "../../../module/actors/character/deaths-door-arcana.js";

// GM-1: a held arcanum whose marked Consequence decides the Death's Door 6-. Read off the shipped cards' own
// back text, so a reworded pack that loses the box's words fails here rather than silently flagging nothing.

const card = rel => {
	const doc = JSON.parse(readRepo(`packs/src/stonetop-arcana/${rel}.json`));
	const flags = doc.flags.stonetop;
	return { slug: flags.slug, name: flags.front.title, back: flags.back.description };
};

// The □ that heads the box holding these words, counted by hand: the last □ before them, indexed in document order.
const boxOf = (c, words) => {
	const at = c.back.indexOf(words);
	expect(at, `${c.slug} prints "${words}"`).toBeGreaterThan(-1);
	return (c.back.slice(0, c.back.lastIndexOf("□", at)).match(/□/g) ?? []).length;
};

const EFFIGY = card("major/redwood-effigy");
const SPHERE = card("major/norubas-ice-sphere");
const MAW    = card("major/hungering-maw-of-hlad");
const SCALES = card("major/rune-laden-scales");
const CAVE   = card("minor/carvings-in-a-cave");

const ticked = (c, words) => ({ [`${c.slug}:back:${boxOf(c, words)}`]: true });

describe("deaths-door-arcana: which fate a held arcanum dictates", () => {
	it("Redwood Effigy's ticked box dictates refusing, as the Revenant", () => {
		const boxes = ticked(EFFIGY, "you have no choice: gain the Revenant insert");
		expect(dictatedFates([EFFIGY], boxes)).toEqual([
			expect.objectContaining({ slug: "redwood-effigy", name: "Redwood Effigy", fate: "refuse", insert: "revenant", tether: false }),
		]);
	});

	it("Noruba's Ice Sphere's ticked box dictates the Ghost, with the sphere as the tether", () => {
		const boxes = ticked(SPHERE, "gain the Ghost insert (with the Ice Sphere as your tether)");
		expect(dictatedFates([SPHERE], boxes)).toEqual([
			expect.objectContaining({ slug: "norubas-ice-sphere", name: "Noruba's Ice Sphere", fate: "refuse", insert: "ghost", tether: true }),
		]);
	});

	it("the Hungering Maw's ticked box dictates the Last Door: they die and become a wraith", () => {
		const boxes = ticked(MAW, "you die and become a wraith");
		expect(dictatedFates([MAW], boxes)).toEqual([
			expect.objectContaining({ slug: "hungering-maw-of-hlad", fate: "last-door", insert: null }),
		]);
	});

	it("dictates nothing while the box is unticked, or when only another box on the card is", () => {
		expect(dictatedFates([EFFIGY, SPHERE, MAW], {})).toEqual([]);
		// The Effigy's fire Consequence, the box just before the Death's Door one.
		const fire = ticked(EFFIGY, "The effigy becomes both fragile and highly flammable");
		expect(dictatedFates([EFFIGY], fire)).toEqual([]);
		// Ticked, but the card is not one they hold.
		expect(dictatedFates([], ticked(EFFIGY, "you have no choice: gain the Revenant insert"))).toEqual([]);
	});

	it("keys by slug: another card's ticked box at the same index dictates nothing", () => {
		const index = boxOf(EFFIGY, "you have no choice: gain the Revenant insert");
		expect(dictatedFates([EFFIGY], { [`norubas-ice-sphere:back:${index}`]: true })).toEqual([]);
	});

	it("leaves out the Rune-laden Scales and Carvings in a cave: neither dictates the 6-", () => {
		expect(DEATHS_DOOR_ARCANA.map(d => d.slug)).toEqual(["redwood-effigy", "norubas-ice-sphere", "hungering-maw-of-hlad"]);
		const everything = Object.fromEntries([...Array(40).keys()].flatMap(i => [
			[`${SCALES.slug}:back:${i}`, true], [`${CAVE.slug}:back:${i}`, true],
		]));
		expect(dictatedFates([SCALES, CAVE], everything)).toEqual([]);
	});

	it("suggests the first in table order when two are marked, and flags both", () => {
		const boxes = {
			...ticked(SPHERE, "gain the Ghost insert (with the Ice Sphere as your tether)"),
			...ticked(EFFIGY, "you have no choice: gain the Revenant insert"),
		};
		const both = dictatedFates([SPHERE, EFFIGY], boxes);
		expect(both.map(d => d.slug)).toEqual(["redwood-effigy", "norubas-ice-sphere"]);
		expect(suggestedDictate(both).insert).toBe("revenant");
		expect(suggestedDictate([])).toBeNull();
	});
});

describe("deaths-door-arcana: reading what a character holds", () => {
	const holding = ({ owned = [], leads = [], boxes = {} } = {}) => ({
		_arcana: {
			ownedSlugs: new Set(owned),
			leadSlugs:  new Set(leads),
			boxStates:  boxes,
			getArcanum: vi.fn(async slug => {
				const c = [EFFIGY, SPHERE, MAW].find(x => x.slug === slug);
				return c ? { slug: c.slug, front: { title: c.name }, back: { description: c.back } } : null;
			}),
		},
	});

	it("reads an owned card's box and fetches only the cards that can dictate", async () => {
		const character = holding({
			owned: ["norubas-ice-sphere", "staff-of-the-lidless-orb"],
			boxes: ticked(SPHERE, "gain the Ghost insert (with the Ice Sphere as your tether)"),
		});
		const dictates = await heldDeathsDoorDictates(character);
		expect(dictates.map(d => [d.slug, d.name, d.insert])).toEqual([["norubas-ice-sphere", "Noruba's Ice Sphere", "ghost"]]);
		expect(character._arcana.getArcanum).toHaveBeenCalledTimes(1);
	});

	it("skips a lead (not yet in their hands) and a character with no arcana", async () => {
		const boxes = ticked(EFFIGY, "you have no choice: gain the Revenant insert");
		expect(await heldDeathsDoorDictates(holding({ owned: ["redwood-effigy"], leads: ["redwood-effigy"], boxes }))).toEqual([]);
		expect(await heldDeathsDoorDictates({})).toEqual([]);
		expect(await heldDeathsDoorDictates(null)).toEqual([]);
	});
});
