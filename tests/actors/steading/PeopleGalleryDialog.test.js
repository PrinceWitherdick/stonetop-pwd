import { describe, expect, it } from "vitest";
import { pickRandomPortrait, rolledScrollTop, asFullPortrait, portraitIdentity } from "../../../module/actors/steading/PeopleGalleryDialog.js";
import { BOOK2_ART_APPLY_MANIFEST } from "../../../module/book2-art/manifest.js";

// asFullPortrait joins against the SHIPPED manifest, so the square/illustration pair has to be a
// real one. Any row with a square authored will do; the projection's own tests guard the shape.
const ROOT = "stonetop-book-art";
const squaredPerson = (BOOK2_ART_APPLY_MANIFEST.people ?? []).find((p) => p.out && p.portraitOut);

// The dialog hands this only the tiles the filters left showing, so "respects the filters"
// is the caller's job; what is tested here is the choice made out of that pool.
describe("pickRandomPortrait", () => {
	const pool = ["a.webp", "b.webp", "c.webp"];

	it("picks from the pool it is given", () => {
		expect(pickRandomPortrait(pool, { rng: () => 0 })).toBe("a.webp");
		expect(pickRandomPortrait(pool, { rng: () => 0.5 })).toBe("b.webp");
		expect(pickRandomPortrait(pool, { rng: () => 0.99 })).toBe("c.webp");
	});

	it("stays in range on an rng that returns 1", () => {
		expect(pickRandomPortrait(pool, { rng: () => 1 })).toBe("c.webp");
	});

	it("never rolls the portrait already in use, so a re-roll always changes something", () => {
		// Every roll lands on the excluded index; with "a" out of the pool it can only be b or c.
		for (const r of [0, 0.34, 0.5, 0.99]) {
			expect(pickRandomPortrait(pool, { current: "a.webp", rng: () => r })).not.toBe("a.webp");
		}
	});

	it("still returns the one showing when it is the one already in use", () => {
		expect(pickRandomPortrait(["a.webp"], { current: "a.webp", rng: () => 0.5 })).toBe("a.webp");
	});

	it("returns nothing when the filters left no portraits", () => {
		expect(pickRandomPortrait([], { rng: () => 0.5 })).toBeNull();
		expect(pickRandomPortrait(undefined, { rng: () => 0.5 })).toBeNull();
		expect(pickRandomPortrait(["", null], { rng: () => 0.5 })).toBeNull();
	});

	it("avoids a current portrait that is held as the whole illustration", () => {
		// The regression the roll's asFullPortrait call exists for. Tiles carry the SQUARE, but a
		// member whose portrait was chosen before squares existed holds the illustration — so
		// comparing the two raw paths matches nothing and every roll can hand back what they
		// already wear. Both sides are normalised to the illustration before they meet.
		const { portraitOut, out } = squaredPerson;
		const pool = [`${ROOT}/${out}`, `${ROOT}/other-person.webp`];
		for (const held of [`${ROOT}/${portraitOut}`, `${ROOT}/${out}`]) {
			for (const r of [0, 0.5, 0.99]) {
				expect(pickRandomPortrait(pool, { current: asFullPortrait(held), rng: () => r }))
					.toBe(`${ROOT}/other-person.webp`);
			}
		}
	});
});

describe("asFullPortrait", () => {
	it("resolves a square back to the illustration it was cut from", () => {
		expect(asFullPortrait(`${ROOT}/${squaredPerson.portraitOut}`)).toBe(`${ROOT}/${squaredPerson.out}`);
	});

	it("leaves an illustration, and anything that is not gallery art, as itself", () => {
		expect(asFullPortrait(`${ROOT}/${squaredPerson.out}`)).toBe(`${ROOT}/${squaredPerson.out}`);
		expect(asFullPortrait("worlds/mine/art/my-own-villager.webp")).toBe("worlds/mine/art/my-own-villager.webp");
	});

	it("reads an absent portrait as the empty string, so nothing matches it", () => {
		for (const empty of ["", null, undefined]) expect(asFullPortrait(empty)).toBe("");
	});
});

// The identity every "is this the same portrait?" question is settled on. Two paths can name one
// picture and not match as strings: a square against its illustration (what asFullPortrait is
// for), and — on a host that serves user files from elsewhere, e.g. The Forge's Assets Library —
// the same file with and without the host's prefix. A world holding portraits chosen before it
// knew where its art lived would otherwise show none of them as selected or as taken.
describe("portraitIdentity", () => {
	const FORGE = "https://assets.forge-vtt.com/abc123/";

	it("reduces a square and its illustration to the same thing", () => {
		expect(portraitIdentity(`${ROOT}/${squaredPerson.portraitOut}`))
			.toBe(portraitIdentity(`${ROOT}/${squaredPerson.out}`));
	});

	it("reduces the same picture to the same thing however the host spells it", () => {
		expect(portraitIdentity(`${FORGE}${ROOT}/${squaredPerson.out}`))
			.toBe(portraitIdentity(`${ROOT}/${squaredPerson.out}`));
	});

	it("keeps two different people apart", () => {
		expect(portraitIdentity(`${ROOT}/${squaredPerson.out}`))
			.not.toBe(portraitIdentity(`${ROOT}/assets/people/someone-else.webp`));
	});

	it("is empty for an absent portrait, so nothing matches it", () => {
		for (const empty of ["", null, undefined]) expect(portraitIdentity(empty)).toBe("");
	});

	it("does not confuse art outside the art folder with a gallery tile of the same name", () => {
		// The GM's own file, in their own directory, that happens to be named like a gallery
		// portrait. Reduced to the bare FILENAME these two matched, and the tile was reported
		// "used by" whoever held the unrelated picture — and hidden from the Unused filter.
		const mine = `worlds/mine/npcs/${squaredPerson.out.split("/").pop()}`;
		expect(portraitIdentity(mine)).not.toBe(portraitIdentity(`${ROOT}/${squaredPerson.out}`));
	});

	it("keeps the roll from handing back the portrait already worn, across spellings", () => {
		// The gallery's tiles carry the host-served path; a member wired by an earlier build holds
		// the bare one. Compared raw, "avoid the current one" silently stops avoiding anything.
		const pool = [`${FORGE}${ROOT}/${squaredPerson.out}`, `${FORGE}${ROOT}/assets/people/other.webp`];
		for (const held of [`${ROOT}/${squaredPerson.out}`, `${ROOT}/${squaredPerson.portraitOut}`]) {
			for (const r of [0, 0.5, 0.99]) {
				expect(pickRandomPortrait(pool, { current: held, keyOf: portraitIdentity, rng: () => r }))
					.toBe(`${FORGE}${ROOT}/assets/people/other.webp`);
			}
		}
	});
});

// The scroll the roll animates towards. A 400px-tall gallery body sitting 100px down the
// viewport, over 2000px of grid, showing 220px tiles — so a centred tile sits 90px below
// the body's top edge and the scroll range ends at 1600.
describe("rolledScrollTop", () => {
	const BODY = { scrollTop: 0, viewTop: 100, viewHeight: 400, tileHeight: 220, scrollHeight: 2000 };

	it("centres a tile that rolled in off the bottom of the view", () => {
		// 800px below the body's top edge, less the 90px that centres it.
		expect(rolledScrollTop({ ...BODY, tileTop: 900 })).toBe(710);
	});

	it("stays put when the roll landed on a tile already centred", () => {
		expect(rolledScrollTop({ ...BODY, tileTop: 190 })).toBe(0);
	});

	it("stops at the top rather than asking for a negative offset", () => {
		// A tile in the first row can't be centred — there is nothing above it to scroll in.
		expect(rolledScrollTop({ ...BODY, tileTop: 100 })).toBe(0);
	});

	it("stops at the end of the grid rather than scrolling past it", () => {
		expect(rolledScrollTop({ ...BODY, scrollTop: 1500, tileTop: 480 })).toBe(1600);
	});

	it("asks for no scroll at all when the grid is shorter than the view", () => {
		expect(rolledScrollTop({ ...BODY, tileTop: 300, scrollHeight: 300 })).toBe(0);
	});
});
