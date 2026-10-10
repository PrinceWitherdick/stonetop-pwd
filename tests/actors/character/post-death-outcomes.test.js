import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";
import { DEATHS_DOOR_STATE } from "../../../module/actors/character/deaths-door.js";
import {
	buildPostDeathTabView, completeMasterTask, gainThrallMark, runPostDeathOutcome, setFavorFromPip, tickInsertLore,
} from "../../../module/actors/character/post-death-outcomes.js";
import { buildPostDeathChoices, sectionReader } from "../../../module/actors/character/post-death-choices.js";
import { FakeRepositoryFactory } from "../../fakes/FakeRepositoryFactory.js";
import { FakePostDeathInsertRepository } from "../../fakes/FakePostDeathInsertRepository.js";
import { makeLiveActor } from "../../fakes/LiveCharacter.js";
import { stubConfirm } from "../../fakes/confirm.js";
import { readRepo } from "../../fakes/css.js";

// The three inserts as they SHIP, so every Purpose, Consequence and Mark is the book's.
const INSERTS = ["revenant", "ghost", "thrall"].map(slug =>
	JSON.parse(readRepo(`packs/src/stonetop-items/post-death-inserts/${slug}.json`)));

const THRALL_MARKS = ["a-festering-rot", "child-of-the-deeps", "death-mask", "quicksilver-dreams", "ravenous",
	"red-wrath", "shadows-cold-embrace", "speak-truth-whisper-secrets", "torments-blessing"];

/**
 * A character wearing `slug`, the stateful live actor so a write can be read back off it. `counts` seeds the
 * insert's lore ("section:option" keys), `insert` its other flags (task, crossedOff), `debilities` the marked ones.
 */
function makeUndead(slug, { counts = {}, insert = {}, hp = 4, max = 16, debilities = [], state = null } = {}) {
	const actor = makeLiveActor({
		name: "Vess",
		flags: { postDeathInsert: { slug, ...insert }, postDeathLore: { counts }, ...(state ? { deathsDoor: state } : {}) },
	});
	actor.system.attributes.hp = { value: hp, max };
	actor.system.attributes.wounds = [];
	for (const key of debilities) actor.system.attributes.debilities.options[key].value = true;
	const factory = new FakeRepositoryFactory({
		postDeathInsert: new FakePostDeathInsertRepository(INSERTS),
		moves: { getPostDeathMoves: async () => [] },
	});
	const char = new StonetopCharacter(actor, factory);
	// The computed max needs a playbook this fake does not carry; the stored one is the answer here.
	char.computedMaxHp = async () => max;
	actor.typedActor = char;
	return { actor, char };
}

const count = (actor, key) => Number(actor.flags["stonetop-pwd"].postDeathLore?.counts?.[key] ?? 0);
const flag = (actor, key) => actor.flags["stonetop-pwd"][key];

/** The tab's view for `char`, in play mode for its owner unless told otherwise. */
async function tabView(char, opts = {}) {
	const { postDeathInsert } = { postDeathInsert: await char._postDeath.buildSnapshot() };
	return buildPostDeathTabView(char, postDeathInsert.activeInsert, {
		editMode: false, canEdit: true, isGM: false, outOfPlay: false, hp: char.hp, maxHp: 16, ...opts,
	});
}

/**
 * Press the asked window's button whose label is `label` (or close it, for null): the pickers are one
 * button per choice, each naming its outcome. The spy is DialogV2.wait, so `.mock.calls[0][0]` is what was asked.
 */
function pressLabelled(label) {
	const wait = vi.fn(async config => config.buttons.find(b => b.label === label)?.action ?? null);
	globalThis.foundry.applications ??= {};
	globalThis.foundry.applications.api ??= {};
	globalThis.foundry.applications.api.DialogV2 = { wait };
	return wait;
}

let savedDialog;
beforeEach(() => {
	savedDialog = globalThis.foundry?.applications?.api?.DialogV2;
	global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
});
afterEach(() => {
	delete global.ChatMessage;
	delete global.Roll;
	if (globalThis.foundry?.applications?.api) globalThis.foundry.applications.api.DialogV2 = savedDialog;
});

// ── R-PURPOSE: the view ────────────────────────────────────────────────────

describe("the Post-Death tab's outcome buttons", () => {
	it("offers a Ghost's Terrible Purpose its five outcomes, in play, to its owner", async () => {
		const { char } = makeUndead("ghost", { counts: { "terrible-purpose:longing": 1, "consequences:breakdown": 1 }, debilities: ["dazed"] });
		const view = await tabView(char);
		const [purpose] = view.outcomes.rows;
		expect(purpose.title).toBe("Terrible Purpose: LONGING");
		expect(purpose.actions.map(a => a.action)).toEqual(["regain-all", "clear-all", "clear-consequence", "mark-consequence", "last-door"]);
		expect(purpose.actions.every(a => !a.disabled)).toBe(true);
		expect(purpose.actions.find(a => a.action === "last-door").danger).toBe(true);
	});

	it("says why an outcome has nothing to do, rather than hiding it", async () => {
		const { char } = makeUndead("revenant", { counts: { "terrible-purpose:duty": 1 }, hp: 16 });
		const actions = Object.fromEntries((await tabView(char, { hp: 16 })).outcomes.rows[0].actions.map(a => [a.action, a]));
		expect(actions["regain-all"]).toMatchObject({ disabled: true, reason: "Already at full HP." });
		expect(actions["clear-all"].disabled).toBe(true);
		// Only the Final Consequence could be "cleared", and it never is.
		expect(actions["clear-consequence"].disabled).toBe(true);
		expect(actions["mark-consequence"].disabled).toBe(false);
	});

	it("gives SPECTER, STRANGE APPETITES and INSATIABLE their own rows only once marked", async () => {
		const ghost = (await tabView(makeUndead("ghost", { counts: { "consequences:specter": 1 } }).char)).outcomes.rows;
		expect(ghost.map(r => r.title)).toEqual(["SPECTER"]);
		expect(ghost[0].actions.map(a => a.label)).toEqual(["Regain 1d8 HP", "Clear a debility"]);

		const revenant = (await tabView(makeUndead("revenant", {
			counts: { "consequences:strange-appetites": 1, "consequences:insatiable": 1 },
		}).char)).outcomes.rows;
		expect(revenant.map(r => r.actions.map(a => a.action))).toEqual([["heal-half", "clear-debility"], ["indulge"]]);

		expect((await tabView(makeUndead("ghost").char)).outcomes).toBeNull();
	});

	it("offers nothing in edit mode, to a viewer who can't write, or to someone out of play", async () => {
		const { char } = makeUndead("ghost", { counts: { "terrible-purpose:longing": 1 } });
		expect((await tabView(char, { editMode: true })).outcomes).toBeNull();
		expect((await tabView(char, { canEdit: false })).outcomes).toBeNull();
		expect((await tabView(char, { outOfPlay: true })).outcomes).toBeNull();
	});
});

// ── R-PURPOSE: pressing them ───────────────────────────────────────────────

describe("pressing an outcome", () => {
	// The Unliving's own healing: Recover and magical healing are closed to them, this is not.
	it("regains all HP for a Ghost, in one write, and tells the table", async () => {
		const { actor, char } = makeUndead("ghost", { counts: { "terrible-purpose:longing": 1 }, hp: 3 });
		actor.update.mockClear();
		const lines = await runPostDeathOutcome(char, "regain-all", { source: "LONGING" });
		expect(actor.system.attributes.hp.value).toBe(16);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.update.mock.calls[0][1]).toEqual({ stonetopMove: "LONGING" });
		expect(lines[0]).toContain("<strong>3</strong> &rarr; <strong>16</strong>");
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("LONGING");
	});

	it("clears every marked debility", async () => {
		const { actor, char } = makeUndead("revenant", { debilities: ["weakened", "miserable"] });
		await runPostDeathOutcome(char, "clear-all", { source: "DUTY" });
		const opts = actor.system.attributes.debilities.options;
		expect([opts.weakened.value, opts.dazed.value, opts.miserable.value]).toEqual([false, false, false]);
	});

	it("clears one chosen consequence, never offering the Final one", async () => {
		const { actor, char } = makeUndead("ghost", {
			counts: { "consequences:breakdown": 1, "consequences:quarry": 1, "consequences:final-consequence": 1 },
		});
		const unmark = vi.spyOn(char, "unmarkSectionOption");
		const wait = pressLabelled("Clear QUARRY");
		await runPostDeathOutcome(char, "clear-consequence", { source: "LONGING" });
		expect(wait.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Clear BREAKDOWN", "Clear QUARRY", "Never mind"]);
		expect(unmark).toHaveBeenCalledWith("consequences", "quarry");
		expect(count(actor, "consequences:quarry")).toBe(0);
		expect(count(actor, "consequences:breakdown")).toBe(1);
	});

	// UndeathDialog's rule: `requires` honoured, and the Final Consequence never a choice. Through
	// markSectionOption, which is where a Consequence that brings a move hands it over.
	it("marks a chosen consequence from the ones that may be taken", async () => {
		const { actor, char } = makeUndead("revenant", { counts: { "consequences:quarry": 1 } });
		const mark = vi.spyOn(char, "markSectionOption");
		const wait = pressLabelled("Mark NIGHTKIN");
		await runPostDeathOutcome(char, "mark-consequence", { source: "VENGEANCE" });
		const offered = wait.mock.calls[0][0].buttons.map(b => b.label);
		expect(offered).toContain("Mark BREAKDOWN");
		expect(offered).not.toContain("Mark UNSTABLE");
		expect(offered).not.toContain("Mark INSATIABLE");
		expect(offered).not.toContain("Mark QUARRY");
		expect(offered).not.toContain("Mark THE FINAL CONSEQUENCE");
		expect(mark).toHaveBeenCalledWith("consequences", "nightkin");
		expect(count(actor, "consequences:nightkin")).toBe(1);
	});

	it("writes nothing when the picker is closed", async () => {
		const { actor, char } = makeUndead("revenant");
		pressLabelled(null);
		actor.update.mockClear();
		expect(await runPostDeathOutcome(char, "mark-consequence", { source: "DUTY" })).toBeNull();
		expect(actor.update).not.toHaveBeenCalled();
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("passes through the Last Door only once asked, naming the outcome", async () => {
		const { actor, char } = makeUndead("ghost", { counts: { "terrible-purpose:duty": 1 } });
		stubConfirm(false);
		expect(await runPostDeathOutcome(char, "last-door", { source: "DUTY" })).toBeNull();
		expect(flag(actor, "deathsDoor")).toBeUndefined();

		const wait = stubConfirm(true);
		await runPostDeathOutcome(char, "last-door", { source: "DUTY" });
		expect(wait.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Pass through the Last Door", "Not yet, they stay"]);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.DEAD);
	});

	it("rolls SPECTER's 1d8 where the table sees it and heals by it, capped at max", async () => {
		const toMessage = vi.fn(async () => ({}));
		global.Roll = class { async evaluate() { this.total = 7; return this; } toMessage(...a) { return toMessage(...a); } };
		const { actor, char } = makeUndead("ghost", { counts: { "consequences:specter": 1 }, hp: 12 });
		await runPostDeathOutcome(char, "regain-d8", { source: "SPECTER" });
		expect(actor.system.attributes.hp.value).toBe(16);
		// On the house roll card, not core's bare dice block: the total, and where HP went.
		const flavor = toMessage.mock.calls[0][0].flavor;
		expect(flavor).toContain("stonetop-roll-card");
		expect(flavor).toContain(">7<");
		expect(flavor).toContain("HP 12 → 16");
		// The dice card says it; no second card.
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("heals STRANGE APPETITES by half max HP, rounded up, as a gain", async () => {
		const { actor, char } = makeUndead("revenant", { counts: { "consequences:strange-appetites": 1 }, hp: 2, max: 15 });
		await runPostDeathOutcome(char, "heal-half", { source: "STRANGE APPETITES" });
		expect(actor.system.attributes.hp.value).toBe(10);
	});

	it("holds an advantage for INSATIABLE, named for it", async () => {
		const { char } = makeUndead("revenant", { counts: { "consequences:insatiable": 1 } });
		await runPostDeathOutcome(char, "indulge", { source: "INSATIABLE" });
		expect(char.heldAdvantage()).toEqual({ sources: ["Insatiable"], source: "Insatiable" });
	});

	it("clears the one debility chosen", async () => {
		const { actor, char } = makeUndead("ghost", { counts: { "consequences:specter": 1 }, debilities: ["weakened", "dazed"] });
		pressLabelled("Clear Dazed");
		await runPostDeathOutcome(char, "clear-debility", { source: "SPECTER" });
		const opts = actor.system.attributes.debilities.options;
		expect([opts.weakened.value, opts.dazed.value]).toEqual([true, false]);
	});
});

// The sheet's render builds the insert's questions and the tab's buttons from one read of each section.
describe("one render's reads", () => {
	it("reads each section once for the questions and the tab together", async () => {
		const { char } = makeUndead("revenant", { counts: { "consequences:breakdown": 1 } });
		const read = vi.spyOn(char, "sectionOptions");
		const sections = sectionReader(char);
		await buildPostDeathChoices(char, { sections });
		await tabView(char, { sections });
		const bySection = read.mock.calls.map(([section]) => section);
		expect(bySection.filter(section => section === "consequences")).toHaveLength(1);
		expect(new Set(bySection).size).toBe(bySection.length);
	});
});

// ── B12: edit mode's ticks and cautions ────────────────────────────────────

describe("edit mode on the insert's lists", () => {
	it("asks before THE FINAL CONSEQUENCE, then marks it and sets dead in ONE write", async () => {
		const { actor, char } = makeUndead("ghost");
		stubConfirm(false);
		expect(await tickInsertLore(char, { section: "consequences", option: "final-consequence", count: 1 })).toBe(false);
		expect(count(actor, "consequences:final-consequence")).toBe(0);

		actor.update.mockClear();
		const wait = stubConfirm(true);
		expect(await tickInsertLore(char, { section: "consequences", option: "final-consequence", count: 1 })).toBe(true);
		expect(wait.mock.calls[0][0].buttons[0].label).toBe("Mark it: they become a monster");
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(count(actor, "consequences:final-consequence")).toBe(1);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.DEAD);
		expect(char.lostToTheGm).toBe("monster");
	});

	// Asks first (the user's call, 2026-09-30): taking it back returns a monster to the party.
	it("takes THE FINAL CONSEQUENCE back once asked, and puts them back in play, in ONE write", async () => {
		const { actor, char } = makeUndead("ghost", {
			counts: { "consequences:final-consequence": 1 }, state: DEATHS_DOOR_STATE.DEAD,
		});
		stubConfirm(false);
		expect(await tickInsertLore(char, { section: "consequences", option: "final-consequence", count: 0 })).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
		expect(count(actor, "consequences:final-consequence")).toBe(1);

		const wait = stubConfirm(true);
		expect(await tickInsertLore(char, { section: "consequences", option: "final-consequence", count: 0 })).toBe(true);
		expect(wait.mock.calls[0][0].buttons[0].label).toBe("Unmark it: back in play");
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(count(actor, "consequences:final-consequence")).toBe(0);
		expect(flag(actor, "deathsDoor")).toBeNull();
		expect(char.lostToTheGm).toBeNull();
	});

	it("routes a Consequence or Mark tick through markSectionOption / unmarkSectionOption", async () => {
		const { char } = makeUndead("thrall");
		const mark = vi.spyOn(char, "markSectionOption");
		const unmark = vi.spyOn(char, "unmarkSectionOption");
		await tickInsertLore(char, { section: "marks", option: "red-wrath", count: 1 });
		await tickInsertLore(char, { section: "marks", option: "red-wrath", count: 0 });
		expect(mark).toHaveBeenCalledWith("marks", "red-wrath");
		expect(unmark).toHaveBeenCalledWith("marks", "red-wrath");
	});

	it("writes any other tick as the count it always was", async () => {
		const { actor, char } = makeUndead("thrall");
		await tickInsertLore(char, { section: "favor", option: "favor-track", count: 2 });
		expect(count(actor, "favor:favor-track")).toBe(2);
	});

	it("flags UNSTABLE without BREAKDOWN, and two Terrible Purposes, without blocking either", async () => {
		const { char } = makeUndead("revenant", {
			counts: { "consequences:unstable": 1, "terrible-purpose:longing": 1, "terrible-purpose:duty": 1 },
		});
		const view = await tabView(char, { editMode: true });
		const option = (section, slug) => view.lore.entries.find(e => e.slug === section).options.find(o => o.slug === slug);
		expect(option("consequences", "unstable").caution).toContain("UNSTABLE requires BREAKDOWN");
		expect(option("consequences", "breakdown").caution).toBeUndefined();
		expect(option("terrible-purpose", "longing").caution).toContain("LONGING & DUTY");
		expect(option("terrible-purpose", "duty").caution).toContain("Flagged, not blocked");
		expect(option("terrible-purpose", "vengeance").caution).toBeUndefined();
	});
});

// ── B13: the Thrall ────────────────────────────────────────────────────────

describe("the Thrall on the Post-Death tab", () => {
	it("draws Favor as hold pips in play, and leaves the track's own entry out of the list", async () => {
		const { char } = makeUndead("thrall", { counts: { "favor:favor-track": 2 } });
		const view = await tabView(char);
		expect(view.favor.pips.map(p => p.filled)).toEqual([true, true, false]);
		expect(view.favor.heldLabel).toBe("2 of 3 held");
		expect(view.favor.canSet).toBe(true);
		expect(view.lore.entries.map(e => e.slug)).not.toContain("favor");

		const edit = await tabView(char, { editMode: true });
		expect(edit.favor).toBeNull();
		expect(edit.lore.entries.map(e => e.slug)).toContain("favor");
		expect((await tabView(char, { canEdit: false })).favor.canSet).toBe(false);
	});

	// A ticked pip is HELD: ticking the third fills to 3, unticking the last held spends one.
	it("sets Favor from a pip through setFavor", async () => {
		const { actor, char } = makeUndead("thrall", { counts: { "favor:favor-track": 1 } });
		await setFavorFromPip(char, 2, false);
		expect(count(actor, "favor:favor-track")).toBe(3);
		await setFavorFromPip(char, 2, true);
		expect(count(actor, "favor:favor-track")).toBe(2);
		await setFavorFromPip(char, 0, true);
		expect(count(actor, "favor:favor-track")).toBe(0);
	});

	it("gives the GM a cross-off on each Mark neither held nor gone, and a Restore on each one gone", async () => {
		const { char } = makeUndead("thrall", { counts: { "marks:red-wrath": 1 }, insert: { crossedOff: ["ravenous"] } });
		const marks = gm => tabView(char, { editMode: true, isGM: gm })
			.then(v => v.lore.entries.find(e => e.slug === "marks").options);
		const gmMarks = await marks(true);
		const by = slug => gmMarks.find(o => o.slug === slug);
		expect(by("red-wrath").pdiMarkControl).toBeUndefined();
		expect(by("ravenous").pdiMarkControl).toMatchObject({ action: "uncross", text: "Restore" });
		expect(by("ravenous").pdiMarkControl.label).toContain("Restore RAVENOUS");
		expect(by("death-mask").pdiMarkControl).toMatchObject({ action: "cross-off", text: "Cross off" });
		expect(by("death-mask").pdiMarkControl.label).toContain("Cross off DEATH MASK");
		expect((await marks(false)).some(o => o.pdiMarkControl)).toBe(false);
	});

	it("crosses a Mark off and takes it back", async () => {
		const { actor, char } = makeUndead("thrall");
		await char.crossOffMark("ravenous");
		await char.crossOffMark("death-mask");
		expect(await char.restoreCrossedOffMark("ravenous")).toBe(true);
		expect(flag(actor, "postDeathInsert").crossedOff).toEqual(["death-mask"]);
		await char.restoreCrossedOffMark("death-mask");
		expect(flag(actor, "postDeathInsert").crossedOff).toBeUndefined();
		expect(await char.restoreCrossedOffMark("death-mask")).toBe(false);
	});

	it("offers the owner Gain a Mark (Favor's \"of your choice\"), and gains the one chosen", async () => {
		const { actor, char } = makeUndead("thrall", { counts: { "marks:red-wrath": 1 }, insert: { crossedOff: ["ravenous"] } });
		expect((await tabView(char, { canEdit: true })).gainMark).toBe(true);
		expect((await tabView(char, { canEdit: false })).gainMark).toBe(false);

		const wait = pressLabelled("Gain DEATH MASK");
		await gainThrallMark(char);
		const offered = wait.mock.calls[0][0].buttons.map(b => b.label);
		expect(offered).not.toContain("Gain RED WRATH");
		expect(offered).not.toContain("Gain RAVENOUS");
		expect(count(actor, "marks:death-mask")).toBe(1);
	});

	// Favor's overflow: "reduce your Favor to 0 and choose 1: ... Gain a new Mark of your choice".
	it("resets Favor to 0 in the Mark's own write", async () => {
		const { actor, char } = makeUndead("thrall", { counts: { "marks:red-wrath": 1, "favor:favor-track": 3 } });
		pressLabelled("Gain DEATH MASK");
		const done = await gainThrallMark(char);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(count(actor, "marks:death-mask")).toBe(1);
		expect(count(actor, "favor:favor-track")).toBe(0);
		expect(done.lines.join(" ")).toContain("Favor reset to");
	});

	// Dark Succor: "Your master gives you a task; until you complete it, your Favor stays at 0." Flagged,
	// never blocked: the pips still set, and Favor held anyway wears the caution.
	it("flags Favor held while the master's task stands, and never blocks it", async () => {
		const { actor, char } = makeUndead("thrall", { insert: { task: "Bring me the bell" } });
		const view = await tabView(char);
		expect(view.favor.canSet).toBe(true);
		expect(view.favor.heldLabel).toBe("Held at 0 until your master's task is done");
		expect(view.favor.caution).toBe("");
		await setFavorFromPip(char, 2, false);
		expect(count(actor, "favor:favor-track")).toBe(3);
		const held = await tabView(char);
		expect(held.favor.heldLabel).toBe("3 of 3 held");
		expect(held.favor.caution).toContain("master's task");
	});

	it("wears no caution on Favor with no task standing", async () => {
		const { char } = makeUndead("thrall", { counts: { "favor:favor-track": 2 } });
		expect((await tabView(char)).favor.caution).toBe("");
	});

	// Unholy Vessel: "When you would gain a Mark but there are none left to gain".
	it("resolves Gain a Mark with none left as Unholy Vessel, once asked", async () => {
		const held = Object.fromEntries(THRALL_MARKS.slice(0, 8).map(slug => [`marks:${slug}`, 1]));
		const { actor, char } = makeUndead("thrall", { counts: held, insert: { crossedOff: ["torments-blessing"] } });

		stubConfirm(false);
		expect(await gainThrallMark(char)).toBeNull();
		expect(flag(actor, "deathsDoor")).toBeUndefined();

		const wait = stubConfirm(true);
		const done = await gainThrallMark(char);
		expect(wait.mock.calls[0][0].buttons[0].label).toBe("Lose your humanity");
		expect(done.unholyVessel).toBe(true);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.DEAD);
		expect(char.lostToTheGm).toBe("threat");
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("humanity is utterly lost");
	});

	it("unsets the master's task once it is confirmed done", async () => {
		const { actor, char } = makeUndead("thrall", { insert: { task: "Bring me the bell" } });
		expect((await tabView(char)).taskComplete).toBe(true);

		stubConfirm(false);
		expect(await completeMasterTask(char)).toBe(false);
		expect(char.masterTask).toBe("Bring me the bell");

		const wait = stubConfirm(true);
		expect(await completeMasterTask(char)).toBe(true);
		expect(wait.mock.calls[0][0].buttons[0].label).toBe("Task complete: clear it");
		expect(flag(actor, "postDeathInsert").task).toBeUndefined();
		expect((await tabView(char)).taskComplete).toBe(false);
	});
});
