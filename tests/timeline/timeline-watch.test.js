import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// THE WATCHER: the Foundry half of the milestones. What is pinned here is WHO writes (only the client
// that made the change; every client hears it) and WHEN it stays quiet (a character being made).

vi.mock("../../module/timeline/timeline-record.js", () => ({
	recordMilestones: vi.fn(async () => null), recordKills: vi.fn(async () => null),
}));
vi.mock("../../module/actors/character/creation-flow.js", () => ({ creationFlowOpen: vi.fn(() => false) }));
vi.mock("../../module/actors/character/onboarding-progress.js", () => ({ isMidCreation: vi.fn(() => false) }));

const { recordKills, recordMilestones } = await import("../../module/timeline/timeline-record.js");
const { creationFlowOpen } = await import("../../module/actors/character/creation-flow.js");
const {
	APPLIED_BEFORE_OPTION, BEFORE_OPTION, FOLLOWER_DIED_HOOK, LEARNED_OPTION, onPreUpdateActor, onPreUpdateChatMessage,
	onUpdateActor, onUpdateChatMessage, recordFollowerDeath,
} = await import("../../module/timeline/timeline-watch.js");
const { readRepo } = await import("../fakes/css.js");

/** A character with a level and an (empty) flag bag, as the watcher reads one. */
function character({ id = "pc1", level = 2, flags = {} } = {}) {
	return { id, type: "character", system: { attributes: { level: { value: level }, wounds: [] } }, flags: { "stonetop-pwd": flags } };
}

beforeEach(() => {
	globalThis.game.user = { id: "me", isGM: false };
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("snapshotting before an update", () => {
	it("snapshots a character when an update touches a milestone", () => {
		const options = {};
		onPreUpdateActor(character(), { "system.attributes.level.value": 3 }, options);
		expect(options[BEFORE_OPTION]?.level).toBe(2);
	});

	// Every HP tick at the table passes through here.
	it("leaves every other update alone", () => {
		const options = {};
		onPreUpdateActor(character(), { "system.attributes.hp.value": 1 }, options);
		expect(options).toEqual({});
	});

	it("never snapshots a monster", () => {
		const monster = { ...character(), type: "monster" };
		const a = {};
		onPreUpdateActor(monster, { "system.attributes.level.value": 3 }, a);
		expect(a[BEFORE_OPTION]).toBeUndefined();
	});
});

describe("writing after an update", () => {
	function levelled(userId, options = {}) {
		const actor = character({ level: 3 });
		const before = {};
		onPreUpdateActor(character({ level: 2 }), { "system.attributes.level.value": 3 }, before);
		return onUpdateActor(actor, {}, { ...before, ...options }, userId).then(() => actor);
	}

	it("records the milestone on the client that made the change, in words", async () => {
		const actor = await levelled("me", { [LEARNED_OPTION]: "Seasoned Warrior" });
		expect(recordMilestones).toHaveBeenCalledTimes(1);
		const [target, milestones] = recordMilestones.mock.calls[0];
		expect(target).toBe(actor);
		expect(milestones).toEqual([{
			source: "levelup", key: "levelup:3", title: "Reached level 3", body: "<p>Learned Seasoned Warrior.</p>",
		}]);
	});

	// A body is plain text a player typed (here, a move's name); an entry's body is HTML, so a "<"
	// or "&" in it must read as itself rather than vanish as a tag.
	it("escapes the body, which is plain text", async () => {
		await levelled("me", { [LEARNED_OPTION]: "Pay <the debt> & more" });
		const [, [milestone]] = recordMilestones.mock.calls[0];
		expect(milestone.body).toBe("<p>Learned Pay &lt;the debt&gt; &amp; more.</p>");
	});

	// Every client hears every update. One row per connected player is the bug this prevents.
	it("writes nothing on any other client", async () => {
		await levelled("someone-else");
		expect(recordMilestones).not.toHaveBeenCalled();
	});

	it("writes nothing while the character is still being made", async () => {
		creationFlowOpen.mockReturnValueOnce(true);
		await levelled("me");
		expect(recordMilestones).not.toHaveBeenCalled();
	});

	it("writes nothing for an update it never snapshotted", async () => {
		await onUpdateActor(character({ level: 3 }), {}, {}, "me");
		expect(recordMilestones).not.toHaveBeenCalled();
	});
});

describe("a follower's death", () => {
	it("is one row per follower, however often the fate is pressed", async () => {
		await recordFollowerDeath(character(), { follower: "custom", slug: "f1", name: "Wren" });
		const [, [milestone]] = recordMilestones.mock.calls[0];
		expect(milestone).toEqual({ source: "follower", key: "follower:dead:custom:f1::Wren", title: "Wren died" });
	});
});

describe("kills off a damage card", () => {
	const SCOPE = "stonetop-pwd";
	const actors = {
		"Actor.pc": { documentName: "Actor", uuid: "Actor.pc", type: "character", name: "Ellis", hasPlayerOwner: true },
		"Actor.crinwin": { documentName: "Actor", uuid: "Actor.crinwin", type: "monster", name: "Crinwin" },
		"Actor.ally": { documentName: "Actor", uuid: "Actor.ally", type: "character", name: "Cora", hasPlayerOwner: true },
	};
	beforeEach(() => {
		globalThis.fromUuid = vi.fn(async uuid => actors[uuid] ?? null);
	});
	afterEach(() => {
		delete globalThis.fromUuid;
	});

	/** A damage card as the watcher reads one, with `applied` rows after the press. */
	function card({ applied = [], attackerUuid = "Actor.pc", selfHarm = false, followerBlow = false } = {}) {
		const damage = {
			attackerUuid, selfHarm, applied,
			results: [
				{ uuid: "Actor.crinwin", name: "Crinwin (3)", disposition: -1 },
				{ uuid: "Actor.ally", name: "Cora", disposition: 1 },
			],
		};
		const flags = { damage, followerBlow };
		return { getFlag: (scope, key) => (scope === SCOPE ? flags[key] : undefined) };
	}

	/** One press of Apply: the snapshot taken before, the update heard after. */
	async function press(message, applied, userId = "me") {
		const options = {};
		onPreUpdateChatMessage(message, { flags: { [SCOPE]: { damage: { applied } } } }, options);
		message.getFlag(SCOPE, "damage").applied = applied;
		await onUpdateChatMessage(message, {}, options, userId);
		return options;
	}

	it("credits the striker with every foe the press felled, in one write, by the token's name", async () => {
		const message = card();
		await press(message, [{ uuid: "Actor.crinwin", oldHp: 6, newHp: 0, felled: 2 }]);
		expect(recordKills).toHaveBeenCalledTimes(1);
		expect(recordKills).toHaveBeenCalledWith(actors["Actor.pc"], ["Crinwin", "Crinwin"]);
	});

	// A second press that applies a later row must not credit the first row again.
	it("reads only the rows the press added", async () => {
		const first = { uuid: "Actor.crinwin", oldHp: 6, newHp: 0, felled: 1 };
		const message = card({ applied: [first] });
		await press(message, [first, { uuid: "Actor.ally", oldHp: 5, newHp: 3 }]);
		expect(recordKills).not.toHaveBeenCalled();
	});

	it("never credits a friend, a follower's blow, a blow suffered, or another client", async () => {
		await press(card(), [{ uuid: "Actor.ally", oldHp: 5, newHp: 0, felled: 1 }]);
		await press(card({ followerBlow: true }), [{ uuid: "Actor.crinwin", oldHp: 6, newHp: 0, felled: 1 }]);
		await press(card({ selfHarm: true }), [{ uuid: "Actor.crinwin", oldHp: 6, newHp: 0, felled: 1 }]);
		await press(card(), [{ uuid: "Actor.crinwin", oldHp: 6, newHp: 0, felled: 1 }], "someone-else");
		expect(recordKills).not.toHaveBeenCalled();
	});

	// The Fight tab can move an NPC across; the tally follows the side the fight put it on, not
	// the token's disposition. A follower and a character are never credited, whatever the stamp.
	describe("in a fight", () => {
		const fighter = (actorId, side) => ({ sceneId: "s1", actorId, tokenId: null, flags: { [SCOPE]: { side } } });
		const npc = (id, extra = {}) => ({ documentName: "Actor", uuid: `Actor.${id}`, id, type: "npc", name: id, ...extra });
		beforeEach(() => {
			Object.assign(actors, {
				"Actor.traitor": npc("traitor"),
				"Actor.turned": { ...npc("turned"), type: "monster" },
				"Actor.wren": npc("wren", { flags: { [SCOPE]: { followerOrigin: "custom" } } }),
			});
			globalThis.canvas = { scene: { id: "s1" } };
			globalThis.game.combats = [{
				id: "c1", flags: { [SCOPE]: { fight: true } },
				combatants: [fighter("traitor", "foes"), fighter("turned", "heroes"), fighter("wren", "foes")],
			}];
		});
		afterEach(() => {
			delete globalThis.canvas;
			delete globalThis.game.combats;
		});
		/** A card whose rows saw every target as friendly, the disposition the fight overrides. */
		const friendlyCard = () => {
			const message = card();
			message.getFlag(SCOPE, "damage").results = ["traitor", "turned", "wren"].map(id => ({ uuid: `Actor.${id}`, name: id, disposition: 1 }));
			return message;
		};

		it("credits an NPC the fight put on the other side, friendly token or not", async () => {
			await press(friendlyCard(), [{ uuid: "Actor.traitor", oldHp: 4, newHp: 0, felled: 1 }]);
			expect(recordKills).toHaveBeenCalledWith(actors["Actor.pc"], ["traitor"]);
		});

		it("does not credit a monster the fight put on the heroes' side, nor a follower stamped a foe", async () => {
			await press(friendlyCard(), [{ uuid: "Actor.turned", oldHp: 4, newHp: 0, felled: 1 }]);
			await press(friendlyCard(), [{ uuid: "Actor.wren", oldHp: 4, newHp: 0, felled: 1 }]);
			expect(recordKills).not.toHaveBeenCalled();
		});
	});

	// Every other write to a card (a toggle, a Readiness spend) is not looked at.
	it("ignores an update that does not touch the applied rows", () => {
		const options = {};
		onPreUpdateChatMessage(card(), { flags: { [SCOPE]: { followerBlow: true } } }, options);
		expect(options[APPLIED_BEFORE_OPTION]).toBeUndefined();
	});

	// The damage path no longer reaches into the timeline, and the sheet only announces.
	it("is announced by the sheet on the hook the watcher hears", () => {
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain(`Hooks.callAll("${FOLLOWER_DIED_HOOK}", this.actor,`);
		expect(sheet).not.toMatch(/from\s+"\.\.\/\.\.\/timeline\/timeline-watch\.js"/);
	});
});
