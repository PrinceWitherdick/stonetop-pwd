import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { Window } from "happy-dom";
import { stubConfirm } from "../../fakes/confirm.js";
import { createStonetopCharacterSheetClass, woundEditPatch } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { WoundDialog } from "../../../module/actors/character/dialogs/WoundDialog.js";
import {FakeActorBuilder} from "../../fakes/FakeActorBuilder.js";
import { DEATHS_DOOR_STATE, zeroHpMove, zeroHpResolution } from "../../../module/actors/character/deaths-door.js";

// The people picker Castigate asks "who did you Censure?" with. Replaced so a test can answer it (or
// back out) without a window; the rest of the module is the real one.
const picker = vi.hoisted(() => ({ pick: vi.fn(async () => null) }));
vi.mock("../../../module/dialogs/RelationshipLinkDialog.js", async (importOriginal) => ({
	...(await importOriginal()),
	pickPersonOnMap: picker.pick,
}));

// -- Helpers ------------------------------------------------------------------

function makeCharacterMock(actor) {
	const background = {
		selectBackground: vi.fn(async slug => actor.setFlag("stonetop-pwd", "background.selected", slug)),
		addChoice: vi.fn(),
		selectedSlug: actor.getFlag("stonetop-pwd", "background.selected") ?? "",
		choices: {},
	};
	const instinct = { select: vi.fn(), selectedValue: "" };
	const appearance = {
		select: vi.fn(async (lineIdx, value) => {
			const saved = actor.getFlag("stonetop-pwd", "appearance.selected") ?? {};
			actor.setFlag("stonetop-pwd", "appearance.selected", { ...saved, [lineIdx]: value });
		}),
		saved: actor.getFlag("stonetop-pwd", "appearance.selected") ?? {},
	};
	const origin = { select: vi.fn() };
	// The holy light is live state, not a stub return: getData reads the getter and the
	// handlers write through the setter, so both have to see the same value or the
	// "already lit, so don't re-render" assertions can't be written at all.
	let lit = false;
	// Writable, so a test can be a NON-Lightbearer. Hardcoding it true made the "show" half
	// of the context assertion unfailable — it would have passed with `show` wired to a
	// constant.
	let canWield = true;
	// The Judge's brand roster, on exactly the same terms as the holy light above: live state
	// rather than a stub return, and a writable `canCondemn` so a test can be a non-Judge. The
	// real getter always answers an ARRAY, so the sheet reads `.length` off it without a guard —
	// a stub returning undefined here would be the only thing in the world that could break that.
	let brands = [];
	let canBrand = true;
	// The Judge's SECOND standing list (Binding Arbitration), the Blessed's marks and the Heavy's
	// Battle Joy, all on the same terms as the two above: live state, and a writable "can they" so
	// a test can be a character who owns none of it. Each real getter always answers an array (or a
	// boolean), which is why the sheet reads `.length` off them with no guard.
	let oaths = [];
	let canSwear = false;
	let marks = [];
	let canMark = false;
	let raging = false;
	let canRage = false;
	// An advantage HELD over the next roll (Make Camp's peaceful night). Live for the reason the
	// rest are: getData draws the header glyph off it and the release control clears it, and the
	// rule that releasing takes the glyph off is only assertable if the two share a value. Null
	// rather than absent, matching the real accessor, which always answers the object or null.
	let held = null;
	let heldDis = null;
	// The Invocation being held open, live for the same reason the holy light is: getData reads
	// the getter, the End control and the candle both write through the setter, and the rule that
	// a snuffed light takes the Invocation with it is only assertable if the two share a value.
	let ongoing = "";
	return {
		background,
		instinct,
		appearance,
		origin,
		get holyLight() { return lit; },
		// Not a getter on the real class — see headerGlyphOwnership below. Kept here as the knob
		// the tests turn, because "this character can wield a holy light" is what they mean.
		get canWieldHolyLight() { return canWield; },
		set canWieldHolyLight(value) { canWield = !!value; },
		get condemned() { return brands; },
		set condemned(value) { brands = Array.isArray(value) ? value : []; },
		get canCondemn() { return canBrand; },
		set canCondemn(value) { canBrand = !!value; },
		get oaths() { return oaths; },
		set oaths(value) { oaths = Array.isArray(value) ? value : []; },
		get canBindOaths() { return canSwear; },
		set canBindOaths(value) { canSwear = !!value; },
		get blessedMarks() { return marks; },
		set blessedMarks(value) { marks = Array.isArray(value) ? value : []; },
		get canMarkBlessed() { return canMark; },
		set canMarkBlessed(value) { canMark = !!value; },
		get battleJoy() { return raging; },
		// A METHOD, matching the real accessor's signature, for the reason headerGlyphOwnership
		// below is one: a getter here would keep passing while the sheet called a function.
		// `holdAdvantage` is the tests' knob rather than a setter of the same name, which cannot
		// share a key with the method in one object literal.
		heldAdvantage: () => held,
		holdAdvantage: (value) => { held = value ?? null; },
		clearHeldAdvantage: vi.fn(async () => { held = null; }),
		heldDisadvantage: () => heldDis,
		holdDisadvantage: (value) => { heldDis = value ?? null; },
		clearHeldDisadvantage: vi.fn(async () => { heldDis = null; }),
		get canEnterBattleJoy() { return canRage; },
		set canEnterBattleJoy(value) { canRage = !!value; },
		// What getData actually reads for the five header glyphs — the real one answers all five
		// from a single walk of the items, and takes that walk from the sheet. A METHOD, matching
		// the real signature: a getter here would keep passing while the sheet called a function.
		// Derived from the same live values the individual getters above expose, so a test that
		// writes `canCondemn = false` still moves it.
		//
		// This mock re-implements the mapping, so it cannot catch two of the five keys being
		// swapped in the real getter — tests/actors/character/header-glyph-ownership.test.js
		// pins that against the real predicates.
		headerGlyphOwnership: () => ({
			holyLight: canWield,
			condemn:   canBrand,
			oaths:     canSwear,
			battleJoy: canRage,
			blessed:   canMark,
		}),
		setBattleJoy: vi.fn(async value => {
			const changed = !!value !== raging;
			raging = !!value;
			return changed;
		}),
		get ongoingInvocation() { return ongoing; },
		setOngoingInvocation: vi.fn(async slug => {
			const next = String(slug ?? "");
			const changed = next !== ongoing;
			ongoing = next;
			return changed;
		}),
		// One slot is all these tests drive; the two-slot rules are ongoing-invocation.test.js's.
		get ongoingInvocationSecond() { return ""; },
		get ongoingInvocationEmpowered() { return false; },
		endOngoingInvocation: vi.fn(async () => {
			const had = ongoing;
			ongoing = "";
			return { changed: !!had, ended: had ? [had] : [], snuffed: false };
		}),
		setHolyLight: vi.fn(async value => {
			const changed = !!value !== lit;
			lit = !!value;
			// The real model drops the Invocation with the light — "it will end immediately if
			// your holy light is extinguished" — so the fake has to as well, or the sheet's own
			// handling of that would be tested against a model that never let go.
			const dropped = !value && !!ongoing;
			if (dropped) ongoing = "";
			return changed || dropped;
		}),
		onRoll: vi.fn(async () => true),
		ensureStartingMoves: vi.fn(),
		ensurePossessionGrants: vi.fn(),
		backgroundState: () => ({ slug: background.selectedSlug, setupChoices: {} }),
		backgroundMovesDropped: vi.fn(async () => []),
		settleBackgroundMoves: vi.fn(async () => {}),
		settleBackgroundPossessions: vi.fn(async () => {}),
		settleBackgroundArcana: vi.fn(async () => {}),
		settleBackgroundResources: vi.fn(async () => {}),
		// A background that leaves a move's answer to the player asks it; none here.
		backgroundAnswerAsks: vi.fn(async () => []),
		// A Seeker background's major arcanum is settled and asked for; not a Seeker here.
		settleSeekerMajorOnBackground: vi.fn(async () => ({ plan: "none", offered: [] })),
		// _onBackgroundChange looks the new background up for neighbors it names; none here.
		playbook: vi.fn(async () => null),
		clearPlaybookData: vi.fn(async () => {}),
		updateName: vi.fn(async name => actor.update({ name })),
		addMove: vi.fn(),
		removeMove: vi.fn(),
		addArcanum: vi.fn(async () => {}),
		addDroppedInventoryItem: vi.fn(async () => {}),
		// _onDropItemCreate reads this to skip re-adding an already-owned arcanum; an
		// empty Set means every dropped card counts as new (matches the real getter,
		// which returns a Set of owned slugs).
		ownedArcanaSlugs: new Set(),
		onDropMove: vi.fn(async () => false),
		setPostDeathInsert: vi.fn(async () => {}),
		moveResources: { add: vi.fn() },
		buildSnapshot: vi.fn(async () => ({})),
		setInventoryResource: vi.fn(),
		inventoryResourceData: vi.fn((slug, count) => ({ [`flags.stonetop-pwd.inventory.resources.${slug}`]: count })),
		// The live hit points and the COMPUTED max, as Recover and Convalesce read them at the press.
		get hp() { return Number(actor.system?.attributes?.hp?.value) || 0; },
		computedMaxHp: vi.fn(async () => Number(actor.system?.attributes?.hp?.max) || 0),
		// Not dying unless a test says so (the real getter reads HP 0 and the `dying` state).
		canFaceDeathsDoor: false,
		zeroHpMove: { name: "Death's Door" },
		// The real one falls back to the Lightbearer's list for anyone with Invoke the Sun God;
		// these tests only ever hand it a playbook that carries its own.
		invocationSource: vi.fn(async playbookDoc => playbookDoc?.invocations?.options?.length ? playbookDoc.invocations : null),
		// Likewise the Crew insert: the real one borrows the Marshal's for anyone with Crew learned.
		crewSource: vi.fn(async playbookDoc => playbookDoc?.crew ?? null),
	};
}

function recoverSnapshot({ hpValue = 4, hpMax = 8, smallItemLimit = 5 } = {}) {
	return { vitals: { hp: { value: hpValue, max: hpMax } }, inventory: { smallItemLimit } };
}

function makeActor() {
	const actor = new FakeActorBuilder().build();
	actor.id = "actor-1";
	actor.isOwner = true;
	actor.typedActor = makeCharacterMock(actor);
	return actor;
}

function installGetDataGlobals() {
	global.foundry.utils.setProperty ??= (obj, path, value) => {
		const parts = String(path).split(".");
		let current = obj;
		for (const key of parts.slice(0, -1)) {
			current[key] ??= {};
			current = current[key];
		}
		current[parts.at(-1)] = value;
	};
	global.game.settings ??= { get: () => false };
	global.game.user ??= { isGM: true, getFlag: () => ({}) };
	// getData enriches the Notes-tab HTML; passthrough in the test env (no real editor).
	global.foundry.applications ??= {};
	global.foundry.applications.ux ??= {};
	global.foundry.applications.ux.TextEditor ??= { enrichHTML: async value => value };
}

function minimalSheetSnapshot(movelist) {
	return {
		playbook: null,
		movelist,
		vitals: { armor: 0, xp: { value: 0, max: 8 }, hp: { value: 8, max: 8 }, damage: "d4" },
		inventory: { smallItemLimit: null },
		postDeathInsert: null,
		crewBonuses: null,
		companionBonuses: null,
		arcana: {
			major: { hasOwned: false, items: [] },
			minor: { hasOwned: false, items: [] },
		},
	};
}

function makeSheet(actor) {
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
		async _onDropItemCreate() {}
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	return new Sheet();
}

// -- Event handler tests ------------------------------------------------------

// -- Item fixtures ------------------------------------------------------------

function makeArcanum(slug = "humble-broom") {
	return { type: "move", system: { moveType: "arcanum" }, flags: { stonetop: { slug } } };
}

function makeMove() {
	return { type: "move", system: { moveType: "basic" }, flags: {} };
}

function makeInventoryItem() {
	return { type: "move", name: "Rope", system: { moveType: "inventory" }, flags: { stonetop: { inventoryColumn: "regular", weight: 1 } } };
}

function makeNonMove() {
	return { type: "equipment", system: {}, flags: {} };
}

// -- Tests --------------------------------------------------------------------

describe("StonetopCharacterSheet event handlers", () => {
	it("shows the over-level moves warning until the current overage key is dismissed", async () => {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => minimalSheetSnapshot({
			levelMovesOverLimit: true,
			levelMovesOverageKey: "2:3:4",
		}));
		const sheet = makeSheet(actor);

		expect((await sheet.getData()).stonetop.movelist.showLevelMovesOverLimit).toBe(true);

		await actor.setFlag("stonetop-pwd", "moves.dismissedLevelOverage", "2:3:4");
		expect((await sheet.getData()).stonetop.movelist.showLevelMovesOverLimit).toBe(false);

		actor.typedActor.buildSnapshot = vi.fn(async () => minimalSheetSnapshot({
			levelMovesOverLimit: true,
			levelMovesOverageKey: "2:3:5",
		}));
		expect((await sheet.getData()).stonetop.movelist.showLevelMovesOverLimit).toBe(true);
	});

	// The "back is owed" strip carries the promise a 7-9 on the identifying Know Things roll
	// made (Book I p.440). It has to vanish the moment the back actually arrives, or it lies.
	describe("arcana identify context", () => {
		function arcanaSheet({ isGM = false, peek = false, revealed = [], card = {}, owns = true } = {}) {
			installGetDataGlobals();
			global.game.user = { isGM, getFlag: () => ({}) };
			global.game.settings = { get: (_scope, key) => (key === "arcanaPlayersSeeBothSides" ? peek : false) };
			const actor = makeActor();
			actor.isOwner = owns;
			actor.typedActor.playbook = vi.fn(async () => null);
			actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
			actor.typedActor.revealedArcanaSlugs = new Set(revealed);
			const snapshot = minimalSheetSnapshot({});
			snapshot.arcana.minor = { hasOwned: true, items: [{
				slug: "the-key", owned: true, identified: true, unlocked: false, backOwed: false,
				front: { title: "The Key", description: "<p>x</p>", unlock: {} }, back: {}, ...card,
			}] };
			actor.typedActor.buildSnapshot = vi.fn(async () => snapshot);
			return makeSheet(actor);
		}
		const cardOf = async sheet => (await sheet.getData()).stonetop.arcana.minor.items[0];

		it("shows the owner the back they are owed", async () => {
			const card = await cardOf(arcanaSheet({ card: { backOwed: true } }));
			expect(card.showBackOwed).toBe(true);
		});

		it("drops the strip once the back has actually arrived", async () => {
			for (const [label, opts] of [
				["revealed", { revealed: ["the-key"], card: { backOwed: true } }],
				["unlocked", { card: { backOwed: true, unlocked: true } }],
				["peek on",  { peek: true, card: { backOwed: true } }],
			]) {
				expect((await cardOf(arcanaSheet(opts))).showBackOwed, label).toBe(false);
			}
		});

		it("carries no GM-side strip: the footer's reveal toggle settles the debt", async () => {
			const card = await cardOf(arcanaSheet({ isGM: true, card: { backOwed: true } }));
			expect(card.showBackOwed).toBe(false);
			expect(card.canReveal).toBe(true);
		});

		/**
		 * revealArcanum is the ONLY thing that clears backOwed, and the footer's reveal toggle is the
		 * GM's only route to it. Gated on secretive mode alone, the debt was stranded with the
		 * world's peek switch on: nobody could settle it, and the day the switch went off the owner's
		 * sheet went back to claiming a back they had been reading for sessions.
		 */
		it("still offers the GM the reveal toggle for an owed back while players can already peek", async () => {
			expect((await cardOf(arcanaSheet({ isGM: true, peek: true, card: { backOwed: true } }))).canReveal).toBe(true);
			expect((await cardOf(arcanaSheet({ isGM: true, peek: true }))).canReveal).toBe(false);
			// An unlocked card's back is the owner's already, so there is nothing left to reveal.
			expect((await cardOf(arcanaSheet({ isGM: true, peek: true, card: { backOwed: true, unlocked: true } }))).canReveal).toBe(false);
		});

		/**
		 * A player with Observer permission on somebody else's sheet fails permittedBack for the same
		 * reason a locked-out owner does — but the strip addresses its reader in the second person
		 * ("You've read the front…") over a Study it button that _onArcanumStudyBack drops on the
		 * spot, since the sheet isn't theirs to edit. Nothing happened and nothing said why.
		 */
		it("keeps the owed-back strip off a non-owning viewer's copy of the sheet", async () => {
			const card = await cardOf(arcanaSheet({ owns: false, card: { backOwed: true } }));
			expect(card.showBackOwed).toBe(false);
		});

		it("offers the no-roll hand-over to the GM only", async () => {
			expect((await cardOf(arcanaSheet({ isGM: true }))).canGiveCard).toBe(true);
			expect((await cardOf(arcanaSheet({ isGM: false }))).canGiveCard).toBe(false);
		});
	});

	it("_onBackgroundChange calls selectBackground with the slug", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onBackgroundChange({ currentTarget: { value: "vessel" } });
		expect(actor.typedActor.background.selectBackground).toHaveBeenCalledWith("vessel");
	});

	// The one helper that takes back the old background's move and grants the new one's, handed
	// the background as it was before the change.
	it("_onBackgroundChange settles the background's moves after selecting it", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onBackgroundChange({ currentTarget: { value: "vessel" } });
		expect(actor.typedActor.settleBackgroundMoves).toHaveBeenCalledWith({ slug: "", setupChoices: {} });
		expect(actor.typedActor.background.selectBackground.mock.invocationCallOrder[0])
			.toBeLessThan(actor.typedActor.settleBackgroundMoves.mock.invocationCallOrder[0]);
		// ...and the special possessions it hands over (the Missionary's aviary), the same way.
		expect(actor.typedActor.settleBackgroundPossessions).toHaveBeenCalledWith({ slug: "", setupChoices: {} });
		// ...and the arcanum (the Storm-Marked's Storm Markings).
		expect(actor.typedActor.settleBackgroundArcana).toHaveBeenCalledWith({ slug: "", setupChoices: {} });
	});

	it("_onAppearanceChange calls appearance.select with lineIdx and value", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onAppearanceChange({ currentTarget: { dataset: { line: "0" }, value: "gray & wizened" } });
		expect(actor.typedActor.appearance.select).toHaveBeenCalledWith(0, "gray & wizened");
	});

	// One appearance line, one value: the row's suggestions and its write-in box are the two
	// ways to set it, so choosing either has to clear the other. These fakes stand in for the
	// row because the suite runs without a DOM — what matters is that the handlers reach for
	// the row and blank/untick what they find.
	function fakeAppearanceRow() {
		const custom = { value: "old text" };
		const radios = [{ checked: true }, { checked: false }];
		return {
			custom, radios,
			el: { querySelector: () => custom, querySelectorAll: () => radios },
		};
	}
	const inRow = (row, line, value) => ({
		currentTarget: { dataset: { line: String(line) }, value, closest: () => row.el },
	});

	it("_onAppearanceCustomChange saves the written-in line, trimmed", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		const row   = fakeAppearanceRow();
		await sheet._onAppearanceCustomChange(inRow(row, 2, "  built like a barn door  "));
		expect(actor.typedActor.appearance.select).toHaveBeenCalledWith(2, "built like a barn door");
		expect(row.radios.every(r => r.checked === false)).toBe(true);
	});

	it("_onAppearanceCustomChange clears the line when the box is emptied", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onAppearanceCustomChange(inRow(fakeAppearanceRow(), 1, "   "));
		expect(actor.typedActor.appearance.select).toHaveBeenCalledWith(1, "");
	});

	it("_onAppearanceChange empties the row's write-in box", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		const row   = fakeAppearanceRow();
		await sheet._onAppearanceChange(inRow(row, 0, "gray & wizened"));
		expect(row.custom.value).toBe("");
		expect(actor.typedActor.appearance.select).toHaveBeenCalledWith(0, "gray & wizened");
	});

	it("appearance handlers still save when there is no row to tidy", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onAppearanceCustomChange({ currentTarget: { dataset: { line: "3" }, value: "sharp-eyed" } });
		expect(actor.typedActor.appearance.select).toHaveBeenCalledWith(3, "sharp-eyed");
	});

	it("_onOriginNameClick updates the actor name", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onOriginNameClick({ currentTarget: { value: "Arwel" } });
		expect(actor.typedActor.updateName).toHaveBeenCalledWith("Arwel");
	});
});

// The Lightbearer's holy light: the header candle, and the Consecrated Flame hook that
// lights it. This suite never drives activateListeners, so the handlers are called directly.
describe("StonetopCharacterSheet holy light candle", () => {
	const clickEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

	it("toggles the light and repaints the sheet", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);

		await sheet._onHolyLightToggle(clickEvent());
		expect(actor.typedActor.setHolyLight).toHaveBeenCalledWith(true);
		expect(sheet.render).toHaveBeenCalledWith(false);

		await sheet._onHolyLightToggle(clickEvent());
		expect(actor.typedActor.setHolyLight).toHaveBeenLastCalledWith(false);
	});

	it("leaves the light alone on a sheet the viewer can't edit", async () => {
		const actor = makeActor();
		const Base = class {
			constructor() { this._actor = actor; }
			get actor() { return this._actor; }
			get isEditable() { return false; }
			async getData() { return {}; }
			activateListeners() {}
			render = vi.fn();
		};
		const sheet = new (createStonetopCharacterSheetClass(Base))();
		await sheet._onHolyLightToggle(clickEvent());
		expect(actor.typedActor.setHolyLight).not.toHaveBeenCalled();
		expect(sheet.render).not.toHaveBeenCalled();
	});

	it("lights up when Consecrated Flame is used", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onDescriptionMoveUsed({ type: "move", name: "Consecrated Flame" });
		expect(actor.typedActor.setHolyLight).toHaveBeenCalledWith(true);
		expect(sheet.render).toHaveBeenCalledWith(false);
	});

	// One slot: "until the flame goes out or until you consecrate another flame". The second
	// consecration replaces the same light, so nothing is written and nothing repaints.
	it("doesn't repaint when the light is already burning", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onDescriptionMoveUsed({ type: "move", name: "Consecrated Flame" });
		sheet.render.mockClear();
		await sheet._onDescriptionMoveUsed({ type: "move", name: "Consecrated Flame" });
		expect(sheet.render).not.toHaveBeenCalled();
	});

	it("ignores any other move, a same-named non-move, and a row with no item at all", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onDescriptionMoveUsed({ type: "move", name: "Lamplighter" });
		await sheet._onDescriptionMoveUsed({ type: "item", name: "Consecrated Flame" });
		await sheet._onDescriptionMoveUsed(null);
		expect(actor.typedActor.setHolyLight).not.toHaveBeenCalled();
	});

	it("hands the header its state", async () => {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => minimalSheetSnapshot({}));
		const sheet = makeSheet(actor);

		// The keys as well as the state: which of the candle's four sentences it says is decided
		// HERE rather than branched in the template, so a wrong one is a wrong value rather than
		// wrong markup, and this is where it can be caught. `editable` is false on this fixture,
		// so the read-only faces are the ones expected.
		expect((await sheet.getData()).stonetop.holyLight).toEqual({
			show: true, lit: false,
			labelKey: "stonetop.holyLight.unlitLabel", tooltipKey: "stonetop.holyLight.readOnlyUnlit",
		});
		await sheet._onHolyLightToggle(clickEvent());
		expect((await sheet.getData()).stonetop.holyLight).toEqual({
			show: true, lit: true,
			labelKey: "stonetop.holyLight.litLabel", tooltipKey: "stonetop.holyLight.readOnlyLit",
		});

		// A sheet with no light-making move gets no candle — unless one is already burning,
		// which is the case that keeps a light stranded by a playbook swap snuffable.
		actor.typedActor.canWieldHolyLight = false;
		expect((await sheet.getData()).stonetop.holyLight).toMatchObject({ show: true, lit: true });
		await sheet._onHolyLightToggle(clickEvent());
		expect((await sheet.getData()).stonetop.holyLight).toMatchObject({ show: false, lit: false });
	});

	it("hands the header the Judge's brand count", async () => {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => minimalSheetSnapshot({}));
		const sheet = makeSheet(actor);
		const condemn = async () => (await sheet.getData()).stonetop.condemn;

		expect(await condemn()).toMatchObject({ show: true, count: 0, brands: 0 });
		actor.typedActor.condemned = [{ id: "a", name: "Brennan" }, { id: "b", name: "The Claws" }];
		expect(await condemn()).toMatchObject({ show: true, count: 2, brands: 2 });

		// A sheet that lost Condemn keeps the scales while brands still stand — otherwise a
		// playbook swap strands them with nothing left that could dismiss them.
		actor.typedActor.canCondemn = false;
		expect(await condemn()).toMatchObject({ show: true, count: 2, brands: 2 });
		actor.typedActor.condemned = [];
		expect(await condemn()).toMatchObject({ show: false, count: 0, brands: 0 });
	});

	// The scales' OTHER list. Binding Arbitration is enough on its own: a Judge who witnesses oaths
	// but has never taken Condemn has somewhere to keep them, and the count the glyph wears is both
	// lists together while only the brands colour it.
	it("opens the same scales for a Judge who only witnesses oaths", async () => {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => minimalSheetSnapshot({}));
		actor.typedActor.canCondemn = false;
		const sheet = makeSheet(actor);
		const condemn = async () => (await sheet.getData()).stonetop.condemn;

		expect(await condemn()).toMatchObject({ show: false, count: 0 });

		actor.typedActor.canBindOaths = true;
		expect(await condemn()).toMatchObject({
			show: true, count: 0, tooltipKey: "stonetop.condemn.noneTooltip",
		});

		actor.typedActor.oaths = [{ id: "o", name: "Gethin" }];
		expect(await condemn()).toMatchObject({
			show: true, count: 1, brands: 0, oaths: 1, tooltipKey: "stonetop.condemn.oathsTooltip",
		});

		// Both at once says both, and the badge is the sum.
		actor.typedActor.canCondemn = true;
		actor.typedActor.condemned = [{ id: "a", name: "Brennan" }];
		expect(await condemn()).toMatchObject({
			show: true, count: 2, brands: 1, oaths: 1, tooltipKey: "stonetop.condemn.bothTooltip",
		});

		// And an oath standing on a sheet that lost the move keeps the scales, so it can be released.
		actor.typedActor.canCondemn = false;
		actor.typedActor.canBindOaths = false;
		actor.typedActor.condemned = [];
		expect(await condemn()).toMatchObject({ show: true, count: 1, oaths: 1 });
	});

	// The Blessed's triquetra and the Heavy's Battle Joy, on the candle's and the scales' terms.
	it("hands the header the Blessed's marks and the Heavy's Battle Joy", async () => {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => minimalSheetSnapshot({}));
		const sheet = makeSheet(actor);
		const header = async () => (await sheet.getData()).stonetop;

		expect(await header()).toMatchObject({
			blessedMarks: { show: false, count: 0 },
			battleJoy:    { show: false, raging: false },
		});

		actor.typedActor.canMarkBlessed = true;
		actor.typedActor.canEnterBattleJoy = true;
		expect(await header()).toMatchObject({
			blessedMarks: { show: true, count: 0 },
			battleJoy:    { show: true, raging: false },
		});

		actor.typedActor.blessedMarks = [{ id: "m", kind: "barkskin", name: "Aeronwen" }];
		await sheet._stonetopCharacter.setBattleJoy(true);
		expect(await header()).toMatchObject({
			blessedMarks: { show: true, count: 1 },
			battleJoy:    { show: true, raging: true },
		});

		// Both survive losing the moves while their state stands: marks so they can be lifted, and
		// a rage because a stranded one would go on cancelling the character's debilities.
		actor.typedActor.canMarkBlessed = false;
		actor.typedActor.canEnterBattleJoy = false;
		expect(await header()).toMatchObject({
			blessedMarks: { show: true, count: 1 },
			battleJoy:    { show: true, raging: true },
		});
	});

	// An advantage held over the next roll (Make Camp's peaceful night, p.334). Unlike the five
	// glyphs above it is gated on NOTHING a character owns — anything may come to promise one —
	// so it appears exactly while one is held and goes when a roll spends it. Without a surface
	// the promise sat in a flag nobody could see, across sessions, until some roll ate it.
	it("shows the header a held advantage only while one is held, and names what promised it", async () => {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => minimalSheetSnapshot({}));
		const sheet = makeSheet(actor);
		const held = async () => (await sheet.getData()).stonetop.heldAdvantage;

		expect(await held()).toMatchObject({ show: false });

		actor.typedActor.holdAdvantage({ source: "A peaceful night's rest" });
		const shown = await held();
		expect(shown.show).toBe(true);
		// The whole value of storing WHAT promised it is that the hover can say so.
		expect(shown.tooltip).toContain("A peaceful night's rest");

		await sheet._stonetopCharacter.clearHeldAdvantage();
		expect(await held()).toMatchObject({ show: false });
	});

	// Releasing is not a toggle: it puts nothing back, so it asks first — and answering "keep
	// holding it" must leave the promise exactly where it was.
	it("asks before releasing a held advantage, and keeps it when the answer is no", async () => {
		const clickEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
		const actor = makeActor();
		const sheet = makeSheet(actor);
		actor.typedActor.holdAdvantage({ source: "A peaceful night's rest" });

		const kept = stubConfirm(false);
		await sheet._onReleaseHeldAdvantage(clickEvent());
		expect(kept).toHaveBeenCalledTimes(1);
		// Keeping it is the default: releasing puts nothing back.
		expect(kept.mock.calls[0][0].buttons.find(b => b.default)?.action).toBe("no");
		expect(sheet._stonetopCharacter.clearHeldAdvantage).not.toHaveBeenCalled();
		expect(sheet._stonetopCharacter.heldAdvantage()).not.toBeNull();

		stubConfirm(true);
		await sheet._onReleaseHeldAdvantage(clickEvent());
		expect(sheet._stonetopCharacter.clearHeldAdvantage).toHaveBeenCalled();
		expect(sheet._stonetopCharacter.heldAdvantage()).toBeNull();
	});

	// Its other half: Interfere's disadvantage, held until the foiled character's next roll. Shown and
	// released exactly as the advantage is, and on its own terms: letting one go keeps the other.
	it("shows the header a held disadvantage, names who laid it, and releases it on its own", async () => {
		installGetDataGlobals();
		const clickEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => minimalSheetSnapshot({}));
		const sheet = makeSheet(actor);
		const glyph = async () => (await sheet.getData()).stonetop.heldDisadvantage;

		expect(await glyph()).toMatchObject({ show: false });
		actor.typedActor.holdAdvantage({ source: "A peaceful night's rest" });
		actor.typedActor.holdDisadvantage({ source: "Interfered with by Bram" });
		const shown = await glyph();
		expect(shown.show).toBe(true);
		expect(shown.tooltip).toContain("Interfered with by Bram");

		const asked = stubConfirm(true);
		await sheet._onReleaseHeldDisadvantage(clickEvent());
		expect(asked.mock.calls[0][0].content).toContain("Interfered with by Bram");
		expect(sheet._stonetopCharacter.heldDisadvantage()).toBeNull();
		expect(sheet._stonetopCharacter.heldAdvantage()).not.toBeNull();
	});

	// Turning it ON is a declaration and writes nothing else; turning it OFF is the move's own
	// "when the action stops, roll +CON", so it asks rather than assuming.
	it("asks before ending a Battle Joy, and simply enters one", async () => {
		const clickEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
		const actor = makeActor();
		const sheet = makeSheet(actor);
		sheet.render = vi.fn();
		const asked = stubConfirm(false);

		await sheet._onBattleJoyToggle(clickEvent());
		expect(sheet._stonetopCharacter.battleJoy).toBe(true);
		expect(asked).not.toHaveBeenCalled();

		// No Battle Joy item on this fake actor, so there is nothing to roll and nothing to ask —
		// the state is simply put out, which is what a rage stranded by a playbook swap needs.
		await sheet._onBattleJoyToggle(clickEvent());
		expect(sheet._stonetopCharacter.battleJoy).toBe(false);
		expect(asked).not.toHaveBeenCalled();
	});

	// The ruling: a Heavy who is down stopped fighting when they dropped, so the lit glyph ends the
	// rage with no +CON roll and no question, and says so in chat.
	it("ends a downed Heavy's Battle Joy with no roll", async () => {
		const clickEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
		const actor = makeActor();
		actor.items = [{ id: "bj", type: "move", name: "Battle Joy", system: { rollType: "con" } }];
		actor.system.attributes.hp.value = 0;
		const sheet = makeSheet(actor);
		sheet.render = vi.fn();
		const asked = stubConfirm(true);
		const saved = globalThis.ChatMessage;
		globalThis.ChatMessage = { create: vi.fn(async data => data), getSpeaker: () => ({}) };
		try {
			await sheet._stonetopCharacter.setBattleJoy(true);
			await actor.setFlag("stonetop-pwd", "battleJoy", true);
			await sheet._onBattleJoyToggle(clickEvent());
			expect(asked).not.toHaveBeenCalled();
			expect(sheet._stonetopCharacter.onRoll).not.toHaveBeenCalled();
			expect(actor.getFlag("stonetop-pwd", "battleJoy")).toBeNull();
			expect(globalThis.ChatMessage.create.mock.calls[0][0].content).toContain("their Battle Joy ends, with no roll");
		} finally {
			globalThis.ChatMessage = saved;
		}
	});

	// The roll this glyph ends the rage WITH is a 2d6 move roll like any other, so it walks the
	// same pre-roll ladder every other one does — the guided/stat pickers, then the window that
	// asks how it is being rolled. It used to call onRoll bare, which made it the one move on the
	// sheet that could never take advantage, disadvantage, or a one-off modifier: the sticky sheet
	// control that used to carry those is gone, and that window is where they live now.
	it("asks how the ending Battle Joy is rolled, and leaves the rage standing on a cancel", async () => {
		const shiftClick = shiftKey => ({ preventDefault: vi.fn(), stopPropagation: vi.fn(), shiftKey });
		const actor = makeActor();
		actor.items = [{ id: "bj", type: "move", name: "Battle Joy", system: { rollType: "con" } }];
		const sheet = makeSheet(actor);
		sheet.render = vi.fn();
		stubConfirm(true);
		// Stubbed at the ladder, not below it: what is being pinned is that the header goes
		// THROUGH it and hands its answer on, which is the whole of the fix.
		const stand = { dataset: { roll: "con" } };
		sheet._makeSyntheticRollable = vi.fn(() => stand);
		sheet._resolveMoveRollPrompts = vi.fn(async () => ({ rollMode: "adv", situational: 1 }));

		await sheet._stonetopCharacter.setBattleJoy(true);
		await sheet._onBattleJoyToggle(shiftClick(true));
		// The Shift the glyph was clicked with rides along, so it skips the window here too.
		expect(sheet._resolveMoveRollPrompts).toHaveBeenCalledWith(stand, { shiftKey: true });
		expect(sheet._stonetopCharacter.onRoll)
			.toHaveBeenCalledWith({ currentTarget: stand }, { rollMode: "adv", situational: 1 });

		// Backing out of that window is a roll that never happened — and rolling it IS leaving it,
		// so the rage is still burning, the same answer Escape on the confirm gives.
		sheet._stonetopCharacter.onRoll.mockClear();
		sheet._resolveMoveRollPrompts = vi.fn(async () => "cancel");
		await sheet._stonetopCharacter.setBattleJoy(true);
		await sheet._onBattleJoyToggle(shiftClick(false));
		expect(sheet._stonetopCharacter.onRoll).not.toHaveBeenCalled();
		expect(sheet._stonetopCharacter.battleJoy).toBe(true);
		delete globalThis.Dialog;
	});
});

// Which Invocation the Lightbearer is holding open. The rules are ongoing-invocation.js's and the
// use flow is invocation-prompt.test.js's; what is covered here is the sheet's side — what the
// header is handed, and the two ways an Invocation stops that aren't "you used another one".
describe("StonetopCharacterSheet ongoing Invocation", () => {
	const clickEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

	function invokingSheet({ ongoing = "warmth-of-the-sun", lit = true } = {}) {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		// What _buildInvocationsData would have left behind on the last render.
		sheet._invocationOptions = [{ slug: "warmth-of-the-sun", label: "Warmth of the Sun", ongoing: true }];
		sheet._postMoveCard = vi.fn(async (title, body) => ({ title, body }));
		if (lit) actor.typedActor.setHolyLight(true);
		if (ongoing) actor.typedActor.setOngoingInvocation(ongoing);
		actor.typedActor.setHolyLight.mockClear();
		actor.typedActor.setOngoingInvocation.mockClear();
		return { actor, sheet };
	}

	it("hands the header the Invocation being held open, by name", async () => {
		installGetDataGlobals();
		const { actor, sheet } = invokingSheet({ ongoing: "" });
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => minimalSheetSnapshot({}));

		expect((await sheet.getData()).stonetop.ongoingInvocation)
			.toEqual({ active: false, slug: "", label: "" });
		await actor.typedActor.setOngoingInvocation("warmth-of-the-sun");
		expect((await sheet.getData()).stonetop.ongoingInvocation)
			.toEqual({ active: true, slug: "warmth-of-the-sun", label: "Warmth of the Sun" });
	});

	// The insert's "you start knowing 2" is the Lightbearer's; anyone else with Invoke the Sun God
	// starts knowing none (StonetopCharacter#invocationSource).
	it("says the Lightbearer starts knowing 2, and a borrower none", () => {
		installGetDataGlobals();
		const { sheet } = invokingSheet({ ongoing: "" });
		const raw = { startingCount: 2, options: [{ slug: "warmth-of-the-sun", label: "Warmth of the Sun" }] };
		expect(sheet._buildInvocationsData(raw).startingCount).toBe(2);
		expect(sheet._buildInvocationsData(raw, { borrowed: true }).startingCount).toBe(0);
	});

	// "You can end an Invocation whenever you wish" — one click, nothing to confirm. It posts,
	// unlike the candle: the candle is a tracker correction, but an Invocation ending is a thing
	// the table needs to hear about, because it was affecting the fiction.
	it("ends it on the End control, and says so", async () => {
		const { actor, sheet } = invokingSheet();
		await sheet._onEndOngoingInvocation(clickEvent());

		expect(actor.typedActor.endOngoingInvocation).toHaveBeenCalledWith("warmth-of-the-sun");
		expect(sheet.render).toHaveBeenCalledWith(false);
		expect(sheet._postMoveCard).toHaveBeenCalledTimes(1);
		expect(sheet._postMoveCard.mock.calls[0][1]).toMatch(/Warmth of the Sun<\/strong> ends\./);
	});

	// Two can run at once, each with its own End it: the control names which one it ends.
	it("ends the Invocation its control names", async () => {
		const { actor, sheet } = invokingSheet();
		await sheet._onEndOngoingInvocation({ ...clickEvent(), currentTarget: { dataset: { slug: "blinding-light" } } });
		expect(actor.typedActor.endOngoingInvocation).toHaveBeenCalledWith("blinding-light");
	});

	// Two controls for the one act (the header chip and the tab banner), and however many clients
	// have the sheet open. "It was running when I read it" is not the same question as "I am the
	// one who stopped it", so the card follows the WRITE — the table hears it stop once.
	it("says nothing when the write found the Invocation already ended", async () => {
		const { actor, sheet } = invokingSheet();
		actor.typedActor.endOngoingInvocation.mockResolvedValueOnce({ changed: false, ended: [], snuffed: false });

		await sheet._onEndOngoingInvocation(clickEvent());

		expect(sheet._postMoveCard).not.toHaveBeenCalled();
		expect(sheet.render).not.toHaveBeenCalled();
	});

	it("says nothing when the snuffed light's Invocation was already let go", async () => {
		const { actor, sheet } = invokingSheet();
		actor.typedActor.setOngoingInvocation.mockResolvedValueOnce(false);

		await sheet._onHolyLightToggle(clickEvent());

		expect(sheet._postMoveCard).not.toHaveBeenCalled();
	});

	it("does nothing when there's no Invocation to end", async () => {
		const { actor, sheet } = invokingSheet({ ongoing: "" });
		await sheet._onEndOngoingInvocation(clickEvent());
		expect(actor.typedActor.setOngoingInvocation).not.toHaveBeenCalled();
		expect(sheet._postMoveCard).not.toHaveBeenCalled();
	});

	it("offers no End to a viewer who can't edit the sheet", async () => {
		const actor = makeActor();
		const Base = class {
			constructor() { this._actor = actor; }
			get actor() { return this._actor; }
			get isEditable() { return false; }
			async getData() { return {}; }
			activateListeners() {}
			render = vi.fn();
		};
		const sheet = new (createStonetopCharacterSheetClass(Base))();
		sheet._postMoveCard = vi.fn(async () => {});
		await actor.typedActor.setOngoingInvocation("warmth-of-the-sun");
		await sheet._onEndOngoingInvocation(clickEvent());
		expect(actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
		expect(sheet._postMoveCard).not.toHaveBeenCalled();
	});

	// "It will end immediately if your holy light is extinguished." The model drops it; the sheet's
	// job is to have read the name BEFORE the write, so there is still something to name.
	it("reports the Invocation the snuffed light took with it", async () => {
		const { actor, sheet } = invokingSheet();
		await sheet._onHolyLightToggle(clickEvent());

		expect(actor.typedActor.ongoingInvocation).toBe("");
		expect(sheet._postMoveCard).toHaveBeenCalledTimes(1);
		expect(sheet._postMoveCard.mock.calls[0][1]).toMatch(/Warmth of the Sun<\/strong> ends. The holy light is out\./);
	});

	// LIGHTING one takes nothing away, and snuffing a light with no Invocation running has nothing
	// to report — the candle itself stays silent either way.
	it("says nothing when the candle is toggled with no Invocation running", async () => {
		const { sheet } = invokingSheet({ ongoing: "", lit: true });
		await sheet._onHolyLightToggle(clickEvent());
		expect(sheet._postMoveCard).not.toHaveBeenCalled();

		const relit = invokingSheet({ ongoing: "warmth-of-the-sun", lit: false });
		await relit.sheet._onHolyLightToggle(clickEvent());
		expect(relit.sheet._postMoveCard).not.toHaveBeenCalled();
		expect(relit.actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
	});
});

// Neither move has a rollType, so both fall through to the description-only path that posts
// their text — the same path Consecrated Flame rides. Stubbed at _openCondemned: what is being
// asserted is WHICH uses open the roster, not the window itself.
describe("StonetopCharacterSheet Condemn roster on move use", () => {
	function condemnSheet() {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		sheet._openCondemned = vi.fn(async () => {});
		return { actor, sheet };
	}

	// Condemn never fires on its own — it amends what Censure does — so the moment a brand is
	// actually laid is a Censure, and that has to open the roster or the Judge is back to
	// keeping the list in their head.
	it("opens on Censure as well as on Condemn", async () => {
		for (const name of ["Censure", "Condemn"]) {
			const { sheet } = condemnSheet();
			await sheet._onDescriptionMoveUsed({ type: "move", name });
			expect(sheet._openCondemned, name).toHaveBeenCalled();
		}
	});

	// A Judge who hasn't taken Condemn brands nobody when they Censure, so the roster isn't
	// theirs to open.
	it("stays shut for a character without Condemn", async () => {
		const { actor, sheet } = condemnSheet();
		actor.typedActor.canCondemn = false;
		await sheet._onDescriptionMoveUsed({ type: "move", name: "Censure" });
		expect(sheet._openCondemned).not.toHaveBeenCalled();
	});

	// Armistice rather than Castigate, which this used to name: Castigate IS a Censure now (it
	// deals the Censure's damage, and opens the roster the Censure opens), see the block below.
	it("ignores any other move, a same-named non-move, and a row with no item at all", async () => {
		const { sheet } = condemnSheet();
		await sheet._onDescriptionMoveUsed({ type: "move", name: "Armistice" });
		await sheet._onDescriptionMoveUsed({ type: "item", name: "Condemn" });
		await sheet._onDescriptionMoveUsed(null);
		expect(sheet._openCondemned).not.toHaveBeenCalled();
	});
});

// "When you Censure someone, your voice deals 1d4 damage to them (near, loud, ignores armor)."
// Castigate is level 2+ and Condemn level 6+, and the blow used to ride the brand being laid in
// Condemn's window, so a Judge without Condemn never dealt it. It lands from the Censure now. What
// is pinned here is WHO it lands on; the card itself (1d4, loud, ignores armor) is pinned against
// the real model in playbook-the-judge.test.js, so `castigate` is a spy.
describe("StonetopCharacterSheet Castigate on Censure", () => {
	const token = (id, name, { actorId = `a-${id}`, hidden = false } = {}) =>
		({ id, name, uuid: `Scene.s.Token.${id}`, hidden, actor: { id: actorId } });
	const bandit = token("b", "Bandit");
	const cutpurse = token("c", "Cutpurse");
	const ownToken = token("j", "The Judge", { actorId: "actor-1" });

	let savedUser;
	let savedScenes;
	beforeEach(() => {
		savedUser = global.game.user;
		savedScenes = global.game.scenes;
		picker.pick.mockReset();
		picker.pick.mockResolvedValue(null);
	});
	afterEach(() => {
		global.game.user = savedUser;
		global.game.scenes = savedScenes;
	});

	function censureSheet({ castigate = true, condemn = false, proclaim = false, targets = [], scene = [], editable = true } = {}) {
		const actor = makeActor();
		Object.assign(actor.typedActor, {
			canCastigate: castigate,
			canProclaim: proclaim,
			castigate: vi.fn(async () => ({ id: "card" })),
		});
		actor.typedActor.canCondemn = condemn;
		const sheet = makeSheet(actor);
		if (!editable) Object.defineProperty(sheet, "isEditable", { get: () => false });
		sheet._openCondemned = vi.fn(async () => {});
		global.game.user = { ...(savedUser ?? {}), isGM: false, targets: new Set(targets.map(document => ({ document }))) };
		global.game.scenes = { viewed: { tokens: scene } };
		return { character: actor.typedActor, sheet };
	}

	const censure = sheet => sheet._onDescriptionMoveUsed({ type: "move", name: "Censure" });

	it("hits the one targeted person, without Condemn, and opens no roster", async () => {
		const { character, sheet } = censureSheet({ targets: [bandit] });
		await censure(sheet);
		expect(character.castigate).toHaveBeenCalledTimes(1);
		expect(character.castigate).toHaveBeenCalledWith(bandit);
		expect(picker.pick).not.toHaveBeenCalled();
		expect(sheet._openCondemned).not.toHaveBeenCalled();
	});

	it("does nothing for a Judge who has not learned Castigate", async () => {
		const { character, sheet } = censureSheet({ castigate: false, targets: [bandit] });
		await censure(sheet);
		expect(character.castigate).not.toHaveBeenCalled();
		expect(picker.pick).not.toHaveBeenCalled();
	});

	it("asks who, off this scene, when nobody is targeted; backing out deals nothing", async () => {
		const hidden = token("h", "Lurker", { hidden: true });
		const { character, sheet } = censureSheet({ scene: [bandit, ownToken, hidden, cutpurse] });
		await censure(sheet);
		expect(picker.pick).toHaveBeenCalledTimes(1);
		// Never the Judge themself, and not a token the player cannot see.
		expect(picker.pick.mock.calls[0][0].options.map(o => o.id)).toEqual(["b", "c"]);
		expect(character.castigate).not.toHaveBeenCalled();
	});

	it("hits whoever the picker names", async () => {
		picker.pick.mockResolvedValue("c");
		const { character, sheet } = censureSheet({ scene: [bandit, cutpurse] });
		await censure(sheet);
		expect(character.castigate).toHaveBeenCalledTimes(1);
		expect(character.castigate).toHaveBeenCalledWith(cutpurse);
	});

	it("says so and rolls nothing when there is nobody to ask about", async () => {
		const info = vi.spyOn(global.ui.notifications, "info");
		const { character, sheet } = censureSheet({ scene: [ownToken] });
		await censure(sheet);
		expect(picker.pick).not.toHaveBeenCalled();
		expect(character.castigate).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith(expect.stringMatching(/Castigate has nobody to hit/));
		info.mockRestore();
	});

	// Censure denounces "an individual": several targets are a question, not a volley.
	it("asks which ONE of several targets, without Proclamation", async () => {
		picker.pick.mockResolvedValue("b");
		const { character, sheet } = censureSheet({ targets: [bandit, cutpurse], scene: [bandit, cutpurse, token("x", "Other")] });
		await censure(sheet);
		expect(picker.pick.mock.calls[0][0].options.map(o => o.id)).toEqual(["b", "c"]);
		expect(character.castigate).toHaveBeenCalledTimes(1);
		expect(character.castigate).toHaveBeenCalledWith(bandit);
	});

	// "Apply the effects of Censure to every member of that group."
	it("hits every target, one card each, with Proclamation", async () => {
		const { character, sheet } = censureSheet({ proclaim: true, condemn: true, targets: [bandit, cutpurse] });
		await censure(sheet);
		expect(picker.pick).not.toHaveBeenCalled();
		expect(character.castigate.mock.calls.map(c => c[0])).toEqual([bandit, cutpurse]);
	});

	// The window still opens for the brand. Laying it there rolls nothing (brandCondemned is
	// record-keeping now, pinned in playbook-the-judge.test.js), so this is the only 1d4.
	it("still opens the roster for a Judge who owns Condemn, after the one blow", async () => {
		const { character, sheet } = censureSheet({ condemn: true, targets: [bandit] });
		await censure(sheet);
		expect(character.castigate).toHaveBeenCalledTimes(1);
		expect(sheet._openCondemned).toHaveBeenCalledTimes(1);
	});

	it("does the same when Castigate itself is used", async () => {
		const { character, sheet } = censureSheet({ condemn: true, targets: [bandit] });
		await sheet._onDescriptionMoveUsed({ type: "move", name: "Castigate" });
		expect(character.castigate).toHaveBeenCalledWith(bandit);
		expect(sheet._openCondemned).toHaveBeenCalledTimes(1);
	});

	it("rolls nothing from a sheet the viewer cannot edit, but still shows the roster", async () => {
		const { character, sheet } = censureSheet({ condemn: true, targets: [bandit], editable: false });
		await censure(sheet);
		expect(character.castigate).not.toHaveBeenCalled();
		expect(sheet._openCondemned).toHaveBeenCalledTimes(1);
	});
});

describe("StonetopCharacterSheet damage die editing", () => {
	function damageInput(value, base = "d6") {
		return { currentTarget: { value, dataset: { damageBase: base } } };
	}

	function makeDamageSheet() {
		const actor = makeActor();
		actor.typedActor.setDamageDieOverride = vi.fn(async () => null);
		return { actor, sheet: makeSheet(actor) };
	}

	it("saves a typed die as an override", async () => {
		const { actor, sheet } = makeDamageSheet();
		await sheet._onDamageDieEdit(damageInput("d8"));
		// The derived die rides along, so the model never rebuilds the snapshot to find it.
		expect(actor.typedActor.setDamageDieOverride).toHaveBeenCalledWith("d8", { base: "d6" });
	});

	it("normalizes loose spellings before saving", async () => {
		const { actor, sheet } = makeDamageSheet();
		await sheet._onDamageDieEdit(damageInput("1D8 "));
		expect(actor.typedActor.setDamageDieOverride).toHaveBeenCalledWith("d8", { base: "d6" });
	});

	it("clears the override when the field is emptied", async () => {
		const { actor, sheet } = makeDamageSheet();
		await sheet._onDamageDieEdit(damageInput(""));
		expect(actor.typedActor.setDamageDieOverride).toHaveBeenCalledWith("", { base: "d6" });
	});

	it("clears the override when the typed die is the playbook's own", async () => {
		const { actor, sheet } = makeDamageSheet();
		await sheet._onDamageDieEdit(damageInput("d6", "d6"));
		expect(actor.typedActor.setDamageDieOverride).toHaveBeenCalledWith("", { base: "d6" });
	});

	it("refuses a value that isn't a single die and puts the old one back", async () => {
		global.ui = { notifications: { warn: vi.fn() } };
		const { actor, sheet } = makeDamageSheet();
		actor.system.attributes.damage.value = "d6";
		const ev = damageInput("2d6");

		await sheet._onDamageDieEdit(ev);

		expect(actor.typedActor.setDamageDieOverride).not.toHaveBeenCalled();
		expect(ev.currentTarget.value).toBe("d6");
		expect(global.ui.notifications.warn).toHaveBeenCalled();
	});

	it("getData mirrors the die in play onto the input, playbook or not", async () => {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => {
			const snap = minimalSheetSnapshot({});
			snap.vitals.damage = "d8";
			return snap;
		});
		const sheet = makeSheet(actor);

		const context = await sheet.getData();
		expect(context.system.attributes.damage.value).toBe("d8");
	});
});

describe("StonetopCharacterSheet Details tab section visibility", () => {
	const DETAILS_SECTIONS = ["lore", "background", "instinct", "appearance", "origin"];

	function detailsPlaybook({ filled }) {
		return {
			lore:       { hasReadonlyContent: filled },
			background: { selected: filled ? "vessel" : "", options: [{ slug: "vessel", selected: filled }] },
			instinct:   { hasSelection: filled },
			appearance: { summary: filled ? "Gray & wizened" : "" },
			origin:     { selected: filled ? "Stonetop" : "", selectedOption: filled ? { region: "Stonetop" } : null },
		};
	}

	async function detailsShowFor(playbook, { editMode = false } = {}) {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.buildSnapshot = vi.fn(async () => ({ ...minimalSheetSnapshot({}), playbook }));
		const sheet = makeSheet(actor);
		sheet._editMode = editMode;
		return (await sheet.getData()).stonetop.detailsShow;
	}

	it("hides every unfilled section in play mode", async () => {
		const show = await detailsShowFor(detailsPlaybook({ filled: false }));
		for (const section of DETAILS_SECTIONS) expect(show[section], section).toBe(false);
	});

	it("shows every section in play mode once it has been filled in", async () => {
		const show = await detailsShowFor(detailsPlaybook({ filled: true }));
		for (const section of DETAILS_SECTIONS) expect(show[section], section).toBe(true);
	});

	it("brings the unfilled sections back when the global edit wrench is on", async () => {
		const show = await detailsShowFor(detailsPlaybook({ filled: false }), { editMode: true });
		for (const section of DETAILS_SECTIONS) expect(show[section], section).toBe(true);
	});

	it("hides only the sections that are still empty", async () => {
		const playbook = detailsPlaybook({ filled: false });
		playbook.instinct.hasSelection = true;
		const show = await detailsShowFor(playbook);
		expect(show.instinct).toBe(true);
		expect(show.background).toBe(false);
		expect(show.appearance).toBe(false);
	});

	it("keeps a section hidden when a saved value matches none of the playbook's options", async () => {
		const playbook = detailsPlaybook({ filled: false });
		playbook.background.selected = "gone-from-the-playbook";
		playbook.origin.selected = "Nowhere";
		const show = await detailsShowFor(playbook);
		expect(show.background).toBe(false);
		expect(show.origin).toBe(false);
	});
});

describe("StonetopCharacterSheet Post-Death tab visibility", () => {
	async function showPostDeathFor(postDeathInsert, { editMode = false, requested = false, state = null } = {}) {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.postDeathTabRequested = requested;
		actor.typedActor.deathsDoorState = state;
		actor.typedActor.buildSnapshot = vi.fn(async () => ({ ...minimalSheetSnapshot({}), postDeathInsert }));
		const sheet = makeSheet(actor);
		sheet._editMode = editMode;
		return (await sheet.getData()).stonetop.showPostDeath;
	}

	it("shows the tab for a character wearing an insert", async () => {
		expect(await showPostDeathFor({ activeSlug: "revenant", activeInsert: {} })).toBe(true);
	});

	it("hides it from a living character in play mode", async () => {
		expect(await showPostDeathFor(null)).toBe(false);
		expect(await showPostDeathFor({ activeSlug: null, activeInsert: null })).toBe(false);
	});

	// The wrench must not put a tab about being dead on every living sheet.
	it("does not open on edit mode alone", async () => {
		expect(await showPostDeathFor(null, { editMode: true })).toBe(false);
	});

	// Removing an insert requests the tab, so it stays standing on its "Choose Your Fate" picker —
	// picking another fate is the whole point of removing one.
	it("keeps it open in edit mode once the tab has been requested", async () => {
		expect(await showPostDeathFor(null, { editMode: true, requested: true })).toBe(true);
		expect(await showPostDeathFor(null, { requested: true })).toBe(false);
	});

	// The other reason an empty tab is wanted: a fate is owed for a Door already faced, whether or
	// not the sheet was the thing that asked.
	it("opens in edit mode for a character who owes a fate", async () => {
		expect(await showPostDeathFor(null, { editMode: true, state: "fate-pending" })).toBe(true);
		expect(await showPostDeathFor(null, { editMode: true, state: "dead" })).toBe(true);
		expect(await showPostDeathFor(null, { editMode: true, state: "out-of-action" })).toBe(false);
	});

	// The request is about an EMPTY tab. A worn insert answers on its own — and Death's Door grants
	// one without asking, so a character who dies later is never left without their insert.
	it("shows the tab for a worn insert with no request on file", async () => {
		expect(await showPostDeathFor({ activeSlug: "thrall", activeInsert: {} })).toBe(true);
	});

	// A slug that's set but unreadable (a pack that hasn't loaded) still gets the tab: the picker
	// is the way back to a legible sheet.
	it("keeps the tab for a slug whose insert cannot be read", async () => {
		expect(await showPostDeathFor({ activeSlug: "ghost", activeInsert: null })).toBe(true);
	});
});

/**
 * The two halves of "who can ask for this tab, and who can send it away".
 *
 * The tab being opt-in is deliberate — the wrench must not put a tab about being dead on every
 * living sheet — but for a while the ONLY thing that ever opted in was REMOVING an insert, which
 * made the "Choose Your Fate" picker unreachable for the case its own hint text describes: a table
 * who resolved the Last Door in conversation and left no state on the sheet at all. And the foot's
 * "Remove Post-Death Tab" was inert for the opposite group, since a character who owes a fate has
 * a tab that redraws itself on the next render whatever that button writes.
 */
describe("StonetopCharacterSheet Post-Death tab, asked for and sent away", () => {
	async function contextFor({ editMode = false, requested = false, state = null, insert = null } = {}) {
		installGetDataGlobals();
		const actor = makeActor();
		actor.typedActor.playbook = vi.fn(async () => null);
		actor.typedActor.possessionTriggerMoves = vi.fn(() => ({}));
		actor.typedActor.postDeathTabRequested = requested;
		actor.typedActor.deathsDoorState = state;
		actor.typedActor.buildSnapshot = vi.fn(async () => ({ ...minimalSheetSnapshot({}), postDeathInsert: insert }));
		const sheet = makeSheet(actor);
		sheet._editMode = editMode;
		return { sheet, stonetop: (await sheet.getData()).stonetop };
	}

	// The Death's Door card's own route in, offered where the picker can't be reached any other way.
	it("offers the Post-Death opt-in in edit mode, and only while the tab is absent", async () => {
		expect((await contextFor({ editMode: true })).stonetop.deathsDoor.openPostDeath).toBe(true);
		// Already there, by request or by state — nothing left to ask for.
		expect((await contextFor({ editMode: true, requested: true })).stonetop.deathsDoor.openPostDeath).toBe(false);
		expect((await contextFor({ editMode: true, state: "dead" })).stonetop.deathsDoor.openPostDeath).toBe(false);
		// Play mode: the tab is opt-in from the wrench, so the opt-in lives there too.
		expect((await contextFor({})).stonetop.deathsDoor.openPostDeath).toBe(false);
	});

	it("puts the tab on the sheet and goes to it", async () => {
		const { sheet } = await contextFor({ editMode: true });
		sheet.actor.typedActor.setPostDeathTabRequested = vi.fn(async () => {});

		await sheet._onPostDeathTabOpen();

		expect(sheet.actor.typedActor.setPostDeathTabRequested).toHaveBeenCalledWith(true);
		// Deferred, not preset: the flag write schedules its own render, which races this one.
		expect(sheet._activateTabOnRender).toBe("post-death");
	});

	// The foot's way out, offered only while the REQUEST is the sole thing holding the tab open.
	it("offers to remove the tab, except from a character who owes a fate", async () => {
		expect((await contextFor({ editMode: true, requested: true })).stonetop.canHidePostDeathTab).toBe(true);
		for (const state of ["fate-pending", "dead"]) {
			expect((await contextFor({ editMode: true, state })).stonetop.canHidePostDeathTab, state).toBe(false);
		}
	});
});

describe("StonetopCharacterSheet._buildRecoverData", () => {
	it("can recover when supplies remain, HP is below max, and not locked", () => {
		const actor = new FakeActorBuilder().withFlag("inventory.resources", { supplies: 3 }).build();
		actor.typedActor = makeCharacterMock(actor);
		const sheet = makeSheet(actor);
		const data = sheet._buildRecoverData(recoverSnapshot({ hpValue: 4, hpMax: 8, smallItemLimit: 5 }));
		expect(data.canRecover).toBe(true);
		expect(data.healAmount).toBe(5);
		expect(data.suppliesLeft).toBe(3);
		expect(data.hint).toBeNull();
	});

	it("sums uses across all three supply tiers", () => {
		const actor = new FakeActorBuilder()
			.withFlag("inventory.resources", { supplies: 1, "more-supplies": 2, "even-more-supplies": 4 })
			.build();
		actor.typedActor = makeCharacterMock(actor);
		const sheet = makeSheet(actor);
		const data = sheet._buildRecoverData(recoverSnapshot());
		expect(data.suppliesLeft).toBe(7);
	});

	it("locks (with hint) once recover.spent is set, until damage is taken", () => {
		const actor = new FakeActorBuilder()
			.withFlag("inventory.resources", { supplies: 3 })
			.withFlag("recover.spent", true)
			.build();
		actor.typedActor = makeCharacterMock(actor);
		const sheet = makeSheet(actor);
		const data = sheet._buildRecoverData(recoverSnapshot({ hpValue: 4 }));
		expect(data.locked).toBe(true);
		expect(data.canRecover).toBe(false);
		expect(data.hint.icon).toBe("fa-lock");
	});

	it("cannot recover with no supplies", () => {
		const actor = new FakeActorBuilder().withFlag("inventory.resources", {}).build();
		actor.typedActor = makeCharacterMock(actor);
		const sheet = makeSheet(actor);
		const data = sheet._buildRecoverData(recoverSnapshot({ hpValue: 4 }));
		expect(data.canRecover).toBe(false);
		expect(data.hint.icon).toBe("fa-triangle-exclamation");
	});

	it("cannot recover at full HP", () => {
		const actor = new FakeActorBuilder().withFlag("inventory.resources", { supplies: 3 }).build();
		actor.typedActor = makeCharacterMock(actor);
		const sheet = makeSheet(actor);
		const data = sheet._buildRecoverData(recoverSnapshot({ hpValue: 8, hpMax: 8 }));
		expect(data.canRecover).toBe(false);
		expect(data.hint.icon).toBe("fa-heart");
	});
});

describe("StonetopCharacterSheet._applyRecover", () => {
	// A purse as supply-cost.js hands them over: which row, what it is called, what is in it.
	const purse = (slug, remaining, label = "Supplies") => ({ slug, label, remaining });
	const RECOVER = { stonetopMove: "Recover" };

	// A hurt character carrying `resources`, at `hp` of a computed `max`.
	function hurt({ hp = 4, max = 20, resources = { supplies: 3 } } = {}) {
		const actor = new FakeActorBuilder().withHp(hp, max).withFlag("inventory.resources", resources).build();
		actor.id = "actor-1";
		actor.isOwner = true;
		actor.typedActor = makeCharacterMock(actor);
		return actor;
	}

	it("decrements one use of the chosen purse, named as Recover's", async () => {
		const actor = hurt();
		const sheet = makeSheet(actor);
		await sheet._applyRecover({ purse: purse("supplies", 3), base: 4 });
		expect(actor.update).toHaveBeenCalledWith(expect.objectContaining({ "flags.stonetop-pwd.inventory.resources.supplies": 2 }), RECOVER);
	});

	// The one thing that may stand in for supplies at a Recover (Book II p.462). It is spent
	// through the same path, which is the point of the purse abstraction.
	it("spends a Twisting Pine vial when that is what was picked", async () => {
		const actor = hurt({ resources: { "twisting-pine": 1 } });
		const sheet = makeSheet(actor);
		await sheet._applyRecover({ purse: purse("twisting-pine", 1, "Twisting Pine sap"), base: 4 });
		expect(actor.update).toHaveBeenCalledWith(expect.objectContaining({ "flags.stonetop-pwd.inventory.resources.twisting-pine": 0 }), RECOVER);
	});

	// Audit #1: every automated move write names its move, so the ledger reads "via Recover".
	it("spends the supply, heals 4+Prosperity and locks the move, in one write named as Recover's", async () => {
		const actor = hurt({ hp: 4, resources: { supplies: 1 } });
		const sheet = makeSheet(actor);
		await sheet._applyRecover({ purse: purse("supplies", 1), base: 5 });
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.inventory.resources.supplies": 0,
			"system.attributes.hp.value": 9,
			"flags.stonetop-pwd.recover.spent": true,
		}, RECOVER);
	});

	// Audit #2: the window's numbers are stale by the press. A camp that healed them meanwhile was
	// written back DOWN to the window's figure, and a blow taken meanwhile was healed over.
	it("heals from the HP at the press, not the HP the window opened on", async () => {
		const actor = hurt({ hp: 4, max: 20 });
		const sheet = makeSheet(actor);
		actor.system.attributes.hp.value = 13;     // Make Camp settled while the window stood open
		await sheet._applyRecover({ purse: purse("supplies", 3), base: 4 });
		expect(actor.system.attributes.hp.value).toBe(17);

		const bled = hurt({ hp: 10, max: 20 });
		const sheet2 = makeSheet(bled);
		bled.system.attributes.hp.value = 4;       // took 6 damage meanwhile
		await sheet2._applyRecover({ purse: purse("supplies", 3), base: 4 });
		expect(bled.system.attributes.hp.value).toBe(8);
	});

	it("caps at the computed max", async () => {
		const actor = hurt({ hp: 18, max: 20 });
		await makeSheet(actor)._applyRecover({ purse: purse("supplies", 3), base: 4 });
		expect(actor.system.attributes.hp.value).toBe(20);
	});

	it("spends from the purse as it is now, not as the window counted it", async () => {
		const actor = hurt({ resources: { supplies: 2 } });   // a camp ate one since the window opened
		await makeSheet(actor)._applyRecover({ purse: purse("supplies", 3), base: 4 });
		expect(actor.update).toHaveBeenCalledWith(expect.objectContaining({ "flags.stonetop-pwd.inventory.resources.supplies": 1 }), RECOVER);
	});

	it("spends nothing when the purse has run dry since the window opened", async () => {
		const actor = hurt({ resources: {} });
		await makeSheet(actor)._applyRecover({ purse: purse("supplies", 3), base: 4 });
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("spends nothing on a second press, or a second window, once the Recover is spent", async () => {
		const actor = hurt();
		const sheet = makeSheet(actor);
		await sheet._applyRecover({ purse: purse("supplies", 3), base: 4 });
		await sheet._applyRecover({ purse: purse("supplies", 3), base: 4 });
		expect(actor.update).toHaveBeenCalledTimes(1);
	});

	it("spends nothing when they are back at full HP by the press", async () => {
		const actor = hurt({ hp: 20, max: 20 });
		await makeSheet(actor)._applyRecover({ purse: purse("supplies", 3), base: 4 });
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("re-renders after applying", async () => {
		const actor = hurt();
		const sheet = makeSheet(actor);
		await sheet._applyRecover({ purse: purse("supplies", 2), base: 4 });
		expect(sheet.render).toHaveBeenCalledWith(false);
	});
});

function convalesceSnapshot({ hpValue = 4, hpMax = 8, debilities = [] } = {}) {
	return { vitals: { hp: { value: hpValue, max: hpMax } }, debilities };
}

describe("StonetopCharacterSheet._buildConvalesceData", () => {
	it("can convalesce when HP is below max", () => {
		const sheet = makeSheet(makeActor());
		const data = sheet._buildConvalesceData(convalesceSnapshot({ hpValue: 4, hpMax: 8 }));
		expect(data.canConvalesce).toBe(true);
		expect(data.hint).toBeNull();
	});

	it("can convalesce at full HP when a debility is marked", () => {
		const sheet = makeSheet(makeActor());
		const data = sheet._buildConvalesceData(convalesceSnapshot({
			hpValue: 8, hpMax: 8,
			debilities: [{ key: "dazed", name: "Dazed", active: true }],
		}));
		expect(data.canConvalesce).toBe(true);
		expect(data.activeDebilities).toHaveLength(1);
	});

	it("cannot convalesce at full HP with no marked debilities (shows hint)", () => {
		const sheet = makeSheet(makeActor());
		const data = sheet._buildConvalesceData(convalesceSnapshot({
			hpValue: 8, hpMax: 8,
			debilities: [{ key: "dazed", name: "Dazed", active: false }],
		}));
		expect(data.canConvalesce).toBe(false);
		expect(data.hint.icon).toBe("fa-heart");
	});

	// Auspicious Birth: "Clear it when you Make Camp or Convalesce." The circle stands in for a
	// debility, so it is often the only thing marked.
	it("can convalesce at full HP to clear a marked Auspicious Birth circle, and only a marked one", () => {
		const sheet = makeSheet(makeActor());
		const withCircle = current => ({
			...convalesceSnapshot({ hpValue: 8, hpMax: 8 }),
			playbook: { background: { options: [{ selected: true, label: "Auspicious Birth", setupResources: [
				{ key: "auspicious-birth", label: "Background circle", current, clearsOn: ["make-camp", "convalesce"] },
			] }] } },
		});
		expect(sheet._buildConvalesceData(withCircle(1)).canConvalesce).toBe(true);
		expect(sheet._buildConvalesceData(withCircle(0)).canConvalesce).toBe(false);
	});
});

describe("StonetopCharacterSheet._applyConvalesce", () => {
	it("heals to max and clears every marked debility, attributed to the move", async () => {
		const actor = makeActor();
		actor.system.attributes.hp.value = 3;
		const sheet = makeSheet(actor);
		await sheet._applyConvalesce({
			debilities: [
				{ key: "weakened",  name: "Weakened",  active: true },
				{ key: "miserable", name: "Miserable", active: true },
			],
		});
		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.hp.value": 8,
			"system.attributes.debilities.options.weakened.value": false,
			"system.attributes.debilities.options.miserable.value": false,
		}, { stonetopMove: "Convalesce" });
	});

	it("clears a marked background track in the same write", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._applyConvalesce({
			debilities: [],
			tracks: [{ key: "auspicious-birth", name: "Auspicious Birth's background circle" }],
		});
		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.hp.value": 8,
			"flags.stonetop-pwd.background.setupResources.auspicious-birth": 0,
		}, { stonetopMove: "Convalesce" });
	});

	it("re-renders after applying", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._applyConvalesce({ debilities: [] });
		expect(sheet.render).toHaveBeenCalledWith(false);
	});

	// Audit #2: the HP is worked out at the press from the live HP and the COMPUTED max, not
	// handed over from the moment the window opened.
	it("sets HP to the computed max as it is at the press", async () => {
		const actor = makeActor();
		actor.system.attributes.hp.value = 2;
		actor.typedActor.computedMaxHp = vi.fn(async () => 14);   // the stored max (8) is stale
		await makeSheet(actor)._applyConvalesce({ debilities: [] });
		expect(actor.system.attributes.hp.value).toBe(14);
	});
});

// Post-death audit B1: the Unliving (Ghost, Revenant) "gain no benefit from magical healing, Make Camp,
// Recover or Convalesce". Both cards lock with the reason, and both windows refuse however they are reached.
describe("Recover and Convalesce for the Unliving", () => {
	function unliving(kind = "ghost") {
		const actor = new FakeActorBuilder()
			.withFlag("inventory.resources", { supplies: 3 })
			.withFlag("postDeathInsert.slug", kind)
			.build();
		actor.id = "actor-1";
		actor.isOwner = true;
		actor.typedActor = makeCharacterMock(actor);
		return actor;
	}

	it("locks Recover with an Unliving hint, supplies and wounds notwithstanding", () => {
		for (const kind of ["ghost", "revenant"]) {
			const data = makeSheet(unliving(kind))._buildRecoverData(recoverSnapshot({ hpValue: 2, hpMax: 8 }));
			expect(data.canRecover, kind).toBe(false);
			expect(data.hint.text).toContain("Unliving: no benefit");
		}
	});

	it("locks Convalesce with an Unliving hint, however hurt they are", () => {
		const data = makeSheet(unliving())._buildConvalesceData(convalesceSnapshot({
			hpValue: 2, hpMax: 8, debilities: [{ key: "dazed", name: "Dazed", active: true }],
		}));
		expect(data.canConvalesce).toBe(false);
		expect(data.hint.text).toContain("Unliving: no benefit");
	});

	it("leaves a Thrall's cards open", () => {
		const actor = unliving("thrall");
		expect(makeSheet(actor)._buildRecoverData(recoverSnapshot({ hpValue: 2 })).canRecover).toBe(true);
		expect(makeSheet(actor)._buildConvalesceData(convalesceSnapshot({ hpValue: 2 })).canConvalesce).toBe(true);
	});

	it("opens no window and writes nothing when either is reached another way", async () => {
		const actor = unliving();
		actor.update = vi.fn();
		const sheet = makeSheet(actor);
		sheet._stonetopCharacter.buildSnapshot = vi.fn();
		await sheet._onRecoverOpen();
		await sheet._onConvalesceOpen();
		expect(sheet._stonetopCharacter.buildSnapshot).not.toHaveBeenCalled();
		await sheet._applyRecover({ purse: { slug: "supplies", label: "Supplies", remaining: 3 }, oldHp: 2, newHp: 7 });
		await sheet._applyConvalesce({ oldHp: 2, newHp: 8, debilities: [] });
		expect(actor.update).not.toHaveBeenCalled();
	});
});

// Wounds audit #9 (user ruling): a PC at Death's Door "can't save themselves" (Book I p.240), and
// whoever tends them is Aiding the roll (p.245). Their own Recover and Convalesce lock while the
// 0-HP move is still to face, however they are reached, and say why.
describe("Recover and Convalesce while dying", () => {
	let warn;
	beforeEach(() => { warn = vi.fn(); global.ui = { notifications: { info: vi.fn(), warn, error: vi.fn() } }; });

	function dying({ move = "Death's Door" } = {}) {
		const actor = new FakeActorBuilder().withHp(0, 20).withFlag("inventory.resources", { supplies: 3 }).build();
		actor.id = "actor-1";
		actor.isOwner = true;
		actor.typedActor = makeCharacterMock(actor);
		actor.typedActor.canFaceDeathsDoor = true;
		actor.typedActor.zeroHpMove = { name: move };
		return actor;
	}

	it("locks both cards with a hint naming the roll to Aid", () => {
		const sheet = makeSheet(dying());
		const recover = sheet._buildRecoverData(recoverSnapshot({ hpValue: 0, hpMax: 20 }));
		const convalesce = sheet._buildConvalesceData(convalesceSnapshot({ hpValue: 0, hpMax: 20 }));
		expect(recover.canRecover).toBe(false);
		expect(convalesce.canConvalesce).toBe(false);
		expect(recover.hint.text).toBe("Dying: you can't save yourself. Someone who tends you Aids your Death's Door roll instead.");
		expect(convalesce.hint.text).toBe(recover.hint.text);
	});

	it("names an insert's own 0-HP move", () => {
		const data = makeSheet(dying({ move: "Undying" }))._buildRecoverData(recoverSnapshot({ hpValue: 0, hpMax: 20 }));
		expect(data.hint.text).toContain("Aids your Undying roll");
	});

	it("opens no window and writes nothing when either is reached another way", async () => {
		const actor = dying();
		const sheet = makeSheet(actor);
		await sheet._onRecoverOpen();
		await sheet._onConvalesceOpen();
		expect(actor.typedActor.buildSnapshot).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(2);
		await sheet._applyRecover({ purse: { slug: "supplies", label: "Supplies", remaining: 3 }, base: 4 });
		await sheet._applyConvalesce({ debilities: [] });
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("leaves both open once they are back up", () => {
		const actor = dying();
		actor.typedActor.canFaceDeathsDoor = false;
		const sheet = makeSheet(actor);
		expect(sheet._buildRecoverData(recoverSnapshot({ hpValue: 1, hpMax: 20 })).canRecover).toBe(true);
		expect(sheet._buildConvalesceData(convalesceSnapshot({ hpValue: 1, hpMax: 20 })).canConvalesce).toBe(true);
	});
});

// Wounds audit #11 (user ruling): Convalesce stays live for a wound that can still heal, or a
// permanent injury with no plan yet. One already planned for no longer holds it open, or every
// survivor of Death's Door's 10+ would carry a Convalesce card that never locks.
describe("Convalesce and the wounds that keep it open", () => {
	const atFull = wounds => ({ ...convalesceSnapshot({ hpValue: 8, hpMax: 8 }), wounds });
	const can = wounds => makeSheet(makeActor())._buildConvalesceData(atFull(wounds)).canConvalesce;

	it("stays open for a wound that can still heal", () => {
		expect(can([{ status: "problematic", healed: false }])).toBe(true);
		expect(can([{ status: "stabilized", healed: false }])).toBe(true);
	});

	it("stays open for a permanent injury with no plan yet", () => {
		expect(can([{ status: "permanent", healed: false, planNote: "", planRequirements: [] }])).toBe(true);
	});

	it("locks for a permanent injury already planned for, by goal or by tick boxes", () => {
		expect(can([{ status: "permanent", healed: false, planNote: "Carry it", planRequirements: [] }])).toBe(false);
		expect(can([{ status: "permanent", healed: false, planNote: "", planRequirements: [{ text: "practice", done: false }] }])).toBe(false);
	});

	it("locks for a scar", () => {
		expect(can([{ status: "stabilized", healed: true }])).toBe(false);
	});

	it("opens no window from a press when only planned injuries are left", async () => {
		const actor = makeActor();
		actor.typedActor.buildSnapshot = vi.fn(async () => atFull([
			{ id: "m", status: "permanent", healed: false, planNote: "Carry it", planRequirements: [] },
		]));
		const DialogSpy = vi.fn(function () { this.render = vi.fn(); });
		globalThis.Dialog = DialogSpy;
		try {
			await makeSheet(actor)._onConvalesceOpen();
			expect(DialogSpy).not.toHaveBeenCalled();
		} finally {
			delete globalThis.Dialog;
		}
	});
});

// Wounds audit #5, #6 and #8: Tend is Recover (so not for the Unliving), the editor writes only
// what was changed, and a record stored with a blank id is still found.
describe("the sheet's wound controls", () => {
	let warn;
	beforeEach(() => { warn = vi.fn(); global.ui = { notifications: { info: vi.fn(), warn, error: vi.fn() } }; });

	function withWounds(wounds, { insert = null } = {}) {
		const builder = new FakeActorBuilder();
		if (insert) builder.withFlag("postDeathInsert.slug", insert);
		const actor = builder.build();
		actor.id = "actor-1";
		actor.isOwner = true;
		actor.system.attributes.wounds = wounds;
		actor.typedActor = makeCharacterMock(actor);
		actor.typedActor.updateWound = vi.fn(async () => {});
		return actor;
	}
	const GASH = { id: "w1", text: "Gash", status: "problematic", healed: false };

	it("draws no Tend button for a Ghost or a Revenant, and refuses a Tend that gets there anyway", () => {
		const DialogSpy = vi.fn(function () { this.render = vi.fn(); });
		globalThis.Dialog = DialogSpy;
		try {
			const ghost = makeSheet(withWounds([GASH], { insert: "ghost" }));
			expect(ghost._buildWoundsView([GASH], true).canTend).toBe(false);
			ghost._onWoundTend("w1");
			expect(DialogSpy).not.toHaveBeenCalled();
			expect(warn.mock.calls[0][0]).toContain("Unliving: no benefit");

			const living = makeSheet(withWounds([GASH]));
			expect(living._buildWoundsView([GASH], true).canTend).toBe(true);
			living._onWoundTend("w1");
			expect(DialogSpy).toHaveBeenCalledTimes(1);
		} finally {
			delete globalThis.Dialog;
		}
	});

	// Book I p.240: the dying can't save themselves, and Tend is Recover.
	it("draws no Tend button while Death's Door is still to face, and refuses a Tend that gets there anyway", () => {
		const DialogSpy = vi.fn(function () { this.render = vi.fn(); });
		globalThis.Dialog = DialogSpy;
		try {
			const actor = withWounds([GASH]);
			actor.typedActor.canFaceDeathsDoor = true;
			const sheet = makeSheet(actor);
			expect(sheet._buildWoundsView([GASH], true).canTend).toBe(false);
			sheet._onWoundTend("w1");
			expect(DialogSpy).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			delete globalThis.Dialog;
		}
	});

	// Test gap #13: the sheet's own Tend, not just the model call it makes. "It's taken care of"
	// stabilizes the wound, clears what it was said to need, and names Recover to the ledger.
	it("stabilizes the tended wound as Recover's write", async () => {
		const DialogSpy = vi.fn(function () { this.render = vi.fn(); });
		globalThis.Dialog = DialogSpy;
		globalThis.ChatMessage = { create: vi.fn(async d => d), getSpeaker: () => ({}) };
		try {
			const actor = withWounds([{ ...GASH, requirementNote: "stitches" }]);
			makeSheet(actor)._onWoundTend("w1");
			await DialogSpy.mock.calls[0][0].buttons.stabilize.callback();
			expect(actor.typedActor.updateWound).toHaveBeenCalledWith("w1", { status: "stabilized", requirementNote: "" }, { moveName: "Recover" });
		} finally {
			delete globalThis.Dialog;
			delete globalThis.ChatMessage;
		}
	});

	it("finds a record stored with a blank id by the stand-in id its row carries", () => {
		const sheet = makeSheet(withWounds([{ id: "", text: "Old gash", status: "problematic" }]));
		expect(sheet._woundRecord("wound-0")?.text).toBe("Old gash");
	});

	it("says so, rather than opening an empty editor, for a wound that is gone", async () => {
		const actor = withWounds([]);
		const sheet = makeSheet(actor);
		sheet._openWoundDialog = vi.fn();
		await sheet._onWoundEdit("w9");
		expect(sheet._openWoundDialog).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith("That wound is no longer on the sheet.");
	});

	it("writes only the fields the player changed", async () => {
		const actor = withWounds([GASH]);
		const sheet = makeSheet(actor);
		const edited = {
			text: "Deep gash", status: "problematic", origin: "wound", requirementNote: "", mechanicalTag: "",
			reminderMove: "", planNote: "", planRequirements: [], healed: false,
		};
		const promise = vi.spyOn(WoundDialog.prototype, "promise").mockResolvedValue(edited);
		try {
			await sheet._openWoundDialog({ isNew: false, wound: GASH });
		} finally {
			promise.mockRestore();
		}
		// The status and the scar box went untouched, so a Tend or a heal landing while the editor
		// stood open is not written back over.
		expect(actor.typedActor.updateWound).toHaveBeenCalledWith("w1", { text: "Deep gash" });
	});
});

describe("woundEditPatch", () => {
	const opened = { id: "w1", text: "Gash ", status: "problematic", planRequirements: [{ text: "rest", done: false }] };
	it("carries nothing for an untouched wound, trimmed text and an unchanged tick list included", () => {
		expect(woundEditPatch(opened, {
			text: "Gash", status: "problematic", origin: "wound", healed: false,
			planRequirements: [{ text: "rest", done: false }],
		})).toEqual({});
	});

	it("carries what moved, the tick list whole", () => {
		expect(woundEditPatch(opened, {
			text: "Gash", status: "permanent", healed: true, planRequirements: [{ text: "rest", done: true }],
		})).toEqual({ status: "permanent", healed: true, planRequirements: [{ text: "rest", done: true }] });
	});
});

describe("StonetopCharacterSheet._onDropPlaybook", () => {
	// The three post-death inserts are `type: "playbook"` Items too, so one handler receives both
	// and has to tell them apart. It used to ask "does it carry lore?" — which every shipped
	// playbook does — so a playbook drop set the character's INSERT instead of their playbook,
	// and the prune that runs with it measured their post-death answers against the wrong lore
	// and deleted them.
	function makePlaybookDoc(slug, extra = {}) {
		return {
			uuid: `Compendium.stonetop-pwd.stonetop-items.${slug}`,
			name: slug,
			type: "playbook",
			system: { slug },
			flags: { stonetop: { lore: [{ slug: "violence-reputation", options: [] }], hp: 20, ...extra } },
		};
	}

	it("assigns a playbook that carries lore of its own, instead of taking it for an insert", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		actor.update = vi.fn(async () => {});

		await sheet._onDropPlaybook(makePlaybookDoc("the-heavy"));

		expect(actor.typedActor.setPostDeathInsert).not.toHaveBeenCalled();
		expect(actor.update).toHaveBeenCalled();
		expect(actor.update.mock.calls[0][0]["system.playbook"].slug).toBe("the-heavy");
		expect(actor.typedActor.ensureStartingMoves).toHaveBeenCalled();
		// Its preselected possessions' gear arrives with the drop, not only through onboarding.
		expect(actor.typedActor.ensurePossessionGrants).toHaveBeenCalled();
	});

	it("still takes the three real inserts as inserts", async () => {
		for (const slug of ["revenant", "ghost", "thrall"]) {
			const actor = makeActor();
			const sheet = makeSheet(actor);
			actor.update = vi.fn(async () => {});

			await sheet._onDropPlaybook(makePlaybookDoc(slug));

			expect(actor.typedActor.setPostDeathInsert).toHaveBeenCalledWith(slug);
			expect(actor.update).not.toHaveBeenCalled();
		}
	});
});

describe("StonetopCharacterSheet._onDropItemCreate", () => {
	it("calls addArcanum with the slug from flags when an arcanum is dropped", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onDropItemCreate(makeArcanum("humble-broom"));
		expect(actor.typedActor.addArcanum).toHaveBeenCalledWith("humble-broom");
	});

	it("accepts an array of items", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onDropItemCreate([makeArcanum("humble-broom"), makeArcanum("stone-idol")]);
		expect(actor.typedActor.addArcanum).toHaveBeenCalledWith("humble-broom");
		expect(actor.typedActor.addArcanum).toHaveBeenCalledWith("stone-idol");
	});

	it("skips arcanum with no slug in flags", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		const noSlug = { type: "move", system: { moveType: "arcanum" }, flags: {} };
		await sheet._onDropItemCreate(noSlug);
		expect(actor.typedActor.addArcanum).not.toHaveBeenCalled();
	});

	it("routes regular moves to onDropMove", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		const move = makeMove();
		await sheet._onDropItemCreate(move);
		expect(actor.typedActor.onDropMove).toHaveBeenCalledWith(move);
		expect(actor.typedActor.addArcanum).not.toHaveBeenCalled();
	});

	// onDropMove returns false for a move the character already owns. That refusal has to
	// say so: silently doing nothing is indistinguishable from a broken drop handler, and
	// it's the exact shape of "I dragged the move on and it just didn't show up".
	it("warns by name when a dropped move was refused as already owned", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		actor.typedActor.onDropMove.mockResolvedValue(false);
		await sheet._onDropItemCreate({ type: "move", name: "Smash", system: { moveType: "playbook" }, flags: {} });
		expect(global.ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining('"Smash" is already on'));
	});

	it("stays quiet when the dropped move was actually added", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		actor.typedActor.onDropMove.mockResolvedValue(true);
		global.ui.notifications.warn.mockClear();  // the notification stub is shared across tests
		await sheet._onDropItemCreate(makeMove());
		expect(global.ui.notifications.warn).not.toHaveBeenCalled();
	});

	it("routes inventory moves to addDroppedInventoryItem", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		const item = makeInventoryItem();
		await sheet._onDropItemCreate(item);
		expect(actor.typedActor.addDroppedInventoryItem).toHaveBeenCalledWith(item, { hideArtifact: false });
		expect(actor.typedActor.onDropMove).not.toHaveBeenCalled();
	});

	it("does not route non-move items to addArcanum or onDropMove", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onDropItemCreate(makeNonMove());
		expect(actor.typedActor.addArcanum).not.toHaveBeenCalled();
		expect(actor.typedActor.onDropMove).not.toHaveBeenCalled();
	});

	it("calls render after dropping an arcanum", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onDropItemCreate(makeArcanum("humble-broom"));
		expect(sheet.render).toHaveBeenCalledWith(false);
	});

	it("calls render after dropping an inventory item", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onDropItemCreate(makeInventoryItem());
		expect(sheet.render).toHaveBeenCalledWith(false);
	});

	it("does not call render when nothing was added", async () => {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		await sheet._onDropItemCreate(makeNonMove());
		expect(sheet.render).not.toHaveBeenCalled();
	});

	// Gear lands on a tab the GM usually isn't looking at, so a silent add reads as "nothing
	// happened" — and, worse, gives no clue when the drop went somewhere the player can't see.
	describe("tells the GM where the gear went", () => {
		let savedUi;
		beforeEach(() => {
			savedUi = global.ui;
			global.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
		});
		afterEach(() => { global.ui = savedUi; });

		it("names the character an item was added to", async () => {
			const actor = makeActor();
			actor.name = "Ordep";
			await makeSheet(actor)._onDropItemCreate(makeInventoryItem());
			expect(global.ui.notifications.info)
				.toHaveBeenCalledWith('Added "Rope" to Ordep\'s Inventory tab.');
		});

		it("joins several items into one toast rather than one apiece", async () => {
			const actor = makeActor();
			actor.name = "Ordep";
			const second = { ...makeInventoryItem(), name: "Brass sphere" };
			await makeSheet(actor)._onDropItemCreate([makeInventoryItem(), second]);
			expect(global.ui.notifications.info).toHaveBeenCalledTimes(1);
			expect(global.ui.notifications.info)
				.toHaveBeenCalledWith('Added "Rope" & "Brass sphere" to Ordep\'s Inventory tab.');
		});

		it("says nothing when the drop carried no inventory", async () => {
			await makeSheet(makeActor())._onDropItemCreate(makeNonMove());
			expect(global.ui.notifications.info).not.toHaveBeenCalled();
		});
	});

	// A sheet opened by double-clicking an UNLINKED token is backed by the token's own copy of
	// the character (its ActorDelta). Everything written there saves fine and reaches nobody:
	// the player opens their character from the sidebar and finds nothing. This is the whole
	// reason a GM reports "I gave them a treasure and they can't see it".
	describe("on an unlinked token's sheet", () => {
		let savedUi;
		beforeEach(() => {
			savedUi = global.ui;
			global.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
		});
		afterEach(() => { global.ui = savedUi; });

		/** The synthetic actor behind an unlinked token, and the world actor it was stamped from. */
		function makeTokenActor() {
			const world = makeActor();
			world.name = "Ordep";
			const synthetic = makeActor();
			synthetic.name = "Ordep";
			synthetic.isToken = true;
			synthetic.token = { baseActor: world };
			return { synthetic, world };
		}

		it("writes gear to the character, not to the token's private copy", async () => {
			const { synthetic, world } = makeTokenActor();
			const item = makeInventoryItem();
			await makeSheet(synthetic)._onDropItemCreate(item);
			expect(world.typedActor.addDroppedInventoryItem).toHaveBeenCalledWith(item, { hideArtifact: false });
			expect(synthetic.typedActor.addDroppedInventoryItem).not.toHaveBeenCalled();
		});

		it("redirects arcana and moves the same way", async () => {
			const { synthetic, world } = makeTokenActor();
			await makeSheet(synthetic)._onDropItemCreate([makeArcanum("humble-broom"), makeMove()]);
			expect(world.typedActor.addArcanum).toHaveBeenCalledWith("humble-broom");
			expect(world.typedActor.onDropMove).toHaveBeenCalled();
			expect(synthetic.typedActor.addArcanum).not.toHaveBeenCalled();
			expect(synthetic.typedActor.onDropMove).not.toHaveBeenCalled();
		});

		it("says so, so the redirect is never silent", async () => {
			const { synthetic } = makeTokenActor();
			await makeSheet(synthetic)._onDropItemCreate(makeInventoryItem());
			expect(global.ui.notifications.info)
				.toHaveBeenCalledWith(expect.stringContaining("isn't linked to Ordep"));
		});

		// A linked token hands back the world actor itself, so isToken is false and there is
		// nothing to resolve — the common case must not pay for the rare one.
		it("leaves an ordinary sheet writing to its own character", async () => {
			const actor = makeActor();
			const item = makeInventoryItem();
			await makeSheet(actor)._onDropItemCreate(item);
			expect(actor.typedActor.addDroppedInventoryItem).toHaveBeenCalledWith(item, { hideArtifact: false });
		});

		// A token whose baseActor has gone (a deleted actor, a torn-down scene) must still take
		// the drop rather than throwing on the way to resolving a target.
		it("falls back to its own character when the base actor is gone", async () => {
			const { synthetic } = makeTokenActor();
			synthetic.token = { baseActor: null };
			const item = makeInventoryItem();
			await makeSheet(synthetic)._onDropItemCreate(item);
			expect(synthetic.typedActor.addDroppedInventoryItem).toHaveBeenCalledWith(item, { hideArtifact: false });
		});
	});
});

// _onDeathsDoorOpen is the ONE way into a character's 0-HP move: the sheet's own button and the
// dying chat card both come through it (hooks/DeathsDoorPrompt.js). The card outlives the moment
// it was posted for, so the gate has to live here rather than only on the button the sheet draws.
describe("StonetopCharacterSheet 0-HP move gate", () => {
	function makeInsertSheet({ hp, state = null }) {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		sheet._stonetopCharacter = {
			hp,
			deathsDoorState: state,
			zeroHpMove: zeroHpMove("revenant"),   // Undying — its own walkthrough, not Death's Door
			zeroHpResolution: zeroHpResolution("revenant"),
		};
		sheet._onUndeathOpen = vi.fn(async () => {});
		return sheet;
	}

	it("opens the insert's walkthrough for a character who is actually down", async () => {
		const sheet = makeInsertSheet({ hp: 0, state: DEATHS_DOOR_STATE.DYING });
		await sheet._onDeathsDoorOpen();
		expect(sheet._onUndeathOpen).toHaveBeenCalled();
	});

	it("refuses an old dying card once the character is back on their feet", async () => {
		// Without this, clicking a spent card's button re-rolls Undying and hands out half their
		// max HP again — for a Revenant standing there at full health.
		const sheet = makeInsertSheet({ hp: 6 });
		await sheet._onDeathsDoorOpen();
		expect(sheet._onUndeathOpen).not.toHaveBeenCalled();
	});

	it("refuses it again while they're out of the action — the move is spent, not pending", async () => {
		const sheet = makeInsertSheet({ hp: 0, state: DEATHS_DOOR_STATE.OUT_OF_ACTION });
		await sheet._onDeathsDoorOpen();
		expect(sheet._onUndeathOpen).not.toHaveBeenCalled();
	});

	it("refuses it for one who stepped through the Last Door", async () => {
		const sheet = makeInsertSheet({ hp: 0, state: DEATHS_DOOR_STATE.DEAD });
		await sheet._onDeathsDoorOpen();
		expect(sheet._onUndeathOpen).not.toHaveBeenCalled();
	});

	// DYING and nothing else (the user's ruling, 2026-09-27): 0 HP alone is also someone just back from
	// the Door, whose move is not owed.
	it("refuses it at 0 HP with no dying state", async () => {
		const sheet = makeInsertSheet({ hp: 0, state: null });
		await sheet._onDeathsDoorOpen();
		expect(sheet._onUndeathOpen).not.toHaveBeenCalled();
	});
});

// The Special Moves card, for someone past the Door: its one control, and what it says.
describe("StonetopCharacterSheet Death's Door card past the Door", () => {
	function makeCardSheet(slug, { state = null, lost = null } = {}) {
		const actor = makeActor();
		const sheet = makeSheet(actor);
		sheet._stonetopCharacter = {
			deathsDoorState: state,
			canFaceDeathsDoor: false,
			zeroHpMove: zeroHpMove(slug),
			zeroHpResolution: zeroHpResolution(slug),
			lostToTheGm: lost,
			computedMaxHp: vi.fn(async () => 15),
			restoreHp: vi.fn(async () => true),
			setDeathsDoorState: vi.fn(async () => {}),
		};
		return sheet;
	}
	const card = (sheet) => sheet._buildDeathsDoorData({ vitals: { hp: { value: 0, max: 15 } } });

	// Every insert, not the Ghost alone: back with half their max HP, rounded up, and the state cleared, in one write.
	it("brings anyone out of the action back on their feet with half their max HP", async () => {
		for (const [slug, move] of [["revenant", "Undying"], ["thrall", "Dark Succor"], ["ghost", "Tethered"]]) {
			const sheet = makeCardSheet(slug, { state: DEATHS_DOOR_STATE.OUT_OF_ACTION });
			await sheet._onDeathsDoorClear();
			// Unhalved: a return is not a heal, so Torment's Blessing leaves it alone (the user's ruling, 2026-09-30).
			expect(sheet._stonetopCharacter.restoreHp, slug).toHaveBeenCalledWith(8, move, { clearsDeathsDoor: true, unhalved: true });
			expect(sheet._stonetopCharacter.setDeathsDoorState, slug).not.toHaveBeenCalled();
		}
	});

	it("labels the button for it, the Ghost's as its reform", () => {
		const revenant = card(makeCardSheet("revenant", { state: DEATHS_DOOR_STATE.OUT_OF_ACTION }));
		expect(revenant.action.label).toBe("Back on your feet");
		expect(revenant.hint.text).toContain("8 HP");
		const ghost = card(makeCardSheet("ghost", { state: DEATHS_DOOR_STATE.OUT_OF_ACTION }));
		expect(ghost.action.label).toBe("Reform at your tether");
	});

	// The return is not a heal (the user's ruling, 2026-09-30): Torment's Blessing leaves it at a full half.
	it("promises a Thrall with Torment's Blessing the full half, unhalved", () => {
		const sheet = makeCardSheet("thrall", { state: DEATHS_DOOR_STATE.OUT_OF_ACTION });
		sheet.actor.flags = { "stonetop-pwd": {
			postDeathInsert: { slug: "thrall" }, postDeathLore: { counts: { "marks:torments-blessing": 1 } },
		} };
		expect(card(sheet).hint.text).toContain("8 HP");
	});

	it("still only clears the state for the living, and for a `dead` being undone", async () => {
		const living = makeCardSheet(null, { state: DEATHS_DOOR_STATE.OUT_OF_ACTION });
		await living._onDeathsDoorClear();
		expect(living._stonetopCharacter.restoreHp).not.toHaveBeenCalled();
		expect(living._stonetopCharacter.setDeathsDoorState).toHaveBeenCalledWith(null);

		const dead = makeCardSheet("ghost", { state: DEATHS_DOOR_STATE.DEAD });
		await dead._onDeathsDoorClear();
		expect(dead._stonetopCharacter.restoreHp).not.toHaveBeenCalled();
	});

	// The insert's own move button is live only while they are dying: at 0 HP otherwise, it is spent.
	it("offers the insert's move only while they are dying", () => {
		expect(card(makeCardSheet("revenant", { state: DEATHS_DOOR_STATE.DYING })).action.disabled).toBe(false);
		expect(card(makeCardSheet("revenant", { state: null })).action.disabled).toBe(true);
	});

	it("says a Ghost lost to the Final Consequence became a monster, and a lost Thrall a threat", () => {
		const monster = card(makeCardSheet("ghost", { state: DEATHS_DOOR_STATE.DEAD, lost: "monster" }));
		expect(monster.hint.text).toContain("monster under the GM's control");
		const threat = card(makeCardSheet("thrall", { state: DEATHS_DOOR_STATE.DEAD, lost: "threat" }));
		expect(threat.hint.text).toContain("threat in the GM's control");
		const door = card(makeCardSheet("ghost", { state: DEATHS_DOOR_STATE.DEAD }));
		expect(door.hint.text).toBe("They stepped through the Last Door.");
	});
});

// Undying, Tethered and Dark Succor rolled from the Moves tab or the hotbar go to their walkthrough, like
// Hard to Kill, instead of rolling a plain card that resolves nothing.
describe("StonetopCharacterSheet: an insert's 0-HP move rolled from the sheet", () => {
	function makeRollSheet(slug, state) {
		const actor = makeActor();
		actor.name = "Vess";
		const sheet = makeSheet(actor);
		sheet._stonetopCharacter = { deathsDoorState: state, zeroHpMove: zeroHpMove(slug), zeroHpResolution: zeroHpResolution(slug) };
		sheet._onDeathsDoorOpen = vi.fn(async () => {});
		// The ladder reads the move off the rolled row's item; hand it the one owned move.
		actor.items = { get: () => ({ type: "move", name: zeroHpMove(slug).name }) };
		return sheet;
	}
	const rollable = { closest: () => ({ dataset: { itemId: "m1" } }) };

	let savedUi;
	beforeEach(() => { savedUi = global.ui; global.ui = { notifications: { info: vi.fn(), warn: vi.fn() } }; });
	afterEach(() => { global.ui = savedUi; });

	it("opens the walkthrough when they are dying", async () => {
		for (const slug of ["revenant", "ghost", "thrall"]) {
			const sheet = makeRollSheet(slug, DEATHS_DOOR_STATE.DYING);
			expect(await sheet._resolveMoveRollPrompts(rollable), slug).toBe("handled");
			expect(sheet._onDeathsDoorOpen, slug).toHaveBeenCalled();
		}
	});

	it("says why nothing rolls otherwise", async () => {
		const sheet = makeRollSheet("revenant", null);
		expect(await sheet._resolveMoveRollPrompts(rollable)).toBe("handled");
		expect(sheet._onDeathsDoorOpen).not.toHaveBeenCalled();
		expect(ui.notifications.info).toHaveBeenCalledWith("Undying is Vess's move at 0 HP, and Vess is not dying.");
	});
});

// The Post-Death tab's controls (post-death-outcomes.js): the context the tab is drawn from, the one
// delegated handler its buttons go through, and the edit-mode ticks of the insert's lists.
describe("StonetopCharacterSheet Post-Death tab controls", () => {
	const purposeLore = {
		entries: [{
			slug: "terrible-purpose",
			options: [{ slug: "longing", count: 1, description: "<p><strong>LONGING</strong> &mdash; Name the person.</p>" }],
		}],
	};

	function makePdiSheet({ isGM = false } = {}) {
		installGetDataGlobals();
		const actor = makeActor();
		const char = actor.typedActor;
		char.playbook = vi.fn(async () => null);
		char.possessionTriggerMoves = vi.fn(() => ({}));
		char.deathsDoorState = null;
		char.sectionOptions = vi.fn(async () => []);
		char.debilityChoices = [];
		char.favor = () => 0;
		char.setFavor = vi.fn(async () => {});
		char.crossOffMark = vi.fn(async () => true);
		char.restoreCrossedOffMark = vi.fn(async () => true);
		char.markSectionOption = vi.fn(async () => true);
		char.unmarkSectionOption = vi.fn(async () => true);
		char.setPostDeathLoreCount = vi.fn(async () => {});
		char.holdAdvantage = vi.fn(async () => {});
		char.buildSnapshot = vi.fn(async () => ({
			...minimalSheetSnapshot({}),
			vitals: { armor: 0, xp: { value: 0, max: 8 }, hp: { value: 3, max: 8 }, damage: "d4" },
			postDeathInsert: { activeSlug: "ghost", activeInsert: { lore: purposeLore } },
		}));
		global.game.user = { isGM, getFlag: () => ({}) };
		const sheet = makeSheet(actor);
		return { sheet, char };
	}

	const button = (dataset, attrs = {}) => ({
		dataset, disabled: false, getAttribute: name => attrs[name] ?? null,
	});

	let savedUser;
	beforeEach(() => { savedUser = global.game.user; global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) }; });
	afterEach(() => { global.game.user = savedUser; delete global.ChatMessage; });

	it("hands the tab its outcome buttons in play, and none in edit mode", async () => {
		const { sheet } = makePdiSheet();
		const play = (await sheet.getData()).stonetop.postDeathTab;
		expect(play.outcomes.rows[0].title).toBe("Terrible Purpose: LONGING");
		// At 3 of 8 HP: regaining is live.
		expect(play.outcomes.rows[0].actions[0]).toMatchObject({ action: "regain-all", disabled: false });

		sheet._editMode = true;
		expect((await sheet.getData()).stonetop.postDeathTab.outcomes).toBeNull();
	});

	it("routes an outcome button to its outcome, and ignores one with nothing to do", async () => {
		const { sheet, char } = makePdiSheet();
		await sheet._onPostDeathControl(button({ pdiAction: "indulge", source: "INSATIABLE" }));
		expect(char.holdAdvantage).toHaveBeenCalledWith("Insatiable");

		char.holdAdvantage.mockClear();
		expect(sheet._onPostDeathControl(button({ pdiAction: "indulge" }, { "aria-disabled": "true" }))).toBeNull();
		expect(char.holdAdvantage).not.toHaveBeenCalled();
	});

	it("sets Favor from a pip: a ticked pip is held", async () => {
		const { sheet, char } = makePdiSheet();
		await sheet._onPostDeathControl(button({ pdiAction: "favor-pip", index: "2" }, { "aria-pressed": "false" }));
		expect(char.setFavor).toHaveBeenCalledWith(3);
		await sheet._onPostDeathControl(button({ pdiAction: "favor-pip", index: "1" }, { "aria-pressed": "true" }));
		expect(char.setFavor).toHaveBeenLastCalledWith(1);
	});

	it("keeps the Mark controls the GM's", async () => {
		const player = makePdiSheet();
		expect(player.sheet._onPostDeathControl(button({ pdiAction: "cross-off", slug: "ravenous" }))).toBeNull();
		expect(player.char.crossOffMark).not.toHaveBeenCalled();

		const gm = makePdiSheet({ isGM: true });
		await gm.sheet._onPostDeathControl(button({ pdiAction: "cross-off", slug: "ravenous" }));
		expect(gm.char.crossOffMark).toHaveBeenCalledWith("ravenous");
		await gm.sheet._onPostDeathControl(button({ pdiAction: "uncross", slug: "ravenous" }));
		expect(gm.char.restoreCrossedOffMark).toHaveBeenCalledWith("ravenous");
	});

	// B12: a Consequence ticked in edit mode goes through markSectionOption, which grants the moves some bring.
	it("routes an edit-mode Consequence tick through markSectionOption, and a Purpose tick as a count", async () => {
		const { sheet, char } = makePdiSheet();
		await sheet._onInsertLoreTick({ checked: true, dataset: { loreSlug: "consequences", optionSlug: "specter", idx: "0" } });
		expect(char.markSectionOption).toHaveBeenCalledWith("consequences", "specter");
		await sheet._onInsertLoreTick({ checked: false, dataset: { loreSlug: "consequences", optionSlug: "specter", idx: "0" } });
		expect(char.unmarkSectionOption).toHaveBeenCalledWith("consequences", "specter");
		await sheet._onInsertLoreTick({ checked: true, dataset: { loreSlug: "terrible-purpose", optionSlug: "duty", idx: "0" } });
		expect(char.setPostDeathLoreCount).toHaveBeenCalledWith("terrible-purpose", "duty", 1);
		expect(sheet.render).toHaveBeenCalled();
	});

	it("puts the Final Consequence's box back when the question is declined", async () => {
		const { sheet, char } = makePdiSheet();
		char.finalConsequenceUpdateData = vi.fn(() => ({ x: 1 }));
		char.applyUpdate = vi.fn(async () => {});
		stubConfirm(false);
		await sheet._onInsertLoreTick({ checked: true, dataset: { loreSlug: "consequences", optionSlug: "final-consequence", idx: "0" } });
		expect(char.applyUpdate).not.toHaveBeenCalled();
		expect(char.markSectionOption).not.toHaveBeenCalled();
		// The re-render is what redraws the box unticked.
		expect(sheet.render).toHaveBeenCalledWith(false);
	});
});

// A double-click on a move's title is ONE roll: the rollable click handler sits behind an in-flight guard,
// keyed by what the rollable rolls (the sheet re-renders under the second click), so a second press of the
// same rollable while the first is still asking or rolling is stopped and let go. Another move still rolls.
describe("the rollable click guard", () => {
	const doc = new Window().document;
	function rollable(itemId, label) {
		const li = doc.createElement("li");
		li.className = "item";
		li.dataset.itemId = itemId;
		const title = doc.createElement("span");
		title.className = "rollable";
		title.dataset.roll = "wis";
		title.textContent = label;
		li.appendChild(title);
		return title;
	}
	const click = target => ({ target, stopPropagation: vi.fn() });

	it("lets the same rollable's second press go while the first is in flight, and takes it again after", async () => {
		const sheet = makeSheet(makeActor());
		let finish;
		const handler = vi.fn(() => new Promise(resolve => { finish = resolve; }));
		const first = sheet._guardRollableClick(click(rollable("m1", "Seek Insight")), handler);
		// The sheet re-rendered: a new element for the same move.
		const second = click(rollable("m1", "Seek Insight"));
		expect(sheet._guardRollableClick(second, handler)).toBeUndefined();
		expect(second.stopPropagation).toHaveBeenCalled();
		expect(handler).toHaveBeenCalledTimes(1);
		finish();
		await first;
		sheet._guardRollableClick(click(rollable("m1", "Seek Insight")), handler);
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("still rolls another move while the first is in flight", () => {
		const sheet = makeSheet(makeActor());
		const handler = vi.fn(() => new Promise(() => {}));
		sheet._guardRollableClick(click(rollable("m1", "Seek Insight")), handler);
		sheet._guardRollableClick(click(rollable("m2", "Defy Danger")), handler);
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("lets the guard go when the press throws", async () => {
		const sheet = makeSheet(makeActor());
		const failing = vi.fn(async () => { throw new Error("no"); });
		await expect(sheet._guardRollableClick(click(rollable("m1", "Seek Insight")), failing)).rejects.toThrow("no");
		const handler = vi.fn(async () => {});
		await sheet._guardRollableClick(click(rollable("m1", "Seek Insight")), handler);
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
