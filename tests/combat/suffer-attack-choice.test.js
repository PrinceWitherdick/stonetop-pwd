import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The HP write, mocked so the tests can assert WHETHER and WHEN it happened. Every other export
// (parseMonsterAttacks above all) stays real: the split is the behaviour under test.
vi.mock("../../module/utils/damage.js", async (importOriginal) => ({
	...(await importOriginal()),
	applyDamageToActor: vi.fn(async () => ({ oldHp: 12, newHp: 5 })),
}));

const { applyDamageToActor } = await import("../../module/utils/damage.js");
const { executeSuffer, resolveSufferChoice } = await import("../../module/combat/attack-flow.js");

const SCOPE = "stonetop-pwd";

// The confirm dialog, answered immediately with whatever value the flow suggested — so the
// assertions land on the suggestion (the roll and its armor maths), not on the prompt.
let lastDialogContent = "";
let lastSuggested = null;
class AutoConfirmDialog {
	constructor(config) { this._config = config; }
	render() {
		lastDialogContent = this._config.content;
		lastSuggested = Number(/name="amount" value="(\d+)"/.exec(this._config.content)?.[1] ?? 0);
		this._config.buttons.apply.callback({ querySelector: () => ({ value: String(lastSuggested) }) });
	}
}
class CancelledDialog {
	constructor(config) { this._config = config; }
	render() { this._config.buttons.cancel.callback(); }
}

function makeMessage(flags = {}) {
	return {
		id: "msg1",
		isOwner: true,
		flags,
		getFlag: (scope, key) => (scope === SCOPE ? flags[key] : undefined),
		setFlag: vi.fn(async (scope, key, value) => { flags[key] = value; return value; }),
	};
}

const pc = { name: "Pim", uuid: "Actor.pim", system: { attributes: { armor: { value: 2 } } } };

/** A targeted foe whose stat block prints `damageValue`. */
function targeting(damageValue, rollFormula = "") {
	globalThis.fromUuid = async () => ({ actor: { system: { attributes: { damage: { value: damageValue, rollFormula } } } } });
	return { attackerUuid: pc.uuid, targets: [{ uuid: "Scene.s.Token.t", name: "Rime Lord" }] };
}

let posted;

beforeEach(() => {
	posted = [];
	lastDialogContent = "";
	lastSuggested = null;
	applyDamageToActor.mockClear();
	globalThis.Dialog = AutoConfirmDialog;
	// A fixed roll, so the suggestion is pure arithmetic: 9, then armor/piercing.
	globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { return { total: 9 }; } };
	globalThis.ChatMessage = {
		create: vi.fn(async (data) => { posted.push(data); return { ...data, id: `posted${posted.length}` }; }),
		getSpeaker: () => ({}),
		getWhisperRecipients: () => [{ id: "gm1" }],
	};
	globalThis.game = { user: { isGM: true, id: "gm1" }, users: { activeGM: { id: "gm1" } }, messages: { get: () => null } };
	globalThis.ui = { notifications: { warn: vi.fn(), error: vi.fn() } };
	globalThis.fromUuidSync = () => null;
});

afterEach(() => {
	for (const key of ["Dialog", "Roll", "ChatMessage", "game", "ui", "fromUuid", "fromUuidSync"]) delete globalThis[key];
});

describe("a foe with ONE printed attack resolves as it always did", () => {
	it("rolls, mitigates by armor and applies without asking anybody", async () => {
		const message = makeMessage();
		const applied = await executeSuffer(message, pc, targeting("bronze khopesh d10+2 (close, messy)", "d10+2"), "attack");

		expect(applied).toBe(true);
		expect(lastSuggested).toBe(7);                    // 9 rolled − 2 armor
		expect(applyDamageToActor).toHaveBeenCalledWith(pc, 7);
		expect(posted.some(p => p.flags?.[SCOPE]?.sufferChoice)).toBe(false);
	});

	it("honours an attack that ignores armor", async () => {
		// Previously armor came off every incoming blow, whatever the stat block said.
		const message = makeMessage();
		await executeSuffer(message, pc, targeting("heat-drain d12+1 (reach, ignores armor)", "d12+1"), "attack");
		expect(lastSuggested).toBe(9);
	});

	it("honours an attack that pierces part of the armor", async () => {
		const message = makeMessage();
		await executeSuffer(message, pc, targeting("antler d10+2 (close, 1 piercing)", "d10+2"), "attack");
		expect(lastSuggested).toBe(8);                    // 9 − max(0, 2 armor − 1 piercing)
	});

	it("shows the arithmetic it used, so the number is a confirmation and not a mystery", async () => {
		await executeSuffer(makeMessage(), pc, targeting("bronze khopesh d10+2 (close)", "d10+2"), "attack");
		expect(lastDialogContent).toContain("− 2 armor");

		await executeSuffer(makeMessage(), pc, targeting("antler d10+2 (close, 1 piercing)", "d10+2"), "attack");
		expect(lastDialogContent).toContain("− 1 armor (2 − 1 piercing)");

		// No subtraction is SHOWN where none happened; the old line said "− 2 armor" regardless.
		await executeSuffer(makeMessage(), pc, targeting("heat-drain d12+1 (reach, ignores armor)", "d12+1"), "attack");
		expect(lastDialogContent).toContain("ignoring your armor");
		expect(lastDialogContent).not.toContain("− 2 armor");
	});

	it("still offers a manual entry for a foe with no damage line at all", async () => {
		// The 22 spirits print "none". Inventing a die for them would be damage the book never gave.
		const message = makeMessage();
		await executeSuffer(message, pc, targeting("none", ""), "attack");
		expect(lastSuggested).toBe(0);
		expect(lastDialogContent).toContain("No stat-block damage found");
	});
});

describe("a foe with SEVERAL printed attacks asks the GM", () => {
	const RIME_LORD = "conjured ice d12+3 (any range, area, grabby, forceful) or heat-drain d12+1 (reach, ignores armor)";

	it("posts a GM-whispered card of buttons instead of guessing, and applies nothing yet", async () => {
		const message = makeMessage();
		const result = await executeSuffer(message, pc, targeting(RIME_LORD, "d12+3"), "attack");

		expect(result).toBe("pending");
		expect(applyDamageToActor).not.toHaveBeenCalled();

		const card = posted.find(p => p.flags?.[SCOPE]?.sufferChoice);
		expect(card).toBeTruthy();
		// Whispered: the buttons ARE the stat block, and that is the GM's to know.
		expect(card.whisper).toEqual(["gm1"]);
		expect(card.flags[SCOPE].sufferChoice.attacks.map(a => a.label)).toEqual(["conjured ice", "heat-drain"]);
		expect(card.content).toContain("d12+1");
		expect(card.content).toContain("ignores armor");
	});

	it("latches the source card so a second click cannot post a second question", async () => {
		const message = makeMessage();
		await executeSuffer(message, pc, targeting(RIME_LORD, "d12+3"), "attack");
		expect(message.flags.attack.awaitingChoice).toBe(true);

		const again = await executeSuffer(message, pc, targeting(RIME_LORD, "d12+3"), "attack");
		expect(again).toBe(false);
		expect(posted.filter(p => p.flags?.[SCOPE]?.sufferChoice)).toHaveLength(1);
	});

	it("never asks when the card was already suffered", async () => {
		const message = makeMessage({ attack: { suffered: true } });
		expect(await executeSuffer(message, pc, targeting(RIME_LORD, "d12+3"), "attack")).toBe(false);
		expect(posted).toHaveLength(0);
	});
});

describe("the GM's pick rolls that attack and writes the HP", () => {
	const choiceCard = (chosen = null) => makeMessage({
		sufferChoice: {
			pcUuid: pc.uuid, foeName: "Rime Lord", foeText: "", sourceId: "msg1", flagKey: "attack", chosen,
			attacks: [
				{ label: "conjured ice", formula: "d12+3", tags: [], piercing: 0, ignoresArmor: false, rollMode: "normal" },
				{ label: "heat-drain", formula: "d12+1", tags: [], piercing: 0, ignoresArmor: true, rollMode: "normal" },
			],
		},
	});

	beforeEach(() => { globalThis.fromUuid = async () => pc; });

	it("applies the PICKED attack's clause, not the primary one's", async () => {
		const message = choiceCard();
		expect(await resolveSufferChoice(message, 1)).toBe(true);
		// heat-drain ignores armor: the full 9, where the other attack would have suggested 7.
		expect(lastSuggested).toBe(9);
		expect(applyDamageToActor).toHaveBeenCalledWith(pc, 9);
		expect(lastDialogContent).toContain("heat-drain");
	});

	it("records which attack was taken so the card still says", async () => {
		const message = choiceCard();
		await resolveSufferChoice(message, 0);
		expect(message.flags.sufferChoice.chosen).toBe(0);
		expect(posted.at(-1).content).toContain("conjured ice");
	});

	it("refuses a second pick once one is recorded", async () => {
		const message = choiceCard(0);
		expect(await resolveSufferChoice(message, 1)).toBe(false);
		expect(applyDamageToActor).not.toHaveBeenCalled();
	});

	it("refuses an index the card does not offer", async () => {
		expect(await resolveSufferChoice(choiceCard(), 7)).toBe(false);
		expect(applyDamageToActor).not.toHaveBeenCalled();
	});

	it("applies nothing when the GM cancels the confirm dialog, and stays askable", async () => {
		globalThis.Dialog = CancelledDialog;
		const message = choiceCard();
		expect(await resolveSufferChoice(message, 0)).toBe(false);
		expect(applyDamageToActor).not.toHaveBeenCalled();
		expect(message.flags.sufferChoice.chosen).toBe(null);
	});

	it("records the pick BEFORE the HP write, so a failed latch costs no damage", async () => {
		const order = [];
		const message = choiceCard();
		message.setFlag.mockImplementation(async (scope, key, value) => {
			order.push("latch"); message.flags[key] = value; return value;
		});
		applyDamageToActor.mockImplementation(async () => { order.push("damage"); return { oldHp: 12, newHp: 5 }; });

		await resolveSufferChoice(message, 0);
		expect(order).toEqual(["latch", "damage"]);
	});

	it("applies NO damage when the pick cannot be recorded", async () => {
		const message = choiceCard();
		message.setFlag.mockImplementation(async () => { throw new Error("no permission"); });

		expect(await resolveSufferChoice(message, 0)).toBe(false);
		expect(applyDamageToActor).not.toHaveBeenCalled();
		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
	});
});
