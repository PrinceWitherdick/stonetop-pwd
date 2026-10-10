// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Go Back to the Shadow's roll goes through the damage window, which is a canvas and a dialog: the
// one seam stood in for here. Everything else on the card is the shipped code.
const { rollInvocationDamage } = vi.hoisted(() => ({ rollInvocationDamage: vi.fn() }));
vi.mock("../../../module/combat/attack-flow.js", async importOriginal => ({ ...(await importOriginal()), rollInvocationDamage }));

import {
	wireInvokeConsequences, wireWielderInvoke, wielderRollOptions, invokeTenPlusCardBody,
	CONSEQUENCES_FLAG, WIELDER_INVOKED_FLAG, TEN_PLUS_FLAG, CARD_INVOCATIONS_FLAG,
} from "../../../module/actors/character/invoke-consequences.js";
import {
	wireInvocationEffects, bathWindowContent, bathPatientView, chooseBathMember, BATH_FLAG, SHADOW_FLAG, BATH_OF_HEALING_LIGHT, GO_BACK_TO_THE_SHADOW,
} from "../../../module/actors/character/invocation-apply.js";
import { rollStat } from "../../../module/utils/roll-engine.js";
import { cardTierNow, rolledRecord, ROLLED_FLAG } from "../../../module/utils/counted-tier.js";
import { moveCardBody } from "../../../module/utils/move-tiers.js";
import { moveChatCard } from "../../../module/utils/chat.js";
import { withMovePickBonuses } from "../../../module/actors/character/move-pick-bonuses.js";
import { buildLiveCharacter, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { writeFlagPath } from "../../fakes/combat-chat.js";
import { stubAsk } from "../../fakes/confirm.js";

// The Invoke the Sun God card as a player sees it: the card the roll engine builds from the shipped
// move, drawn into a chat log, wired, and clicked. invoke-consequences.test.js and
// invocation-apply.test.js hold what each settle function does; this holds that the card's own boxes
// and buttons reach them, once, and only for whoever may act.

const SCOPE = "stonetop-pwd";
const INVOKE = "Invoke the Sun God";
const WIELDER = "Wielder of the White Flame";
const moveDoc = slug => JSON.parse(fs.readFileSync(
	path.resolve(`packs/src/stonetop-items/playbook-moves/the-lightbearer/${slug}.json`), "utf8"));
const INVOKE_DOC = moveDoc("invoke-the-sun-god");
const WIELDER_DOC = moveDoc("wielder-of-the-white-flame");

let posted;
let rollTotal;
let rolled;
let saved;

beforeEach(() => {
	posted = [];
	rolled = [];
	rollTotal = 10;
	saved = { ...globalThis.game, Roll: globalThis.Roll, ChatMessage: globalThis.ChatMessage, ui: globalThis.ui, DialogV2: globalThis.foundry.applications?.api?.DialogV2 };
	globalThis.Roll = class {
		constructor(formula) { this.formula = formula; this.total = rollTotal; this.dice = []; }
		async evaluate() { return this; }
		async toMessage(data) { rolled.push({ ...data, roll: this }); }
	};
	globalThis.ChatMessage = { create: vi.fn(async data => { posted.push(data); return { id: `posted${posted.length}` }; }), getSpeaker: ({ actor }) => ({ actor: actor?.id, alias: actor?.name }) };
	globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
	globalThis.game.settings = { get: () => "publicroll" };
	globalThis.game.user = { id: "u-seren", isGM: false, targets: new Set() };
	rollInvocationDamage.mockReset();
	document.body.innerHTML = `<ol id="chat-log"></ol>`;
});
afterEach(() => {
	for (const key of ["settings", "user", "actors"]) globalThis.game[key] = saved[key];
	globalThis.Roll = saved.Roll;
	globalThis.ChatMessage = saved.ChatMessage;
	globalThis.ui = saved.ui;
	if (globalThis.foundry.applications?.api) globalThis.foundry.applications.api.DialogV2 = saved.DialogV2;
});

/** Let every queued settle run: the list's change listener serialises its writes per card. */
async function settle() {
	for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * The Lightbearer, as a real character model over a stateful actor, with the Wielder move when asked.
 * `owner: false` is another player's client looking at the same character.
 */
function lightbearer({ background = null, wielder = false, wielderLearned = true, owner = true } = {}) {
	const items = wielder ? [makeLiveItem({
		name: WIELDER, type: "move", system: structuredClone(WIELDER_DOC.system),
		flags: wielderLearned ? undefined : { [SCOPE]: { learned: false } },
	})] : [];
	const { char, actor } = buildLiveCharacter({
		slug: "the-lightbearer", name: "The Lightbearer", items,
		flags: background ? { "background.selected": background } : {},
	});
	Object.assign(actor, { id: "seren", uuid: "Actor.seren", name: "Seren", isOwner: owner, typedActor: char });
	actor.sheet = { _invokeAsTenPlus: vi.fn(async () => ({ id: "ten-plus-card" })) };
	globalThis.game.actors = new Map([[actor.id, actor]]);
	return { actor, char };
}

/** A posted card: flags written as Foundry writes them (dotted keys, merged objects), a roll if it had one. */
function chatMessage({ id = "msg1", flags = {}, total = null, speaker = "seren", canModify = true } = {}) {
	const store = structuredClone(flags[SCOPE] ?? {});
	const message = {
		id,
		speaker: { actor: speaker },
		rolls: total == null ? [] : [{ total }],
		flags: { [SCOPE]: store },
		getFlag: (scope, key) => (scope === SCOPE ? key.split(".").reduce((at, part) => at?.[part], store) : undefined),
		setFlag: vi.fn(async (_scope, key, value) => writeFlagPath(store, key, structuredClone(value))),
		unsetFlag: vi.fn(async (_scope, key) => {
			const parts = key.split(".");
			const at = parts.slice(0, -1).reduce((node, part) => node?.[part], store);
			if (at) delete at[parts.at(-1)];
		}),
		canUserModify: () => canModify,
	};
	return message;
}

/**
 * The roll card for `move`, built the way StonetopItem#roll builds it: the move's own text through
 * moveCardBody (its list made tickable) and the roller's pick bonuses, handed to the roll engine.
 */
async function rollCard(actor, { move = INVOKE, total = 10, flags = {}, options = {} } = {}) {
	const doc = move === INVOKE ? INVOKE_DOC : WIELDER_DOC;
	rollTotal = total;
	await rollStat("wis", actor, {
		moveName: move,
		moveDescription: withMovePickBonuses(moveCardBody(doc.system.description, doc.system.moveResults, { pickable: true }), actor, move, null),
		moveResults: doc.system.moveResults,
		messageFlags: { [SCOPE]: { move, ...flags } },
		noXpOnMiss: true,
		...options,
	});
	const posting = rolled.at(-1);
	return { flavor: posting.flavor, flags: posting.flags, total: posting.roll.total };
}

/** Draw a message into the chat log, as core's renderChatMessageHTML hands it over. */
function draw(message, { flavor = "", content = "" } = {}) {
	const li = document.createElement("li");
	li.className = "chat-message message flexcol";
	li.dataset.messageId = message.id;
	li.innerHTML = `<header class="message-header flexrow"><h4 class="message-sender">Seren</h4>`
		+ `${flavor ? `<span class="flavor-text">${flavor}</span>` : ""}</header>`
		+ `<div class="message-content">${content}</div>`;
	document.getElementById("chat-log").appendChild(li);
	return li;
}

/**
 * The picks pass (stonetop.js#_chatWireRollCardPicks), which runs before these wirings: each box's
 * tick restored from the message, and a tick saved back to it. Private to stonetop.js, which registers
 * its hooks on import, so its two effects the consequences read are stood in for here.
 */
function picksPass(root, message) {
	const boxes = [...root.querySelectorAll(".stonetop-picklist-check")];
	const savedTicks = message.getFlag(SCOPE, "pickChecked") ?? [];
	for (const box of boxes) {
		box.checked = !!savedTicks[Number(box.dataset.index)];
		if (box.dataset.picksWired === "1") continue;
		box.dataset.picksWired = "1";
		box.addEventListener("change", () => {
			writeFlagPath(message.flags[SCOPE], "pickChecked", boxes.map(b => !!b.checked));
		});
	}
}

/** Both consequence and Invocation passes, in stonetop.js's order, after the picks pass. */
function renderCard(message, parts) {
	const root = draw(message, parts);
	picksPass(root, message);
	wireInvokeConsequences(message, root);
	wireInvocationEffects(message, root, { missed: missed(message) });
	return root;
}

/** stonetop.js#_invokeCardMissed: a rolled card that COUNTS as a 6- (its total, bent by the rules on the card). */
function missed(message) {
	return cardTierNow(message, SCOPE) === "failure";
}

/** One consequence row, found by its printed words. */
function row(root, words) {
	const item = [...root.querySelectorAll(".stonetop-picklist-item")].find(li => li.textContent.includes(words));
	if (!item) throw new Error(`no consequence row reading "${words}"`);
	return { item, box: item.querySelector(".stonetop-picklist-check") };
}
const DEBILITY = "mark a debility";
const SNUFF = "The light is snuffed out";
const SUN = "You must bask in sunlight";
const REDUCED = "The Invocation has its reduced effect";

const debilityButtons = root => [...row(root, DEBILITY).item.querySelectorAll(".stonetop-invoke-debility-btn")];
const readouts = (root, words) => [...row(root, words).item.querySelectorAll(".stonetop-invoke-consequence-note")].map(el => el.textContent);
const marked = actor => Object.entries(actor.system.attributes.debilities.options).filter(([, d]) => d.value).map(([key]) => key);

/** A rolled Invoke card for the Invocation(s) named, drawn and wired. */
async function invokeCard(actor, { invocations = ["warmth-of-the-sun"], total = 10, empowered = false, id = "msg1", canModify = true } = {}) {
	const card = await rollCard(actor, { total, flags: { [CARD_INVOCATIONS_FLAG]: invocations, ...(empowered ? { invokeEmpowered: true } : {}) } });
	const message = chatMessage({ id, flags: card.flags, total: card.total, canModify });
	return { message, card, root: renderCard(message, { flavor: card.flavor }) };
}

// stonetop.js registers its hooks on import, so the dispatch is read off the source: the consequence
// and Invocation passes run after the picks pass that restores each tick, which is what they read.
describe("the chat render dispatch", () => {
	it("wires the consequences and the Invocation buttons after the picks pass, and the Wielder button on every card", () => {
		const src = fs.readFileSync(path.resolve("stonetop.js"), "utf8");
		const at = src.indexOf('Hooks.on("renderChatMessageHTML"');
		const hook = src.slice(at, src.indexOf("\n});\n", at));
		const picks = hook.indexOf("_chatWireRollCardPicks(message, html);");
		expect(picks).toBeGreaterThan(0);
		expect(hook.indexOf("wireInvokeConsequences(message, html);")).toBeGreaterThan(picks);
		expect(hook.indexOf("wireInvocationEffects(message, html, { missed: _invokeCardMissed(message) });")).toBeGreaterThan(picks);
		expect(hook).toContain("wireWielderInvoke(message, html);");
	});

	// A card's 6- consequences and its Logbook offer both follow the tier the card COUNTS as: a rule stamped on it
	// that counts a miss as a 7-9 lifts it off the miss, and one that counts a 7-9 as a 10+ leaves no Logbook to buy.
	it("reads the Invoke miss and the Know Things upgrade off the card's counted tier, not its bare total", () => {
		const src = fs.readFileSync(path.resolve("stonetop.js"), "utf8");
		const body = name => src.slice(src.indexOf(`function ${name}(`), src.indexOf("\n}\n", src.indexOf(`function ${name}(`)));
		expect(body("_invokeCardMissed")).toContain("cardTierNow(message, SYSTEM_ID)");
		expect(body("_knowThingsCountsAsStrongHit")).toContain("cardTierNow(message, SYSTEM_ID)");
		expect(body("_wireLogbook")).toContain("_knowThingsCountsAsStrongHit(message)");
		expect(body("_upgradeKnowThings")).toContain("_knowThingsCountsAsStrongHit(message)");
		expect(body("_wireLogbook")).not.toContain("roll.total");
	});

	it("counts a 6- the card lifts to a 7-9 as no miss", () => {
		const flags = { [SCOPE]: { [ROLLED_FLAG]: rolledRecord("wis", { missCountsAsPartial: "Tower Eternal" }) } };
		expect(missed(chatMessage({ flags, total: 6 }))).toBe(false);
		expect(missed(chatMessage({ total: 6 }))).toBe(true);
	});
});

describe("the card the roll engine builds", () => {
	it("carries the move's four consequences as tickable rows, in the card's own message", async () => {
		const { actor } = lightbearer();
		const { root } = await invokeCard(actor);
		const items = [...root.querySelectorAll(".stonetop-roll-card .stonetop-picklist-item")];
		expect(items.map(li => li.querySelector("label").textContent.trim())).toEqual([
			REDUCED,
			"The effort taxes you; mark a debility",
			"The light is snuffed out when the Invocation is complete, its fuel consumed",
			"You must bask in sunlight for an hour or so before using that Invocation again",
		]);
	});
});

// "The effort taxes you; mark a debility".
describe("ticking the debility", () => {
	it("shows a button per unmarked debility only while the box is ticked", async () => {
		const { actor } = lightbearer();
		actor.system.attributes.debilities.options.dazed.value = true;
		const { root } = await invokeCard(actor);
		const panel = row(root, DEBILITY).item.querySelector(".stonetop-invoke-debility");
		expect(panel.hidden).toBe(true);
		row(root, DEBILITY).box.click();
		expect(panel.hidden).toBe(false);
		expect(debilityButtons(root).map(b => b.textContent)).toEqual(["Mark Weakened", "Mark Miserable"]);
		row(root, DEBILITY).box.click();
		expect(panel.hidden).toBe(true);
	});

	it("marks exactly the one debility pressed, once, however often it is pressed", async () => {
		const { actor } = lightbearer();
		const { root, message } = await invokeCard(actor);
		row(root, DEBILITY).box.click();
		const [weakened, dazed] = debilityButtons(root);
		weakened.click();
		weakened.click();
		dazed.click();
		await settle();
		expect(marked(actor)).toEqual(["weakened"]);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(posted.map(p => p.content).filter(c => c.includes("marks Weakened"))).toHaveLength(1);
		expect(debilityButtons(root).every(b => b.disabled)).toBe(true);
		expect(message.getFlag(SCOPE, CONSEQUENCES_FLAG)[row(root, DEBILITY).box.dataset.index]).toEqual({ marked: "weakened" });
	});

	it("after the card re-renders, says what was marked and offers nothing more", async () => {
		const { actor } = lightbearer();
		const { root, message, card } = await invokeCard(actor);
		row(root, DEBILITY).box.click();
		debilityButtons(root)[0].click();
		await settle();
		root.remove();
		const again = renderCard(message, { flavor: card.flavor });
		expect(row(again, DEBILITY).box.checked).toBe(true);
		expect(debilityButtons(again)).toEqual([]);
		expect(readouts(again, DEBILITY)).toEqual(["Marked Weakened."]);
		// And the same element wired twice keeps one readout, not two.
		wireInvokeConsequences(message, again);
		expect(readouts(again, DEBILITY)).toEqual(["Marked Weakened."]);
	});

	it("offers the Auspicious Birth circle first, and pressing it marks the circle, not a debility", async () => {
		const { actor, char } = lightbearer({ background: "auspicious-birth" });
		const { root } = await invokeCard(actor);
		row(root, DEBILITY).box.click();
		const buttons = debilityButtons(root);
		expect(buttons.map(b => b.textContent)).toEqual([
			"Mark your Auspicious Birth circle (no ill effect)", "Mark Weakened", "Mark Dazed", "Mark Miserable",
		]);
		buttons[0].click();
		await settle();
		expect(char.background.setupResources["auspicious-birth"]).toBe(1);
		expect(marked(actor)).toEqual([]);
		expect(posted.at(-1).content).toContain("marks their Auspicious Birth circle instead of a debility");
	});

	it("does not offer the circle once it is marked", async () => {
		const { actor, char } = lightbearer({ background: "auspicious-birth" });
		await char.background.setSetupResource("auspicious-birth", 1);
		const { root } = await invokeCard(actor);
		row(root, DEBILITY).box.click();
		expect(debilityButtons(root).map(b => b.dataset.choice)).toEqual(["weakened", "dazed", "miserable"]);
	});
});

// "The light is snuffed out when the Invocation is complete, its fuel consumed".
describe("ticking the snuffing", () => {
	it("stamps a running Invocation, so the light goes out when it ends, and unticking takes the stamp back", async () => {
		const { actor, char } = lightbearer();
		await char.setHolyLight(true);
		await char.setOngoingInvocation("warmth-of-the-sun");
		const snuff = vi.spyOn(char, "markInvocationSnuff");
		const light = vi.spyOn(char, "setHolyLight");
		const { root, message, card } = await invokeCard(actor, { invocations: ["warmth-of-the-sun"] });

		row(root, SNUFF).box.click();
		await settle();
		expect(snuff).toHaveBeenCalledWith("warmth-of-the-sun", true);
		expect(light).not.toHaveBeenCalled();
		expect(char.invocationState.snuff).toBe(true);
		expect(char.holyLight).toBe(true);

		// The card re-renders on the flag it wrote, and says what is coming.
		root.remove();
		const again = renderCard(message, { flavor: card.flavor });
		expect(readouts(again, SNUFF)).toEqual(["The holy light goes out when Warmth of the Sun ends."]);

		row(again, SNUFF).box.click();
		await settle();
		expect(snuff).toHaveBeenLastCalledWith("warmth-of-the-sun", false);
		expect(char.invocationState.snuff).toBe(false);
	});

	it("puts the light out at once for an instant Invocation, and a relit light stays lit through a re-tick", async () => {
		const { actor, char } = lightbearer();
		await char.setHolyLight(true);
		const light = vi.spyOn(char, "setHolyLight");
		const { root, message, card } = await invokeCard(actor, { invocations: ["cleansing-light"] });

		row(root, SNUFF).box.click();
		await settle();
		expect(light).toHaveBeenCalledWith(false);
		expect(char.holyLight).toBe(false);
		expect(posted.at(-1).content).toContain("holy light is snuffed out as the Invocation completes");

		await char.setHolyLight(true);
		light.mockClear();
		root.remove();
		const again = renderCard(message, { flavor: card.flavor });
		expect(readouts(again, SNUFF)).toEqual(["The holy light went out, its fuel consumed."]);
		row(again, SNUFF).box.click();
		row(again, SNUFF).box.click();
		await settle();
		expect(light).not.toHaveBeenCalled();
		expect(char.holyLight).toBe(true);
	});

	it("says a roll that names no Invocation is the table's to settle", async () => {
		const { actor, char } = lightbearer();
		const snuff = vi.spyOn(char, "markInvocationSnuff");
		const { root, message, card } = await invokeCard(actor, { invocations: [] });
		row(root, SNUFF).box.click();
		await settle();
		expect(snuff).not.toHaveBeenCalled();
		root.remove();
		const again = renderCard(message, { flavor: card.flavor });
		expect(readouts(again, SNUFF)).toEqual(["This roll names no Invocation, so the sheet can't track this one: settle it at the table."]);
	});
});

// "You must bask in sunlight for an hour or so before using that Invocation again".
describe("ticking the sun", () => {
	it("puts the Invocation on the needs-sun list, and unticking takes it back off", async () => {
		const { actor, char } = lightbearer();
		const { root, message, card } = await invokeCard(actor, { invocations: ["warmth-of-the-sun"] });
		row(root, SUN).box.click();
		await settle();
		expect(char.invocationsNeedingSun).toEqual(["warmth-of-the-sun"]);
		root.remove();
		const again = renderCard(message, { flavor: card.flavor });
		expect(readouts(again, SUN)).toEqual(["Warmth of the Sun needs sun: bask in sunlight for an hour or so before using it again."]);
		row(again, SUN).box.click();
		await settle();
		expect(char.invocationsNeedingSun).toEqual([]);
	});

	// A tick past the list's cap releases an earlier box with no event of its own
	// (stonetop.js#_releasePicksOverLimit): the next change squares every row with its box.
	it("takes the sun back when a later tick released its box without an event", async () => {
		const { actor, char } = lightbearer();
		const { root } = await invokeCard(actor, { invocations: ["cleansing-light"] });
		row(root, SUN).box.click();
		await settle();
		expect(char.invocationsNeedingSun).toEqual(["cleansing-light"]);
		row(root, SUN).box.checked = false;
		row(root, REDUCED).box.click();
		await settle();
		expect(char.invocationsNeedingSun).toEqual([]);
	});

	it("binds one listener per list, so the same card wired twice marks once", async () => {
		const { actor, char } = lightbearer();
		const { root, message } = await invokeCard(actor, { invocations: ["warmth-of-the-sun"] });
		wireInvokeConsequences(message, root);
		const sun = vi.spyOn(char, "markNeedsSun");
		row(root, SUN).box.click();
		await settle();
		expect(sun).toHaveBeenCalledTimes(1);
	});
});

describe("a client that may not act", () => {
	it("sees what was done and the debility choices, but nothing it can press, and a tick writes nothing", async () => {
		const { actor, char } = lightbearer();
		const { message, card } = await invokeCard(actor, { invocations: ["warmth-of-the-sun"] });
		writeFlagPath(message.flags[SCOPE], "pickChecked", [false, true, false, false]);
		actor.isOwner = false;
		const sun = vi.spyOn(char, "markNeedsSun");
		const view = renderCard(message, { flavor: card.flavor });
		expect(row(view, DEBILITY).item.querySelector(".stonetop-invoke-debility").hidden).toBe(false);
		expect(debilityButtons(view).length).toBe(3);
		expect(debilityButtons(view).every(b => b.disabled)).toBe(true);
		debilityButtons(view)[0].click();
		row(view, SUN).box.click();
		await settle();
		expect(marked(actor)).toEqual([]);
		expect(sun).not.toHaveBeenCalled();
		expect(message.setFlag).not.toHaveBeenCalled();
		// The sun readout is the tick's, drawn on the next render for everyone.
		const next = renderCard(chatMessage({ id: "msg1", flags: { [SCOPE]: { ...message.flags[SCOPE], pickChecked: [false, false, false, true] } }, total: 10 }), { flavor: card.flavor });
		expect(readouts(next, SUN)).toHaveLength(1);
	});

	it("is a player who owns the character but not a GM's message: no buttons to press either", async () => {
		const { actor } = lightbearer();
		const { root } = await invokeCard(actor, { canModify: false, invocations: [BATH_OF_HEALING_LIGHT] });
		row(root, DEBILITY).box.click();
		expect(debilityButtons(root).length).toBe(3);
		expect(debilityButtons(root).every(b => b.disabled)).toBe(true);
		expect(root.querySelector(".stonetop-bath-heal").disabled).toBe(true);
	});
});

// "you may Invoke the Sun God right now as if you rolled a 10+".
describe("Wielder of the White Flame's Invoke now", () => {
	async function wielderCard(actor, { total = 10 } = {}) {
		const card = await rollCard(actor, { move: WIELDER, total, options: { ...(wielderRollOptions(actor) ?? {}) } });
		const message = chatMessage({ flags: card.flags, total: card.total });
		const root = draw(message, { flavor: card.flavor });
		wireWielderInvoke(message, root);
		return { root, message, card };
	}
	const invokeNow = root => root.querySelector(".stonetop-wielder-invoke");

	it("is on the 10+ for a Lightbearer with the move learned, and invokes once however often it is pressed", async () => {
		const { actor } = lightbearer({ wielder: true });
		const { root, message } = await wielderCard(actor);
		const btn = invokeNow(root);
		expect(btn.textContent.trim()).toBe("Invoke the Sun God now (as a 10+)");
		expect(btn.closest("[hidden]")).toBeNull();
		btn.click();
		btn.click();
		await settle();
		expect(actor.sheet._invokeAsTenPlus).toHaveBeenCalledTimes(1);
		expect(message.getFlag(SCOPE, WIELDER_INVOKED_FLAG)).toBe(true);
		expect(btn.disabled).toBe(true);
	});

	it("once used, a re-rendered card shows it chosen and it cannot be pressed", async () => {
		const { actor } = lightbearer({ wielder: true });
		const { message, card } = await wielderCard(actor);
		await message.setFlag(SCOPE, WIELDER_INVOKED_FLAG, true);
		const again = draw(message, { flavor: card.flavor });
		wireWielderInvoke(message, again);
		expect(invokeNow(again).classList.contains("is-chosen")).toBe(true);
		expect(invokeNow(again).disabled).toBe(true);
		invokeNow(again).click();
		await settle();
		expect(actor.sheet._invokeAsTenPlus).not.toHaveBeenCalled();
	});

	it("gives the button back when the invoke window is backed out of", async () => {
		const { actor } = lightbearer({ wielder: true });
		actor.sheet._invokeAsTenPlus.mockResolvedValueOnce(null);
		const { root, message } = await wielderCard(actor);
		invokeNow(root).click();
		await settle();
		expect(message.getFlag(SCOPE, WIELDER_INVOKED_FLAG)).toBeUndefined();
		expect(invokeNow(root).disabled).toBe(false);
	});

	it("wired twice on the same card, still invokes once", async () => {
		const { actor } = lightbearer({ wielder: true });
		const { root, message } = await wielderCard(actor);
		wireWielderInvoke(message, root);
		invokeNow(root).click();
		await settle();
		expect(actor.sheet._invokeAsTenPlus).toHaveBeenCalledTimes(1);
	});

	it("is not on the card for a Lightbearer whose Wielder is switched off, and sits hidden on a 7-9", async () => {
		const { actor: off } = lightbearer({ wielder: true, wielderLearned: false });
		expect(invokeNow((await wielderCard(off)).root)).toBeNull();
		const { actor } = lightbearer({ wielder: true });
		const weak = invokeNow((await wielderCard(actor, { total: 8 })).root);
		expect(weak.closest("[hidden]")).not.toBeNull();
	});

	it("is disabled for a client that does not own the character", async () => {
		const { actor } = lightbearer({ wielder: true });
		const card = await rollCard(actor, { move: WIELDER, total: 10, options: wielderRollOptions(actor) });
		actor.isOwner = false;
		const message = chatMessage({ flags: card.flags, total: card.total });
		const root = draw(message, { flavor: card.flavor });
		wireWielderInvoke(message, root);
		expect(invokeNow(root).disabled).toBe(true);
		invokeNow(root).click();
		await settle();
		expect(actor.sheet._invokeAsTenPlus).not.toHaveBeenCalled();
	});
});

describe("the Invocation's own buttons on the card", () => {
	const bathBtn = root => root.querySelector(".stonetop-bath-heal");
	const shadowBtn = root => root.querySelector(".stonetop-shadow-damage");

	/** The Wielder's "as a 10+" card, as the sheet's _postInvokeTenPlus posts it: no roll. */
	function tenPlusCard(actor, invocations) {
		const content = moveChatCard("Invoke the Sun God (as a 10+)", invokeTenPlusCardBody(INVOKE_DOC.system.description, actor, null));
		const message = chatMessage({ flags: { [SCOPE]: { move: INVOKE, [TEN_PLUS_FLAG]: true, [CARD_INVOCATIONS_FLAG]: invocations } } });
		return { message, content, root: renderCard(message, { content }) };
	}

	it("grows neither button on a 6-, and both on a 7-9, a 10+ and the as-a-10+ card", async () => {
		const { actor } = lightbearer();
		const both = [BATH_OF_HEALING_LIGHT, GO_BACK_TO_THE_SHADOW];
		const miss = await invokeCard(actor, { invocations: both, total: 6, id: "miss" });
		expect(bathBtn(miss.root)).toBeNull();
		expect(shadowBtn(miss.root)).toBeNull();
		for (const total of [8, 11]) {
			const hit = await invokeCard(actor, { invocations: both, total, id: `hit${total}` });
			expect(bathBtn(hit.root).textContent.trim()).toBe("Heal your patient");
			expect(shadowBtn(hit.root).textContent.trim()).toBe("Roll 2d8 damage for each spirit");
			// In the card's own action row, not the shared Shift row.
			expect(bathBtn(hit.root).closest(".stonetop-roll-actions")).not.toBeNull();
			expect(bathBtn(hit.root).closest(".stonetop-card-buttons")).toBeNull();
		}
		const tenPlus = tenPlusCard(actor, both);
		expect(bathBtn(tenPlus.root)).not.toBeNull();
		expect(shadowBtn(tenPlus.root)).not.toBeNull();
		expect(tenPlus.root.querySelector(".stonetop-chat-move .stonetop-roll-actions")).not.toBeNull();
	});

	it("keeps one of each through a re-wire of the same card", async () => {
		const { actor } = lightbearer();
		const { root, message } = await invokeCard(actor, { invocations: [BATH_OF_HEALING_LIGHT, GO_BACK_TO_THE_SHADOW] });
		wireInvocationEffects(message, root, { missed: false });
		expect(root.querySelectorAll(".stonetop-bath-heal")).toHaveLength(1);
		expect(root.querySelectorAll(".stonetop-shadow-damage")).toHaveLength(1);
	});

	it("names 1d8 once the reduced effect is ticked, and rolls it once per card", async () => {
		const { actor } = lightbearer();
		rollInvocationDamage.mockResolvedValue([{ uuid: "Scene.s.Token.shade", raw: 5 }]);
		const { root, message, card } = await invokeCard(actor, { invocations: [GO_BACK_TO_THE_SHADOW] });
		row(root, REDUCED).box.click();
		expect(shadowBtn(root).textContent.trim()).toBe("Roll 1d8 damage for each spirit");
		shadowBtn(root).click();
		shadowBtn(root).click();
		await settle();
		expect(rollInvocationDamage).toHaveBeenCalledTimes(1);
		expect(rollInvocationDamage.mock.calls[0][1]).toMatchObject({ formula: "1d8", move: "Go Back to the Shadow (Reduced)" });
		expect(message.getFlag(SCOPE, SHADOW_FLAG)).toBe(true);
		root.remove();
		const again = renderCard(message, { flavor: card.flavor });
		expect(shadowBtn(again).textContent.trim()).toBe("Damage rolled");
		expect(shadowBtn(again).disabled).toBe(true);
	});

	it("heals the targeted patient once, and the card then says who", async () => {
		const { actor } = lightbearer();
		const { char: kyraModel, actor: kyra } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy" });
		Object.assign(kyra, { id: "kyra", uuid: "Actor.kyra", name: "Kyra", isOwner: true, typedActor: kyraModel });
		kyraModel.computedMaxHp = vi.fn(async () => 18);
		kyra.system.attributes.hp.value = 4;
		globalThis.game.user.targets = new Set([{ actor: kyra }]);
		// The picks window, answered with "Regains 5 HP" ticked on the real form.
		const form = document.createElement("form");
		form.innerHTML = bathWindowContent(bathPatientView(kyra));
		form.querySelector('input[value="hp5"]').checked = true;
		const wait = stubAsk("heal", form);

		const { root, message, card } = await invokeCard(actor, { invocations: [BATH_OF_HEALING_LIGHT] });
		bathBtn(root).click();
		bathBtn(root).click();
		await settle();
		expect(wait).toHaveBeenCalledTimes(1);
		expect(kyra.system.attributes.hp.value).toBe(9);
		expect(posted.at(-1).content).toContain("Bath of Healing Light");
		expect(message.getFlag(SCOPE, BATH_FLAG)).toBe("Kyra");
		root.remove();
		const again = renderCard(message, { flavor: card.flavor });
		expect(bathBtn(again).textContent.trim()).toBe("Healed Kyra");
		expect(bathBtn(again).disabled).toBe(true);
	});

	it("shows a client that may not act the buttons, disabled", async () => {
		const { actor } = lightbearer();
		const { card, message } = await invokeCard(actor, { invocations: [BATH_OF_HEALING_LIGHT, GO_BACK_TO_THE_SHADOW] });
		actor.isOwner = false;
		const view = renderCard(chatMessage({ id: "msg1", flags: { [SCOPE]: message.flags[SCOPE] }, total: 10 }), { flavor: card.flavor });
		expect(bathBtn(view).disabled).toBe(true);
		expect(shadowBtn(view).disabled).toBe(true);
		shadowBtn(view).click();
		await settle();
		expect(rollInvocationDamage).not.toHaveBeenCalled();
	});
});

// "Which member?" for a group follower's token: a list of radio rows in a box that scrolls, not a button
// per member (a crew of twelve made a window taller than the screen), and ONE Heal button naming whoever
// is ticked. Drawn here into a real DOM, the way DialogV2 draws it (content, then a footer of buttons each
// holding an icon and a span), so the ticking, the disabled fallen row and the live label are the browser's.
describe("the Bath's Which member? window", () => {
	/** A DialogV2.wait that draws the window, runs the render hook, lets `act` use it, then presses `press`. */
	function drawnDialog(act, press = "heal") {
		const wait = vi.fn(async config => {
			const form = document.createElement("form");
			form.appendChild(config.content);
			const footer = document.createElement("footer");
			footer.className = "form-footer";
			for (const b of config.buttons) {
				const button = document.createElement("button");
				button.type = "submit";
				button.dataset.action = b.action;
				button.innerHTML = `<i class="${b.icon ?? ""}"></i><span></span>`;
				button.querySelector("span").innerText = b.label;
				footer.appendChild(button);
			}
			form.appendChild(footer);
			document.body.appendChild(form);
			config.render?.(new Event("render"), { element: form });
			await act(form);
			const button = config.buttons.find(b => b.action === press);
			const pressed = form.querySelector(`button[data-action="${press}"]`);
			return button?.callback ? button.callback(null, pressed) : press;
		});
		globalThis.foundry.applications ??= {};
		globalThis.foundry.applications.api ??= {};
		globalThis.foundry.applications.api.DialogV2 = { wait };
		return wait;
	}

	const crew = n => ({
		kind: "roster", group: "Rhianna's crew",
		members: Array.from({ length: n }, (_, i) => ({ key: `anon:${i}`, name: `Crew member ${i + 1}`, hp: i === 3 ? 2 : 6, hpMax: 6 })),
	});

	it("lists twelve members as radio rows with one Heal button that follows the tick", async () => {
		let seen;
		drawnDialog(async form => {
			seen = form;
			const rows = form.querySelectorAll(".stonetop-bath-members input[type=radio]");
			expect(rows).toHaveLength(12);
			// The hurt first, and ticked; the window has two buttons, never one per member.
			expect(rows[0].value).toBe("anon:3");
			expect(rows[0].checked).toBe(true);
			expect([...form.querySelectorAll("footer button")].map(b => b.textContent)).toEqual(["Heal Crew member 4", "Not now"]);
			rows[5].checked = true;
			rows[5].dispatchEvent(new Event("change", { bubbles: true }));			expect(form.querySelector('button[data-action="heal"] span').textContent).toBe(`Heal ${rows[5].dataset.name}`);
		});
		const picked = await chooseBathMember({}, { group: crew(12) });
		expect(picked).toEqual({ key: "anon:5", name: "Crew member 6 of Rhianna's crew" });
		expect(seen.querySelector(".stonetop-bath-member-hp").textContent).toBe("2 of 6 HP");
		seen.remove();
	});

	it("draws a fallen member greyed with the Fallen badge, not tickable, and never answers with them", async () => {
		const group = {
			kind: "roster", group: "The Band",
			members: [{ key: "member:0", name: "Member 1", hp: 0, hpMax: 4, dead: true }, { key: "member:1", name: "Member 2", hp: 1, hpMax: 4 }],
		};
		drawnDialog(async form => {
			const fallen = form.querySelector('input[value="member:0"]');
			expect(fallen.disabled).toBe(true);
			expect(fallen.closest(".stonetop-bath-member").classList.contains("is-dead")).toBe(true);
			expect(fallen.closest(".stonetop-bath-member").querySelector(".stonetop-follower-dead-badge").textContent.trim()).toBe("Fallen");
			expect(form.querySelector('input[value="member:1"]').checked).toBe(true);
			form.remove();
		});
		await expect(chooseBathMember({}, { group })).resolves.toEqual({ key: "member:1", name: "Member 2 of The Band" });
		drawnDialog(async form => form.remove(), "cancel");
		await expect(chooseBathMember({}, { group })).resolves.toBeNull();
	});
});
