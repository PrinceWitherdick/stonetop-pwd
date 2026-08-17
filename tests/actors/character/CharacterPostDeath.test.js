import { describe, it, expect, vi } from "vitest";
import { CharacterPostDeath, buildLoreSection } from "../../../module/actors/character/CharacterPostDeath.js";
import { CharacterInstincts } from "../../../module/actors/character/CharacterInstincts.js";
import { CharacterLore } from "../../../module/actors/character/CharacterLore.js";

// Stands in for the deletion marker StonetopFlags emits (a ForcedDeletion on v14+, a "-=key"
// path below it) so this fake can tell a write from a removal without either shape.
const DELETE = Symbol("delete");

function makeFlags(store = {}) {
	return {
		getFlag: (key) => store[key] ?? null,
		setFlag: vi.fn(async (key, val) => { store[key] = val; }),
		unsetFlag: vi.fn(async (key) => { delete store[key]; }),
		// The fragment builders, mirroring StonetopFlags: a plain object the caller can spread
		// into ONE document update. Keyed by the bare flag key rather than the real dotted path —
		// the path itself is StonetopFlags' own business, and what these tests are about is which
		// fragment gets built and whether it lands in one write.
		updateData:   vi.fn((key, val) => ({ [key]: val })),
		deletionData: vi.fn((key) => ({ [key]: DELETE })),
		applyUpdateData: vi.fn(async (data) => {
			for (const [key, val] of Object.entries(data ?? {})) {
				if (val === DELETE) delete store[key];
				else store[key] = val;
			}
		}),
	};
}

describe("CharacterPostDeath", () => {
	it("activeSlug returns null when unset", () => {
		const pd = new CharacterPostDeath(makeFlags(), new CharacterInstincts(makeFlags()), new CharacterLore(makeFlags()));
		expect(pd.activeSlug).toBeNull();
	});

	it("instinct returns the CharacterInstincts instance", () => {
		const instinct = new CharacterInstincts(makeFlags());
		const pd = new CharacterPostDeath(makeFlags(), instinct, new CharacterLore(makeFlags()));
		expect(pd.instinct).toBe(instinct);
	});

	it("lore returns the CharacterLore instance", () => {
		const lore = new CharacterLore(makeFlags());
		const pd = new CharacterPostDeath(makeFlags(), new CharacterInstincts(makeFlags()), lore);
		expect(pd.lore).toBe(lore);
	});

	describe("tabRequested", () => {
		function makePostDeath(store = {}) {
			const flags = makeFlags(store);
			return { flags, pd: new CharacterPostDeath(flags, new CharacterInstincts(makeFlags()), new CharacterLore(makeFlags())) };
		}

		// Opt-in, so an empty Post-Death tab can't open on every living character in edit mode.
		it("is false until the tab is asked for", () => {
			expect(makePostDeath().pd.tabRequested).toBe(false);
		});

		it("records a request", async () => {
			const { flags, pd } = makePostDeath();
			await pd.setTabRequested(true);
			expect(flags.updateData).toHaveBeenCalledWith("tabOpen", true);
			expect(pd.tabRequested).toBe(true);
		});

		// Unset rather than written false: the flag's absence is the ordinary state.
		it("unsets rather than storing false", async () => {
			const { flags, pd } = makePostDeath({ tabOpen: true });
			await pd.setTabRequested(false);
			expect(flags.deletionData).toHaveBeenCalledWith("tabOpen");
			expect(flags.updateData).not.toHaveBeenCalled();
			expect(pd.tabRequested).toBe(false);
		});

		it("writes nothing when clearing a request that was never made", async () => {
			const { flags, pd } = makePostDeath();
			await pd.setTabRequested(false);
			expect(flags.applyUpdateData).not.toHaveBeenCalled();
		});

		// The fragment form is what lets setPostDeathInsert land the slug, the Death's Door
		// clear and this in ONE update — see StonetopCharacter.postDeathInsert.test.js.
		it("offers the request as a fragment, and nothing to write when there is nothing to do", () => {
			const { pd } = makePostDeath();
			expect(pd.tabRequestUpdateData(true)).toEqual({ tabOpen: true });
			expect(pd.tabRequestUpdateData(false)).toBeNull();
		});
	});

	// Taking an insert has to end the brush with death in the SAME update, and the Death's Door
	// state is a sibling of these flags rather than one of them — so the slug is offered as an
	// update fragment its caller can combine with one.
	it("hands the slug write out as a fragment for a caller that must batch it", () => {
		const flags = makeFlags();
		flags.updateData = (key, value) => ({ [`flags.stonetop-pwd.postDeathInsert.${key}`]: value });
		const pd = new CharacterPostDeath(flags, new CharacterInstincts(makeFlags()), new CharacterLore(makeFlags()));

		expect(pd.slugUpdateData("ghost")).toEqual({ "flags.stonetop-pwd.postDeathInsert.slug": "ghost" });
	});
});

// Crossing off is the Thrall's Dark Succor rule and nothing else: a Mark crossed off can never be
// gained again. The crossed-off set holds MARK slugs, so applying it to every entry made any
// option in any other section that happened to share a slug render struck through — and, since
// sectionOptions folds that into "blocked", unclickable for good.
describe("buildLoreSection — crossed-off Marks", () => {
	// One slug reused across two sections, which is the whole point: nothing stops an insert's
	// Consequences and its Marks both naming an option "hollow".
	const LORE = [
		{
			slug: "marks",
			options: [
				{ slug: "hollow", description: "<p><strong>HOLLOW</strong> &mdash; a Mark.</p>" },
				{ slug: "hungry", description: "<p><strong>HUNGRY</strong> &mdash; a Mark.</p>" },
			],
		},
		{
			slug: "consequences",
			options: [
				{ slug: "hollow", description: "<p><strong>HOLLOW</strong> &mdash; a Consequence sharing the name.</p>" },
			],
		},
	];

	const loreState = { getCount: () => 0, getText: () => "" };
	const optionIn = (section, entrySlug, optSlug) =>
		section.entries.find(e => e.slug === entrySlug).options.find(o => o.slug === optSlug);

	it("crosses the Mark off", () => {
		const section = buildLoreSection(LORE, loreState, null, ["hollow"]);
		expect(optionIn(section, "marks", "hollow").crossedOff).toBe(true);
	});

	it("leaves a same-named option in another section alone", () => {
		const section = buildLoreSection(LORE, loreState, null, ["hollow"]);
		expect(optionIn(section, "consequences", "hollow").crossedOff).toBe(false);
	});

	it("crosses nothing off when nothing has been", () => {
		const section = buildLoreSection(LORE, loreState, null, []);
		expect(optionIn(section, "marks", "hollow").crossedOff).toBe(false);
		expect(optionIn(section, "marks", "hungry").crossedOff).toBe(false);
	});
});
