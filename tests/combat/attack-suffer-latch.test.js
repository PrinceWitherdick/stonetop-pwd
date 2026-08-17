import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// applyDamageToActor is the HP write. Mocked so the test can watch when it is called relative
// to the `suffered` latch — which is the entire point of this file.
// Only this one export is replaced — attack-flow also imports dieFromDamage from here.
vi.mock("../../module/utils/damage.js", async (importOriginal) => ({
	...(await importOriginal()),
	applyDamageToActor: vi.fn(async () => ({ oldHp: 10, newHp: 7 })),
}));

const { applyDamageToActor } = await import("../../module/utils/damage.js");
const { executeSuffer } = await import("../../module/combat/attack-flow.js");

const SCOPE = "stonetop-pwd";

// Suffering opens a confirm dialog; this Dialog answers it immediately with the suggested
// number, so the test exercises the write ordering rather than the prompt.
class AutoConfirmDialog {
	constructor(config) { this._config = config; }
	render() {
		const input = { value: "3" };
		this._config.buttons.apply.callback({ querySelector: () => input });
	}
}

/** A chat card whose `setFlag` can be made to fail the way a non-author's write does. */
function makeMessage({ setFlagFails = false } = {}) {
	const flags = {};
	return {
		flags,
		isOwner: true,
		getFlag: (scope, key) => (scope === SCOPE ? flags[key] : undefined),
		setFlag: vi.fn(async (scope, key, value) => {
			if (setFlagFails) throw new Error("User lacks permission to update ChatMessage");
			flags[key] = value;
			return value;
		}),
	};
}

const pc = { name: "Pim", system: { attributes: { armor: { value: 1 } } } };
// No targets: the foe lookup and damage roll are skipped, so the prompt's suggested value is
// what the dialog above returns. The ordering under test is downstream of all of that.
const ctx = { attackerUuid: "Actor.pim", targets: [] };

let calls;

beforeEach(() => {
	calls = [];
	applyDamageToActor.mockClear();
	applyDamageToActor.mockImplementation(async () => {
		calls.push("damage");
		return { oldHp: 10, newHp: 7 };
	});

	globalThis.Dialog = AutoConfirmDialog;
	globalThis.Roll = class { async evaluate() { return { total: 0 }; } };
	globalThis.fromUuid = async () => null;
	globalThis.ChatMessage = {
		create: vi.fn(async () => ({})),
		getSpeaker: () => ({}),
	};
	globalThis.ui = { notifications: { warn: vi.fn(), error: vi.fn() } };
});

afterEach(() => {
	delete globalThis.Dialog;
	delete globalThis.Roll;
	delete globalThis.fromUuid;
	delete globalThis.ChatMessage;
	delete globalThis.ui;
});

describe("executeSuffer latches before it writes HP", () => {
	it("marks the card suffered BEFORE applying the damage", async () => {
		const message = makeMessage();
		message.setFlag.mockImplementation(async (scope, key, value) => {
			calls.push("latch");
			message.flags[key] = value;
			return value;
		});

		await executeSuffer(message, pc, ctx, "attack");

		// Order is the assertion. Latching afterwards meant a rejected latch left the HP already
		// gone and the card still unlatched.
		expect(calls).toEqual(["latch", "damage"]);
	});

	it("applies NO damage when the latch cannot be written", async () => {
		// The real shape of the bug: the GM rolled the attack, so the card is theirs. The player
		// owns the PC and passes the button's gate, but cannot update the message.
		const message = makeMessage({ setFlagFails: true });

		const applied = await executeSuffer(message, pc, ctx, "attack");

		expect(applied).toBe(false);
		expect(applyDamageToActor).not.toHaveBeenCalled();
		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
	});

	it("refuses a second suffer once the latch is set", async () => {
		const message = makeMessage();
		message.flags.attack = { suffered: true };

		expect(await executeSuffer(message, pc, ctx, "attack")).toBe(false);
		expect(applyDamageToActor).not.toHaveBeenCalled();
	});
});
