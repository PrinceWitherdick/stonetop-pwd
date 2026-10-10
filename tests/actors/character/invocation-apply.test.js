import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	BATH_PICK, BATH_FLAG, SHADOW_FLAG, BATH_QUERY, BATH_OF_HEALING_LIGHT, GO_BACK_TO_THE_SHADOW,
	bathOfHealingChoices, bathPickCount, validateBathPicks, bathHealing, shadowDamageFormula, invocationEffectsFor,
	bathPatientView, bathWindowContent, readBathForm, squareBathForm, chooseBathPatient, applyBath, healPatient,
	handleBathQuery, bathResultHtml, settleBathOfHealingLight, settleShadowDamage, askBathPicks,
	isBathPatient, bathHpOnly, partyFollowers, restoreActorHp, restoreFollowerCardHp, bathGroupFor, chooseBathMember,
} from "../../../module/actors/character/invocation-apply.js";
import { rosterGroupFor } from "../../../module/fight/group-hits.js";
import { stubAsk } from "../../fakes/confirm.js";
import { invokeCardReduced, invokeCardChoosesConsequence } from "../../../module/actors/character/invoke-consequences.js";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";

// R7: the buttons two Invocations grow on the Invoke the Sun God card that names them. Bath of Healing
// Light heals a patient, Go Back to the Shadow rolls at the spirits. And the holy relics on the Wielder
// of the White Flame's "as a 10+" card.

const SCOPE = "stonetop-pwd";
const pick = (key, ref) => (ref ? { key, ref } : { key });

/** An Invoke card whose flags live in a plain object, as the consequence tests keep theirs. */
function card({ invocations = [BATH_OF_HEALING_LIGHT], empowered = false, tenPlus = false, move = "Invoke the Sun God", speaker = null } = {}) {
	const flags = { [SCOPE]: { move, invocations, ...(empowered ? { invokeEmpowered: true } : {}), ...(tenPlus ? { invokeTenPlus: true } : {}) } };
	return {
		id: "m1",
		flags,
		speaker: speaker ?? {},
		getFlag: (scope, key) => (scope === SCOPE ? flags[SCOPE][key] : undefined),
		setFlag: vi.fn(async (_scope, key, value) => { flags[SCOPE][key] = value; }),
		unsetFlag: vi.fn(async (_scope, key) => { delete flags[SCOPE][key]; }),
		canUserModify: () => true,
	};
}

/** A patient, with the model call the heal makes. */
function patient({ name = "Kyra", owner = true, marked = [], wounds = [] } = {}) {
	return {
		id: name.toLowerCase(), name, type: "character", isOwner: owner, uuid: `Actor.${name.toLowerCase()}`,
		system: { attributes: { wounds } },
		typedActor: {
			debilityChoices: ["weakened", "dazed", "miserable"].map(key => ({ key, name: key[0].toUpperCase() + key.slice(1), marked: marked.includes(key) })),
			receiveHealing: vi.fn(async ({ hp, clearDebilities }) => ({
				hp: hp ? { gain: hp, from: 3, to: 3 + hp } : null,
				cleared: clearDebilities.map(key => ({ key, name: key[0].toUpperCase() + key.slice(1) })),
				stabilized: null, healed: null,
			})),
		},
	};
}

const seren = { id: "seren", name: "Seren", type: "character", isOwner: true, uuid: "Actor.seren", items: [] };

/** Anyone but a player character: HP on the actor, written by `update`, and nothing else to heal. */
function npcPatient({ name = "Andras", type = "npc", owner = true, hp = 2, max = 6, uuid = null, id = null, flags = {} } = {}) {
	const actor = {
		id: id ?? name.toLowerCase(), name, type, isOwner: owner, uuid: uuid ?? `Actor.${name.toLowerCase()}`,
		flags: { [SCOPE]: flags },
		// Wounds on an NPC's data are not the Invocation's to reach: only a player character keeps them.
		system: { attributes: { hp: { value: hp, max }, wounds: [{ id: "w1", text: "Gash", status: "problematic" }] } },
		update: vi.fn(async changes => { if ("system.attributes.hp.value" in changes) actor.system.attributes.hp.value = changes["system.attributes.hp.value"]; }),
	};
	return actor;
}

let posted;
let saved;
beforeEach(() => {
	posted = [];
	saved = { ChatMessage: globalThis.ChatMessage, ui: globalThis.ui, user: globalThis.game.user, users: globalThis.game.users, messages: globalThis.game.messages, actors: globalThis.game.actors };
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ alias: actor?.name }) };
	globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn() } };
});
afterEach(() => {
	globalThis.ChatMessage = saved.ChatMessage;
	globalThis.ui = saved.ui;
	globalThis.game.user = saved.user;
	globalThis.game.users = saved.users;
	globalThis.game.messages = saved.messages;
	globalThis.game.actors = saved.actors;
});

describe("Bath of Healing Light's choices", () => {
	it("are the four printed ones, and the empowered effect adds its three", () => {
		expect(bathOfHealingChoices().map(c => c.key)).toEqual([BATH_PICK.HP5, BATH_PICK.DEBILITY, BATH_PICK.STABILIZE, BATH_PICK.MINOR]);
		expect(bathOfHealingChoices({ empowered: true }).map(c => c.key)).toEqual([
			BATH_PICK.HP5, BATH_PICK.DEBILITY, BATH_PICK.STABILIZE, BATH_PICK.MINOR, BATH_PICK.HP10, BATH_PICK.RECOVER, BATH_PICK.AFFLICTION,
		]);
		// "can pick this twice"
		expect(bathOfHealingChoices({ empowered: true }).filter(c => c.max === 2).map(c => c.key)).toEqual([BATH_PICK.HP5, BATH_PICK.DEBILITY, BATH_PICK.HP10]);
	});

	it("pick 2, and only 1 reduced", () => {
		expect(bathPickCount()).toBe(2);
		expect(bathPickCount({ reduced: true })).toBe(1);
	});

	it("allows a twice-pick twice, and nothing past the count", () => {
		expect(validateBathPicks([pick("hp5"), pick("hp5")]).ok).toBe(true);
		expect(validateBathPicks([pick("hp5"), pick("minor")]).ok).toBe(true);
		expect(validateBathPicks([pick("hp5"), pick("hp5")], { reduced: true }).ok).toBe(false);
		expect(validateBathPicks([pick("hp5")], { reduced: true }).ok).toBe(true);
		expect(validateBathPicks([pick("minor"), pick("minor")]).ok).toBe(false);
		expect(validateBathPicks([pick("hp5"), pick("hp5"), pick("minor")]).ok).toBe(false);
		expect(validateBathPicks([]).ok).toBe(false);
	});

	it("offers the empowered choices only when empowered", () => {
		expect(validateBathPicks([pick("hp10")]).ok).toBe(false);
		expect(validateBathPicks([pick("hp10"), pick("hp10")], { empowered: true }).ok).toBe(true);
		expect(validateBathPicks([pick("affliction")], { empowered: true }).ok).toBe(true);
	});

	it("clears two different debilities, never one twice, and names the wound it acts on", () => {
		expect(validateBathPicks([pick("debility", "weakened"), pick("debility", "dazed")]).ok).toBe(true);
		expect(validateBathPicks([pick("debility", "weakened"), pick("debility", "weakened")]).ok).toBe(false);
		expect(validateBathPicks([pick("stabilize")]).ok).toBe(false);
		expect(validateBathPicks([pick("stabilize", "w1")]).ok).toBe(true);
	});

	it("turns picks into the one write and the table's lines", () => {
		expect(bathHealing([pick("hp5"), pick("hp10"), pick("debility", "dazed"), pick("stabilize", "w1"), pick("recover", "w2"), pick("minor"), pick("affliction")]))
			.toEqual({ hp: 15, clearDebilities: ["dazed"], stabilizeWound: "w1", healWound: "w2", minor: true, affliction: true });
		expect(bathHealing([pick("hp5"), pick("hp5")])).toMatchObject({ hp: 10, clearDebilities: [], stabilizeWound: null, healWound: null, minor: false });
	});
});

describe("the picks window", () => {
	const wounds = [
		{ id: "w1", text: "Broken arm", status: "problematic" },
		{ id: "w2", text: "Cracked ribs", status: "stabilized" },
		{ id: "w3", text: "Lost eye", status: "permanent" },
		{ id: "w4", text: "Old gash", status: "problematic", healed: true },
		{ id: "w5", text: "Secret curse wound", status: "problematic", gmOnly: true },
	];

	it("names each marked debility and each problematic wound as its own box", () => {
		globalThis.game.user = { isGM: false };
		const view = bathPatientView(patient({ marked: ["dazed"], wounds }));
		expect(view.debilities).toEqual([{ key: "dazed", name: "Dazed" }]);
		// Stabilized only if not already; recovered from stabilized or not; never a permanent injury or a scar.
		expect(view.open.map(w => w.id)).toEqual(["w1", "w5"]);
		expect(view.wounds.map(w => w.id)).toEqual(["w1", "w2", "w5"]);
		// A GM-only wound is not the player's to read.
		expect(view.open[1].text).toBe("a wound only the GM can see");
	});

	it("draws the empowered choices only when empowered, and the Reduced box as the card has it", () => {
		const view = bathPatientView(patient({ marked: ["weakened", "miserable"], wounds }));
		const plain = bathWindowContent(view, { reduced: true });
		expect(plain).toContain('value="debility:weakened"');
		expect(plain).toContain('value="debility:miserable"');
		expect(plain).not.toContain('value="debility:dazed"');
		expect(plain).toContain('value="stabilize:w1"');
		expect(plain.match(/value="hp5"/g)).toHaveLength(2);
		expect(plain).not.toContain("hp10");
		expect(plain).toMatch(/name="stonetop-bath-reduced" checked/);
		expect(plain).toContain("Pick 1: 0 chosen.");
		const empowered = bathWindowContent(view, { empowered: true });
		expect(empowered.match(/value="hp10"/g)).toHaveLength(2);
		expect(empowered).toContain('value="recover:w2"');
		expect(empowered).toContain('value="affliction"');
		expect(empowered).not.toMatch(/name="stonetop-bath-reduced" checked/);
	});

	it("says there is nothing to clear rather than offering a box that does nothing", () => {
		const html = bathWindowContent(bathPatientView(patient()), {});
		expect(html).toContain("Clears a debility (none is marked)");
		expect(html).toMatch(/value="debility" data-group="debility" data-max="2" data-none="1" disabled/);
	});

	/** A form of boxes, as squareBathForm and readBathForm read one. */
	function form(values, { reduced = false } = {}) {
		const boxes = values.map(([value, checked = false]) => ({
			value, checked, disabled: false, dataset: { group: value.split(":")[0], max: String(["hp5", "hp10", "debility"].includes(value.split(":")[0]) ? 2 : 1) },
		}));
		const reducedBox = { checked: reduced };
		const count = { textContent: "" };
		const heal = { disabled: false };
		return {
			boxes, count, heal,
			querySelectorAll: sel => (sel.includes("stonetop-bath-pick") ? boxes : []),
			querySelector: sel => (sel.includes("stonetop-bath-reduced") ? reducedBox
				: sel === ".stonetop-bath-count" ? count : sel.includes('data-action="heal"') ? heal : null),
		};
	}

	it("asks with a button that names the patient, reads the form, and caps it on screen", async () => {
		const savedDoc = globalThis.document;
		globalThis.document = { createElement: () => ({ innerHTML: "" }) };
		try {
			const answered = form([["hp5", true], ["minor", true]]);
			const wait = stubAsk("heal", answered);
			await expect(askBathPicks(patient(), { reduced: false })).resolves.toEqual({ reduced: false, picks: [pick("hp5"), pick("minor")] });
			const asked = wait.mock.calls[0][0];
			expect(asked.window.title).toBe("Bath of Healing Light: Kyra");
			// Affirmative first, and it names what happens.
			expect(asked.buttons.map(b => b.label)).toEqual(["Heal Kyra", "Not now"]);
			const onScreen = form([["hp5", true], ["hp5", true], ["minor"]]);
			onScreen.addEventListener = vi.fn();
			asked.render({}, { element: onScreen });
			expect(onScreen.boxes[2].disabled).toBe(true);
			expect(onScreen.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
		} finally {
			globalThis.document = savedDoc;
		}
	});

	it("reads the ticked boxes back as picks", () => {
		const f = form([["hp5", true], ["hp5", true], ["debility:dazed"], ["stabilize:w1"]]);
		expect(readBathForm(f)).toEqual({ reduced: false, picks: [pick("hp5"), pick("hp5")] });
	});

	it("caps the boxes at the count, which the Reduced box moves, and each choice at its own twice", () => {
		const f = form([["hp5", true], ["hp5"], ["minor"], ["stabilize:w1", true], ["stabilize:w5"]]);
		squareBathForm(f);
		// Two ticked of 2: nothing else can be.
		expect(f.boxes.filter(b => !b.checked).every(b => b.disabled)).toBe(true);
		expect(f.count.textContent).toBe("Pick 2: 2 chosen.");
		expect(f.heal.disabled).toBe(false);

		const one = form([["hp5", true], ["hp5"], ["minor"], ["stabilize:w1"]]);
		squareBathForm(one);
		expect(one.boxes.map(b => b.disabled)).toEqual([false, false, false, false]);
		const stab = form([["stabilize:w1", true], ["stabilize:w5"], ["minor"]]);
		squareBathForm(stab);
		// "one of their problematic wounds": a second wound is not on offer.
		expect(stab.boxes.map(b => b.disabled)).toEqual([false, true, false]);

		const reduced = form([["hp5", true], ["minor", true]], { reduced: true });
		squareBathForm(reduced);
		expect(reduced.count.textContent).toBe("Pick 1: 2 chosen.");
		expect(reduced.heal.disabled).toBe(true);
		const none = form([["hp5"], ["minor"]]);
		squareBathForm(none);
		expect(none.heal.disabled).toBe(true);
	});
});

describe("who the patient is", () => {
	const kyra = patient();
	const bram = patient({ name: "Bram" });
	const token = actor => ({ actor });

	it("is the one character targeted, with no question, passing over a target with no HP to heal", async () => {
		const ask = vi.fn();
		await expect(chooseBathPatient(seren, { targets: [token(kyra), token({ type: "stonetop", uuid: "Actor.st" })], pick: ask })).resolves.toBe(kyra);
		expect(ask).not.toHaveBeenCalled();
	});

	it("is nobody when the picker is closed, even for a patient with no uuid", async () => {
		const ask = vi.fn(async () => undefined);
		await expect(chooseBathPatient(seren, { targets: [token(kyra), token({ type: "monster", name: "Nameless" })], pick: ask })).resolves.toBeNull();
	});

	it("is asked from the party, the Lightbearer too, with nobody targeted", async () => {
		const ask = vi.fn(async () => "Actor.bram");
		await expect(chooseBathPatient(seren, { targets: [], party: () => [kyra, bram], followers: () => [], pick: ask })).resolves.toBe(bram);
		expect(ask.mock.calls[0][0].options.map(o => o.id)).toEqual(["Actor.seren", "Actor.kyra", "Actor.bram"]);
		expect(ask.mock.calls[0][0].formatLabel("Bram")).toBe("Heal Bram");
	});

	it("is asked from the targeted characters when there are several, and is nobody when closed", async () => {
		const ask = vi.fn(async () => null);
		await expect(chooseBathPatient(seren, { targets: [token(kyra), token(bram)], pick: ask })).resolves.toBeNull();
		expect(ask.mock.calls[0][0].options.map(o => o.id)).toEqual(["Actor.kyra", "Actor.bram"]);
	});
});

describe("healing the patient", () => {
	it("writes their own sheet when this client owns it", async () => {
		const kyra = patient({ marked: ["dazed"] });
		const gm = { query: vi.fn() };
		const out = await healPatient(card(), kyra, [pick("hp5"), pick("debility", "dazed")], {}, { gm });
		expect(kyra.typedActor.receiveHealing).toHaveBeenCalledWith({
			hp: 5, clearDebilities: ["dazed"], stabilizeWound: null, healWound: null, moveName: "Bath of Healing Light",
		});
		expect(out).toMatchObject({ patient: "Kyra", hp: { from: 3, to: 8 }, cleared: ["Dazed"], minor: false });
		expect(gm.query).not.toHaveBeenCalled();
	});

	it("asks the GM's client for another player's character, and gives up with no GM", async () => {
		const bram = patient({ name: "Bram", owner: false });
		const gm = { query: vi.fn(async () => ({ patient: "Bram" })) };
		await expect(healPatient(card(), bram, [pick("minor")], { reduced: true }, { gm, userId: "u1" })).resolves.toEqual({ patient: "Bram" });
		expect(gm.query).toHaveBeenCalledWith(BATH_QUERY, { messageId: "m1", patientUuid: "Actor.bram", picks: [pick("minor")], reduced: true, userId: "u1" }, { timeout: 10000 });
		expect(bram.typedActor.receiveHealing).not.toHaveBeenCalled();
		await expect(healPatient(card(), bram, [pick("minor")], {}, { gm: null })).resolves.toBeNull();
	});

	it("names a GM-only wound on the public card as a wound, and nothing more", async () => {
		const kyra = patient();
		kyra.typedActor.receiveHealing = vi.fn(async () => ({
			hp: null, cleared: [], stabilized: { id: "w5", text: "Secret curse wound", gmOnly: true }, healed: { id: "w1", text: "Broken arm" },
		}));
		const out = await applyBath(kyra, [pick("stabilize", "w5"), pick("recover", "w1")]);
		expect(out.stabilized).toEqual({ text: "" });
		expect(out.healed).toEqual({ text: "Broken arm" });
		const html = bathResultHtml(seren, out);
		expect(html).toContain("One of Kyra&#x27;s problematic wounds is stabilized.");
		expect(html).not.toContain("Secret");
		expect(html).toContain("Kyra fully recovers from a problematic wound: Broken arm.");
	});

	it("says what went on the sheet and what is the table's", () => {
		const html = bathResultHtml(seren, { patient: "Kyra", hp: { from: 3, to: 13 }, cleared: ["Dazed"], minor: true, affliction: true });
		expect(html).toContain("Seren cups their hands around their light and bathes Kyra in it.");
		expect(html).toContain("Kyra regains HP: 3 → 13.");
		expect(html).toContain("Kyra clears Dazed.");
		expect(html).toContain("Kyra recovers from a minor condition.");
		expect(html).toContain("Kyra is cured of a dire affliction, poison, or disease.");
		expect(bathResultHtml(seren, { patient: "Kyra", hp: { from: 20, to: 20 } })).toContain("Kyra&#x27;s HP stays at 20.");
	});
});

// The real model: one write, the computed max HP, and only what is really there.
describe("StonetopCharacter#receiveHealing", () => {
	it("regains HP up to the computed max, clears marked debilities and acts on the named wounds in one write", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy" });
		char.computedMaxHp = vi.fn(async () => 18);
		actor.system.attributes.hp.value = 4;
		actor.system.attributes.debilities.options.dazed.value = true;
		const w1 = await char.addWound({ text: "Broken arm" });
		const w2 = await char.addWound({ text: "Cracked ribs", status: "stabilized" });
		actor.update.mockClear();

		const out = await char.receiveHealing({ hp: 20, clearDebilities: ["dazed", "weakened"], stabilizeWound: w1, healWound: w2, moveName: "Bath of Healing Light" });
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.update.mock.calls[0][1]).toEqual({ stonetopMove: "Bath of Healing Light" });
		// 18, not the stored max of 8: max HP is computed.
		expect(actor.system.attributes.hp.value).toBe(18);
		expect(out.hp).toEqual({ gain: 20, from: 4, to: 18 });
		// Weakened was not marked, so there was nothing to clear.
		expect(out.cleared).toEqual([{ key: "dazed", name: "Dazed" }]);
		expect(actor.system.attributes.debilities.options.dazed.value).toBe(false);
		const wounds = actor.system.attributes.wounds;
		expect(wounds.find(w => w.id === w1)).toMatchObject({ status: "stabilized", healed: false });
		expect(wounds.find(w => w.id === w2)).toMatchObject({ healed: true });
		expect(out.stabilized.id).toBe(w1);
		expect(out.healed.id).toBe(w2);
	});

	it("never lowers HP, and writes nothing when there is nothing to do", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy" });
		char.computedMaxHp = vi.fn(async () => 10);
		actor.system.attributes.hp.value = 12;
		actor.update.mockClear();
		const out = await char.receiveHealing({ hp: 5, clearDebilities: ["dazed"], stabilizeWound: "nope" });
		expect(actor.update).not.toHaveBeenCalled();
		expect(out).toEqual({ hp: { gain: 5, from: 12, to: 12 }, cleared: [], stabilized: null, healed: null });
	});
});

describe("the GM's side of the heal", () => {
	function gmTable({ flag = true, empowered = false, owner = true, invocations = [BATH_OF_HEALING_LIGHT] } = {}) {
		const lightbearer = { ...seren, testUserPermission: vi.fn(() => owner) };
		const message = card({ invocations, empowered });
		if (flag) message.flags[SCOPE][BATH_FLAG] = flag;
		const bram = patient({ name: "Bram", owner: false });
		globalThis.game.user = { isGM: true, id: "gm1" };
		globalThis.game.users = { activeGM: { id: "gm1" }, find: () => null, get: id => (id === "u1" ? { id: "u1", isGM: false } : null) };
		globalThis.game.messages = { get: id => (id === "m1" ? message : null) };
		const apply = vi.fn(async () => ({ patient: "Bram" }));
		const deps = { resolve: uuid => (uuid === "Actor.bram" ? bram : null), apply };
		// The speaker is read off the card: speakerActor resolves it through game.actors.
		globalThis.game.actors = { get: id => (id === "seren" ? lightbearer : null) };
		message.speaker = { actor: "seren" };
		return { message, apply, deps };
	}
	const ask = (extra = {}) => ({ messageId: "m1", patientUuid: "Actor.bram", picks: [pick("hp5"), pick("minor")], reduced: false, userId: "u1", ...extra });

	it("heals for the player who plays the Lightbearer who posted the card", async () => {
		const { apply, deps } = gmTable();
		await expect(handleBathQuery(ask(), {}, deps)).resolves.toEqual({ patient: "Bram" });
		expect(apply).toHaveBeenCalledWith(expect.objectContaining({ name: "Bram" }), [pick("hp5"), pick("minor")]);
	});

	it("reads Empowered off the card, not off the ask", async () => {
		const plain = gmTable();
		await expect(handleBathQuery(ask({ picks: [pick("hp10")] }), {}, plain.deps)).resolves.toBeNull();
		const empowered = gmTable({ empowered: true });
		await expect(handleBathQuery(ask({ picks: [pick("hp10")] }), {}, empowered.deps)).resolves.toEqual({ patient: "Bram" });
	});

	it("refuses anyone else, a card for another Invocation, and a card already settled", async () => {
		await expect(handleBathQuery(ask(), {}, gmTable({ owner: false }).deps)).resolves.toBeNull();
		await expect(handleBathQuery(ask(), {}, gmTable({ invocations: ["blinding-light"] }).deps)).resolves.toBeNull();
		await expect(handleBathQuery(ask(), {}, gmTable({ flag: "Bram" }).deps)).resolves.toBeNull();
		await expect(handleBathQuery(ask({ picks: [pick("hp5"), pick("hp5"), pick("minor")] }), {}, gmTable().deps)).resolves.toBeNull();
	});
});

// A follower, another NPC or a monster as the patient: HP only, on the actor's own fields.
describe("a patient who is not a player character", () => {
	it("is a follower's NPC, any NPC or a monster, and only the HP reaches them", () => {
		expect([npcPatient(), npcPatient({ type: "monster" }), patient()].map(isBathPatient)).toEqual([true, true, true]);
		expect(isBathPatient({ type: "stonetop" })).toBe(false);
		expect(isBathPatient({ type: "gmToolkit" })).toBe(false);
		expect(bathHpOnly(npcPatient())).toBe(true);
		expect(bathHpOnly(patient())).toBe(false);
	});

	it("draws the debility and wound choices greyed, and leaves the HP and the table's lines pickable", () => {
		const view = bathPatientView(npcPatient());
		expect(view).toMatchObject({ hpOnly: true, debilities: [], open: [], wounds: [] });
		const html = bathWindowContent(view, { empowered: true });
		expect(html).toMatch(/value="debility" data-group="debility" data-max="2" data-none="1" disabled/);
		expect(html).toMatch(/value="stabilize" data-group="stabilize" data-max="1" data-none="1" disabled/);
		expect(html).toMatch(/value="recover" data-group="recover" data-max="1" data-none="1" disabled/);
		expect(html).toContain("Clears a debility (only a player character has debilities)");
		expect(html).toContain("Has one of their problematic wounds stabilized (only a player character keeps wounds on their sheet)");
		// The wound on the NPC's data is never offered.
		expect(html).not.toContain("stabilize:w1");
		expect(html.match(/value="hp5" data-group="hp5" data-max="2" aria-label/g)).toHaveLength(2);
		expect(html.match(/value="hp10" data-group="hp10" data-max="2" aria-label/g)).toHaveLength(2);
		expect(html).toMatch(/value="minor" data-group="minor" data-max="1" aria-label/);
		expect(html).toMatch(/value="affliction" data-group="affliction" data-max="1" aria-label/);
		expect((html.match(/is-none/g) ?? [])).toHaveLength(3);
	});

	it("refuses a debility or wound pick for them, and allows the HP twice", () => {
		expect(validateBathPicks([pick("hp5"), pick("hp5")], { hpOnly: true }).ok).toBe(true);
		expect(validateBathPicks([pick("hp10"), pick("minor")], { empowered: true, hpOnly: true }).ok).toBe(true);
		expect(validateBathPicks([pick("debility", "weakened")], { hpOnly: true }).ok).toBe(false);
		expect(validateBathPicks([pick("stabilize", "w1")], { hpOnly: true }).ok).toBe(false);
		expect(validateBathPicks([pick("recover", "w1")], { empowered: true, hpOnly: true }).ok).toBe(false);
	});

	it("heals a follower on their actor's HP, capped at their max, and says so on the card", async () => {
		const andras = npcPatient({ hp: 2, max: 6 });
		const out = await applyBath(andras, [pick("hp5"), pick("hp5")]);
		expect(andras.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 6 }, { stonetopMove: "Bath of Healing Light" });
		expect(out).toEqual({ patient: "Andras", hp: { gain: 10, from: 2, to: 6 }, cleared: [], stabilized: null, healed: null, minor: false, affliction: false });
		const html = bathResultHtml(seren, out);
		expect(html).toContain("Seren cups their hands around their light and bathes Andras in it.");
		expect(html).toContain("Andras regains HP: 2 → 6.");
	});

	it("never lowers HP past the max, and a table's line alone writes nothing", async () => {
		const over = npcPatient({ hp: 8, max: 6 });
		await expect(restoreActorHp(over, 5)).resolves.toEqual({ gain: 5, from: 8, to: 8 });
		expect(over.update).not.toHaveBeenCalled();
		const goblin = npcPatient({ name: "Crinwin", type: "monster", hp: 1, max: 3 });
		await expect(applyBath(goblin, [pick("minor")])).resolves.toMatchObject({ patient: "Crinwin", hp: null, minor: true });
		expect(goblin.update).not.toHaveBeenCalled();
		await expect(restoreActorHp({ system: { attributes: {} } }, 5)).resolves.toBeNull();
	});

	it("is the one targeted NPC or monster, with no question", async () => {
		const ask = vi.fn();
		const crinwin = npcPatient({ name: "Crinwin", type: "monster" });
		await expect(chooseBathPatient(seren, { targets: [{ actor: crinwin }, { actor: { type: "stonetop", uuid: "Actor.st" } }], pick: ask })).resolves.toBe(crinwin);
		expect(ask).not.toHaveBeenCalled();
	});

	it("tells two tokens of one unlinked monster apart, and offers characters and NPCs targeted together", async () => {
		const one = npcPatient({ name: "Crinwin", type: "monster", id: "crin", uuid: "Scene.s.Token.t1.Actor.crin" });
		const two = npcPatient({ name: "Crinwin", type: "monster", id: "crin", uuid: "Scene.s.Token.t2.Actor.crin" });
		const kyra = patient();
		const ask = vi.fn(async () => "Scene.s.Token.t2.Actor.crin");
		await expect(chooseBathPatient(seren, { targets: [{ actor: kyra }, { actor: one }, { actor: two }], pick: ask })).resolves.toBe(two);
		expect(ask.mock.calls[0][0].options.map(o => o.id)).toEqual(["Actor.kyra", "Scene.s.Token.t1.Actor.crin", "Scene.s.Token.t2.Actor.crin"]);
	});

	it("with nobody targeted, offers the party's followers too, each named as whose", async () => {
		const kyra = patient();
		const andras = npcPatient();
		const followers = vi.fn(characters => [{ actor: andras, master: characters.find(c => c.id === "kyra") }]);
		const ask = vi.fn(async () => "Actor.andras");
		await expect(chooseBathPatient(seren, { targets: [], party: () => [kyra], followers, pick: ask })).resolves.toBe(andras);
		expect(followers).toHaveBeenCalledWith([seren, kyra]);
		const options = ask.mock.calls[0][0].options;
		expect(options.map(o => o.id)).toEqual(["Actor.seren", "Actor.kyra", "Actor.andras"]);
		expect(options[2].hint).toBe("Kyra's follower");
	});

	it("finds the party's followers through their cards, a group follower too (which member is asked next)", () => {
		const kyra = { id: "kyra", uuid: "Actor.kyra", name: "Kyra", type: "character", flags: { [SCOPE]: {
			customFollowers: { maeve: { sourceUuid: "Actor.maeve" }, band: { actorUuid: "Actor.band", isGroup: true } },
			crew: { details: { actorUuid: "Actor.crew" } },
		} } };
		const hound = npcPatient({ name: "Hound", flags: { followerOrigin: { characterUuid: "Actor.kyra", ftype: "animal-companion", slug: "" } } });
		const actors = [kyra, npcPatient({ name: "Maeve" }), npcPatient({ name: "Band" }), npcPatient({ name: "Crew" }), hound, npcPatient({ name: "Tovia" })];
		const found = partyFollowers([kyra], { actors });
		expect(found.map(f => f.actor.name)).toEqual(["Maeve", "Band", "Crew", "Hound"]);
		expect(found.every(f => f.master === kyra)).toBe(true);
	});

	it("asks the GM's client to heal a follower this client does not own", async () => {
		const andras = npcPatient({ owner: false });
		const gm = { query: vi.fn(async () => ({ patient: "Andras" })) };
		await expect(healPatient(card(), andras, [pick("hp5")], {}, { gm, userId: "u1" })).resolves.toEqual({ patient: "Andras" });
		expect(gm.query).toHaveBeenCalledWith(BATH_QUERY, { messageId: "m1", patientUuid: "Actor.andras", picks: [pick("hp5")], reduced: false, userId: "u1" }, { timeout: 10000 });
		expect(andras.update).not.toHaveBeenCalled();
	});

	it("refuses a debility pick for them at the button, and gives the card back", async () => {
		const message = card();
		const heal = vi.fn();
		await expect(settleBathOfHealingLight(message, seren, {
			choosePatient: async () => npcPatient(), askPicks: async () => ({ reduced: false, picks: [pick("debility", "weakened")] }), heal,
		})).resolves.toBe(false);
		expect(heal).not.toHaveBeenCalled();
		expect(message.getFlag(SCOPE, BATH_FLAG)).toBeUndefined();
	});
});

describe("the GM's side of the heal, for a patient who is not a player character", () => {
	function gmTable({ owner = true, flag = true, patientType = "npc" } = {}) {
		const lightbearer = { ...seren, testUserPermission: vi.fn(() => owner) };
		const message = card();
		if (flag) message.flags[SCOPE][BATH_FLAG] = flag;
		const andras = npcPatient({ owner: false, type: patientType });
		globalThis.game.user = { isGM: true, id: "gm1" };
		globalThis.game.users = { activeGM: { id: "gm1" }, find: () => null, get: id => (id === "u1" ? { id: "u1", isGM: false } : null) };
		globalThis.game.messages = { get: id => (id === "m1" ? message : null) };
		globalThis.game.actors = { get: id => (id === "seren" ? lightbearer : null) };
		message.speaker = { actor: "seren" };
		const apply = vi.fn(async () => ({ patient: "Andras" }));
		return { apply, deps: { resolve: uuid => (uuid === "Actor.andras" ? andras : null), apply } };
	}
	const ask = (extra = {}) => ({ messageId: "m1", patientUuid: "Actor.andras", picks: [pick("hp5"), pick("minor")], reduced: false, userId: "u1", ...extra });

	it("heals a follower's NPC or a monster for the Lightbearer's player", async () => {
		const npc = gmTable();
		await expect(handleBathQuery(ask(), {}, npc.deps)).resolves.toEqual({ patient: "Andras" });
		expect(npc.apply).toHaveBeenCalledWith(expect.objectContaining({ name: "Andras", type: "npc" }), [pick("hp5"), pick("minor")]);
		await expect(handleBathQuery(ask(), {}, gmTable({ patientType: "monster" }).deps)).resolves.toEqual({ patient: "Andras" });
	});

	it("refuses a debility or wound pick for them, anyone else asking, a settled card, and an actor with no HP to heal", async () => {
		const table = gmTable();
		await expect(handleBathQuery(ask({ picks: [pick("hp5"), pick("debility", "weakened")] }), {}, table.deps)).resolves.toBeNull();
		await expect(handleBathQuery(ask({ picks: [pick("stabilize", "w1")] }), {}, table.deps)).resolves.toBeNull();
		expect(table.apply).not.toHaveBeenCalled();
		await expect(handleBathQuery(ask(), {}, gmTable({ owner: false }).deps)).resolves.toBeNull();
		await expect(handleBathQuery(ask(), {}, gmTable({ flag: "Andras" }).deps)).resolves.toBeNull();
		const steading = gmTable({ patientType: "stonetop" });
		await expect(handleBathQuery(ask(), {}, steading.deps)).resolves.toBeNull();
		expect(steading.apply).not.toHaveBeenCalled();
	});
});

// A follower keeps a second HP box on their character's Followers tab. The user's ruling: a Bath heals
// both by the same amount, each to its own max (a heal, not a sync).
describe("a follower's card heals with their NPC", () => {
	const MOVE = { stonetopMove: "Bath of Healing Light" };

	/** The character whose follower it is: the card's box as their sheet draws it, and their flags. */
	function master({ owner = true, followers = {}, box = { max: 4, current: 1 } } = {}) {
		return {
			id: "kyra", name: "Kyra", type: "character", isOwner: owner, uuid: "Actor.kyra",
			flags: { [SCOPE]: { customFollowers: followers } },
			sheet: { followerCardHp: vi.fn(async () => box) },
			update: vi.fn(async () => {}),
		};
	}
	const onCard = (character, ftype = "custom", slug = "maeve") => vi.fn(() => ({ character, ftype, slug }));

	it("raises the card's box and the NPC's HP by the same amount, each capped at its own max, and says one HP line", async () => {
		const kyra = master({ followers: { maeve: { name: "Maeve" } }, box: { max: 4, current: 1 } });
		const maeve = npcPatient({ name: "Maeve", hp: 2, max: 6 });
		const out = await applyBath(maeve, [pick("hp5")], { cardFor: onCard(kyra) });
		expect(maeve.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 6 }, MOVE);
		// The card's max is the one its sheet draws, not the NPC's.
		expect(kyra.sheet.followerCardHp).toHaveBeenCalledWith("custom", "maeve");
		expect(kyra.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.customFollowers.maeve.hpCurrent": 4 }, MOVE);
		expect(out).toMatchObject({ patient: "Maeve", hp: { gain: 5, from: 2, to: 6 }, card: { gain: 5, from: 1, to: 4 } });
		const html = bathResultHtml(seren, out);
		expect(html.match(/regains HP/g)).toHaveLength(1);
		expect(html).toContain("Maeve regains HP: 2 → 6.");
	});

	it("writes each built-in follower's box where the tab's HP input writes it", async () => {
		const paths = { "animal-companion": ["", "animalCompanion.hpCurrent"], initiate: ["enfys", "initiatesHp.enfys"], beast: ["dog", "beastHp.dog"] };
		for (const [ftype, [slug, path]] of Object.entries(paths)) {
			const kyra = master({ box: { max: 8, current: 3 } });
			await applyBath(npcPatient({ hp: 1, max: 8 }), [pick("hp5")], { cardFor: onCard(kyra, ftype, slug) });
			expect(kyra.update).toHaveBeenCalledWith({ [`flags.stonetop-pwd.${path}`]: 8 }, MOVE);
		}
	});

	it("brings a fallen custom follower back, clearing their Dead mark as the HP box does", async () => {
		const kyra = master({ followers: { maeve: { name: "Maeve", dead: true } }, box: { max: 4, current: 0 } });
		await applyBath(npcPatient({ name: "Maeve", hp: 0, max: 6 }), [pick("hp5")], { cardFor: onCard(kyra) });
		expect(kyra.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.customFollowers.maeve.hpCurrent": 4,
			"flags.stonetop-pwd.customFollowers.maeve.dead": false,
		}, MOVE);
	});

	it("never lowers the card's box, and says the card's HP when only the card moved", async () => {
		const full = master({ box: { max: 4, current: 6 } });
		await expect(applyBath(npcPatient({ hp: 1, max: 6 }), [pick("hp5")], { cardFor: onCard(full) }))
			.resolves.toMatchObject({ hp: { from: 1, to: 6 }, card: { from: 6, to: 6 } });
		expect(full.update).not.toHaveBeenCalled();
		const hurt = master({ box: { max: 4, current: 1 } });
		const out = await applyBath(npcPatient({ name: "Maeve", hp: 6, max: 6 }), [pick("hp5")], { cardFor: onCard(hurt) });
		expect(out.hp).toEqual({ gain: 5, from: 1, to: 4 });
		expect(bathResultHtml(seren, out)).toContain("Maeve regains HP: 1 → 4.");
	});

	it("touches no card for an NPC who follows nobody, a group follower, or a heal with no HP in it", async () => {
		const goblin = npcPatient({ name: "Crinwin", hp: 1, max: 3 });
		const nobody = vi.fn(() => null);
		const out = await applyBath(goblin, [pick("hp5")], { cardFor: nobody });
		expect(out).not.toHaveProperty("card");
		expect(out.hp).toEqual({ gain: 5, from: 1, to: 3 });
		const kyra = master({ followers: { band: { name: "The Band", isGroup: true } } });
		await applyBath(npcPatient({ name: "Crew" }), [pick("hp5")], { cardFor: onCard(kyra, "crew", "") });
		await applyBath(npcPatient({ name: "Band" }), [pick("hp5")], { cardFor: onCard(kyra, "custom", "band") });
		const minorOnly = onCard(kyra);
		await applyBath(npcPatient({ name: "Maeve" }), [pick("minor")], { cardFor: minorOnly });
		expect(minorOnly).not.toHaveBeenCalled();
		expect(kyra.sheet.followerCardHp).not.toHaveBeenCalled();
		expect(kyra.update).not.toHaveBeenCalled();
	});

	it("finds the card of a targeted follower who walks the map unlinked", async () => {
		const kyra = master({ followers: { maeve: { name: "Maeve", sourceUuid: "Actor.maeve" } } });
		globalThis.game.actors = [kyra];
		const token = { ...npcPatient({ name: "Maeve", hp: 2, max: 6, uuid: "Scene.s.Token.t1.Actor.maeve" }), isToken: true, token: { baseActor: { uuid: "Actor.maeve" } } };
		token.update = vi.fn(async () => {});
		await applyBath(token, [pick("hp5")]);
		expect(kyra.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.customFollowers.maeve.hpCurrent": 4 }, MOVE);
	});

	// Wave 3 audit FOL-1: while a follower has an NPC, its HP is theirs and the box mirrors it, so the
	// card is never written beside it (follower-hp.js#setFollowerHp).
	describe("a follower whose card is linked to an NPC", () => {
		let savedResolve;
		beforeEach(() => { savedResolve = globalThis.fromUuidSync; });
		afterEach(() => { globalThis.fromUuidSync = savedResolve; });

		it("heals the NPC once as the patient, and leaves the card's box to mirror it", async () => {
			const kyra = master({ followers: { maeve: { name: "Maeve", actorUuid: "Actor.maeve" } }, box: { max: 4, current: 1 } });
			const maeve = { ...npcPatient({ name: "Maeve", hp: 2, max: 6 }), documentName: "Actor" };
			maeve.update = vi.fn(async changes => { maeve.system.attributes.hp.value = changes["system.attributes.hp.value"]; });
			globalThis.fromUuidSync = uuid => (uuid === "Actor.maeve" ? maeve : null);
			const out = await applyBath(maeve, [pick("hp5")], { cardFor: onCard(kyra) });
			expect(maeve.update).toHaveBeenCalledTimes(1);
			expect(maeve.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 6 }, MOVE);
			expect(kyra.update).not.toHaveBeenCalled();
			expect(kyra.sheet.followerCardHp).not.toHaveBeenCalled();
			expect(out).not.toHaveProperty("card");
			expect(out.hp).toEqual({ gain: 5, from: 2, to: 6 });
		});

		it("heals the card's NPC, not its box, when the card's follower is raised from elsewhere", async () => {
			const kyra = master({ followers: { maeve: { name: "Maeve", actorUuid: "Actor.maeve" } }, box: { max: 4, current: 1 } });
			const maeve = npcPatient({ name: "Maeve", hp: 3, max: 6 });
			const out = await restoreFollowerCardHp({ character: kyra, ftype: "custom", slug: "maeve" }, 5, { link: () => maeve });
			expect(out).toEqual({ gain: 5, from: 3, to: 6 });
			expect(maeve.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 6 }, MOVE);
			expect(kyra.update).not.toHaveBeenCalled();
		});
	});

	it("heals here only when this client can write the character too, and otherwise asks the GM's client", async () => {
		const mine = master();
		const maeve = npcPatient({ name: "Maeve" });
		const gm = { query: vi.fn(async () => ({ patient: "Maeve" })) };
		await healPatient(card(), maeve, [pick("hp5")], {}, { gm, cardFor: onCard(mine) });
		expect(gm.query).not.toHaveBeenCalled();
		expect(mine.update).toHaveBeenCalled();

		const theirs = master({ owner: false });
		const owned = npcPatient({ name: "Maeve" });
		await expect(healPatient(card(), owned, [pick("hp5")], {}, { gm, userId: "u1", cardFor: onCard(theirs) })).resolves.toEqual({ patient: "Maeve" });
		expect(gm.query).toHaveBeenCalledWith(BATH_QUERY, { messageId: "m1", patientUuid: "Actor.maeve", picks: [pick("hp5")], reduced: false, userId: "u1" }, { timeout: 10000 });
		expect(owned.update).not.toHaveBeenCalled();
		expect(theirs.update).not.toHaveBeenCalled();
	});

	it("is healed on the GM's client, card and NPC, off the validated picks", async () => {
		const lightbearer = { ...seren, testUserPermission: vi.fn(() => true) };
		const kyra = master({ owner: true, followers: { maeve: { name: "Maeve" } }, box: { max: 4, current: 1 } });
		const maeve = npcPatient({ name: "Maeve", owner: true, hp: 2, max: 6, flags: { followerOrigin: { characterUuid: "Actor.kyra", ftype: "custom", slug: "maeve" } } });
		const message = card();
		message.flags[SCOPE][BATH_FLAG] = true;
		message.speaker = { actor: "seren" };
		globalThis.game.user = { isGM: true, id: "gm1" };
		globalThis.game.users = { activeGM: { id: "gm1" }, find: () => null, get: id => (id === "u1" ? { id: "u1", isGM: false } : null) };
		globalThis.game.messages = { get: id => (id === "m1" ? message : null) };
		const world = [lightbearer, kyra];
		world.get = id => world.find(a => a.id === id) ?? null;
		globalThis.game.actors = world;
		const ask = { messageId: "m1", patientUuid: "Actor.maeve", picks: [pick("hp5")], reduced: false, userId: "u1" };
		const out = await handleBathQuery(ask, {}, { resolve: uuid => (uuid === "Actor.maeve" ? maeve : null) });
		expect(out).toMatchObject({ patient: "Maeve", hp: { from: 2, to: 6 }, card: { from: 1, to: 4 } });
		expect(kyra.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.customFollowers.maeve.hpCurrent": 4 }, MOVE);
	});

	it("reads the box off the real Followers tab and lands the heal in the stored card", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-lightbearer", name: "Kyra",
			flags: {
				"customFollowers.maeve": { name: "Maeve", hpMax: 5, hpCurrent: 0, dead: true, order: 1 },
				"customFollowers.tovia": { name: "Tovia", hpMax: 3, order: 2 },
			},
		});
		actor.typedActor = char;
		const Base = class {
			get actor() { return actor; }
			get isEditable() { return true; }
			async getData() { return {}; }
			activateListeners() {}
			render = vi.fn();
		};
		const { createStonetopCharacterSheetClass } = await import("../../../module/actors/character/StonetopCharacterSheet.js");
		actor.sheet = new (createStonetopCharacterSheetClass(Base))();
		// An unset HP is a full box, as the tab draws it.
		await expect(actor.sheet.followerCardHp("custom", "tovia")).resolves.toEqual({ max: 3, current: 3 });
		await expect(actor.sheet.followerCardHp("custom", "nobody")).resolves.toBeNull();

		const maeve = npcPatient({ name: "Maeve", hp: 0, max: 8 });
		const out = await applyBath(maeve, [pick("hp5"), pick("hp5")], { cardFor: () => ({ character: actor, ftype: "custom", slug: "maeve" }) });
		expect(out).toMatchObject({ hp: { from: 0, to: 8 }, card: { from: 0, to: 5 } });
		expect(actor.flags[SCOPE].customFollowers.maeve).toMatchObject({ hpCurrent: 5, dead: false });
	});
});

// A group follower's members are rows on its character's roster, each with their own HP, and a lone blow
// lands on one of them (fight/group-hits.js#applyRosterHit). "Your patient" is one person: the Bath asks
// which member and heals that row, never the token's pooled HP.
describe("a group as the patient: one member of it", () => {
	const MOVE = { stonetopMove: "Bath of Healing Light" };
	let savedResolve;
	let savedDoc;
	beforeEach(() => {
		savedResolve = globalThis.fromUuidSync;
		savedDoc = globalThis.document;
		globalThis.document = { createElement: () => ({ innerHTML: "" }) };
	});
	afterEach(() => {
		globalThis.fromUuidSync = savedResolve;
		globalThis.document = savedDoc;
	});

	/** Write an `actor.update` object onto a fake's flags, dotted paths and all. */
	function applyUpdate(doc, changes) {
		for (const [key, value] of Object.entries(changes)) {
			const keys = key.split(".");
			let node = doc;
			for (const k of keys.slice(0, -1)) node = (node[k] ??= {});
			node[keys.at(-1)] = value;
		}
	}

	/**
	 * Rhianna, whose crew is Bryn (named, 2 of 6), Aled (named, down) and two anonymous members, the
	 * second at 1; and her crew's token, whose pool is 3 of 6. `band` is a custom group of three at 4 HP.
	 */
	function table({ owner = true, tokenOwner = true } = {}) {
		const rhianna = {
			id: "rhianna", name: "Rhianna", type: "character", isOwner: owner, uuid: "Actor.rhianna",
			flags: { [SCOPE]: {
				crew: { size: 4, individuals: [{ name: "Bryn" }, { name: "Aled" }], individualsHp: { 0: 2, 1: 0 }, memberHp: [null, 1] },
				customFollowers: { band: { name: "The Band", isGroup: true, size: 3, hpMax: 4, memberHp: [0, 2] } },
			} },
		};
		rhianna.update = vi.fn(async changes => applyUpdate(rhianna, changes));
		const origin = (ftype, slug = "") => ({ followerOrigin: { characterUuid: "Actor.rhianna", ftype, slug } });
		const crew = npcPatient({ name: "Rhianna's crew", owner: tokenOwner, hp: 3, max: 6, uuid: "Actor.crew", flags: origin("crew") });
		const band = npcPatient({ name: "The Band", owner: tokenOwner, hp: 1, max: 4, uuid: "Actor.band", flags: origin("custom", "band") });
		const docs = { [rhianna.uuid]: rhianna, [crew.uuid]: crew, [band.uuid]: band };
		globalThis.fromUuidSync = uuid => docs[uuid] ?? null;
		return { rhianna, crew, band, resolve: uuid => docs[uuid] ?? null };
	}

	/** A monster fought as a group: six crinwin, the hurt one having lost `wound`. */
	function horde({ wound = 2 } = {}) {
		const actor = npcPatient({ name: "Crinwin", type: "monster", hp: 3, max: 3, flags: { groupWound: wound } });
		Object.assign(actor.system, { fightAsGroup: true, organization: "horde", count: 6 });
		return actor;
	}

	it("asks which member as a list, the hurt and the down first, each with their HP, and names them", async () => {
		const { crew } = table();
		const ask = vi.fn(async () => "named:1");
		await expect(chooseBathMember(crew, { ask })).resolves.toEqual({ key: "named:1", name: "Aled of Rhianna's crew" });
		const asked = ask.mock.calls[0][0];
		expect(asked.title).toBe("Bath of Healing Light: which of Rhianna's crew?");
		// ONE affirmative, naming the first ticked, and Not now: never a button per member.
		expect(asked.buttons.map(b => b.label)).toEqual(["Heal Bryn", "Not now"]);
		// A radio row each, the unhurt last, the first hurt ticked.
		const html = asked.content.innerHTML;
		const rows = [...html.matchAll(/value="([^"]+)" data-name="([^"]+)"[^>]*>.*?<span class="stonetop-bath-member-hp">([^<]+)</g)]
			.map(([, key, name, hp]) => `${key} ${name}: ${hp}`);
		expect(rows).toEqual([
			"named:0 Bryn: 2 of 6 HP", "named:1 Aled: down, 0 of 6 HP", "anon:1 Crew member 4: 1 of 6 HP",
			"anon:0 Crew member 3: 6 of 6 HP, unhurt",
		]);
		expect(html).toMatch(/value="named:0" data-name="Bryn" checked>/);
		expect(html).toContain('class="stonetop-bath-members"');
		await expect(chooseBathMember(crew, { ask: async () => null })).resolves.toBeNull();
	});

	it("reads the ticked member off the window, and renames the Heal button as the tick moves", async () => {
		const { crew } = table();
		const radio = (value, name, checked = false) => ({ value, checked, disabled: false, dataset: { name } });
		let radios = [radio("named:0", "Bryn"), radio("anon:1", "Crew member 4", true)];
		const label = { textContent: "Heal Bryn" };
		const listeners = [];
		const root = {
			querySelectorAll: sel => (sel.includes("stonetop-bath-member") ? radios : []),
			querySelector: sel => (sel === 'button[data-action="heal"] span' ? label : null),
			addEventListener: (type, fn) => listeners.push([type, fn]),
		};
		const ask = vi.fn(async ({ buttons, render }) => {
			render(root);
			expect(label.textContent).toBe("Heal Crew member 4");
			radios = [radio("named:0", "Bryn"), radio("named:1", "Aled", true)];
			listeners.filter(([type]) => type === "change").forEach(([, fn]) => fn());
			expect(label.textContent).toBe("Heal Aled");
			return buttons[0].value(root);
		});
		await expect(chooseBathMember(crew, { ask })).resolves.toEqual({ key: "named:1", name: "Aled of Rhianna's crew" });
	});

	it("asks nothing for one person or a monster group, which have no roster", async () => {
		const ask = vi.fn();
		await expect(chooseBathMember(npcPatient(), { ask })).resolves.toBeUndefined();
		await expect(chooseBathMember(patient(), { ask })).resolves.toBeUndefined();
		await expect(chooseBathMember(horde(), { ask })).resolves.toBeUndefined();
		expect(ask).not.toHaveBeenCalled();
		expect(bathGroupFor(horde())).toMatchObject({ kind: "wound", group: "Crinwin" });
	});

	it("heals the member's roster HP, capped at one member's max, and leaves the token's pool alone", async () => {
		const { rhianna, crew } = table();
		const out = await applyBath(crew, [pick("hp5"), pick("hp5")], { memberKey: "named:0" });
		expect(rhianna.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.crew.individualsHp.0": 6 }, MOVE);
		expect(crew.update).not.toHaveBeenCalled();
		expect(crew.system.attributes.hp.value).toBe(3);
		expect(out).toMatchObject({ patient: "Bryn of Rhianna's crew", hp: { gain: 10, from: 2, to: 6 }, member: { key: "named:0", name: "Bryn" } });
		const html = bathResultHtml(seren, out);
		expect(html).toContain("Seren cups their hands around their light and bathes Bryn of Rhianna&#x27;s crew in it.");
		expect(html.match(/regains HP/g)).toHaveLength(1);
		expect(html).toContain("Bryn of Rhianna&#x27;s crew regains HP: 2 → 6.");
	});

	it("writes an anonymous member and a custom group's member where the roster keeps them, never lowering", async () => {
		const { rhianna, crew, band } = table();
		await applyBath(crew, [pick("hp5")], { memberKey: "anon:1" });
		expect(rhianna.update).toHaveBeenLastCalledWith({ "flags.stonetop-pwd.crew.memberHp": [null, 6] }, MOVE);
		const custom = await applyBath(band, [pick("hp5")], { memberKey: "member:0" });
		expect(rhianna.update).toHaveBeenLastCalledWith({ "flags.stonetop-pwd.customFollowers.band.memberHp": [4, 2] }, MOVE);
		expect(custom).toMatchObject({ patient: "Member 1 of The Band", hp: { from: 0, to: 4 } });
		expect(band.update).not.toHaveBeenCalled();
		rhianna.update.mockClear();
		// Crew member 3 is unhurt: nothing to write, and the card says their HP stays.
		await expect(applyBath(crew, [pick("hp5")], { memberKey: "anon:0" })).resolves.toMatchObject({ hp: { from: 6, to: 6 } });
		expect(rhianna.update).not.toHaveBeenCalled();
	});

	it("brings a fallen member back onto their feet, even with the whole group down", async () => {
		const { rhianna, crew } = table();
		expect(rosterGroupFor(crew).members.map(m => m.key)).not.toContain("named:1");
		await applyBath(crew, [pick("hp5")], { memberKey: "named:1" });
		expect(rhianna.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.crew.individualsHp.1": 5 }, MOVE);
		// Standing again, as the fight counts the crew's bodies off the roster.
		expect(rosterGroupFor(crew)).toMatchObject({ standing: 4 });
		expect(rosterGroupFor(crew).members.map(m => m.key)).toContain("named:1");

		rhianna.flags[SCOPE].crew = { size: 2, individuals: [], memberHp: [0, 0] };
		expect(bathGroupFor(crew).members).toEqual([
			{ key: "anon:0", name: "Crew member 1", hp: 0, hpMax: 6 }, { key: "anon:1", name: "Crew member 2", hp: 0, hpMax: 6 },
		]);
		await applyBath(crew, [pick("hp5")], { memberKey: "anon:1" });
		expect(rhianna.update).toHaveBeenLastCalledWith({ "flags.stonetop-pwd.crew.memberHp": [0, 5] }, MOVE);
	});

	it("heals nobody for a group with no member named, or one not on its roster", async () => {
		const { rhianna, crew } = table();
		await expect(applyBath(crew, [pick("hp5")])).resolves.toBeNull();
		await expect(applyBath(crew, [pick("hp5")], { memberKey: "named:9" })).resolves.toBeNull();
		expect(rhianna.update).not.toHaveBeenCalled();
		expect(crew.update).not.toHaveBeenCalled();
	});

	it("heals a monster group's hurt member off the wound kept on its token, not its pool", async () => {
		const crinwin = horde({ wound: 2 });
		const out = await applyBath(crinwin, [pick("hp5")]);
		expect(crinwin.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.groupWound": 0 }, MOVE);
		expect(crinwin.update).toHaveBeenCalledTimes(1);
		expect(out).toMatchObject({ patient: "Crinwin's hurt member", hp: { gain: 5, from: 1, to: 3 } });
		expect(bathResultHtml(seren, out)).toContain("Crinwin&#x27;s hurt member regains HP: 1 → 3.");
	});

	it("says so on the card when a monster group has nobody hurt", async () => {
		const crinwin = horde({ wound: 0 });
		const out = await applyBath(crinwin, [pick("hp5"), pick("minor")]);
		expect(crinwin.update).not.toHaveBeenCalled();
		expect(out).toMatchObject({ patient: "Crinwin", hp: null, nobodyHurt: true, minor: true });
		const html = bathResultHtml(seren, out);
		expect(html).toContain("None of Crinwin is hurt, so the light has no HP to give back.");
		expect(html).toContain("Crinwin recovers from a minor condition.");
		// A table's line alone says nothing about HP.
		await expect(applyBath(crinwin, [pick("minor")])).resolves.not.toHaveProperty("nobodyHurt");
	});

	it("knows a group follower's token by its own data when its roster cannot be found, and never raises its pool", async () => {
		table();
		globalThis.game.actors = [];
		const origin = (characterUuid, ftype, slug = "") => ({ followerOrigin: { characterUuid, ftype, slug } });
		// The crew's token, its character since deleted: a crew is a group whatever else is lost.
		const lost = npcPatient({ name: "Lost crew", hp: 2, max: 6, uuid: "Actor.lost", flags: origin("Actor.gone", "crew") });
		expect(bathGroupFor(lost)).toMatchObject({ kind: "wound", group: "Lost crew", info: { hpMax: 6, wound: 0 } });
		const out = await applyBath(lost, [pick("hp5")]);
		expect(lost.update).not.toHaveBeenCalled();
		expect(lost.system.attributes.hp.value).toBe(2);
		expect(out).toMatchObject({ patient: "Lost crew", hp: null, nobodyHurt: true });
		expect(bathResultHtml(seren, out)).toContain("None of Lost crew is hurt");

		// A custom group's token (unlinked, as a group's is made) whose card is gone: the harm kept on it heals.
		const band = npcPatient({ name: "Lost band", hp: 1, max: 4, uuid: "Actor.lostband", flags: { groupWound: 3, ...origin("Actor.rhianna", "custom", "gone") } });
		band.prototypeToken = { actorLink: false };
		const healed = await applyBath(band, [pick("hp5")]);
		expect(band.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.groupWound": 0 }, MOVE);
		expect(band.update).toHaveBeenCalledTimes(1);
		expect(band.system.attributes.hp.value).toBe(1);
		expect(healed).toMatchObject({ patient: "Lost band's hurt member", hp: { from: 1, to: 4 } });

		// A linked custom follower whose card is gone is one person, healed on their own HP as before.
		const one = npcPatient({ name: "Lost friend", hp: 1, max: 4, uuid: "Actor.friend", flags: origin("Actor.rhianna", "custom", "gone") });
		one.prototypeToken = { actorLink: true };
		expect(bathGroupFor(one)).toBeNull();
	});

	it("never heals a custom group's member marked fallen: listed greyed and unpickable, and refused if named", async () => {
		const { rhianna, band } = table();
		rhianna.flags[SCOPE].customFollowers.band = { name: "The Band", isGroup: true, size: 2, hpMax: 4, memberHp: [0, 2], memberDead: [true, null] };
		expect(bathGroupFor(band).members).toEqual([
			{ key: "member:0", name: "Member 1", dead: true, hp: 0, hpMax: 4 }, { key: "member:1", name: "Member 2", hp: 2, hpMax: 4 },
		]);
		// Down, as the fight counts them: the fallen one is not standing.
		expect(rosterGroupFor(band)).toMatchObject({ standing: 1, size: 2, members: [{ key: "member:1", name: "Member 2" }] });
		const ask = vi.fn(async () => "member:0");
		await expect(chooseBathMember(band, { ask })).resolves.toBeNull();
		const asked = ask.mock.calls[0][0];
		expect(asked.content.innerHTML).toMatch(/is-dead"><input type="radio" name="stonetop-bath-member" value="member:0" data-name="Member 1" disabled>/);
		expect(asked.content.innerHTML).toMatch(/Member 1<\/span><span class="stonetop-follower-dead-badge">.*Fallen/);
		expect(asked.content.innerHTML).toMatch(/value="member:1" data-name="Member 2" checked>/);
		expect(asked.buttons[0].label).toBe("Heal Member 2");
		await expect(applyBath(band, [pick("hp5")], { memberKey: "member:0" })).resolves.toBeNull();
		expect(rhianna.update).not.toHaveBeenCalled();
	});

	it("says every member has fallen, and asks nothing, when none can be healed", async () => {
		const { rhianna, band } = table();
		rhianna.flags[SCOPE].customFollowers.band = { name: "The Band", isGroup: true, size: 2, hpMax: 4, memberHp: [0, 0], memberDead: [true, true] };
		const ask = vi.fn();
		await expect(chooseBathMember(band, { ask })).resolves.toBeNull();
		expect(ask).not.toHaveBeenCalled();
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith("Everyone in The Band has fallen: the light cannot raise the dead.");
	});

	it("heals here when this client can write the roster's character, and otherwise asks the GM's client, naming the member", async () => {
		const gm = { query: vi.fn(async () => ({ patient: "Bryn of Rhianna's crew" })) };
		// The token is the GM's, the roster is ours: the heal writes only the roster.
		const mine = table({ tokenOwner: false });
		await healPatient(card(), mine.crew, [pick("hp5")], { memberKey: "named:0" }, { gm });
		expect(gm.query).not.toHaveBeenCalled();
		expect(mine.rhianna.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.crew.individualsHp.0": 6 }, MOVE);

		const theirs = table({ owner: false });
		await expect(healPatient(card(), theirs.crew, [pick("hp5")], { memberKey: "named:0" }, { gm, userId: "u1" }))
			.resolves.toEqual({ patient: "Bryn of Rhianna's crew" });
		expect(gm.query).toHaveBeenCalledWith(BATH_QUERY, {
			messageId: "m1", patientUuid: "Actor.crew", picks: [pick("hp5")], reduced: false, userId: "u1", memberKey: "named:0",
		}, { timeout: 10000 });
		expect(theirs.rhianna.update).not.toHaveBeenCalled();
	});

	describe("on the GM's client", () => {
		function gmTable() {
			const world = table({ owner: true });
			const lightbearer = { ...seren, testUserPermission: vi.fn(() => true) };
			const message = card();
			message.flags[SCOPE][BATH_FLAG] = true;
			message.speaker = { actor: "seren" };
			globalThis.game.user = { isGM: true, id: "gm1" };
			globalThis.game.users = { activeGM: { id: "gm1" }, find: () => null, get: id => (id === "u1" ? { id: "u1", isGM: false } : null) };
			globalThis.game.messages = { get: id => (id === "m1" ? message : null) };
			globalThis.game.actors = { get: id => (id === "seren" ? lightbearer : null) };
			return world;
		}
		const ask = extra => ({ messageId: "m1", patientUuid: "Actor.crew", picks: [pick("hp5")], reduced: false, userId: "u1", ...extra });

		it("heals the member the ask names, checked against the roster itself", async () => {
			const { rhianna, resolve } = gmTable();
			const out = await handleBathQuery(ask({ memberKey: "named:1" }), {}, { resolve });
			expect(rhianna.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.crew.individualsHp.1": 5 }, MOVE);
			expect(out).toMatchObject({ patient: "Aled of Rhianna's crew", hp: { from: 0, to: 5 } });
		});

		it("refuses a key not on the roster, a group ask with no member, and a member key for one person", async () => {
			const { resolve } = gmTable();
			const apply = vi.fn(async () => ({}));
			await expect(handleBathQuery(ask({ memberKey: "named:7" }), {}, { resolve, apply })).resolves.toBeNull();
			await expect(handleBathQuery(ask({ memberKey: "member:0" }), {}, { resolve, apply })).resolves.toBeNull();
			await expect(handleBathQuery(ask(), {}, { resolve, apply })).resolves.toBeNull();
			const andras = npcPatient({ owner: false });
			await expect(handleBathQuery(ask({ patientUuid: "Actor.andras", memberKey: "named:0" }), {}, {
				resolve: uuid => (uuid === "Actor.andras" ? andras : resolve(uuid)), apply,
			})).resolves.toBeNull();
			expect(apply).not.toHaveBeenCalled();
			await handleBathQuery(ask({ memberKey: "anon:1" }), {}, { resolve, apply });
			expect(apply).toHaveBeenCalledWith(expect.objectContaining({ name: "Rhianna's crew" }), [pick("hp5")], { memberKey: "anon:1" });
		});

		it("refuses a custom group's member marked fallen", async () => {
			const { rhianna, resolve } = gmTable();
			rhianna.flags[SCOPE].customFollowers.band = { name: "The Band", isGroup: true, size: 2, hpMax: 4, memberHp: [0, 2], memberDead: [true, null] };
			const apply = vi.fn(async () => ({}));
			await expect(handleBathQuery(ask({ patientUuid: "Actor.band", memberKey: "member:0" }), {}, { resolve, apply })).resolves.toBeNull();
			expect(apply).not.toHaveBeenCalled();
			await handleBathQuery(ask({ patientUuid: "Actor.band", memberKey: "member:1" }), {}, { resolve, apply });
			expect(apply).toHaveBeenCalledWith(expect.objectContaining({ name: "The Band" }), [pick("hp5")], { memberKey: "member:1" });
		});
	});

	it("on the card's button: the patient, which member, the picks naming them, the heal, and the latch names who", async () => {
		const { crew } = table();
		const message = card();
		const chooseMember = vi.fn(async () => ({ key: "named:0", name: "Bryn of Rhianna's crew" }));
		const askPicks = vi.fn(async () => ({ reduced: false, picks: [pick("hp5")] }));
		const heal = vi.fn(async () => ({ patient: "Bryn of Rhianna's crew", hp: { from: 2, to: 6 } }));
		await expect(settleBathOfHealingLight(message, seren, { choosePatient: async () => crew, chooseMember, askPicks, heal })).resolves.toBe(true);
		expect(chooseMember).toHaveBeenCalledWith(crew);
		expect(askPicks).toHaveBeenCalledWith(crew, { reduced: false, empowered: false, name: "Bryn of Rhianna's crew" });
		expect(heal).toHaveBeenCalledWith(message, crew, [pick("hp5")], { reduced: false, memberKey: "named:0" });
		expect(posted.at(-1).content).toContain("Bryn of Rhianna&#x27;s crew regains HP: 2 → 6.");
		expect(message.getFlag(SCOPE, BATH_FLAG)).toBe("Bryn of Rhianna's crew");

		const closed = card();
		const notAsked = vi.fn();
		await expect(settleBathOfHealingLight(closed, seren, { choosePatient: async () => crew, chooseMember: async () => null, askPicks: notAsked })).resolves.toBe(false);
		expect(notAsked).not.toHaveBeenCalled();
		expect(closed.getFlag(SCOPE, BATH_FLAG)).toBeUndefined();
	});

	it("titles the picks window by the member", async () => {
		const { crew } = table();
		const wait = stubAsk(null);
		await askBathPicks(crew, { name: "Bryn of Rhianna's crew" });
		expect(wait.mock.calls[0][0].window.title).toBe("Bath of Healing Light: Bryn of Rhianna's crew");
		expect(wait.mock.calls[0][0].buttons[0].label).toBe("Heal Bryn of Rhianna's crew");
	});
});

describe("the card's Bath of Healing Light button", () => {
	const kyra = patient();
	const result = { patient: "Kyra", hp: { from: 3, to: 13 }, cleared: [], minor: false, affliction: false };

	it("heals once: the patient, the picks, the card, then the latch names who", async () => {
		const message = card({ empowered: true });
		const choosePatient = vi.fn(async () => kyra);
		const askPicks = vi.fn(async () => ({ reduced: false, picks: [pick("hp10")] }));
		const heal = vi.fn(async () => result);
		await expect(settleBathOfHealingLight(message, seren, { empowered: true, choosePatient, askPicks, heal })).resolves.toBe(true);
		expect(askPicks).toHaveBeenCalledWith(kyra, { reduced: false, empowered: true });
		expect(heal).toHaveBeenCalledWith(message, kyra, [pick("hp10")], { reduced: false });
		expect(posted.at(-1).content).toContain("Bath of Healing Light (Empowered)");
		expect(posted.at(-1).content).toContain("Kyra regains HP: 3 → 13.");
		expect(message.getFlag(SCOPE, BATH_FLAG)).toBe("Kyra");
		// A second press, a re-render or a reload finds it used.
		await expect(settleBathOfHealingLight(message, seren, { choosePatient, askPicks, heal })).resolves.toBe(false);
		expect(heal).toHaveBeenCalledTimes(1);
	});

	it("opens the picks on the card's Reduced tick, and titles the card by the window's answer", async () => {
		const message = card();
		const askPicks = vi.fn(async () => ({ reduced: true, picks: [pick("hp5")] }));
		await settleBathOfHealingLight(message, seren, { reduced: true, choosePatient: async () => kyra, askPicks, heal: async () => result });
		expect(askPicks).toHaveBeenCalledWith(kyra, { reduced: true, empowered: false });
		expect(posted.at(-1).content).toContain("Bath of Healing Light (Reduced)");
	});

	it("gives the card back when either window is closed, the picks are refused, or no GM can write the sheet", async () => {
		const buttons = [{ disabled: false }];
		const message = card();
		await expect(settleBathOfHealingLight(message, seren, { buttons, choosePatient: async () => null })).resolves.toBe(false);
		expect(message.getFlag(SCOPE, BATH_FLAG)).toBeUndefined();
		expect(buttons[0].disabled).toBe(false);
		await expect(settleBathOfHealingLight(message, seren, { choosePatient: async () => kyra, askPicks: async () => null })).resolves.toBe(false);
		// Two picks on a reduced Invocation: not what it allows.
		await expect(settleBathOfHealingLight(message, seren, {
			choosePatient: async () => kyra, askPicks: async () => ({ reduced: true, picks: [pick("hp5"), pick("minor")] }), heal: vi.fn(),
		})).resolves.toBe(false);
		expect(globalThis.ui.notifications.warn).toHaveBeenLastCalledWith("Pick 1 or 2 of the choices, as the Invocation allows.");
		await expect(settleBathOfHealingLight(message, seren, {
			choosePatient: async () => kyra, askPicks: async () => ({ reduced: false, picks: [pick("minor")] }), heal: async () => null,
		})).resolves.toBe(false);
		expect(globalThis.ui.notifications.warn.mock.calls.at(-1)[0]).toMatch(/no GM is online/);
		expect(message.getFlag(SCOPE, BATH_FLAG)).toBeUndefined();
		expect(posted).toEqual([]);
	});
});

describe("Go Back to the Shadow's button", () => {
	it("rolls 2d8, or 1d8 reduced, with Hungry Flames' ticked line when it is learned", async () => {
		const roll = vi.fn(async () => [{ uuid: "Scene.s.Token.a", raw: 9 }]);
		const hungry = { ...seren, items: [{ type: "move", name: "Hungry Flames" }] };
		const message = card({ invocations: [GO_BACK_TO_THE_SHADOW] });
		await expect(settleShadowDamage(message, hungry, { roll })).resolves.toBe(true);
		expect(roll).toHaveBeenCalledWith(hungry, expect.objectContaining({ move: "Go Back to the Shadow", formula: "2d8" }));
		expect(roll.mock.calls[0][1].offers.map(o => o.key)).toEqual(["hungryFlames"]);
		expect(message.getFlag(SCOPE, SHADOW_FLAG)).toBe(true);
		await expect(settleShadowDamage(message, hungry, { roll })).resolves.toBe(false);

		const reduced = card({ invocations: [GO_BACK_TO_THE_SHADOW] });
		await settleShadowDamage(reduced, seren, { reduced: true, roll });
		expect(roll.mock.calls[1][1]).toMatchObject({ move: "Go Back to the Shadow (Reduced)", formula: "1d8", offers: [] });
	});

	it("gives the card back when the window is cancelled, and after a roll at nobody, for the next spirit", async () => {
		const message = card({ invocations: [GO_BACK_TO_THE_SHADOW] });
		await expect(settleShadowDamage(message, seren, { roll: async () => null })).resolves.toBe(false);
		expect(message.getFlag(SCOPE, SHADOW_FLAG)).toBeUndefined();
		await expect(settleShadowDamage(message, seren, { roll: async () => [{ raw: 7 }] })).resolves.toBe(true);
		expect(message.getFlag(SCOPE, SHADOW_FLAG)).toBeUndefined();
	});

	it("reads a 1d8 and a 2d8", () => {
		expect(shadowDamageFormula()).toBe("2d8");
		expect(shadowDamageFormula({ reduced: true })).toBe("1d8");
	});
});

describe("which cards grow the buttons", () => {
	it("an Invoke card naming either Invocation, on a hit or the 10+ card, never a 6-", () => {
		expect(invocationEffectsFor(card())).toEqual([{ slug: BATH_OF_HEALING_LIGHT, flag: BATH_FLAG }]);
		expect(invocationEffectsFor(card({ invocations: [GO_BACK_TO_THE_SHADOW, BATH_OF_HEALING_LIGHT] })).map(e => e.slug))
			.toEqual([GO_BACK_TO_THE_SHADOW, BATH_OF_HEALING_LIGHT]);
		expect(invocationEffectsFor(card(), { missed: true })).toEqual([]);
		expect(invocationEffectsFor(card({ tenPlus: true }), { missed: true })).toHaveLength(1);
		expect(invocationEffectsFor(card({ invocations: ["blinding-light"] }))).toEqual([]);
		expect(invocationEffectsFor(card({ move: "Clash" }))).toEqual([]);
	});

	it("reads the Reduced tick off the card", () => {
		const item = (text, checked) => ({
			closest: () => null,
			textContent: text,
			querySelector: sel => (sel === "label" ? { textContent: text } : sel === ".stonetop-picklist-check" ? { checked } : null),
		});
		const root = items => ({ querySelectorAll: () => items });
		expect(invokeCardReduced(root([item("The Invocation has its reduced effect", true), item("The effort taxes you; mark a debility", false)]), card())).toBe(true);
		expect(invokeCardReduced(root([item("The Invocation has its reduced effect", false), item("The effort taxes you; mark a debility", true)]), card())).toBe(false);
	});

	// B5/R7: the Wielder's "as a 10+" card has no roll, and a 10+'s list to choose 1 from.
	it("offers the holy relics on a 7+ and on the 10+ card, never on a 6-", () => {
		expect(invokeCardChoosesConsequence(card(), { total: 7 })).toBe(true);
		expect(invokeCardChoosesConsequence(card(), { total: 6 })).toBe(false);
		expect(invokeCardChoosesConsequence(card(), {})).toBe(false);
		expect(invokeCardChoosesConsequence(card({ tenPlus: true }), {})).toBe(true);
		expect(invokeCardChoosesConsequence(card({ move: "Clash" }), { total: 10 })).toBe(false);
	});

	// stonetop.js registers hooks on import, so its wiring is read off the source.
	it("is wired on every chat card, and the relic reads the 10+ card too", () => {
		const src = fs.readFileSync(path.resolve("stonetop.js"), "utf8");
		expect(src).toContain("wireInvocationEffects(message, html, { missed: _invokeCardMissed(message) });");
		expect(src.indexOf("wireInvocationEffects(message, html")).toBeGreaterThan(src.indexOf("_chatWireRollCardPicks(message, html);"));
		expect(src).toContain("CONFIG.queries[BATH_QUERY] = (data, context) => handleBathQuery(data, context)");
		const at = src.indexOf("function _chatWireHolyRelics");
		const relics = src.slice(at, src.indexOf("\n}\n", at));
		expect(relics).toContain("invokeCardChoosesConsequence(message, { total: message.rolls?.at(0)?.total ?? null })");
		expect(relics).toContain("tenPlus ? invokeActionRow(html)");
		expect(relics).not.toContain('_classifyShiftedTotal(roll.total).key === "failure"');
	});
});
