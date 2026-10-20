import { describe, it, expect, vi } from "vitest";
import { followerRefresh, refreshCatalogFollowers, FOLLOWER_SUPERSEDED } from "../../module/migration/follower-refresh.js";
import { possessionFollower } from "../../module/data/possession-followers.js";
import { summonEntryFor } from "../../module/data/arcana-summons.js";
import { loadPlaybookDefs } from "../fakes/sourcePack.js";

// Follower cards made from the system's own lists, put right where they still hold a value an older
// release wrote: the good dog's herder default, and two summons' notes.

const SCOPE = "stonetop-pwd";
const OLD_DOG = { sourceUuid: "possession:a-good-dog", name: "Rex", tags: ["herder", "keen-nosed", "clever"], notes: FOLLOWER_SUPERSEDED["possession:a-good-dog"].notes[0] };

describe("followerRefresh", () => {
	it("makes an old herder-by-default dog the retriever its player picked, and drops the old note", () => {
		expect(followerRefresh(OLD_DOG, ["retriever"])).toEqual({ tags: ["retriever", "keen-nosed", "clever"], notes: "" });
	});

	it("only drops the note from a dog whose player picked herder", () => {
		expect(followerRefresh(OLD_DOG, ["herder"])).toEqual({ notes: "" });
	});

	it("leaves a dog whose player has not picked, and one whose tags or note they wrote", () => {
		expect(followerRefresh(OLD_DOG, [])).toBeNull();
		expect(followerRefresh({ ...OLD_DOG, tags: ["herder", "loyal"], notes: "Our dog." }, ["retriever"])).toBeNull();
	});

	it("corrects a summon's note an older release wrote, and leaves one the player wrote", () => {
		for (const uuid of ["stone-idol:thistlewik", "ring-of-daagon:servant-of-daagon"]) {
			const card = { sourceUuid: uuid, notes: FOLLOWER_SUPERSEDED[uuid].notes[0] };
			expect(followerRefresh(card)).toEqual({ notes: summonEntryFor(card).notes });
			expect(followerRefresh({ sourceUuid: uuid, notes: "Mine." })).toBeNull();
		}
	});

	it("lifts Halix's and the Mighty Servant's old \"exceptional\" tag into the flag that rolls +2", () => {
		for (const uuid of ["blackwood-fetishes:halix", "mindgem:mighty-servant"]) {
			const card = { sourceUuid: uuid, tags: FOLLOWER_SUPERSEDED[uuid].tags[0] };
			expect(followerRefresh(card)).toEqual({ tags: summonEntryFor(card).tags, exceptional: true });
			expect(followerRefresh({ sourceUuid: uuid, tags: ["mine"] })).toBeNull();
		}
	});

	it("never lists a value the lists still ship as an old one", () => {
		expect(FOLLOWER_SUPERSEDED["possession:a-good-dog"].notes).not.toContain(possessionFollower("a-good-dog", ["herder"]).notes ?? "");
		for (const uuid of ["stone-idol:thistlewik", "ring-of-daagon:servant-of-daagon"]) {
			expect(FOLLOWER_SUPERSEDED[uuid].notes).not.toContain(summonEntryFor({ sourceUuid: uuid }).notes);
		}
	});
});

describe("refreshCatalogFollowers", () => {
	it("writes each character's stale cards in one update, reading the dog's pick off the possession", async () => {
		const flags = {
			customFollowers: { d1: OLD_DOG, x: { sourceUuid: "custom", notes: "n" } },
			possessions: { subChoices: { "a-good-dog": ["retriever"] } },
		};
		const pc = {
			type: "character",
			flags: { [SCOPE]: flags },
			getFlag: (scope, key) => (scope === SCOPE ? flags[key] : undefined),
			update: vi.fn(async () => {}),
		};
		expect(await refreshCatalogFollowers({ actors: [pc, { type: "npc" }] })).toBe(1);
		expect(pc.update).toHaveBeenCalledWith({
			[`flags.${SCOPE}.customFollowers.d1.tags`]: ["retriever", "keen-nosed", "clever"],
			[`flags.${SCOPE}.customFollowers.d1.notes`]: "",
		}, { stonetopLedger: true });
	});

	// Olwin picked before the playbook carried her "Armor 1 (shield)" as a ticked Shield row.
	const blessedPc = (flags) => ({
		type: "character",
		name: "Bran",
		flags: { [SCOPE]: flags },
		getFlag: (scope, key) => (scope === SCOPE ? flags[key] : undefined),
		typedActor: { playbook: async () => loadPlaybookDefs().byName.get("The Blessed") },
		update: vi.fn(async () => {}),
	});

	it("gives an Olwin picked before the playbook carried it her shield, and leaves a Gear list her player wrote", async () => {
		const old = blessedPc({ background: { selected: "initiate", choices: { olwin: true, enfys: true, seren: false } }, initiateDetails: { olwin: { pronoun: "she" } } });
		const own = blessedPc({ background: { selected: "initiate", choices: { olwin: true } }, initiateDetails: { olwin: { gear: [] } } });
		const none = blessedPc({ background: { selected: "vessel" } });
		expect(await refreshCatalogFollowers({ actors: [old, own, none] })).toBe(1);
		expect(old.update).toHaveBeenCalledWith({
			[`flags.${SCOPE}.initiateDetails.olwin.gear`]: [{ label: "Shield", checked: true }],
		}, { stonetopLedger: true });
		expect(own.update).not.toHaveBeenCalled();
		expect(none.update).not.toHaveBeenCalled();
	});
});
