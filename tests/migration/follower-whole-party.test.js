import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	wholePartySplitUpdate, splitFollowerWholeParty, FOLLOWER_WHOLE_PARTY_SWEEP,
} from "../../module/migration/follower-whole-party.js";
import { oncePerVersion } from "../../module/migration/once-per-version.js";

// Wave 3 audit FOL-6: a custom follower's one "Party follower" switch was LABELLED "any PC pays/spends its
// Loyalty" (Book I p.464, following the party as a whole) while Make Camp READ it as travelling with the
// party. Now two switches; one switched on keeps both. Once per WORLD, so a follower switched on for travel
// alone after the split is never swept into following the party as a whole by a later version.

const SCOPE = "stonetop-pwd";
const SETTING = "repairSweepVersions";
const realGame = globalThis.game;

let stored;
beforeEach(() => {
	stored = {};
	globalThis.game = {
		...realGame,
		system: { version: "1.7.1" },
		settings: {
			get: (_ns, key) => (key === SETTING ? stored : undefined),
			set: (_ns, key, value) => { if (key === SETTING) stored = value; return Promise.resolve(value); },
		},
	};
});
afterEach(() => { globalThis.game = realGame; });

const pc = (id, customFollowers, type = "character") => ({
	id, type, flags: { [SCOPE]: { customFollowers } }, update: vi.fn(async () => {}),
});

describe("splitting the custom follower's party switch", () => {
	it("turns on following the party as a whole beside every old switch that was on, and nothing else", () => {
		expect(wholePartySplitUpdate({
			guide: { party: true },
			mule:  { party: false },
			hound: {},
			set:   { party: true, wholeParty: false },
		})).toEqual({ [`flags.${SCOPE}.customFollowers.guide.wholeParty`]: true });
	});

	it("writes each character once, quietly, and never runs again in a world that has run it", async () => {
		const a = pc("a", { guide: { party: true } });
		const b = pc("b", { mule: { party: false } });
		await oncePerVersion(FOLLOWER_WHOLE_PARTY_SWEEP, () => splitFollowerWholeParty({ actors: [a, b, pc("n", { x: { party: true } }, "npc")] }));
		expect(a.update).toHaveBeenCalledWith({ [`flags.${SCOPE}.customFollowers.guide.wholeParty`]: true }, { stonetopLedger: true });
		expect(b.update).not.toHaveBeenCalled();
		game.system.version = "1.7.2";
		const later = pc("c", { travels: { party: true } });
		await oncePerVersion(FOLLOWER_WHOLE_PARTY_SWEEP, () => splitFollowerWholeParty({ actors: [later] }));
		expect(later.update).not.toHaveBeenCalled();
	});
});
