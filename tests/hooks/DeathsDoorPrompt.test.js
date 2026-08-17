import { afterEach, describe, expect, it, vi } from "vitest";
import {
	autoOpenUserId,
	onUpdateActorDeathsDoorAutoOpen,
	onUpdateActorDeathsDoorCard,
} from "../../module/hooks/DeathsDoorPrompt.js";
import { DEATHS_DOOR_STATE } from "../../module/actors/character/deaths-door.js";

const SCOPE = "stonetop-pwd";

/** A user as `ownerUsers` reduces one: just the four facts the claim rules on. */
const user = (id, { isGM = false, active = true, assigned = false } = {}) => ({ id, isGM, active, assigned });

/**
 * A dying character on a client, with the surfaces the auto-open touches: the ownership test,
 * the users' assigned characters, and the sheet it opens through.
 *
 * Modelled on a table that lets the party read each other's sheets — every player owns the
 * dying PC, and only one of them is playing them.
 */
function world({ me = "player-1", owners = ["player-1", "player-2", "gm"], playedBy = "player-1", settings = {} } = {}) {
	const sheet = { render: vi.fn(async () => {}), _onDeathsDoorOpen: vi.fn(async () => {}) };
	const actor = { id: "actor-1", type: "character", sheet };
	const users = [
		{ id: "player-1", isGM: false, active: true },
		{ id: "player-2", isGM: false, active: true },
		{ id: "gm",       isGM: true,  active: true },
	];
	for (const u of users) u.character = u.id === playedBy ? actor : null;

	global.game = {
		user: { id: me },
		users: { contents: users },
		settings: {
			get: (_scope, key) => ({ deathsDoorPrompt: true, deathsDoorAutoOpen: true, ...settings })[key],
		},
	};

	actor.testUserPermission = (u) => owners.includes(u.id);
	return { actor, sheet };
}

/** The diff Foundry broadcasts when the preUpdate half records the dying state. */
const becameDying = { [`flags`]: { [SCOPE]: { deathsDoor: DEATHS_DOOR_STATE.DYING } } };

afterEach(() => { delete global.game; });

describe("autoOpenUserId — whose screen the walkthrough lands on", () => {
	// The whole point: it opens for the player who died, and for nobody else.
	it("gives it to the player the character is assigned to", () => {
		expect(autoOpenUserId([
			user("arto"),
			user("bella", { assigned: true }),
			user("gm", { isGM: true }),
		])).toBe("bella");
	});

	// A table where the party can read each other's sheets has every player owning every PC.
	// Ownership alone would hand Bella's death to whoever sorts first.
	it("passes over co-owners who merely have permission to see the sheet", () => {
		const party = ["arto", "cass", "delia"].map(id => user(id));
		expect(autoOpenUserId([...party, user("bella", { assigned: true })])).toBe("bella");
	});

	// Assignment is the strong signal, but it is not a requirement — a PC nobody has set as
	// their character still has an owner who should catch it.
	it("falls back to a logged-in player owner when nobody is assigned them", () => {
		expect(autoOpenUserId([user("player-1"), user("gm", { isGM: true })])).toBe("player-1");
	});

	// A GM-run PC, or a player who logged off mid-fight: better the GM's screen than nobody's.
	it("falls back to the GM only once no player owner is logged in", () => {
		expect(autoOpenUserId([user("player-1", { active: false, assigned: true }), user("gm", { isGM: true })])).toBe("gm");
	});

	it("claims nobody when no owner is connected at all", () => {
		expect(autoOpenUserId([user("player-1", { active: false })])).toBe(null);
		expect(autoOpenUserId([])).toBe(null);
	});

	// Every client runs this over the same user list, so a tie must resolve to ONE answer or
	// the dialog opens once per claimant.
	it("breaks a tie the same way whatever order the users arrive in", () => {
		const owners = [user("bella"), user("arto"), user("gm", { isGM: true })];
		expect(autoOpenUserId(owners)).toBe("arto");
		expect(autoOpenUserId([...owners].reverse())).toBe("arto");
	});
});

describe("onUpdateActorDeathsDoorAutoOpen — opening the move on the dying player's screen", () => {
	it("opens the sheet's 0-HP walkthrough for the player who died", async () => {
		const { actor, sheet } = world({ me: "player-2", playedBy: "player-2" });
		onUpdateActorDeathsDoorAutoOpen(actor, becameDying);
		await vi.waitFor(() => expect(sheet._onDeathsDoorOpen).toHaveBeenCalled());
		expect(sheet.render).toHaveBeenCalledWith(true);
	});

	it("opens nothing on the GM's client while that player is logged in", () => {
		const { actor, sheet } = world({ me: "gm" });
		onUpdateActorDeathsDoorAutoOpen(actor, becameDying);
		expect(sheet.render).not.toHaveBeenCalled();
	});

	// player-2 owns the dying PC too — the party can read each other's sheets — but it isn't
	// their character, so the window isn't theirs.
	it("opens nothing on another player's client, even one who owns the sheet", () => {
		const { actor, sheet } = world({ me: "player-2", playedBy: "player-1" });
		onUpdateActorDeathsDoorAutoOpen(actor, becameDying);
		expect(sheet.render).not.toHaveBeenCalled();
	});

	// Subordinate to the announcement: silencing the card silences the window with it.
	it("stays shut when either setting is off", () => {
		for (const settings of [{ deathsDoorAutoOpen: false }, { deathsDoorPrompt: false }]) {
			const { actor, sheet } = world({ settings });
			onUpdateActorDeathsDoorAutoOpen(actor, becameDying);
			expect(sheet.render).not.toHaveBeenCalled();
		}
	});

	// The flag is written only on the transition, so an already-down PC taking another hit
	// carries no state change — and must not get a second window.
	it("ignores an update that isn't the moment they became dying", () => {
		const { actor, sheet } = world();
		onUpdateActorDeathsDoorAutoOpen(actor, { system: { attributes: { hp: { value: 0 } } } });
		onUpdateActorDeathsDoorAutoOpen(actor, { flags: { [SCOPE]: { deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION } } });
		expect(sheet.render).not.toHaveBeenCalled();
	});

	it("ignores actors that aren't characters", () => {
		const { actor, sheet } = world();
		onUpdateActorDeathsDoorAutoOpen({ ...actor, type: "monster" }, becameDying);
		expect(sheet.render).not.toHaveBeenCalled();
	});
});

// The announcement used to be posted from preUpdateActor — i.e. before the write that makes it
// true was committed. An update can still be refused at that point (a later preUpdate hook
// returning false, a permission, a dropped connection), and the hit points and the state flag are
// discarded together when it is; the card is not. It now rides the committed diff instead, on the
// same signal the auto-open reads.
describe("onUpdateActorDeathsDoorCard — announcing a PC who went down", () => {
	/** The card path needs a ChatMessage to create and an actor with a uuid to point at. */
	function cardWorld(opts = {}) {
		const built = world(opts);
		built.actor.uuid = "Actor.actor-1";
		built.actor.name = "Pim";
		global.ChatMessage = {
			create: vi.fn(async (data) => data),
			getSpeaker: vi.fn(() => ({ actor: built.actor.id })),
		};
		return built;
	}

	afterEach(() => { delete global.ChatMessage; });

	it("posts the card once the dying state has actually landed", async () => {
		const { actor } = cardWorld({ me: "gm" });
		onUpdateActorDeathsDoorCard(actor, becameDying, {}, "gm");
		await vi.waitFor(() => expect(global.ChatMessage.create).toHaveBeenCalled());
		expect(global.ChatMessage.create.mock.calls[0][0].content).toContain("dying");
	});

	it("posts nothing for an update that never became dying", () => {
		const { actor } = cardWorld({ me: "gm" });
		onUpdateActorDeathsDoorCard(actor, { system: { attributes: { hp: { value: 0 } } } }, {}, "gm");
		onUpdateActorDeathsDoorCard(actor, { flags: { [SCOPE]: { deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION } } }, {}, "gm");
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});

	// updateActor fires on every connected client, and the card is public — all of them posting
	// one is N copies of the same announcement.
	it("posts from the client that made the change and no other", () => {
		const { actor } = cardWorld({ me: "player-2" });
		onUpdateActorDeathsDoorCard(actor, becameDying, {}, "gm");
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("stays quiet when the table silenced the announcement", () => {
		const { actor } = cardWorld({ me: "gm", settings: { deathsDoorPrompt: false } });
		onUpdateActorDeathsDoorCard(actor, becameDying, {}, "gm");
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("ignores actors that aren't characters", () => {
		const { actor } = cardWorld({ me: "gm" });
		onUpdateActorDeathsDoorCard({ ...actor, type: "monster" }, becameDying, {}, "gm");
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});
});
