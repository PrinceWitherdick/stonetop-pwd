import { describe, expect, it, afterEach } from "vitest";
import { playbookSlug, getPlayerCharacters, playbookIconPath, hasOwnRingArt, playbookTitle, characterFullName } from "../../module/utils/playbook-actors.js";
import { WBH_HERO_FLAG } from "../../module/actors/character/WouldBeHeroAsterisk.js";

// Shared "player character" helpers. The logic worth guarding is the slug lookup
// (embedded data vs. a contained playbook item vs. none) and the PC filter that
// the Introductions / Spring-Burst walkthroughs and the playbook picker all rely
// on. Pure functions over plain objects — no DOM needed; only getPlayerCharacters
// touches the `game.actors` global.

describe("playbookSlug", () => {
	it("reads the embedded system.playbook slug", () => {
		expect(playbookSlug({ system: { playbook: { slug: "the-blessed" } } })).toBe("the-blessed");
	});

	it("falls back to a contained playbook item's slug", () => {
		const actor = { items: [{ type: "move" }, { type: "playbook", system: { slug: "the-fox" } }] };
		expect(playbookSlug(actor)).toBe("the-fox");
	});

	it("returns \"\" (falsy) when there's no playbook", () => {
		expect(playbookSlug({ system: {}, items: [] })).toBe("");
		expect(playbookSlug(null)).toBe("");
		expect(playbookSlug(undefined)).toBe("");
	});
});

describe("playbookIconPath", () => {
	it("maps a slug to its avatar art, underscoring the hyphens", () => {
		expect(playbookIconPath("the-would-be-hero"))
			.toBe("systems/stonetop-pwd/assets/icons/playbooks/the_would_be_hero_icon.webp");
	});

	it("returns null for a slug-less actor", () => {
		expect(playbookIconPath("")).toBe(null);
		expect(playbookIconPath(null)).toBe(null);
	});

	it("is server-root-relative (no leading slash) so it matches the stored avatar", () => {
		expect(playbookIconPath("the-fox").startsWith("systems/")).toBe(true);
	});
});

// Every badge is a woodcut inside a hand-drawn circle, so a surface that frames a face in a ring of
// its own draws a second one a few pixels outside the first. The relationship map asks this and
// leaves its rim off those portraits; what the test is guarding is the pair of edges the answer
// turns on — the badges no playbook slug names, and the ringless marks sharing their folder.
describe("hasOwnRingArt", () => {
	it("knows the art playbookIconPath hands out", () => {
		for (const slug of ["the-fox", "the-blessed", "the-would-be-hero"]) {
			expect(hasOwnRingArt(playbookIconPath(slug))).toBe(true);
		}
	});

	it("knows the badges no playbook slug names — the ghost, the revenant, the thrall", () => {
		for (const file of ["ghost_icon.webp", "revenant_icon.webp", "thrall_icon.webp"]) {
			expect(hasOwnRingArt(`systems/stonetop-pwd/assets/icons/playbooks/${file}`)).toBe(true);
		}
	});

	it("knows the same file written with a leading slash, which is how it gets typed by hand", () => {
		expect(hasOwnRingArt("/systems/stonetop-pwd/assets/icons/playbooks/the_heavy_icon.webp")).toBe(true);
	});

	it("says no to the ringless marks that share the badges' folder", () => {
		for (const file of ["arrow_icon.svg", "blood-filled.svg", "diamond.svg"]) {
			expect(hasOwnRingArt(`systems/stonetop-pwd/assets/icons/playbooks/${file}`)).toBe(false);
		}
	});

	it("says no to a portrait of somebody's own, to the core silhouette, and to no picture at all", () => {
		expect(hasOwnRingArt("worlds/stonetop/art/pim.webp")).toBe(false);
		expect(hasOwnRingArt("icons/svg/mystery-man.svg")).toBe(false);
		expect(hasOwnRingArt("")).toBe(false);
		expect(hasOwnRingArt(null)).toBe(false);
		expect(hasOwnRingArt(undefined)).toBe(false);
	});

	// The folder is matched from a slash or from the start of the string, so a path that merely
	// ENDS in the badges' folder name is a different place and not our art.
	it("is not fooled by a folder whose name merely ends in theirs", () => {
		expect(hasOwnRingArt("worlds/x/notassets/icons/playbooks/the_fox_icon.webp")).toBe(false);
	});
});

// The name a player character is called by across the system — the Actors sidebar, the
// steading's Player Characters roster, a chat card's speaker. The two things worth guarding
// are the Would-Be Hero's mid-campaign rename and the fallbacks, since these run against
// every actor in the world including the ones that carry no playbook at all.
describe("playbookTitle", () => {
	it("is the playbook's name", () => {
		expect(playbookTitle({ system: { playbook: { name: "The Lightbearer" } } })).toBe("The Lightbearer");
	});

	it("is \"\" for an actor with no playbook", () => {
		expect(playbookTitle({ system: {} })).toBe("");
		expect(playbookTitle(null)).toBe("");
	});

	it("renames a Would-Be Hero who has crossed off \"Would-be\", by flag or by owning the move", () => {
		const wbh = (over = {}) => ({ system: { playbook: { name: "The Would-Be Hero" } }, items: [], ...over });
		expect(playbookTitle(wbh())).toBe("The Would-Be Hero");
		expect(playbookTitle(wbh({ getFlag: (_s, k) => k === WBH_HERO_FLAG }))).toBe("The Hero");
		expect(playbookTitle(wbh({ items: [{ type: "move", system: { asterisk: true } }] }))).toBe("The Hero");
	});

	it("never consults the cross-off for a playbook that cannot be renamed", () => {
		// The item scan behind the flag runs once per row of every sidebar render, so it has to
		// stay off the path for the rest of the party — an asterisked move on somebody else's
		// sheet must not rename their playbook.
		const blessed = {
			system: { playbook: { name: "The Blessed" } },
			items: [{ type: "move", system: { asterisk: true } }],
			getFlag: () => { throw new Error("read the cross-off for a non-Would-Be-Hero"); },
		};
		expect(playbookTitle(blessed)).toBe("The Blessed");
	});
});

describe("characterFullName", () => {
	it("appends the playbook to the actor's name", () => {
		expect(characterFullName({ name: "Pim", system: { playbook: { name: "The Lightbearer" } } }))
			.toBe("Pim The Lightbearer");
	});

	it("falls back to the bare name when there is no playbook to append", () => {
		expect(characterFullName({ name: "Pim", system: {} })).toBe("Pim");
		expect(characterFullName({ system: { playbook: { name: "The Fox" } } })).toBe("");
		expect(characterFullName(null)).toBe("");
	});
});

describe("getPlayerCharacters", () => {
	afterEach(() => { delete global.game; });

	it("keeps only characters that carry a playbook", () => {
		global.game = {
			actors: {
				contents: [
					{ type: "character", system: { playbook: { slug: "the-blessed" } } }, // PC
					{ type: "character", system: {}, items: [] },                          // blank sheet, no playbook
					{ type: "monster",   system: { playbook: { slug: "x" } } },            // not a character
					{ type: "character", items: [{ type: "playbook", system: { slug: "the-heavy" } }] }, // PC via item
				],
			},
		};
		const pcs = getPlayerCharacters();
		expect(pcs.map(a => playbookSlug(a))).toEqual(["the-blessed", "the-heavy"]);
	});

	it("is empty when there are no actors", () => {
		global.game = { actors: {} };
		expect(getPlayerCharacters()).toEqual([]);
	});
});
