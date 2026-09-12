/**
 * The globals an incoming attack's chat posts reach for, stood up once.
 *
 * Two suites drive the same flow from opposite ends — one from the blow arriving
 * (suffer-enemy-attack), one from the GM's answer to a card it whispered (suffer-attack-choice) —
 * and both need the same fixed die, the same ChatMessage recorder and the same teardown. Written
 * out twice, a stub that drifted would have each suite testing a slightly different world.
 *
 * The ROLL IS FIXED at 9 on purpose: every total these suites assert is then pure arithmetic on
 * the die the flow chose, and a failure names the flow rather than the dice.
 */
import { vi } from "vitest";

export const SCOPE = "stonetop-pwd";

/** The character the blow is aimed at. Two armor, which is what makes mitigation visible. */
export const pc = {
	name: "Pim", id: "pim", uuid: "Actor.pim", type: "character",
	system: { attributes: { armor: { value: 2 } } },
};

const GLOBALS = ["Roll", "CONST", "ChatMessage", "game", "ui", "fromUuid"];

/**
 * Install the fakes and return the array that every `ChatMessage.create` lands in.
 *
 * `fromUuid` is deliberately NOT set here: one suite points it at the character and the other
 * re-points it per test at a foe whose stat block prints the line under test. It is torn down
 * either way.
 *
 * @param {object}  [o]
 * @param {object}  [o.user]  merged into `game.user`.
 * @param {object}  [o.game]  merged into `game`.
 * @returns {object[]} the posted message payloads, in order.
 */
export function installCombatChatFakes({ user = {}, game: gameExtra = {} } = {}) {
	const posted = [];

	globalThis.Roll = class {
		constructor(formula) { this.formula = formula; }
		async evaluate() { this.total = 9; this.dice = []; return this; }
	};
	globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1 } };
	globalThis.ChatMessage = {
		create: vi.fn(async (data) => { posted.push(data); return { ...data, id: `posted${posted.length}` }; }),
		getSpeaker: () => ({ alias: "Pim" }),
		getWhisperRecipients: () => [{ id: "gm1" }],
	};
	globalThis.game = {
		...globalThis.game,
		user: { isGM: true, id: "gm1", ...user },
		// A GM at the table, which is the ordinary case and what the whispered cards assume. Pass
		// `game: { users: NO_ACTIVE_GM }` for the table that has none: a whisper still sends to
		// every user holding the role, so "asked" and "asked somebody who is here" differ.
		users: activeGm(),
		settings: { get: () => "roll" },
		...gameExtra,
	};
	globalThis.ui = { notifications: { warn: vi.fn(), error: vi.fn() } };

	return posted;
}

/** `game.users` with a GM logged in: what `primary-gm.js` reads, in the shape it reads it. */
function activeGm() {
	const users = [{ id: "gm1", isGM: true, active: true }];
	return { activeGM: users[0], find: (fn) => users.find(fn) };
}

/** `game.users` with the GM away — every user still HOLDS the role, none of them is here. */
export const NO_ACTIVE_GM = { activeGM: null, find: () => undefined };

/** Take them back down, so the next file in the run starts from a bare global. */
export function uninstallCombatChatFakes() {
	for (const key of GLOBALS) delete globalThis[key];
}

/** The posted card carrying `flagKey` under the system's scope, or undefined. */
export const cardWithFlag = (posted, flagKey) => posted.find(p => p.flags?.[SCOPE]?.[flagKey]);

/** A chat message whose flags can be read and written, as the GM-card handlers expect. */
export function makeMessage(flags = {}) {
	return {
		id: "msg1",
		isOwner: true,
		flags,
		getFlag: (scope, key) => (scope === SCOPE ? flags[key] : undefined),
		setFlag: vi.fn(async (scope, key, value) => { flags[key] = value; return value; }),
	};
}
