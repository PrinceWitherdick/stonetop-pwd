// Level-up audit 2026-10-23 (PBB-1): a Big Magic learned through a later Initiate of the Secret Arts
// grows a pouch the Seeker already holds, and the new room arrives EMPTY (the user's ruling,
// 2026-10-18), whichever path learns it: the Moves tab's "Learn a Move" picker (which runs outside
// any level-up) or the Level Up window (whose own settle the foreign add joins).
//
// Book I p.106, Big Magic: "increase your max Stock by 2". The track counts Stock SPENT.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";

const SCOPE = "stonetop-pwd";
const POUCH = "sacred-pouch";
const seekerMove = name => sourceMovesFor("The Seeker").find(d => d.name === name);
const bigMagicId = () => sourceMovesFor("The Blessed").find(d => d.name === "Big Magic")._id;

// A level-4 Seeker who took Initiate at 2 (pouch 3 + 1 for level 2 + 1 for level 4 = 5), all spent.
function seeker({ level = 4, xp = 0 } = {}) {
	const initiate = makeLiveItem({ name: "Initiate of the Secret Arts", type: "move", system: structuredClone(seekerMove("Initiate of the Secret Arts").system) });
	const built = buildLiveCharacter({
		slug: "the-seeker", name: "The Seeker", level, xp, items: [initiate],
		flags: {
			"possessions.selected": ["scribes-tools", POUCH],
			"possessions.grantedAtLevel": { [POUCH]: 2 },
			"possessions.uses": { [POUCH]: 5 },
		},
	});
	built.actor.items.get = id => built.actor.items.find(i => i.id === id);
	return built;
}
const spentOf = actor => actor.getFlag(SCOPE, "possessions.uses")?.[POUCH] ?? 0;
const secondInitiate = async char => char.addMove(seekerMove("Initiate of the Secret Arts")._id);

beforeEach(() => { globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } }; });
afterEach(() => { delete globalThis.ui; });

describe("Big Magic through a second Initiate grows the held pouch with empty room", () => {
	it("on the Moves tab's picker: max 7, still no Stock in it", async () => {
		const { char, actor } = seeker();
		expect(await char.sacredPouchMax()).toBe(5);
		const initiate = await secondInitiate(char);
		await char._applyForeignMoveChoice(initiate, bigMagicId(), POUCH);
		expect(await char.sacredPouchMax()).toBe(7);
		expect(spentOf(actor)).toBe(7);
	});

	it("in the Level Up window: one settle for the level's +1 and Big Magic's +2", async () => {
		const { char, actor } = seeker({ level: 5, xp: 16 });
		expect(await char.sacredPouchMax()).toBe(5);
		const result = await char.applyLevelUp(seekerMove("Initiate of the Secret Arts")._id, null,
			{ crossPlaybook: true, foreignMoveId: bigMagicId(), grantsPossession: POUCH }, { fromLevel: 5 });
		expect(result).toEqual({ applied: true });
		// Level 6 adds 1, Big Magic 2: 8 in all, every new space empty.
		expect(await char.sacredPouchMax()).toBe(8);
		expect(spentOf(actor)).toBe(8);
	});
});
