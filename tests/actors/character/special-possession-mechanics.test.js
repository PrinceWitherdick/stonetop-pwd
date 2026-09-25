import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { possessionTrackUses, BOOKS_AND_SCROLLS, HOLY_RELICS } from "../../../module/actors/character/possession-tracks.js";
import { restockPouch, withTrappingGear } from "../../../module/actors/character/provisions.js";
import { backgroundPossessionSlugs } from "../../../module/actors/character/StonetopCharacter.js";

// The special possessions' own rules, checked against the playbooks (2026-09-24 audit).

const POUCH = "sacred-pouch";
const playbookSource = slug =>
	JSON.parse(readFileSync(`packs/src/stonetop-items/playbooks/${slug}.json`, "utf8")).flags.stonetop.specialPossessions;
const option = (slug, possession) => playbookSource(slug).options.find(o => o.slug === possession);

describe("possession tracks a chat card spends (books & scrolls, holy relics)", () => {
	it("reads null for a character without the possession", () => {
		expect(possessionTrackUses({ selected: [] }, BOOKS_AND_SCROLLS)).toBeNull();
	});

	it("counts uses SPENT, so a fresh track is full", () => {
		expect(possessionTrackUses({ selected: ["books-and-scrolls"] }, BOOKS_AND_SCROLLS))
			.toEqual({ max: 5, spent: 0, left: 5 });
		expect(possessionTrackUses({ selected: ["holy-relics"], uses: { "holy-relics": 2 } }, HOLY_RELICS))
			.toEqual({ max: 3, spent: 2, left: 1 });
	});

	it("matches the printed track lengths", () => {
		expect(option("the-seeker", "books-and-scrolls").resource.max).toBe(BOOKS_AND_SCROLLS.max);
		expect(option("the-lightbearer", "books-and-scrolls").resource.max).toBe(BOOKS_AND_SCROLLS.max);
		expect(option("the-lightbearer", "holy-relics").resource.max).toBe(HOLY_RELICS.max);
	});
});

describe("Forage and the special possessions", () => {
	it("trapping gear adds one use to the payout", () => {
		expect(withTrappingGear("1d6")).toBe("1d6+1");
	});

	// "When you Forage, you can produce Stock instead of provisions."
	it("a pouch takes back only the Stock it is missing", () => {
		expect(restockPouch(2, 5, 4)).toEqual({ spent: 2, restocked: 2, held: 4 });
		expect(restockPouch(3, 1, 4)).toEqual({ spent: 3, restocked: 1, held: 2 });
		expect(restockPouch(0, 3, 4)).toEqual({ spent: 0, restocked: 0, held: 4 });
	});
});

describe("possessions a background hands over", () => {
	const fox = { extraPossessions: [], setup: { choices: [{ key: "extraPossession", apply: "possession" }, { key: "extraMove", apply: "move" }] } };

	it("reads the Missionary's aviary and A Life of Crime's pick", () => {
		expect([...backgroundPossessionSlugs({ extraPossessions: ["aviary"] })]).toEqual(["aviary"]);
		expect([...backgroundPossessionSlugs(fox, { extraPossession: "hidden-stash", extraMove: "Burgle" })]).toEqual(["hidden-stash"]);
		expect([...backgroundPossessionSlugs(null)]).toEqual([]);
	});

	it("doesn't count against the playbook's picks on the sheet", async () => {
		// A Fox with A Life of Crime's hidden stash and ONE pick of their own: one pick short.
		const { char } = buildLiveCharacter({ slug: "the-fox", name: "The Fox" });
		const sp = playbookSource("the-fox");
		await char._possessions.select("hidden-stash");
		await char._possessions.select("tannery");
		const snap = char._buildPossessionsSnapshot(sp, {}, null, new Map(), new Map(), new Set(["hidden-stash"]));
		expect(snap.isIncomplete).toBe(true);
	});

	// The user's ruling (Fox audit): it goes with the background, not with a click.
	it("is locked on the sheet, while the player's own picks stay free to untick", async () => {
		const { char } = buildLiveCharacter({ slug: "the-fox", name: "The Fox" });
		await char._possessions.select("hidden-stash");
		await char._possessions.select("tannery");
		const snap = char._buildPossessionsSnapshot(playbookSource("the-fox"), {}, null, new Map(), new Map(), new Set(["hidden-stash"]));
		expect(snap.items.find(i => i.slug === "hidden-stash").disabled).toBe(true);
		expect(snap.items.find(i => i.slug === "tannery").disabled).toBe(false);
	});
});

// Flagged the way too few is, never refused (Fox audit).
describe("more special possessions than the playbook's count", () => {
	const snapWith = async (...slugs) => {
		const { char } = buildLiveCharacter({ slug: "the-fox", name: "The Fox" });
		for (const slug of slugs) await char._possessions.select(slug);
		return char._buildPossessionsSnapshot(playbookSource("the-fox"), {});
	};

	it("is flagged with how many over", async () => {
		const snap = await snapWith("tannery", "distillery", "mummers-kit");
		expect(snap.isOverLimit).toBe(true);
		expect(snap.overBy).toBe(1);
		expect(snap.isIncomplete).toBe(false);
		// Kept, not refused.
		expect(snap.items.filter(i => i.checked).map(i => i.slug)).toEqual(["distillery", "mummers-kit", "tannery"]);
	});

	it("is not flagged at the count, nor below it", async () => {
		expect((await snapWith("tannery", "distillery")).isOverLimit).toBe(false);
		expect((await snapWith("tannery")).overBy).toBe(0);
	});
});

describe("a possession's rule survives its granted gear", () => {
	it("husbandry tools keep their advantage to Persuade on the sheet", () => {
		const { char } = buildLiveCharacter({ slug: "the-ranger", name: "The Ranger" });
		const sp = playbookSource("the-ranger");
		const granted = new Map([["husbandry-tools", { regular: [{ name: "Whips" }], small: [] }]]);
		const item = char._buildPossessionsSnapshot(sp, {}, null, granted).items.find(i => i.slug === "husbandry-tools");
		expect(item.description).toMatch(/advantage to Persuade domestic beasts/);
		// ...and not the item list the granted rows already say.
		expect(item.description).not.toMatch(/brushes/);
	});

	// Or a qualifier the line opens with, which the granted rows can't say (the Fox audit):
	// a smithy or tannery "(or access to it)", trade contacts' "small amounts of" each good.
	const OPENING_QUALIFIERS = { "Or access to it.": "(or access to it)", "Small amounts of each.": "small amounts of " };

	it("every rule note is the tail of its possession's printed line, or its opening qualifier", () => {
		for (const pb of ["the-blessed", "the-fox", "the-heavy", "the-judge", "the-ranger", "the-seeker", "the-would-be-hero"]) {
			for (const opt of playbookSource(pb).options.filter(o => o.rulesNote)) {
				const qualifier = OPENING_QUALIFIERS[opt.rulesNote];
				expect(opt.description.endsWith(opt.rulesNote) || (!!qualifier && opt.description.startsWith(qualifier)), `${pb}: ${opt.slug}`).toBe(true);
			}
		}
	});

	it.each([
		["the-fox", "tannery", "Or access to it."], ["the-would-be-hero", "tannery", "Or access to it."],
		["the-heavy", "smithy", "Or access to it."], ["the-judge", "smithy", "Or access to it."],
		["the-would-be-hero", "smithy", "Or access to it."],
		["the-fox", "trade-contacts", "Small amounts of each."], ["the-seeker", "trade-contacts", "Small amounts of each."],
	])("%s's %s keeps its qualifier once its gear is granted", (pb, slug, note) => {
		const { char } = buildLiveCharacter({ slug: pb, name: pb });
		const granted = new Map([[slug, { regular: [], small: [{ name: "Anything" }] }]]);
		const item = char._buildPossessionsSnapshot(playbookSource(pb), {}, null, granted).items.find(i => i.slug === slug);
		expect(item.description).toBe(note);
	});
});

describe("lanterns burn for five hours", () => {
	it.each([["the-fox", "burglars-kit", "Lantern"], ["the-lightbearer", "glassworks", "Lanterns"]])(
		"%s's %s lantern has its ○○○○○ hours", (pb, possession, name) => {
			const grant = option(pb, possession).grantsItems.find(g => g.name === name);
			expect(grant.resource.max).toBe(5);
			expect(grant.resourceSuffix).toMatch(/^hours/);
			// Already-granted lanterns carry the old name; the key keeps them matched.
			expect(grant.sourceKey).toBe(`${name} (close, area)`);
		});
});

describe("the Seeker's sacred pouch (Initiate of the Secret Arts)", () => {
	const initiate = () => {
		const raw = sourceMovesFor("The Seeker").find(d => d.name === "Initiate of the Secret Arts");
		return makeLiveItem({ name: raw.name, type: "move", system: structuredClone(raw.system) });
	};

	it("goes when the move goes", async () => {
		const item = initiate();
		const { char, actor } = buildLiveCharacter({
			slug: "the-seeker", name: "The Seeker", level: 4, items: [item],
			flags: { "possessions.selected": [POUCH], "possessions.grantedAtLevel": { [POUCH]: 2 } },
		});
		await char.removeMove(item._id);
		expect(actor.getFlag("stonetop-pwd", "possessions.selected")).not.toContain(POUCH);
		// Its level, spent Stock and picks are forgotten too, so a retake starts fresh.
		const writes = actor.update.mock.calls.flatMap(([u]) => Object.keys(u));
		expect(writes.some(k => k.includes("grantedAtLevel") && k.includes(POUCH))).toBe(true);
	});

	it("stays while another granting move remains", async () => {
		const first = initiate();
		const { char, actor } = buildLiveCharacter({
			slug: "the-seeker", name: "The Seeker", level: 4, items: [first, initiate()],
			flags: { "possessions.selected": [POUCH] },
		});
		await char.removeMove(first._id);
		expect(actor.getFlag("stonetop-pwd", "possessions.selected")).toContain(POUCH);
	});

	it("a Blessed who learned it keeps the pouch they started with", async () => {
		const item = initiate();
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed", level: 4, items: [item],
			flags: { "possessions.selected": [POUCH] },
		});
		await char.removeMove(item._id);
		expect(actor.getFlag("stonetop-pwd", "possessions.selected")).toContain(POUCH);
	});

	// Initiate: "no remarkable traits". Big Magic: "choose an additional remarkable trait".
	it("has no trait to pick until Big Magic, then one per Big Magic", async () => {
		const { char } = buildLiveCharacter({
			slug: "the-seeker", name: "The Seeker", level: 4,
			flags: { "possessions.selected": [POUCH] },
		});
		const sp = playbookSource("the-seeker");
		const pouch = () => char._buildPossessionsSnapshot(sp, {}).items.find(i => i.slug === POUCH);
		expect(pouch().hasChoiceGroups).toBe(false);
		expect(await char.possessionWithOpenChoiceFor("Big Magic")).toBeNull();

		const bigMagic = sourceMovesFor("The Blessed").find(d => d.name === "Big Magic");
		char._actor.items.push(makeLiveItem({ name: bigMagic.name, type: "move", system: structuredClone(bigMagic.system) }));
		expect(pouch().hasChoiceGroups).toBe(true);
		expect(await char.possessionWithOpenChoiceFor("Big Magic")).toBe(POUCH);
	});
});
