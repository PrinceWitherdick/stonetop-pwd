import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import {
	DEATHS_DOOR_ROLL_STALE_MS,
	DEATHS_DOOR_STATE,
	PAST_DEATH_KINDS,
	POST_DEATH_INSERT_SLUGS,
	ZERO_HP_MOVES,
	ZERO_HP_RESOLUTIONS,
	canFaceDeathsDoor,
	deathsDoorClaimRuling,
	deathsDoorRollOptions,
	deathsDoorRollWatch,
	effectiveDeathsDoorState,
	hardToKillTradeOpen,
	nextDeathsDoorState,
	pastDeathClasses,
	pastDeathKind,
	raisedFromDead,
	zeroHpMove,
} from "../../../module/actors/character/deaths-door.js";
import {
	DeathsDoorDialog,
	DEATHS_DOOR_FATES,
	DEATHS_DOOR_REFUSAL_INSERTS,
	DEATHS_DOOR_TIERS,
} from "../../../module/actors/character/dialogs/DeathsDoorDialog.js";
import { formatOutcomeDetail } from "../../../module/utils/strings.js";

describe("POST_DEATH_INSERT_SLUGS — the closed set of fates", () => {
	it("is the book's three, in the order Death's Door offers them", () => {
		expect(POST_DEATH_INSERT_SLUGS).toEqual(["revenant", "ghost", "thrall"]);
	});

	// Anything that lists the inserts and anything that routes a 0-HP move must agree on which
	// inserts exist, or a character could hold a fate with no move behind it.
	it("matches the inserts the 0-HP routing and resolution tables know", () => {
		const routed = Object.keys(ZERO_HP_MOVES).filter(k => k !== "null");
		expect([...routed].sort()).toEqual([...POST_DEATH_INSERT_SLUGS].sort());
		expect(Object.keys(ZERO_HP_RESOLUTIONS).sort()).toEqual([...POST_DEATH_INSERT_SLUGS].sort());
	});
});

describe("zeroHpMove — which move 0 HP actually triggers", () => {
	it("is Death's Door for a character with no post-death insert", () => {
		expect(zeroHpMove(null).name).toBe("Death's Door");
		expect(zeroHpMove(null).dialog).toBe(true);
	});

	// The whole point of the routing table: an undead PC does NOT roll Death's Door again.
	it("is the insert's own move once the character carries one", () => {
		expect(zeroHpMove("revenant").name).toBe("Undying");
		expect(zeroHpMove("ghost").name).toBe("Tethered");
		expect(zeroHpMove("thrall").name).toBe("Dark Succor");
	});

	it("never offers the Death's Door walkthrough to a character with an insert", () => {
		for (const slug of ["revenant", "ghost", "thrall"]) {
			expect(zeroHpMove(slug).dialog).toBe(false);
		}
	});

	it("falls back to Death's Door for an unknown (homebrew) insert rather than nothing", () => {
		expect(zeroHpMove("wight").name).toBe("Death's Door");
	});

	it("only rolls a stat the system can actually read", () => {
		// The Thrall's +Favor lives on the insert, not on the character's stats — the routing
		// table says so rather than faking it.
		expect(ZERO_HP_MOVES.thrall.roll.stat).toBeNull();
		expect(ZERO_HP_MOVES.revenant.roll.stat).toBe("con");
		expect(ZERO_HP_MOVES.ghost.roll).toBeNull();
	});
});

describe("nextDeathsDoorState", () => {
	it("makes a character dying when they are reduced to 0 HP", () => {
		expect(nextDeathsDoorState({ oldHp: 4, newHp: 0, state: null })).toBe(DEATHS_DOOR_STATE.DYING);
	});

	it("treats negative HP as 0 for the transition", () => {
		expect(nextDeathsDoorState({ oldHp: 2, newHp: -3, state: null })).toBe(DEATHS_DOOR_STATE.DYING);
	});

	it("leaves an already-dying character dying when they take another hit", () => {
		const state = DEATHS_DOOR_STATE.DYING;
		expect(nextDeathsDoorState({ oldHp: 0, newHp: 0, state })).toBe(state);
	});

	it("clears dying when they are patched up before facing the move", () => {
		expect(nextDeathsDoorState({ oldHp: 0, newHp: 3, state: DEATHS_DOOR_STATE.DYING })).toBeNull();
	});

	// "Out of the action until you say otherwise" is the GM's to lift, not HP's.
	it("keeps out-of-action standing even after they regain HP", () => {
		const state = DEATHS_DOOR_STATE.OUT_OF_ACTION;
		expect(nextDeathsDoorState({ oldHp: 0, newHp: 5, state })).toBe(state);
	});

	it("makes an out-of-action character dying again if they are dropped to 0 a second time", () => {
		expect(nextDeathsDoorState({ oldHp: 5, newHp: 0, state: DEATHS_DOOR_STATE.OUT_OF_ACTION }))
			.toBe(DEATHS_DOOR_STATE.DYING);
	});

	it("never revives a character who stepped through the Last Door", () => {
		const state = DEATHS_DOOR_STATE.DEAD;
		expect(nextDeathsDoorState({ oldHp: 0, newHp: 10, state })).toBe(state);
		expect(nextDeathsDoorState({ oldHp: 10, newHp: 0, state })).toBe(state);
	});

	// Healing someone mid-conversation can't retract the 6- they already rolled.
	it("holds a pending fate through any HP change", () => {
		const state = DEATHS_DOOR_STATE.FATE_PENDING;
		expect(nextDeathsDoorState({ oldHp: 0, newHp: 6, state })).toBe(state);
		expect(nextDeathsDoorState({ oldHp: 6, newHp: 0, state })).toBe(state);
	});
});

// The "is this the moment they became dying?" question used to live in a `becameDying` helper
// here, read from preUpdate. The card now waits for the committed diff and keys off the state
// flag arriving as `dying` (see DeathsDoorPrompt.onUpdateActorDeathsDoorCard), which is the same
// transition read one beat later — and `nextDeathsDoorState` above is what decides it, so the
// cases that mattered (already down, healing, already dead) are covered by its own block.

describe("canFaceDeathsDoor", () => {
	it("is true at 0 HP with the move still to face", () => {
		expect(canFaceDeathsDoor({ hp: 0, state: DEATHS_DOOR_STATE.DYING })).toBe(true);
	});

	// The bug this state exists to prevent: a 7-9 leaves them at 0 HP but expressly not dying,
	// so a bare `hp <= 0` gate would let them roll the same brush with death over and over.
	it("is false after a 7-9, even though they are still at 0 HP", () => {
		expect(canFaceDeathsDoor({ hp: 0, state: DEATHS_DOOR_STATE.OUT_OF_ACTION })).toBe(false);
	});

	it("is false for a character who is up", () => {
		expect(canFaceDeathsDoor({ hp: 5, state: null })).toBe(false);
	});

	it("is false for a character who has died", () => {
		expect(canFaceDeathsDoor({ hp: 0, state: DEATHS_DOOR_STATE.DEAD })).toBe(false);
	});

	// The roll is spent; what's left is the choice of fate, not another chance at it.
	it("is false once a 6- is rolled and the fate is still to be chosen", () => {
		expect(canFaceDeathsDoor({ hp: 0, state: DEATHS_DOOR_STATE.FATE_PENDING })).toBe(false);
	});
});

// Taking an insert used to be two writes, and a reload could land between them (2026-08-08, in
// play): the Ghost was granted and the `fate-pending` from the 6- was left standing. Every reader
// then said Death's Door was still owed by a character who had just answered it — a Ghost at 0 HP
// was offered the fate fork again instead of Tethered. The write is one update now; this is what
// heals the sheets it already happened to.
describe("effectiveDeathsDoorState — an insert IS the fate", () => {
	it("drops a fate-pending left standing beside an insert", () => {
		for (const slug of POST_DEATH_INSERT_SLUGS) {
			expect(effectiveDeathsDoorState({ state: DEATHS_DOOR_STATE.FATE_PENDING, insertSlug: slug })).toBe(null);
		}
	});

	it("leaves a real fate-pending alone", () => {
		expect(effectiveDeathsDoorState({ state: DEATHS_DOOR_STATE.FATE_PENDING, insertSlug: null }))
			.toBe(DEATHS_DOOR_STATE.FATE_PENDING);
	});

	// A homebrew insert isn't one of the book's three fates, so it can't be the answer to a 6-.
	// Reinterpreting on any truthy slug would strand such a character with no fate to choose.
	it("leaves it alone for an insert Death's Door never offered", () => {
		expect(effectiveDeathsDoorState({ state: DEATHS_DOOR_STATE.FATE_PENDING, insertSlug: "wight" }))
			.toBe(DEATHS_DOOR_STATE.FATE_PENDING);
	});

	// Only that one pairing is reinterpreted: a dispersed Ghost is out of the action, and having
	// an insert doesn't make that untrue.
	it("passes every other state through, insert or not", () => {
		for (const state of [null, DEATHS_DOOR_STATE.DYING, DEATHS_DOOR_STATE.OUT_OF_ACTION, DEATHS_DOOR_STATE.DEAD]) {
			expect(effectiveDeathsDoorState({ state, insertSlug: "ghost" })).toBe(state);
			expect(effectiveDeathsDoorState({ state, insertSlug: null })).toBe(state);
		}
	});

	it("answers for a caller that passes nothing", () => {
		expect(effectiveDeathsDoorState()).toBe(null);
	});
});

describe("pastDeathKind — who the log should mark as dead", () => {
	it("is null for the living", () => {
		expect(pastDeathKind({})).toBe(null);
		expect(pastDeathKind({ state: null, insertSlug: null })).toBe(null);
	});

	it("is 'dead' for a character who stepped through the Last Door", () => {
		expect(pastDeathKind({ state: DEATHS_DOOR_STATE.DEAD })).toBe("dead");
	});

	it("is the insert slug for each of the book's three fates", () => {
		for (const slug of POST_DEATH_INSERT_SLUGS) {
			expect(pastDeathKind({ insertSlug: slug })).toBe(slug);
		}
	});

	// The whole point of being narrower than "has been at 0 HP": each of these can still be
	// walked back, and marking a PC as dead mid-conversation would be the system calling it
	// before the table has.
	it("is null for every brush with death that can still be walked back", () => {
		for (const state of [
			DEATHS_DOOR_STATE.DYING,
			DEATHS_DOOR_STATE.FATE_PENDING,
			DEATHS_DOOR_STATE.OUT_OF_ACTION,
		]) {
			expect(pastDeathKind({ state })).toBe(null);
		}
	});

	// A homebrew slug has no insert behind it, so it can't name a fate; falling back to the
	// state keeps a genuinely dead character marked rather than reporting them as living.
	it("ignores a slug that isn't one of the three", () => {
		expect(pastDeathKind({ insertSlug: "lich" })).toBe(null);
		expect(pastDeathKind({ insertSlug: "lich", state: DEATHS_DOOR_STATE.DEAD })).toBe("dead");
	});

	// They died, but "Ghost" is what they are now.
	it("prefers the insert over the state when a sheet somehow carries both", () => {
		expect(pastDeathKind({ state: DEATHS_DOOR_STATE.DEAD, insertSlug: "ghost" })).toBe("ghost");
	});
});

describe("PAST_DEATH_KINDS — every answer a sheet has to be able to clear", () => {
	// The sheet clears all of them and sets one, so a list short of an answer pastDeathKind can
	// give would leave a raised character still wearing the modifier of what they used to be.
	it("covers everything pastDeathKind returns", () => {
		expect(PAST_DEATH_KINDS).toEqual([...POST_DEATH_INSERT_SLUGS, "dead"]);
	});
});

describe("pastDeathClasses — the pair a window is stamped with", () => {
	it("names the repaint and the kind that tints it", () => {
		expect(pastDeathClasses("ghost")).toEqual(["stonetop-past-death", "stonetop-past-death--ghost"]);
	});

	// The black is for a plain death too now (2026-08-08, at the user's request). It used to stop
	// at the three inserts, so this is the case that would silently regress.
	it("stamps a character who died and stayed dead", () => {
		expect(pastDeathClasses("dead")).toEqual(["stonetop-past-death", "stonetop-past-death--dead"]);
	});

	// Spread onto a window's own classes unconditionally, so the empty case has to be a list.
	it("is empty for the living", () => {
		expect(pastDeathClasses(null)).toEqual([]);
	});
});

describe("raisedFromDead — the one transition that walks `dead` back", () => {
	const dead = DEATHS_DOOR_STATE.DEAD;

	it("is true when hit points appear on a sheet through the Last Door", () => {
		expect(raisedFromDead({ oldHp: 0, newHp: 4, state: dead })).toBe(true);
	});

	// Recognising the TRANSITION, not the condition: a second write while they are already up
	// would otherwise ask again, every time.
	it("is false for a write that finds them already above 0", () => {
		expect(raisedFromDead({ oldHp: 4, newHp: 6, state: dead })).toBe(false);
	});

	it("is false while they stay at or below 0", () => {
		expect(raisedFromDead({ oldHp: 0, newHp: 0, state: dead })).toBe(false);
		expect(raisedFromDead({ oldHp: -2, newHp: -1, state: dead })).toBe(false);
	});

	// Every other state has its own way back and doesn't need asking about: a dying character
	// healed above 0 was simply patched up before they faced the move.
	it("is false for anyone who isn't dead", () => {
		for (const state of [null, DEATHS_DOOR_STATE.DYING, DEATHS_DOOR_STATE.OUT_OF_ACTION, DEATHS_DOOR_STATE.FATE_PENDING]) {
			expect(raisedFromDead({ oldHp: 0, newHp: 4, state })).toBe(false);
		}
	});
});

describe("deathsDoorRollOptions — the Heavy's two modifiers", () => {
	it("offers only +nothing by default", () => {
		const opts = deathsDoorRollOptions(["Dangerous", "Armored"], {});
		expect(opts.hardToKill).toBe(false);
		expect(opts.statChoices).toEqual([{ stat: "", label: "+nothing" }]);
		expect(opts.penalty).toBe(0);
		// Nothing opened a choice up, so there's no move for the dialog to explain.
		expect(opts.statChoiceMove).toBeNull();
	});

	it("offers +CON as well with Hard to Kill, with +nothing still first", () => {
		const opts = deathsDoorRollOptions(["Hard to Kill"], {});
		expect(opts.hardToKill).toBe(true);
		expect(opts.statChoices.map(c => c.stat)).toEqual(["", "con"]);
	});

	it("names the move that opened the choice up, so the dialog can print its description", () => {
		expect(deathsDoorRollOptions(["Hard to Kill"], {}).statChoiceMove).toBe("Hard to Kill");
		// The canonical spelling, not whatever case the owned copy happens to carry — the lookup
		// on the other side is case-insensitive, and the label reads better spelled properly.
		expect(deathsDoorRollOptions(["hard to kill"], {}).statChoiceMove).toBe("Hard to Kill");
	});

	it("matches the move name case-insensitively", () => {
		expect(deathsDoorRollOptions(["hard to kill"], {}).hardToKill).toBe(true);
	});

	it("charges -1 per circle marked on Unstoppable", () => {
		const opts = deathsDoorRollOptions(["Hard to Kill", "Unstoppable"], { Unstoppable: 3 });
		expect(opts.unstoppableMarks).toBe(3);
		expect(opts.penalty).toBe(-3);
	});

	it("ignores a stored count for a character who doesn't have Unstoppable", () => {
		const opts = deathsDoorRollOptions(["Hard to Kill"], { Unstoppable: 3 });
		expect(opts.penalty).toBe(0);
	});

	it("treats a missing or junk mark count as no penalty", () => {
		expect(deathsDoorRollOptions(["Unstoppable"], {}).penalty).toBe(0);
		expect(deathsDoorRollOptions(["Unstoppable"], { Unstoppable: "x" }).penalty).toBe(0);
		expect(deathsDoorRollOptions(["Unstoppable"], { Unstoppable: -2 }).penalty).toBe(0);
	});
});

// The same two moves on a live Heavy: only LEARNED ones bend the roll. A player can switch a move
// off and keep it on the sheet, and an un-ticked Hard to Kill or Unstoppable must do nothing here.
describe("StonetopCharacter#deathsDoorRollOptions: learned moves only", () => {
	function heavy({ hardToKill = true, unstoppable = true, marks = 0 } = {}) {
		const def = name => structuredClone(sourceMovesFor("The Heavy").find(d => d.name === name).system);
		const off = { "stonetop-pwd": { learned: false } };
		const built = buildLiveCharacter({
			slug: "the-heavy", name: "The Heavy",
			items: [makeLiveItem({ name: "Unstoppable", type: "move", system: def("Unstoppable"), flags: unstoppable ? {} : off })],
			flags: marks ? { "moves.backgroundChoices": { Unstoppable: marks } } : {},
		});
		if (!hardToKill) built.actor.items.find(i => i.name === "Hard to Kill").flags["stonetop-pwd"].learned = false;
		return built;
	}
	const marksOf = actor => actor.flags["stonetop-pwd"].moves?.backgroundChoices?.Unstoppable ?? 0;

	it("offers +CON and charges the circles with both learned", () => {
		const opts = heavy({ marks: 2 }).char.deathsDoorRollOptions();
		expect(opts.hardToKill).toBe(true);
		expect(opts.penalty).toBe(-2);
	});

	it("offers no +CON and no debility trade with Hard to Kill switched off", () => {
		const opts = heavy({ hardToKill: false }).char.deathsDoorRollOptions();
		expect(opts.hardToKill).toBe(false);
		expect(opts.statChoices).toEqual([{ stat: "", label: "+nothing" }]);
	});

	it("charges no penalty for the circles of an Unstoppable switched off", () => {
		expect(heavy({ unstoppable: false, marks: 3 }).char.deathsDoorRollOptions().penalty).toBe(0);
	});

	it("clears the circles it charged for, and only those", async () => {
		const learned = heavy({ marks: 3 });
		expect(await learned.char.clearUnstoppableCircles()).toBe(3);
		expect(marksOf(learned.actor)).toBe(0);

		const off = heavy({ unstoppable: false, marks: 3 });
		expect(await off.char.clearUnstoppableCircles()).toBe(0);
		expect(marksOf(off.actor)).toBe(3);
	});

	// The Heavy's Guardian is a rule too (+1 Readiness on every Defend), so it asks the same way.
	it("gives Guardian's extra Readiness only while Guardian is learned", () => {
		const guardian = learned => makeLiveItem({ name: "Guardian", type: "move", system: {}, flags: learned ? {} : { "stonetop-pwd": { learned: false } } });
		expect(buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", items: [guardian(true)] }).char.hasGuardianMove).toBe(true);
		expect(buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", items: [guardian(false)] }).char.hasGuardianMove).toBe(false);
	});
});

// Hard to Kill is "when you are at Death's Door, you can roll +CON": its roll IS Death's Door's, which
// the walkthrough already folds it into. Rolled on its own it posted a +CON card that changed nothing
// and doubled the real roll, so every roll path (the Moves tab, the hotbar, the fight ring) opens the
// walkthrough instead, or says why nothing rolls.
describe("rolling Hard to Kill opens Death's Door instead", () => {
	let saved;
	beforeEach(() => {
		saved = { ui: globalThis.ui, document: globalThis.document };
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
		// Enough of a DOM for the hotbar's detached stand-in row (_makeSyntheticRollable).
		globalThis.document = { createElement: () => {
			const el = { dataset: {}, className: "", textContent: "", parent: null, kids: [] };
			el.append = (...k) => { for (const c of k) { c.parent = el; el.kids.push(c); } };
			el.closest = sel => (sel === ".item" ? (el.dataset.itemId ? el : el.parent?.closest(sel) ?? null) : null);
			el.classList = { contains: c => el.className.split(" ").includes(c) };
			return el;
		} };
	});
	afterEach(() => { globalThis.ui = saved.ui; globalThis.document = saved.document; });

	function sheetFor({ hp = 8, state = null } = {}) {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", flags: state ? { deathsDoor: state } : {} });
		actor.system.attributes.hp = { value: hp, max: 20 };
		actor.typedActor = char;
		actor.items.get = id => actor.items.find(i => i.id === id);
		const Base = class {
			constructor() { this._actor = actor; }
			get actor() { return this._actor; }
			get isEditable() { return true; }
			activateListeners() {}
			render = vi.fn();
		};
		const sheet = new (createStonetopCharacterSheetClass(Base))();
		sheet._stonetopCharacter = char;
		sheet._onDeathsDoorOpen = vi.fn();
		char.onRoll = vi.fn();
		const hardToKill = actor.items.find(i => i.name === "Hard to Kill");
		return { sheet, char, hardToKill };
	}

	it("opens the walkthrough for a Heavy who is dying, and rolls nothing on its own", async () => {
		const { sheet, char, hardToKill } = sheetFor({ hp: 0, state: DEATHS_DOOR_STATE.DYING });
		await sheet.rollMoveById(hardToKill.id);
		expect(sheet._onDeathsDoorOpen).toHaveBeenCalledTimes(1);
		expect(char.onRoll).not.toHaveBeenCalled();
	});

	it("says why nothing rolls for a Heavy who is not at Death's Door", async () => {
		const { sheet, char, hardToKill } = sheetFor();
		await sheet.rollMoveById(hardToKill.id);
		expect(sheet._onDeathsDoorOpen).not.toHaveBeenCalled();
		expect(char.onRoll).not.toHaveBeenCalled();
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("not at Death's Door"));
	});

	// Audit DD-5: the 7-9's trade, once the Death's Door window that rolled it has gone (closed, or the GM's).
	describe("Hard to Kill's 7-9 trade on the Death's Door card", () => {
		beforeEach(() => { globalThis.ChatMessage = { create: vi.fn(async d => d), getSpeaker: () => ({}) }; });
		afterEach(() => { delete globalThis.ChatMessage; });
		const card = sheet => sheet._buildDeathsDoorData({ vitals: { hp: { value: 0, max: 20 } } });

		it("offers each unmarked debility while the 7-9 left it open, and trades one for 1 HP", async () => {
			const { sheet, char } = sheetFor({ hp: 0, state: DEATHS_DOOR_STATE.OUT_OF_ACTION });
			expect(char.deathsDoorRollOptions().hardToKill).toBe(true);
			await sheet.actor.setFlag("stonetop-pwd", "hardToKillTrade", true);

			expect(card(sheet).hardToKillTrade.map(d => d.key)).toEqual(expect.arrayContaining(["weakened", "dazed", "miserable"]));

			await sheet._onHardToKillTrade({ currentTarget: { dataset: { debility: "dazed" } } });

			expect(sheet.actor.system.attributes.hp.value).toBe(1);
			expect(sheet.actor.system.attributes.debilities.options.dazed.value).toBe(true);
			expect(char.deathsDoorState).toBeNull();
			expect(sheet.actor.getFlag("stonetop-pwd", "hardToKillTrade")).toBeFalsy();
			expect(card(sheet).hardToKillTrade).toBeNull();
		});

		it("offers nothing out of the action that no 7-9 opened, and trades nothing from a stale card", async () => {
			const { sheet } = sheetFor({ hp: 0, state: DEATHS_DOOR_STATE.OUT_OF_ACTION });
			expect(card(sheet).hardToKillTrade).toBeNull();

			await sheet._onHardToKillTrade({ currentTarget: { dataset: { debility: "dazed" } } });

			expect(sheet.actor.system.attributes.hp.value).toBe(0);
			expect(sheet.actor.system.attributes.debilities.options.dazed.value).toBe(false);
		});
	});

	it("keeps no em dash in the move's own outcome lines", () => {
		for (const tier of Object.values(sourceMovesFor("The Heavy").find(d => d.name === "Hard to Kill").system.moveResults)) {
			expect(tier.value).not.toContain(String.fromCharCode(0x2014));
		}
	});
});

describe("hardToKillTradeOpen", () => {
	it("is open only out of the action, latched by a 7-9, with Hard to Kill learned", () => {
		const open = { state: DEATHS_DOOR_STATE.OUT_OF_ACTION, latched: true, hardToKill: true };
		expect(hardToKillTradeOpen(open)).toBe(true);
		expect(hardToKillTradeOpen({ ...open, latched: false })).toBe(false);
		expect(hardToKillTradeOpen({ ...open, hardToKill: false })).toBe(false);
		for (const state of [null, DEATHS_DOOR_STATE.DYING, DEATHS_DOOR_STATE.FATE_PENDING, DEATHS_DOOR_STATE.DEAD]) {
			expect(hardToKillTradeOpen({ ...open, state }), String(state)).toBe(false);
		}
	});
});

describe("the move's text stays the book's", () => {
	it("keeps Death's Door's trigger wording", () => {
		// The prompt card shows this verbatim, so a paraphrase here is a paraphrase at the table.
		expect(ZERO_HP_MOVES.null.trigger).toContain("you glimpse the Last Door and the Lady of Crows");
	});

	it("keeps each insert's 0-HP trigger wording", () => {
		expect(ZERO_HP_MOVES.revenant.trigger).toContain("regain half your max HP and choose 1");
		expect(ZERO_HP_MOVES.ghost.trigger).toContain("your essence disperses until the next sunset");
		expect(ZERO_HP_MOVES.thrall.trigger).toContain("your master intercedes on your behalf");
	});

	it("offers exactly the book's three fates on a 6-", () => {
		expect(DEATHS_DOOR_FATES.map(f => f.label)).toEqual([
			"Make one last move as if you rolled a 12+, then step through the Last Door",
			"Refuse to go; gain the Revenant or Ghost insert",
			"Call on one of the Things Below by name and beseech it to intercede; gain the Thrall insert",
		]);
	});

	it("grants the insert each fate actually names", () => {
		const byKey = Object.fromEntries(DEATHS_DOOR_FATES.map(f => [f.key, f.insert]));
		expect(byKey["last-door"]).toBeNull();      // stepping through grants nothing; they're dead
		expect(byKey.refuse).toBe("choice");        // Revenant or Ghost, the player picks
		expect(byKey.thrall).toBe("thrall");
		expect(DEATHS_DOOR_REFUSAL_INSERTS.map(i => i.slug)).toEqual(["revenant", "ghost"]);
	});
});

/**
 * The tier text reaches the chat card through moveResults, which formatOutcomeDetail escapes
 * and the card persists into a data-outcome-* attribute. An HTML entity or tag in there is
 * therefore double-escaped and prints as literal markup ("The Lady waves you off&mdash;you…"),
 * which is exactly what shipped before these landed.
 */
describe("Death's Door tier text survives the trip to a chat card", () => {
	// Exactly what DeathsDoorDialog._onRoll composes for moveResults[tier].value.
	const cardValue = (t) => (t.options ? `${t.text} ${t.options.join(" / ")}` : t.text);

	it("stores plain text, not HTML, in the tier strings", () => {
		for (const tier of DEATHS_DOOR_TIERS) {
			expect(tier.text, `${tier.label} carries an entity`).not.toMatch(/&[a-z]+;|&#/i);
			expect(tier.text, `${tier.label} carries a tag`).not.toMatch(/<[a-z/]/i);
		}
	});

	it("renders the book's real punctuation rather than an escaped entity", () => {
		const partial = DEATHS_DOOR_TIERS.find(t => t.key === "partial");
		const html = formatOutcomeDetail(cardValue(partial));
		expect(html).toContain("The Lady waves you off—you’re no longer dying");
		expect(html).not.toContain("&amp;");
	});

	it("breaks the 6-'s three fates onto their own lines instead of one run-on", () => {
		const failure = DEATHS_DOOR_TIERS.find(t => t.key === "failure");
		const html = formatOutcomeDetail(cardValue(failure));
		expect(html).toContain("stonetop-roll-result-picks");
		expect(html.match(/<li>/g) ?? []).toHaveLength(DEATHS_DOOR_FATES.length);
		// The fates' own semicolons must not be mistaken for separators.
		expect(html).toContain("Refuse to go; gain the Revenant or Ghost insert");
	});
});

/**
 * How dark the window goes. These assert the literal class names because that string IS the
 * contract with stonetop.css ("the dark comes in from the edges") — renaming one here without
 * renaming it there leaves the dialog painting a mood no rule answers to.
 */
describe("DeathsDoorDialog — the window's mood", () => {
	const dialogFor = (state = null) => new DeathsDoorDialog({ deathsDoorState: state }, () => {});

	// A stand-in window root: _paintMood only ever touches classList and reads a layout property.
	function fakeRoot() {
		const classes = new Set();
		return {
			classes,
			offsetWidth: 0,
			classList: {
				add:    (...c) => c.forEach(x => classes.add(x)),
				remove: (...c) => c.forEach(x => classes.delete(x)),
			},
		};
	}

	function paint(dlg) {
		dlg.element = dlg.element ?? [fakeRoot()];
		dlg._paintMood();
		return dlg.element[0].classes;
	}

	it("opens at dusk — the dice are still in hand", () => {
		expect(dialogFor()._mood()).toBe("deaths-door-mood--dusk");
	});

	it("brings the light back on a 10+", () => {
		const dlg = dialogFor();
		dlg._step = "result";
		dlg._rolledTotal = 11;
		expect(dlg._mood()).toBe("deaths-door-mood--returned");
	});

	it("drains the colour on a 7-9 — nothing was won there", () => {
		const dlg = dialogFor();
		dlg._step = "result";
		dlg._rolledTotal = 8;
		expect(dlg._mood()).toBe("deaths-door-mood--waved-off");
	});

	it("puts the lamp out on a 6-", () => {
		const dlg = dialogFor();
		dlg._step = "result";
		dlg._rolledTotal = 5;
		expect(dlg._mood()).toBe("deaths-door-mood--door");
	});

	it("keeps it out through the Refuse-to-Go fork", () => {
		const dlg = dialogFor();
		dlg._step = "fate";
		expect(dlg._mood()).toBe("deaths-door-mood--door");
	});

	// Reopened on an unresolved 6-: the roll is spent and there's no total left to classify,
	// but the character is still standing at the Door.
	it("reopens in the dark on a pending fate rather than at dusk", () => {
		expect(dialogFor(DEATHS_DOOR_STATE.FATE_PENDING)._mood()).toBe("deaths-door-mood--door");
	});

	it("paints exactly one mood at a time — a re-roll never leaves the old one behind", () => {
		const dlg = dialogFor();
		expect(paint(dlg)).toContain("deaths-door-mood--dusk");

		dlg._step = "result";
		dlg._rolledTotal = 5;
		const classes = paint(dlg);
		expect(classes).toContain("deaths-door-mood--door");
		expect(classes).not.toContain("deaths-door-mood--dusk");
	});

	// The blackout is a one-shot on the roll that lands the miss. Recording a fate re-renders
	// the same step, and replaying the lights going out on every click would be absurd.
	it("stamps the entering class on a mood change and not on a re-render within it", () => {
		const dlg = dialogFor();
		paint(dlg);
		dlg._step = "result";
		dlg._rolledTotal = 5;
		expect(paint(dlg)).toContain("deaths-door-mood-entering");
		expect(paint(dlg)).not.toContain("deaths-door-mood-entering");
	});
});

/**
 * The roll in progress, as every other owner's window reads it. The window is one client's and the character
 * stays dying until the tier lands, so this decides whether a window offers dice, waits, resumes or may take over.
 */
describe("deathsDoorRollWatch: what a window makes of a roll under way", () => {
	const DYING = DEATHS_DOOR_STATE.DYING;
	const marker = (over = {}) => ({ userId: "p1", userName: "Aline", nonce: "n1", at: 1_000, ...over });
	const watch = (over = {}) => deathsDoorRollWatch({ marker: marker(), state: DYING, me: "gm", holderActive: true, now: 2_000, ...over });

	it("follows another owner's live roll", () => {
		expect(watch()).toMatchObject({ kind: "watch", marker: { userId: "p1" } });
	});

	it("honours a marker only while the character is dying, and not one set aside", () => {
		for (const state of [null, DEATHS_DOOR_STATE.OUT_OF_ACTION, DEATHS_DOOR_STATE.FATE_PENDING, DEATHS_DOOR_STATE.DEAD]) {
			expect(watch({ state }).kind).toBe("none");
		}
		expect(watch({ marker: null }).kind).toBe("none");
		expect(watch({ marker: { userId: "p1" } }).kind).toBe("none");   // no nonce: not a roll
		expect(watch({ ignoredNonce: "n1" }).kind).toBe("none");
	});

	it("is the window's own roll only while its name is still on it", () => {
		expect(watch({ me: "p1", ownNonce: "n1" }).kind).toBe("own");
		// Taken over: the same roll under another name is someone else's again.
		expect(watch({ me: "p1", ownNonce: "n1", marker: marker({ userId: "gm", userName: "GM" }) }).kind).toBe("watch");
	});

	it("resumes this user's roll that no window here holds, and follows the one that still does", () => {
		expect(watch({ me: "p1" }).kind).toBe("resume");
		expect(watch({ me: "p1", heldHere: true }).kind).toBe("watch");
	});

	it("may be taken over once its roller has left, or it has sat untouched too long", () => {
		expect(watch({ holderActive: false })).toMatchObject({ kind: "orphaned", reason: "away" });
		expect(watch({ now: 1_000 + DEATHS_DOOR_ROLL_STALE_MS }).kind).toBe("watch");
		expect(watch({ now: 1_001 + DEATHS_DOOR_ROLL_STALE_MS })).toMatchObject({ kind: "orphaned", reason: "stale" });
	});
});

/**
 * The primary GM's ruling on a claim, one claim at a time: the lock that makes two owners' presses of Roll inside
 * one round trip into one roll. Read from the claimant's side of deathsDoorRollWatch.
 */
describe("deathsDoorClaimRuling: the GM's lock on a roll", () => {
	const DYING = DEATHS_DOOR_STATE.DYING;
	const marker = (over = {}) => ({ userId: "p1", userName: "Aline", nonce: "n1", at: 1_000, ...over });
	const rule = (over = {}) => deathsDoorClaimRuling({
		marker: null, state: DYING, userId: "p2", nonce: "n2", holderActive: true, now: 2_000, ...over,
	});

	it("grants the first claim, with nothing under way", () => {
		expect(rule()).toEqual({ granted: true, holder: null });
	});

	it("refuses a second claim while the first is live, naming who holds it", () => {
		expect(rule({ marker: marker() })).toEqual({ granted: false, holder: marker() });
	});

	it("refuses every claim once the Door is settled, or before anyone is dying", () => {
		for (const state of [null, DEATHS_DOOR_STATE.OUT_OF_ACTION, DEATHS_DOOR_STATE.FATE_PENDING, DEATHS_DOOR_STATE.DEAD]) {
			expect(rule({ state })).toEqual({ granted: false, holder: null });
		}
		expect(rule({ userId: null }).granted).toBe(false);
		expect(rule({ nonce: null }).granted).toBe(false);
	});

	it("grants a fresh roll over one nobody is finishing, unless it reached the table", () => {
		expect(rule({ marker: marker(), holderActive: false }).granted).toBe(true);
		expect(rule({ marker: marker(), now: 1_001 + DEATHS_DOOR_ROLL_STALE_MS }).granted).toBe(true);
		// Posted: that roll is spent, and is taken over and accepted, never rolled again.
		expect(rule({ marker: marker(), holderActive: false, posted: true })).toEqual({ granted: false, holder: marker() });
		// The same user's own posted roll (a reload): picked back up, not rolled again either.
		expect(rule({ marker: marker({ userId: "p2" }), posted: true }).granted).toBe(false);
		expect(rule({ marker: marker({ userId: "p2" }) }).granted).toBe(true);
	});

	it("grants a stale roll to the taker, and only the roll the taker saw left behind", () => {
		const stale = { marker: marker(), now: 1_001 + DEATHS_DOOR_ROLL_STALE_MS, takeOver: true };
		expect(rule({ ...stale, nonce: "n1" })).toEqual({ granted: true, holder: null });
		expect(rule({ marker: marker(), holderActive: false, takeOver: true, nonce: "n1" }).granted).toBe(true);
		// Its roller came back to it meanwhile: live again, and theirs.
		expect(rule({ marker: marker(), takeOver: true, nonce: "n1" })).toEqual({ granted: false, holder: marker() });
		// Another owner took it first: live under their name.
		const takenFirst = marker({ userId: "p3", userName: "Cal", at: 1_001 + DEATHS_DOOR_ROLL_STALE_MS });
		expect(rule({ ...stale, marker: takenFirst, nonce: "n1" })).toEqual({ granted: false, holder: takenFirst });
		// It landed (the marker is gone), or a different roll stands now.
		expect(rule({ ...stale, marker: null, nonce: "n1" }).granted).toBe(false);
		expect(rule({ ...stale, nonce: "other" }).granted).toBe(false);
		// Already the taker's: granted again, so a repeated ask changes nothing.
		expect(rule({ marker: marker({ userId: "p2" }), takeOver: true, nonce: "n1" }).granted).toBe(true);
	});
});
