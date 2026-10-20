// The Marshal's advancement, pinned to the playbook sheet (Marshal audit, 2026-09-26): the moves
// that feed the Crew's numbers (Veteran Crew, Heroes to the Last) stop counting when un-learned and
// count when taken through another playbook's cross-playbook move; the Scion's background-granted
// Veteran Crew (repeatMax 2) is told apart from one taken at a level-up; removing a copy takes back
// the pick it paid for; the Scion's free pick may be the second Veteran Crew; and the Penitent's
// +STR to Know Things (in alt-stat-grants.test.js).

import { describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, sourceMovesFor, ownedMoveNames, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { BACKGROUND_GRANT_FLAG, CREATION_PICK_FLAG } from "../../../module/actors/character/StonetopCharacter.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

const PACK    = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const pbDoc   = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });
const marshal = name => sourceMovesFor("The Marshal").find(d => d.name === name);
const heavy   = name => sourceMovesFor("The Heavy").find(d => d.name === name);
const VC      = "Veteran Crew";
const moveItem = (def, flags) => makeLiveItem({ name: def.name, type: "move", system: structuredClone(def.system), flags });
const marshalAt = (level, opts = {}) => buildLiveCharacter({ slug: "the-marshal", name: "The Marshal", level, ...opts });

const marksOf  = actor => actor.getFlag(STONETOP_SCOPE, "moves.moveMarks") ?? {};
const copiesOf = (actor, name = VC) => actor.items.filter(i => i.type === "move" && i.name === name);
const stamped  = item => item.flags[STONETOP_SCOPE]?.[BACKGROUND_GRANT_FLAG];
const bonuses  = async char => char._ownedMoveBonuses(await char.playbook(), char._buildOwnedMovesMap());
const pick     = level => ({ stat: "", level });

describe("un-learned moves give no bonuses (every playbook)", () => {
	it("Veteran Crew's crew-hp mark counts only while the move is learned, and comes back with it", async () => {
		const { char, actor } = marshalAt(2, { flags: { "moves.moveMarks": { [VC]: { "crew-hp": [pick(2)] } } } });
		const vc = await char.addMove(marshal(VC)._id);
		expect((await bonuses(char)).crewHp).toBe(2);

		await vc.setFlag(STONETOP_SCOPE, "learned", false);
		expect((await bonuses(char)).crewHp).toBe(0);
		// The mark stays stored.
		expect(marksOf(actor)[VC]["crew-hp"]).toHaveLength(1);

		await vc.setFlag(STONETOP_SCOPE, "learned", true);
		expect((await bonuses(char)).crewHp).toBe(2);
	});

	it("reads the actor's learned switch through the owned-moves map", async () => {
		const { char } = marshalAt(2, { flags: { "moves.moveMarks": { [VC]: { tags: [pick(2)] } } } });
		const vc = await char.addMove(marshal(VC)._id);
		expect((await char._ownedMoveBonuses({ name: "The Marshal" }, char._buildOwnedMovesMap())).crewTags).toBe(2);
		await vc.setFlag(STONETOP_SCOPE, "learned", false);
		expect((await char._ownedMoveBonuses({ name: "The Marshal" }, char._buildOwnedMovesMap())).crewTags).toBe(0);
	});

	it("the crew card's numbers follow: an un-learned Veteran Crew's crew-hp mark adds nothing to member HP", async () => {
		const { char } = marshalAt(2, { flags: { "moves.moveMarks": { [VC]: { "crew-hp": [pick(2)] } } } });
		const vc = await char.addMove(marshal(VC)._id);
		const memberHp = async () => (await char.buildSnapshot()).crewBonuses.memberHp;
		const learnedHp = await memberHp();
		await vc.setFlag(STONETOP_SCOPE, "learned", false);
		expect(await memberHp()).toBe(learnedHp - 2);
	});

	it("the Ranger's Magnificent Specimen, un-learned, gives the companion no extra trait picks", async () => {
		const ranger = name => sourceMovesFor("The Ranger").find(d => d.name === name);
		const { char } = buildLiveCharacter({ slug: "the-ranger", name: "The Ranger", level: 6 });
		const specimen = await char.addMove(ranger("Magnificent Specimen")._id);
		expect((await char.buildSnapshot()).companionBonuses.traitPicks).toBe(2);
		await specimen.setFlag(STONETOP_SCOPE, "learned", false);
		expect((await char.buildSnapshot()).companionBonuses.traitPicks).toBe(0);
	});

	it("the Heavy's Carved Out of Wood, un-learned, adds no HP", async () => {
		const { char } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 2, seedStartingMoves: false });
		const carved = await char.addMove(heavy("Carved Out of Wood")._id);
		expect((await bonuses(char)).hp).toBe(4);
		await carved.setFlag(STONETOP_SCOPE, "learned", false);
		expect((await bonuses(char)).hp).toBe(0);
	});
});

describe("a Crew move taken through another playbook's cross-playbook move", () => {
	// A Heavy who took Seasoned Warrior and, through it, the Marshal's Veteran Crew.
	function seasonedHeavy(marks, { learned = true } = {}) {
		const seasoned = moveItem(heavy("Seasoned Warrior"));
		const vc = moveItem(marshal(VC), { [STONETOP_SCOPE]: {
			grantedBy: { move: "Seasoned Warrior", instanceId: seasoned._id },
			...(learned ? {} : { learned: false }),
		} });
		return buildLiveCharacter({
			slug: "the-heavy", name: "The Heavy", level: 3, items: [seasoned, vc],
			flags: { "moves.moveMarks": { [VC]: marks } },
		});
	}

	it("counts its marks, as it does for a Marshal", async () => {
		const { char } = seasonedHeavy({ "crew-hp": [pick(3)], tags: [pick(3)] });
		expect(await bonuses(char)).toMatchObject({ crewHp: 2, crewTags: 2 });
	});

	it("counts nothing while un-learned", async () => {
		const { char } = seasonedHeavy({ "crew-hp": [pick(3)] }, { learned: false });
		expect((await bonuses(char)).crewHp).toBe(0);
	});

	it("counts a name's marks once however many copies are held", async () => {
		const { char, actor } = seasonedHeavy({ "crew-hp": [pick(3)] });
		actor.items.push(moveItem(marshal(VC), { [STONETOP_SCOPE]: { grantedBy: { move: "Seasoned Warrior", instanceId: "other" } } }));
		expect((await bonuses(char)).crewHp).toBe(2);
	});
});

describe("the Scion's Veteran Crew, a background grant of a repeatable move", () => {
	// A Scion made through settleBackgroundMoves, as onboarding and the Details tab do it.
	async function scion(level = 1, extra = {}) {
		const made = marshalAt(level, extra);
		const previous = made.char.backgroundState();
		await made.char.background.selectBackground("scion");
		await made.char.settleBackgroundMoves(previous);
		return made;
	}
	const switchTo = async (char, slug) => {
		const previous = char.backgroundState();
		await char.background.selectBackground(slug);
		await char.settleBackgroundMoves(previous);
	};
	const vcRow = async char => (await char.buildSnapshot()).movelist.playbookMoves.find(m => m.name === VC);

	it("comes stamped with the background", async () => {
		const { actor } = await scion();
		expect(copiesOf(actor)).toHaveLength(1);
		expect(stamped(copiesOf(actor)[0])).toBe("scion");
	});

	it("a Scion who took the second at a level-up keeps that one on becoming Penitent", async () => {
		const { char, actor } = await scion(2);
		const levelUp = await char.addMove(marshal(VC)._id);
		await switchTo(char, "penitent");

		expect(copiesOf(actor).map(i => i._id)).toEqual([levelUp._id]);
		const { movelist } = await char.buildSnapshot();
		expect(movelist.levelMovesShortfall).toBe(0);
		expect(movelist.levelMovesOverage).toBe(0);
	});

	it("a Penitent's level-up copy stays their pick on becoming a Scion, who gets their own beside it", async () => {
		const { char, actor } = marshalAt(2, { flags: { "background.selected": "penitent" } });
		const levelUp = await char.addMove(marshal(VC)._id);
		await switchTo(char, "scion");

		const copies = copiesOf(actor);
		expect(copies).toHaveLength(2);
		expect(stamped(levelUp)).toBeFalsy();
		expect(copies.filter(stamped)).toHaveLength(1);

		const row = await vcRow(char);
		expect(row.sourceLabel).toBe("Background");
		// Box 0 (the background's) is locked; the last copy, the one a later box un-ticks, is the pick.
		expect(row.ownedIds.at(-1)).toBe(levelUp._id);
		const { movelist } = await char.buildSnapshot();
		expect(movelist.levelMovesShortfall).toBe(0);
		expect(movelist.levelMovesOverage).toBe(0);
	});

	it("round trip Scion to Penitent and back leaves one stamped copy", async () => {
		const { char, actor } = await scion();
		await switchTo(char, "penitent");
		expect(copiesOf(actor)).toHaveLength(0);
		await switchTo(char, "scion");
		expect(copiesOf(actor)).toHaveLength(1);
		expect(stamped(copiesOf(actor)[0])).toBe("scion");
	});

	it("a Scion from before the stamp: the copy held is stamped, not doubled", async () => {
		const { char, actor } = marshalAt(1, { flags: { "background.selected": "scion" }, items: [moveItem(marshal(VC))] });
		await char.ensureStartingMoves();
		expect(copiesOf(actor)).toHaveLength(1);
		expect(stamped(copiesOf(actor)[0])).toBe("scion");
	});

	it("a Scion from before the stamp holding two loses only ONE on becoming Penitent", async () => {
		const first  = moveItem(marshal(VC));
		const second = moveItem(marshal(VC));
		const { char, actor } = marshalAt(2, { flags: { "background.selected": "scion" }, items: [first, second] });
		const dropped = await char.backgroundMovesDropped({ slug: "scion", setupChoices: {} }, { slug: "penitent", setupChoices: {} });
		expect(dropped.map(i => i._id)).toEqual([first._id]);
		await switchTo(char, "penitent");
		expect(copiesOf(actor).map(i => i._id)).toEqual([second._id]);
	});

	it("a non-repeatable background move already held gets no stamp and no second copy (Luminary's We Happy Few)", async () => {
		const held = moveItem(marshal("We Happy Few"));
		const { char, actor } = marshalAt(2, { flags: { "background.selected": "penitent" }, items: [held] });
		await switchTo(char, "luminary");
		expect(copiesOf(actor, "We Happy Few").map(i => i._id)).toEqual([held._id]);
		expect(stamped(held)).toBeFalsy();
	});
});

describe("removing a copy of a pick-1-each-time move takes back its pick", () => {
	it("one of two Veteran Crew: the latest-level pick goes; the last one: all go, and a re-tick starts fresh", async () => {
		const { char, actor } = marshalAt(4, { flags: { "moves.moveMarks": { [VC]: { tags: [pick(2)], "crew-hp": [pick(4)] } } } });
		await char.addMove(marshal(VC)._id);
		const second = await char.addMove(marshal(VC)._id);

		await char.removeMove(second._id);
		expect(marksOf(actor)[VC]).toMatchObject({ tags: [pick(2)], "crew-hp": [] });
		expect((await bonuses(char)).crewHp).toBe(0);

		await char.removeMove(copiesOf(actor)[0]._id);
		expect(marksOf(actor)[VC]).toBeUndefined();

		await char.addMove(marshal(VC)._id);
		expect(await bonuses(char)).toMatchObject({ crewHp: 0, crewTags: 0 });
	});

	it("leaves the marks alone while the copies left still pay for them", async () => {
		const { char, actor } = marshalAt(4, { flags: { "moves.moveMarks": { [VC]: { tags: [pick(2)] } } } });
		await char.addMove(marshal(VC)._id);
		const second = await char.addMove(marshal(VC)._id);
		await char.removeMove(second._id);
		expect(marksOf(actor)[VC]).toEqual({ tags: [pick(2)] });
	});

	it("Heroes to the Last trims the same way (latest level first across all its options)", async () => {
		const htl = "Heroes to the Last";
		const { char, actor } = marshalAt(8, { flags: { "moves.moveMarks": { [htl]: { "crew-hp": [pick(6)], exceptional: [pick(8)] } } } });
		await char.addMove(marshal(htl)._id);
		const second = await char.addMove(marshal(htl)._id);
		expect((await bonuses(char)).crewRollSteps).toBe(1);
		await char.removeMove(second._id);
		expect(marksOf(actor)[htl]).toMatchObject({ "crew-hp": [pick(6)], exceptional: [] });
		expect(await bonuses(char)).toMatchObject({ crewHp: 4, crewRollSteps: 0 });
	});
});

describe("the Scion's free pick may be the second Veteran Crew", () => {
	function onboarding(backgroundSlug, ownedMoveCounts = {}, moves = []) {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(pbDoc("the-marshal"), null, null);
		d._movesCache = sourceMovesFor("The Marshal").map(doc => ({ id: doc._id, name: doc.name, system: doc.system }));
		d._ownedMoveCounts = ownedMoveCounts;
		Object.assign(d._selections, { backgroundSlug, moves });
		return d;
	}
	const offered = d => d._freePickOffers().map(doc => doc.name);

	it("onboarding offers it to a Scion, but never the Luminary's non-repeatable We Happy Few to a Luminary", () => {
		expect(offered(onboarding("scion"))).toContain(VC);
		expect(offered(onboarding("luminary"))).not.toContain("We Happy Few");
		expect(offered(onboarding("luminary"))).toContain(VC);
	});

	it("a re-run keeps offering the one already picked, but not past repeatMax", () => {
		// Held twice: the background's and this free pick.
		expect(offered(onboarding("scion", { [VC]: 2 }, [marshal(VC)._id]))).toContain(VC);
		// Held twice with neither the free pick (a level-up took the second): no room.
		expect(offered(onboarding("scion", { [VC]: 2 }))).not.toContain(VC);
	});

	it("taken at creation: the background's copy and the pick's are told apart, and the sheet reads the pick as made", async () => {
		const { char, actor } = marshalAt(1);
		const real = await char.playbook();
		vi.spyOn(char, "playbook").mockResolvedValue({ ...real, startingMovesNote: real.startingMovesNote ?? PACK.get("the-marshal").flags.stonetop.moves.startingMovesNote });
		const previous = char.backgroundState();
		await char.background.selectBackground("scion");
		await char.settleBackgroundMoves(previous);
		// As the sheet's onboarding apply does it: settle the background, then the free pick.
		await char.addMove(marshal(VC)._id, { skipIfOwned: true });
		await char.markCreationPick(VC);

		const copies = copiesOf(actor);
		expect(copies).toHaveLength(2);
		expect(copies.filter(stamped)).toHaveLength(1);
		const picked = copies.find(i => !stamped(i));
		expect(picked.flags[STONETOP_SCOPE][CREATION_PICK_FLAG]).toBe(true);

		const { movelist } = await char.buildSnapshot();
		expect(movelist.startingMovesNote).toMatch(/1 move of your choice/);
		expect(movelist.movesIncomplete).toBe(false);
		expect(movelist.levelMovesShortfall).toBe(0);
		expect(movelist.levelMovesOverage).toBe(0);

		// A re-run that picks it again adds nothing.
		await char.addMove(marshal(VC)._id, { skipIfOwned: true });
		expect(copiesOf(actor)).toHaveLength(2);
		expect(ownedMoveNames(actor)).toContain("Crew");
	});
});

// ── A follower at 0 HP: the crew's members get the fate dialog, and SIR, PERMISSION TO DIE, SIR ──
// Marshal audit, 2026-09-26 (user's rulings). Book I p.469 gives EVERY follower at 0 HP a fate, and a
// crew member is one: named individuals and anonymous members now open the dialog like a custom
// follower does, and Dead strikes them off the roster. The Marshal's SIR, PERMISSION TO DIE, SIR ("When
// one of your followers would die, you can spend 1 of their Loyalty to have them survive (out of the
// action, but alive). If you let them go, mark XP.") is a button while LEARNED and Loyalty is held, and
// a pre-ticked "you let them go, mark XP" box that the Dead outcome reads.
// Imported here rather than at the head, so this block leaves the file's own imports alone.
const fate = await import("../../../module/actors/character/follower-fate.js");
const { createStonetopCharacterSheetClass } = await import("../../../module/actors/character/StonetopCharacterSheet.js");
const { FakeActorBuilder } = await import("../../fakes/FakeActorBuilder.js");
const { groupFollowerStanding } = await import("../../../module/utils/crew.js");
const { XP_MARK_FLAG } = await import("../../../module/utils/undo-xp-mark.js");
const { SYSTEM_ID } = await import("../../../module/system-id.js");

const SIR = "Sir, Permission to Die, Sir";
const sirMove = ({ learned = true } = {}) => ({ type: "move", name: SIR, flags: learned ? {} : { [SYSTEM_ID]: { learned: false } } });

function fateSheet({ flags = {}, items = [], xp = 0 } = {}) {
	const actor = new FakeActorBuilder().withName("Rhianna").withFlags(flags).withItems(items).withXp(xp, 8).build();
	actor.id = "marshal-1";
	actor.uuid = "Actor.marshal-1";
	actor.isOwner = true;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	return { sheet: new Sheet(), actor };
}

function withChat() {
	const create = vi.fn(async data => data);
	global.ChatMessage = { create, getSpeaker: vi.fn(() => ({})) };
	return create;
}

// Six strong: Aled and Eira named (Eira down), four anonymous behind them ("Crew member 3" to "6"),
// "Crew member 4" down.
const crewFlags = (extra = {}) => ({
	crew: {
		name: "The Wolves", size: 6, loyalty: 2,
		individuals: [{ name: "Aled" }, { name: "Eira", tag: "eager" }],
		individualsHp: { 0: 6, 1: 0 },
		memberHp: [6, 0, 6, 6],
		memberPortrait: ["a.webp", "b.webp", "c.webp", "d.webp"],
		...extra,
	},
});

describe("follower fate: the crew's members are followers too (p.469)", () => {
	it("crew roster rows open the fate dialog; pooled group HP still does not", () => {
		expect(fate.FOLLOWER_FATE_TYPES.has("crew-individual")).toBe(true);
		expect(fate.FOLLOWER_FATE_TYPES.has("crew-member")).toBe(true);
		expect(fate.FOLLOWER_FATE_TYPES.has("custom")).toBe(true);
		expect(fate.FOLLOWER_FATE_TYPES.has("crew-group")).toBe(false);
		expect(fate.FOLLOWER_FATE_TYPES.has("custom-group")).toBe(false);
	});

	it("reads the row's own HP, where unset is full and only an explicit 0 is already down", () => {
		expect(fate.followerFateHpPath("crew-individual", "", "1")).toBe("crew.individualsHp.1");
		expect(fate.followerFateHpPath("crew-member", "", 3)).toBe("crew.memberHp.3");
		expect(fate.wasStanding(undefined)).toBe(true);
		expect(fate.wasStanding(null)).toBe(true);
		expect(fate.wasStanding(4)).toBe(true);
		expect(fate.wasStanding(0)).toBe(false);
	});

	it("names a crew member by their roster row, and spends the crew's shared Loyalty", () => {
		const crew = crewFlags().crew;
		expect(fate.crewMemberFateName(crew, "crew-individual", 1)).toBe("Eira");
		expect(fate.crewMemberFateName({ individuals: [{ name: "" }] }, "crew-individual", 0)).toBe("Crew member 1");
		expect(fate.crewMemberFateName(crew, "crew-member", 1)).toBe("Crew member 4");
		expect(fate.followerFateLoyaltyType("crew-member")).toBe("crew");
		expect(fate.followerFateLoyaltyType("custom")).toBe("custom");
	});

	it("Dead strikes a named individual off the roster: HP re-keyed behind them, the headcount one lower", () => {
		const crew = crewFlags({ individuals: [{ name: "Aled" }, { name: "Eira" }, { name: "Glaw" }], individualsHp: { 0: 6, 1: 0, 2: 3 }, memberHp: [6, 6, 6] }).crew;
		const update = fate.crewMemberDeathUpdate(crew, "crew-individual", 1);
		expect(update["flags.stonetop-pwd.crew.individuals"].map(i => i.name)).toEqual(["Aled", "Glaw"]);
		expect(update["flags.stonetop-pwd.crew.individualsHp.1"]).toBe(3);
		expect(update["flags.stonetop-pwd.crew.individualsHp.-=2"]).toBe(null);
		expect(update["flags.stonetop-pwd.crew.size"]).toBe(5);
	});

	it("Dead strikes an anonymous member off: their HP and face leave by the same cut", () => {
		const update = fate.crewMemberDeathUpdate(crewFlags().crew, "crew-member", 1);
		expect(update["flags.stonetop-pwd.crew.memberHp"]).toEqual([6, 6, 6]);
		expect(update["flags.stonetop-pwd.crew.memberPortrait"]).toEqual(["a.webp", "c.webp", "d.webp"]);
		expect(update["flags.stonetop-pwd.crew.size"]).toBe(5);
	});

	it("an unset crew size (the default six) still drops to five", () => {
		const update = fate.crewMemberDeathUpdate({ individuals: [], memberHp: [0] }, "crew-member", 0);
		expect(update["flags.stonetop-pwd.crew.size"]).toBe(5);
	});

	it("never erases a member who is no longer down, or a row that is not there", () => {
		const crew = crewFlags().crew;
		expect(fate.crewMemberDeathUpdate(crew, "crew-individual", 0)).toBe(null);  // Aled is up
		expect(fate.crewMemberDeathUpdate(crew, "crew-member", 0)).toBe(null);      // standing
		expect(fate.crewMemberDeathUpdate(crew, "crew-member", 9)).toBe(null);      // past the roster
		expect(fate.crewMemberDeathUpdate(crew, "custom", 0)).toBe(null);
	});

	it("the sheet's Dead strikes the member off, and the fight's roster count follows", async () => {
		const chat = withChat();
		const { sheet, actor } = fateSheet({ flags: crewFlags() });
		const flags = () => actor.flags["stonetop-pwd"];
		expect(groupFollowerStanding(flags(), { ftype: "crew" })).toEqual({ standing: 4, size: 6 });

		await sheet._resolveFollowerFate("dead", { name: "Crew member 4", follower: "crew-member", slug: "", index: 1 });

		expect(groupFollowerStanding(flags(), { ftype: "crew" })).toEqual({ standing: 4, size: 5 });
		expect(chat).toHaveBeenCalledTimes(1);
		expect(chat.mock.calls[0][0].content).toMatch(/Crew member 4<\/strong> is dead/);
		expect(chat.mock.calls[0][0].content).toMatch(/struck off the crew roster/);
	});

	it("Death's Door and Dying leave the roster alone", async () => {
		withChat();
		const { sheet, actor } = fateSheet({ flags: crewFlags() });
		await sheet._resolveFollowerFate("dying", { name: "Eira", follower: "crew-individual", slug: "", index: 1 });
		await sheet._resolveFollowerFate("deathsdoor", { name: "Eira", follower: "crew-individual", slug: "", index: 1 });
		expect(actor.flags["stonetop-pwd"].crew.individuals).toHaveLength(2);
		expect(actor.flags["stonetop-pwd"].crew.size).toBe(6);
	});
});

describe("SIR, PERMISSION TO DIE, SIR", () => {
	it("is offered only while LEARNED; the spend also needs Loyalty, the XP box does not", () => {
		const learned = fateSheet({ items: [sirMove()] }).actor;
		const off     = fateSheet({ items: [sirMove({ learned: false })] }).actor;
		const none    = fateSheet().actor;
		expect(fate.sirPermissionOffer(learned, 2)).toEqual({ canSpare: true, letGo: true, presence: 0 });
		expect(fate.sirPermissionOffer(learned, 0)).toEqual({ canSpare: false, letGo: true, presence: 0 });
		expect(fate.sirPermissionOffer(off, 2)).toEqual({ canSpare: false, letGo: false, presence: 0 });
		expect(fate.sirPermissionOffer(none, 2).canSpare).toBe(false);
	});

	it("the dialog for a downed crew member carries the spend button and a TICKED let-go box", async () => {
		const { sheet } = fateSheet({ flags: crewFlags(), items: [sirMove()] });
		const dialog = sheet._openFollowerFate({ follower: "crew-member", slug: "", index: 1, name: "Crew member 4" });
		expect(dialog._ctx).toMatchObject({ loyalty: 2, isCrewMember: true, sir: { canSpare: true, letGo: true } });
		const data = dialog.getData();
		expect(data).toMatchObject({ canSpare: true, letGo: true });
		expect(data.spareDesc).toMatch(/crew's shared Loyalty \(2 held\)/);
		expect(data.deadDesc).toMatch(/struck off the crew roster/);

		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/follower-fate.hbs", data);
		expect(html).toMatch(/data-action="spare"/);
		expect(html).toContain("Sir, Permission to Die, Sir: spend 1 Loyalty, they survive (out of the action)");
		expect(html).toMatch(/<input type="checkbox" class="stonetop-ff-let-go" checked>/);
	});

	it("a character without the move sees neither, and a follower with no Loyalty gets no spend", async () => {
		const plain = fateSheet({ flags: crewFlags() }).sheet._openFollowerFate({ follower: "crew-member", slug: "", index: 1, name: "x" });
		const plainHtml = await renderTemplate("systems/stonetop-pwd/templates/dialogs/follower-fate.hbs", plain.getData());
		expect(plainHtml).not.toMatch(/data-action="spare"/);
		expect(plainHtml).not.toMatch(/stonetop-ff-let-go/);

		const broke = fateSheet({ flags: { customFollowers: { f1: { name: "Andras", loyalty: 0 } } }, items: [sirMove()] })
			.sheet._openFollowerFate({ follower: "custom", slug: "f1", name: "Andras" });
		expect(broke.getData()).toMatchObject({ canSpare: false, letGo: true });
	});

	it("the dialog hands the box's state to the chosen outcome", () => {
		const { sheet } = fateSheet({ flags: crewFlags(), items: [sirMove()] });
		const spy = vi.spyOn(sheet, "_resolveFollowerFate").mockResolvedValue();
		const dialog = sheet._openFollowerFate({ follower: "crew-individual", slug: "", index: 1, name: "Eira" });
		dialog._onChoose("dead", { letGo: true });
		expect(spy).toHaveBeenCalledWith("dead", expect.objectContaining({ follower: "crew-individual", index: 1, letGo: true, name: "Eira" }));
	});

	it("spending: 1 of the crew's Loyalty, attributed to the move; they stay at 0 HP and on the roster", async () => {
		const chat = withChat();
		const { sheet, actor } = fateSheet({ flags: crewFlags(), items: [sirMove()] });
		await sheet._resolveFollowerFate("spare", { name: "Eira", loyalty: 2, follower: "crew-individual", slug: "", index: 1 });

		const crew = actor.flags["stonetop-pwd"].crew;
		expect(crew.loyalty).toBe(1);
		expect(actor.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.crew.loyalty": 1 }, { stonetopMove: SIR });
		expect(crew.individuals).toHaveLength(2);
		expect(crew.individualsHp[1]).toBe(0);
		expect(chat.mock.calls[0][0].content).toMatch(/Eira<\/strong> survives: out of the action, but alive\. 1 Loyalty spent, 1 left\./);
	});

	it("spending on a custom follower uses their own Loyalty track and leaves them un-fallen", async () => {
		withChat();
		const { sheet, actor } = fateSheet({ flags: { customFollowers: { f1: { name: "Andras", loyalty: 1, hpCurrent: 0 } } }, items: [sirMove()] });
		await sheet._resolveFollowerFate("spare", { name: "Andras", loyalty: 1, follower: "custom", slug: "f1" });
		expect(actor.flags["stonetop-pwd"].customFollowers.f1.loyalty).toBe(0);
		expect(actor.flags["stonetop-pwd"].customFollowers.f1.dead).toBeUndefined();
	});

	it("nothing is spent when the move is not learned or the Loyalty is gone", async () => {
		const chat = withChat();
		const off = fateSheet({ flags: crewFlags(), items: [sirMove({ learned: false })] });
		await off.sheet._resolveFollowerFate("spare", { name: "Eira", follower: "crew-individual", slug: "", index: 1 });
		expect(off.actor.flags["stonetop-pwd"].crew.loyalty).toBe(2);

		const broke = fateSheet({ flags: crewFlags({ loyalty: 0 }), items: [sirMove()] });
		await broke.sheet._resolveFollowerFate("spare", { name: "Eira", follower: "crew-individual", slug: "", index: 1 });
		expect(broke.actor.flags["stonetop-pwd"].crew.loyalty).toBe(0);
		expect(chat).not.toHaveBeenCalled();
	});

	it("letting them go: Dead with the box ticked marks 1 XP on the Marshal, on ONE card with an Undo", async () => {
		const chat = withChat();
		const { sheet, actor } = fateSheet({ flags: crewFlags(), items: [sirMove()], xp: 3 });
		await sheet._resolveFollowerFate("dead", { name: "Eira", follower: "crew-individual", slug: "", index: 1, letGo: true });

		expect(actor.system.attributes.xp.value).toBe(4);
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.xp.value": 4 }, { stonetopMove: SIR });
		expect(chat).toHaveBeenCalledTimes(1);
		const card = chat.mock.calls[0][0];
		expect(card.flags[SYSTEM_ID][XP_MARK_FLAG]).toBe(1);
		expect(card.content).toMatch(/Eira<\/strong> is dead/);
		expect(card.content).toMatch(/You let them go, and mark XP\./);
		expect(actor.flags["stonetop-pwd"].crew.individuals.map(i => i.name)).toEqual(["Aled"]);
	});

	it("no XP when the box is unticked, when the move is not learned, or for any outcome but Dead", async () => {
		withChat();
		const unticked = fateSheet({ flags: crewFlags(), items: [sirMove()], xp: 3 });
		await unticked.sheet._resolveFollowerFate("dead", { name: "Eira", follower: "crew-individual", slug: "", index: 1, letGo: false });
		expect(unticked.actor.system.attributes.xp.value).toBe(3);

		const off = fateSheet({ flags: crewFlags(), items: [sirMove({ learned: false })], xp: 3 });
		await off.sheet._resolveFollowerFate("dead", { name: "Eira", follower: "crew-individual", slug: "", index: 1, letGo: true });
		expect(off.actor.system.attributes.xp.value).toBe(3);

		const dying = fateSheet({ flags: crewFlags(), items: [sirMove()], xp: 3 });
		await dying.sheet._resolveFollowerFate("dying", { name: "Eira", follower: "crew-individual", slug: "", index: 1, letGo: true });
		expect(dying.actor.system.attributes.xp.value).toBe(3);
	});

	it("applies to any follower: a custom follower let go is marked fallen and the XP is marked", async () => {
		withChat();
		const { sheet, actor } = fateSheet({ flags: { customFollowers: { f1: { name: "Andras", loyalty: 1, hpCurrent: 0 } } }, items: [sirMove()], xp: 0 });
		await sheet._resolveFollowerFate("dead", { name: "Andras", follower: "custom", slug: "f1", letGo: true });
		expect(actor.flags["stonetop-pwd"].customFollowers.f1.dead).toBe(true);
		expect(actor.system.attributes.xp.value).toBe(1);
	});
});

// Marshal re-audit (2026-10-18), the user's ruling: FRONT LINE LEADER's "Spend Presence in lieu of your crew's
// Loyalty" pays Sir, Permission to Die, Sir's spend too, for the crew only, even when the crew holds no Loyalty.
describe("SIR, PERMISSION TO DIE, SIR paid with Front Line Leader's Presence", () => {
	const FLL = "Front Line Leader";
	const fllMove = () => ({ type: "move", name: FLL, system: { resource: { max: 2, title: "Presence" } }, flags: {} });
	const presenceSheet = ({ presence = 2, flags = crewFlags(), items = [sirMove(), fllMove()] } = {}) => {
		const built = fateSheet({ flags, items });
		const tracks = { [FLL]: presence };
		built.actor.typedActor = { moveResources: {
			getMoveResources: () => tracks,
			setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
		} };
		return { ...built, tracks };
	};

	it("offers the Presence for the crew only, while Sir is learned", () => {
		const { actor } = presenceSheet();
		expect(fate.sirPermissionOffer(actor, 0, { ftype: "crew" })).toEqual({ canSpare: false, letGo: true, presence: 2 });
		expect(fate.sirPermissionOffer(actor, 1, { ftype: "custom" }).presence).toBe(0);
		expect(fate.sirPermissionOffer(presenceSheet({ items: [fllMove()] }).actor, 1, { ftype: "crew" }).presence).toBe(0);
		expect(fate.sirPermissionOffer(presenceSheet({ presence: 0 }).actor, 1, { ftype: "crew" }).presence).toBe(0);
	});

	it("the dialog for a downed crew member at 0 Loyalty carries the Presence spare", async () => {
		const { sheet } = presenceSheet({ flags: crewFlags({ loyalty: 0 }) });
		const dialog = sheet._openFollowerFate({ follower: "crew-member", slug: "", index: 1, name: "Crew member 4" });
		const data = dialog.getData();
		expect(data).toMatchObject({ canSpare: false, canSparePresence: true });
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/follower-fate.hbs", data);
		expect(html).not.toMatch(/data-action="spare"/);
		expect(html).toMatch(/data-action="sparePresence"/);
		expect(html).toContain("spend 1 Presence (2 held) in place of the crew&#x27;s Loyalty");

		const custom = presenceSheet({ flags: { customFollowers: { f1: { name: "Andras", loyalty: 0 } } } })
			.sheet._openFollowerFate({ follower: "custom", slug: "f1", name: "Andras" });
		expect(custom.getData().canSparePresence).toBe(false);
	});

	it("spending: 1 Presence off the Marshal, the crew's Loyalty left alone, they stay on the roster", async () => {
		const chat = withChat();
		const { sheet, actor, tracks } = presenceSheet();
		await sheet._resolveFollowerFate("sparePresence", { name: "Eira", loyalty: 2, follower: "crew-individual", slug: "", index: 1 });
		expect(tracks[FLL]).toBe(1);
		expect(actor.typedActor.moveResources.setUses).toHaveBeenCalledWith(FLL, 1, { stonetopMove: FLL });
		expect(actor.flags["stonetop-pwd"].crew.loyalty).toBe(2);
		expect(actor.flags["stonetop-pwd"].crew.individuals).toHaveLength(2);
		expect(chat.mock.calls[0][0].content).toMatch(/Eira<\/strong> survives: out of the action, but alive\. 1 Presence spent in place of the crew's Loyalty \(Front Line Leader\), 1 left\./);
	});

	it("nothing is spent with no Presence held, or for anyone but the crew", async () => {
		const chat = withChat();
		const broke = presenceSheet({ presence: 0 });
		await broke.sheet._resolveFollowerFate("sparePresence", { name: "Eira", follower: "crew-individual", slug: "", index: 1 });
		expect(broke.actor.typedActor.moveResources.setUses).not.toHaveBeenCalled();
		const custom = presenceSheet({ flags: { customFollowers: { f1: { name: "Andras", loyalty: 0, hpCurrent: 0 } } } });
		await custom.sheet._resolveFollowerFate("sparePresence", { name: "Andras", follower: "custom", slug: "f1" });
		expect(custom.tracks[FLL]).toBe(2);
		expect(chat).not.toHaveBeenCalled();
	});
});

// ── The crew card (Marshal audit, 2026-09-26) ────────────────────────────────────────────────────────
// Exceptional comes from Heroes to the Last's pick alone (the user's ruling), so "Roll +N" and the roll
// agree; the crew's armor is the kit it carries; Shield Wall counts only while learned; a mark option
// whose target is at its cap is greyed; onboarding counts only real crew-tag picks.
// Imported here rather than at the head, so this block leaves the file's own imports alone.
const crewSheetMod    = await import("../../../module/actors/character/StonetopCharacterSheet.js");
const crewMasters     = await import("../../../module/actors/character/follower-masters.js");
const crewBuild       = await import("../../../module/data/follower-build.js");
const crewMarkBudget  = await import("../../../module/actors/character/move-mark-budget.js");
const crewDialogs     = await import("../../../module/actors/character/dialogs/OrderFollowersDialog.js");

const HTL = "Heroes to the Last";
const CREW = { name: "The Wolves", tags: ["brave"], instinct: "x", cost: "y" };

function crewCardSheet(char, actor) {
	actor.typedActor = char;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return new (crewSheetMod.createStonetopCharacterSheetClass(Base))();
}

// The crew card as the Followers tab draws it, with the snapshot's crew stats.
async function crewCard(char, actor) {
	const snap = await char.buildSnapshot();
	return crewCardSheet(char, actor)._buildFollowersData(await char.playbook(), null, snap.crewBonuses).crew;
}

// A level-6 Marshal holding Veteran Crew and Heroes to the Last, with the given marks.
async function marshalWithHeroes(marks = {}, extraFlags = {}) {
	const made = marshalAt(6, { flags: { crew: { ...CREW }, "moves.moveMarks": marks, ...extraFlags } });
	await made.char.addMove(marshal(VC)._id);
	const htl = await made.char.addMove(marshal(HTL)._id);
	return { ...made, htl };
}

describe("the crew card: exceptional is Heroes to the Last's pick, the one source", () => {
	it("the card and its Roll +N agree: exceptional only while the pick is marked on a learned copy", async () => {
		const { char, actor, htl } = await marshalWithHeroes({ [HTL]: { exceptional: [pick(6)] } });
		let card = await crewCard(char, actor);
		expect(card.exceptional).toBe(true);
		expect(card.rollMod).toBe(2);
		expect(card.exceptionalDerived).toBe(true);

		await htl.setFlag(STONETOP_SCOPE, "learned", false);
		card = await crewCard(char, actor);
		expect(card.exceptional).toBe(false);
		expect(card.rollMod).toBe(1);
	});

	it("a stored hand toggle from before is ignored for the crew", async () => {
		const { char, actor } = await marshalWithHeroes({ [HTL]: { "crew-hp": [pick(6)] } }, { crew: { ...CREW, details: { exceptional: true } } });
		const card = await crewCard(char, actor);
		expect(card.exceptional).toBe(false);
		expect(card.rollMod).toBe(1);
		expect(crewMasters.crewIsExceptional(actor)).toBe(false);
	});

	it("a crew member's own row inherits it", async () => {
		const { char, actor } = await marshalWithHeroes({ [HTL]: { exceptional: [pick(6)] } }, { crew: { ...CREW, individuals: [{ name: "Aled" }] } });
		const card = await crewCard(char, actor);
		expect(card.individuals[0].exceptional).toBe(true);
	});

	it("every order of the crew rolls it, whatever the button said", async () => {
		const opened = [];
		const spy = vi.spyOn(crewDialogs.OrderFollowersDialog.prototype, "render").mockImplementation(function () { opened.push(this._follower); return this; });
		try {
			const { char, actor } = await marshalWithHeroes({ [HTL]: { exceptional: [pick(6)] } });
			await crewCardSheet(char, actor).orderFollower({ name: "The Wolves", tags: [], moves: [], exceptional: false }, { ftype: "crew", slug: "" });
			expect(opened.at(-1).exceptional).toBe(true);

			const legacy = await marshalWithHeroes({}, { crew: { ...CREW, details: { exceptional: true } } });
			await crewCardSheet(legacy.char, legacy.actor).orderFollower({ name: "The Wolves", tags: [], moves: [], exceptional: true }, { ftype: "crew", slug: "" });
			expect(opened.at(-1).exceptional).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it("other followers keep their own stored toggle", () => {
		const actor = { items: [], flags: { [STONETOP_SCOPE]: { customFollowers: { f1: { exceptional: true } } } } };
		expect(crewMasters.followerExceptional(actor, "custom", "f1")).toBe(true);
		expect(crewMasters.followerExceptional(actor, "custom", "f2")).toBe(false);
	});
});

describe("the crew card: armor from the kit they carry", () => {
	const INV = [
		{ slug: "shield", weight: 2, armorBonus: 1 },
		{ slug: "thick-hides", weight: 2, armor: 1 },
		{ slug: "cloak", weight: 1 },
	];

	it("counts a row once every pip is filled: hides 1, shield +1, both 2", () => {
		expect(crewBuild.crewGearArmor(INV, {})).toBe(0);
		expect(crewBuild.crewGearArmor(INV, { "thick-hides": 2 })).toBe(1);
		expect(crewBuild.crewGearArmor(INV, { "thick-hides": 1 })).toBe(0);
		expect(crewBuild.crewGearArmor(INV, { shield: 2 })).toBe(1);
		expect(crewBuild.crewGearArmor(INV, { shield: true, "thick-hides": 2, cloak: 1 })).toBe(2);
	});

	// One rule for the shield's armor and its Readiness (the sheet's Defend reads crewBearsShield too).
	it("crewBearsShield: the shield row carried in full, the same rule the armor reads", () => {
		expect(crewBuild.crewBearsShield(INV, { shield: 1 })).toBe(false);
		expect(crewBuild.crewBearsShield(INV, { shield: 2 })).toBe(true);
		expect(crewBuild.crewBearsShield(INV, { shield: true })).toBe(true);
		expect(crewBuild.crewBearsShield(INV, {})).toBe(false);
		expect(crewBuild.crewBearsShield([], { shield: 2 })).toBe(false);
		expect(crewBuild.crewBearsShield(null, { shield: 2 })).toBe(false);
	});

	it("the pack's crew inventory carries the numbers", () => {
		const rows = PACK.get("the-marshal").flags.stonetop.crew.inventory;
		expect(rows.find(r => r.slug === "thick-hides").armor).toBe(1);
		expect(rows.find(r => r.slug === "shield").armorBonus).toBe(1);
	});

	it("the card's armor follows the carried kit, and a hand-set armor still wins", async () => {
		const { char, actor } = marshalAt(2, { flags: { crew: { ...CREW, gear: { "thick-hides": 2, shield: 2 } } } });
		expect((await crewCard(char, actor)).armor).toBe(2);
		await actor.setFlag(STONETOP_SCOPE, "crew.gear", { "thick-hides": 2 });
		expect((await crewCard(char, actor)).armor).toBe(1);
		await actor.setFlag(STONETOP_SCOPE, "crew.details.armor", 3);
		expect((await crewCard(char, actor)).armor).toBe(3);
	});
});

describe("the crew card: Shield Wall counts only while learned and formed", () => {
	it("an un-learned Shield Wall leaves the shield's +1 Readiness", async () => {
		const { char, actor } = marshalAt(2, { flags: { crew: { ...CREW, gear: { shield: 2 }, readiness: 2, shieldWall: true } } });
		const wall = await char.addMove(marshal("Shield Wall")._id);
		const formed = await crewCard(char, actor);
		expect(formed.readinessShieldWall).toBe(true);
		expect(formed.readinessPips).toHaveLength(5);
		await wall.setFlag(STONETOP_SCOPE, "learned", false);
		const card = await crewCard(char, actor);
		expect(card.readinessShieldWall).toBe(false);
		expect(card.readinessPips).toHaveLength(4);
	});

	// The Marshal's re-audit, the user's ruling (2026-10-18): the cap rises to 5 only while the wall stands.
	it("a learned Shield Wall the crew has not formed keeps the cap at 4", async () => {
		const { char, actor } = marshalAt(2, { flags: { crew: { ...CREW, gear: { shield: 2 }, readiness: 2 } } });
		await char.addMove(marshal("Shield Wall")._id);
		const card = await crewCard(char, actor);
		expect(card.readinessShieldWall).toBe(false);
		expect(card.readinessPips).toHaveLength(4);
	});
});

describe("a mark option whose target is at its cap is greyed (Heroes to the Last's max d10)", () => {
	it("markOptionCapNote reads the option's own cap against the crew's die", () => {
		const opt = { crewDamageStep: 1, crewDamageCap: "d10" };
		expect(crewMarkBudget.markOptionCapNote(opt, { crewDamageDie: "d8" })).toBe(null);
		expect(crewMarkBudget.markOptionCapNote(opt, { crewDamageDie: "d10" })).toBe("Their damage die is already d10");
		expect(crewMarkBudget.markOptionCapNote({ crewHp: 4 }, { crewDamageDie: "d10" })).toBe(null);
	});

	it("the move card: at d10 the unticked box locks with the reason, the ticked one stays editable", async () => {
		// d6, d8 from Veteran Crew, d10 from Heroes' first damage box. A second Heroes copy gives the budget room.
		const { char } = await marshalWithHeroes({ [VC]: { "crew-damage": [pick(2)] }, [HTL]: { "crew-damage": [pick(6)] } });
		await char.addMove(marshal(HTL)._id);
		const snap = await char.buildSnapshot();
		expect(snap.crewBonuses.damageDie).toBe("d10");
		const cards = snap.moves.flatMap(c => c.moves);
		const damage = cards.find(m => m.name === HTL).markOptions.find(o => o.slug === "crew-damage");
		expect(damage.capNote).toBe("Their damage die is already d10");
		expect(damage.checks.map(c => c.disabled)).toEqual([false, true]);
		expect(cards.find(m => m.name === HTL).markOptions.find(o => o.slug === "crew-hp").capNote).toBe(null);
		// Veteran Crew's own d6-to-d8 box is ticked, so it stays editable.
		const vcDamage = cards.find(m => m.name === VC).markOptions.find(o => o.slug === "crew-damage");
		expect(vcDamage.checks.map(c => c.disabled)).toEqual([false]);
	});

	it("the level-up data carries the crew's die for the mark step", async () => {
		const { char } = await marshalWithHeroes({ [VC]: { "crew-damage": [pick(2)] }, [HTL]: { "crew-damage": [pick(6)] } });
		expect((await char.getLevelUpData()).markCapState).toEqual({ crewDamageDie: "d10" });
	});
});

describe("onboarding counts only real crew-tag picks", () => {
	function crewOnboarding(backgroundSlug, tags, crewTagBonus = 0) {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(pbDoc("the-marshal"), null, null);
		d._movesCache = sourceMovesFor("The Marshal").map(doc => ({ id: doc._id, name: doc.name, system: doc.system }));
		d._ownedMoveCounts = {};
		d._crewTagBonus = crewTagBonus;
		d._selections.backgroundSlug = backgroundSlug;
		Object.assign(d._selections.crew, { tags: [...tags], instinct: "x", cost: "y" });
		return d;
	}

	it("a Penitent who picked respected + brave and became a Scion has one pick, not 2/2", () => {
		const d = crewOnboarding("penitent", ["respected", "brave"]);
		expect(d._isStepComplete("crew")).toBe(true);
		d._applyBackgroundChange("scion");
		expect(d._crewPickedTags()).toEqual(["brave"]);
		expect(d._isStepComplete("crew")).toBe(false);
		// The Scion's Veteran Crew asks its "Go mark it now" pick; one that adds no tags.
		d._setCreationMark("Veteran Crew", 0, "crew-hp");
		// Room for the second pick, and no more.
		expect(d._toggleCrewTag("cunning", true)).toBe(true);
		expect(d._isStepComplete("crew")).toBe(true);
		expect(d._toggleCrewTag("hardy", true)).toBe(false);
	});

	it("a stored tag the background grants is not counted even without a background change", () => {
		const d = crewOnboarding("scion", ["respected", "brave"]);
		expect(d._crewPickedTags()).toEqual(["brave"]);
		expect(d._isStepComplete("crew")).toBe(false);
	});

	it("Veteran Crew's marked extra tags raise the cap", () => {
		const d = crewOnboarding("penitent", ["brave", "cunning"], 2);
		expect(d._crewTagLimit()).toBe(4);
		expect(d._isStepComplete("crew")).toBe(false);
		expect(d._toggleCrewTag("hardy", true)).toBe(true);
		expect(d._toggleCrewTag("patient", true)).toBe(true);
		expect(d._toggleCrewTag("athletic", true)).toBe(false);
		expect(d._isStepComplete("crew")).toBe(true);
	});
});

// ── A crew borrowed through a learned Crew (Marshal audit, 2026-09-26, user's ruling) ────────────────
// A character who takes Crew through Dabbler / Worldly / Seasoned Warrior / Versatile has a crew, drawn
// from the one Crew insert (StonetopCharacter#crewSource): its numbers, its pickers and its kit are the
// Marshal's insert's, it gets no background tag (that is the insert's word to the Marshal), and a
// "Create your crew" button sets it up, since onboarding's crew step follows the character's OWN
// playbook. Un-learning Crew hides the card and keeps the flags.
// Imported here rather than at the head, so this block leaves the file's own imports alone.
const crewSetup = await import("../../../module/actors/character/dialogs/CrewSetupDialog.js");
const { crewBackgroundTag } = await import("../../../module/utils/crew.js");

const MARSHAL_CREW = PACK.get("the-marshal").flags.stonetop.crew;

// A Heavy who took Seasoned Warrior and, through it, the Marshal's Crew.
function heavyWithCrew({ learned = true, flags = {}, extra = [] } = {}) {
	const seasoned = moveItem(heavy("Seasoned Warrior"));
	const crewMove = moveItem(marshal("Crew"), { [STONETOP_SCOPE]: {
		grantedBy: { move: "Seasoned Warrior", instanceId: seasoned._id },
		...(learned ? {} : { learned: false }),
	} });
	const made = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3, items: [seasoned, crewMove, ...extra], flags });
	return { ...made, crewMove };
}

// The Followers tab's groups, as getData builds them: the snapshot's crew stats and the crew insert.
async function followerGroups(char, actor) {
	const snap = await char.buildSnapshot();
	const playbookDoc = await char.playbook();
	const sheet = crewCardSheet(char, actor);
	return sheet._buildFollowersData(playbookDoc, null, snap.crewBonuses, undefined, await char.crewSource(playbookDoc));
}

describe("a crew borrowed through a learned Crew", () => {
	it("crewSource: the Marshal's own insert; a learned Crew borrows it; none without, or switched off", async () => {
		expect(await marshalAt(1).char.crewSource()).toMatchObject({ availableTags: MARSHAL_CREW.availableTags });
		expect(await buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3 }).char.crewSource()).toBeNull();
		const borrowed = await heavyWithCrew().char.crewSource();
		expect(borrowed.availableTags).toEqual(MARSHAL_CREW.availableTags);
		expect(borrowed.inventory.map(i => i.slug)).toEqual(MARSHAL_CREW.inventory.map(i => i.slug));
		expect(await heavyWithCrew({ learned: false }).char.crewSource()).toBeNull();
	});

	it("the crew's numbers come off the insert and the borrowed Veteran Crew's marks", async () => {
		const vc = moveItem(marshal(VC), { [STONETOP_SCOPE]: { grantedBy: { move: "Seasoned Warrior", instanceId: "x" } } });
		const { char } = heavyWithCrew({ extra: [vc], flags: { "moves.moveMarks": { [VC]: { "crew-hp": [pick(3)], tags: [pick(3)] } } } });
		const { crewBonuses } = await char.buildSnapshot();
		expect(crewBonuses).toMatchObject({ memberHp: MARSHAL_CREW.hp + 2, damageDie: MARSHAL_CREW.damageDie, rollMod: MARSHAL_CREW.roll, tagBonus: 2 });
	});

	it("draws the crew card from the Marshal's insert: its kit and its individuals' lists", async () => {
		const { char, actor } = heavyWithCrew({ flags: { crew: { ...CREW } } });
		const { crew, crewSetupOffer } = await followerGroups(char, actor);
		expect(crew).toBeTruthy();
		expect(crew.name).toBe("The Wolves");
		expect(crew.gear.map(g => g.slug)).toEqual(MARSHAL_CREW.inventory.map(i => i.slug));
		expect(crew.individualOptions).toEqual(MARSHAL_CREW.individualOptions);
		expect(crewSetupOffer).toBe(false);
	});

	it("gets no background tag, whatever its keeper's background is called", async () => {
		// A Heavy's background can never be "scion", but the tag is the Marshal's alone either way.
		const { char, actor } = heavyWithCrew({ flags: { crew: { ...CREW }, "background.selected": "scion" } });
		const { crew } = await followerGroups(char, actor);
		expect(crew.tags.map(t => t.label)).toEqual(["group", "brave"]);   // p.144: every crew is a group
		expect(crew.tagAutoLabel).toBeNull();
		expect(crewBackgroundTag(await char.playbook(), MARSHAL_CREW, "scion")).toBeNull();
		// The Marshal's own does.
		expect(crewBackgroundTag(PACK.get("the-marshal").flags.stonetop, MARSHAL_CREW, "scion")).toBe("respected");
	});

	it("un-learning Crew hides the card and keeps the flags; learning it again brings it back", async () => {
		const { char, actor, crewMove } = heavyWithCrew({ flags: { crew: { ...CREW } } });
		await crewMove.setFlag(STONETOP_SCOPE, "learned", false);
		const hidden = await followerGroups(char, actor);
		expect(hidden.crew).toBeNull();
		expect(hidden.crewSetupOffer).toBe(false);
		expect(actor.getFlag(STONETOP_SCOPE, "crew.name")).toBe("The Wolves");
		await crewMove.setFlag(STONETOP_SCOPE, "learned", true);
		expect((await followerGroups(char, actor)).crew?.name).toBe("The Wolves");
	});

	it("offers Create your crew to a borrowed Crew with none set up, and to a Marshal whose onboarding stopped short", async () => {
		const heavyMade = heavyWithCrew();
		expect((await followerGroups(heavyMade.char, heavyMade.actor)).crewSetupOffer).toBe(true);
		const marshalMade = marshalAt(1);
		expect((await followerGroups(marshalMade.char, marshalMade.actor)).crewSetupOffer).toBe(true);
		const plainHeavy = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3 });
		expect((await followerGroups(plainHeavy.char, plainHeavy.actor)).crewSetupOffer).toBe(false);
	});

	it("Create your crew writes the same crew flags onboarding does, with no background tag for a non-Marshal", async () => {
		const opened = [];
		const spy = vi.spyOn(crewSetup.CrewSetupDialog.prototype, "promise").mockImplementation(async function () {
			opened.push(this);
			return { name: " The Anvils ", tags: ["hardy", "stubborn"], instinct: "To take things too far", cost: "Victories won against worthy foes" };
		});
		try {
			const { char, actor } = heavyWithCrew({ flags: { "background.selected": "sheriff" } });
			const sheet = crewCardSheet(char, actor);
			expect(await sheet._onCreateCrew()).toBe(true);
			expect(opened[0]._bgTag).toBeNull();
			expect(opened[0]._limit).toBe(2);
			expect(actor.getFlag(STONETOP_SCOPE, "crew")).toMatchObject({
				name: "The Anvils", tags: ["hardy", "stubborn"], instinct: "To take things too far", cost: "Victories won against worthy foes",
			});
			const { crew, crewSetupOffer } = await followerGroups(char, actor);
			expect(crew.name).toBe("The Anvils");
			expect(crewSetupOffer).toBe(false);

			// A Scion Marshal's dialog shows respected locked on, and never stores it.
			const scion = marshalAt(1, { flags: { "background.selected": "scion" } });
			await crewCardSheet(scion.char, scion.actor)._onCreateCrew();
			expect(opened[1]._bgTag).toBe("respected");
		} finally {
			spy.mockRestore();
		}
	});

	it("nothing is written when the dialog is closed, or for a character with no Crew", async () => {
		const spy = vi.spyOn(crewSetup.CrewSetupDialog.prototype, "promise").mockResolvedValue(null);
		try {
			const { char, actor } = heavyWithCrew();
			expect(await crewCardSheet(char, actor)._onCreateCrew()).toBe(false);
			expect(actor.getFlag(STONETOP_SCOPE, "crew")).toBeNull();
			const plain = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3 });
			expect(await crewCardSheet(plain.char, plain.actor)._onCreateCrew()).toBe(false);
			expect(spy).toHaveBeenCalledTimes(1);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("the crew setup dialog's picks", () => {
	const flagKey = key => ["flags", STONETOP_SCOPE, "crew", key].join(".");

	it("picks 2 tags, plus Veteran Crew's marked extras, and refuses one past the limit", () => {
		expect(crewSetup.crewSetupLimit(MARSHAL_CREW)).toBe(2);
		expect(crewSetup.crewSetupLimit(MARSHAL_CREW, 2)).toBe(4);
		let sel = crewSetup.crewSetupInitial({}, null);
		sel = crewSetup.crewSetupToggleTag(sel, "brave", true, 2).sel;
		sel = crewSetup.crewSetupToggleTag(sel, "hardy", true, 2).sel;
		const refused = crewSetup.crewSetupToggleTag(sel, "cunning", true, 2);
		expect(refused.ok).toBe(false);
		expect(refused.sel.tags).toEqual(["brave", "hardy"]);
		expect(crewSetup.crewSetupToggleTag(sel, "brave", false, 2).sel.tags).toEqual(["hardy"]);
	});

	it("a written-in tag spends a pick; the name is optional, the instinct and cost are not", () => {
		let sel = crewSetup.crewSetupToggleTag(crewSetup.crewSetupInitial(), "brave", true, 2).sel;
		sel = crewSetup.crewSetupCustomTag(sel, " stubborn ", MARSHAL_CREW, 2);
		expect(sel.tags).toEqual(["brave", "stubborn"]);
		expect(crewSetup.crewSetupReady(sel, 2)).toBe(false);
		sel = { ...sel, instinct: "To lord over others", cost: "Merry-making, as a group" };
		expect(crewSetup.crewSetupReady(sel, 2)).toBe(true);
		expect(crewSetup.crewSetupReady(sel, 4)).toBe(false);
	});

	it("starts from a half-made crew, less the background's tag and group", () => {
		expect(crewSetup.crewSetupInitial({ name: "Wolves", tags: ["respected", "group", "brave"], instinct: "x" }, "respected"))
			.toEqual({ name: "Wolves", tags: ["brave"], instinct: "x", cost: "" });
	});

	it("writes the four crew flags onboarding writes", () => {
		expect(crewSetup.crewSetupUpdate({ name: " Wolves ", tags: ["brave"], instinct: "x", cost: "y" })).toEqual({
			[flagKey("name")]: "Wolves",
			[flagKey("tags")]: ["brave"],
			[flagKey("instinct")]: "x",
			[flagKey("cost")]: "y",
		});
	});

	it("draws the insert's lists, the background tag locked on, and Create greyed until ready", async () => {
		const sel = { name: "", tags: ["brave"], instinct: "", cost: "" };
		const view = crewSetup.crewSetupView(MARSHAL_CREW, sel, { bgTag: "respected", limit: 2 });
		expect(view.tags.find(t => t.slug === "respected")).toMatchObject({ isAuto: true, isSelected: true, disabled: true });
		expect(view.tags.find(t => t.slug === "brave")).toMatchObject({ isSelected: true, disabled: false });
		expect(view.instincts).toHaveLength(MARSHAL_CREW.instincts.length);
		expect(view.ready).toBe(false);

		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/crew-setup.hbs", { crewData: view });
		expect(html).toMatch(/<em>respected<\/em> \(from your background\)/);
		expect(html).toMatch(/class="stonetop-crew-setup-create[^"]*" disabled/);
		expect(html).toContain("Create the crew");

		const ready = crewSetup.crewSetupView(MARSHAL_CREW, { ...sel, tags: ["brave", "hardy"], instinct: "a", cost: "b" }, { limit: 2 });
		const readyHtml = await renderTemplate("systems/stonetop-pwd/templates/dialogs/crew-setup.hbs", { crewData: ready });
		expect(readyHtml).not.toMatch(/class="stonetop-crew-setup-create[^"]*" disabled/);
		expect(readyHtml).not.toMatch(/from your background/);
		// Written-in instinct and cost come back in their own fields.
		expect(ready.customInstinct).toBe("a");
		expect(ready.customCost).toBe("b");
	});
});

// ── A custom GROUP follower's members count too (follower-fate.js) ──────────────────────────────────
// The same p.469 fate the crew's members get: a member of a warband (or any custom follower flagged a
// group) crossing to 0 opens the dialog, named by their roster row, spending the GROUP's Loyalty, and
// Dead cuts them out of the roster. A group keeps at least two, so the last two keep their slots.

// Four strong, "Member 2" down.
const bandFlags = (extra = {}) => ({
	customFollowers: {
		band: {
			name: "The Band", isGroup: true, size: 4, hpMax: 4, loyalty: 2,
			memberHp: [4, 0, 3, null],
			memberPortrait: ["a.webp", "b.webp", "c.webp", "d.webp"],
			...extra,
		},
	},
});

describe("follower fate: a custom group's members are followers too", () => {
	it("a custom group's roster rows open the dialog, read their own HP, and spend the group's Loyalty", () => {
		expect(fate.FOLLOWER_FATE_TYPES.has("custom-member")).toBe(true);
		expect(fate.followerFateHpPath("custom-member", "band", "1")).toBe("customFollowers.band.memberHp.1");
		const { actor } = fateSheet({ flags: bandFlags() });
		expect(fate.wasStanding(actor.getFlag("stonetop-pwd", fate.followerFateHpPath("custom-member", "band", 1)))).toBe(false);
		expect(fate.wasStanding(actor.getFlag("stonetop-pwd", fate.followerFateHpPath("custom-member", "band", 3)))).toBe(true);
		expect(fate.followerFateLoyaltyType("custom-member")).toBe("custom");
		expect(fate.customMemberFateName(1)).toBe("Member 2");
	});

	it("Dead cuts the member's HP and face out of the roster and drops the headcount by one", () => {
		const update = fate.customMemberDeathUpdate(bandFlags().customFollowers.band, "band", 1);
		expect(update).toEqual({
			"flags.stonetop-pwd.customFollowers.band.memberHp":       [4, 3, null],
			"flags.stonetop-pwd.customFollowers.band.memberPortrait": ["a.webp", "c.webp", "d.webp"],
			"flags.stonetop-pwd.customFollowers.band.size":           3,
		});
	});

	it("never erases a member who is no longer down, a row past the roster, or anyone in a group of one", () => {
		const band = bandFlags().customFollowers.band;
		expect(fate.customMemberDeathUpdate(band, "band", 0)).toBe(null);   // standing
		expect(fate.customMemberDeathUpdate(band, "band", 3)).toBe(null);   // unset is full HP
		expect(fate.customMemberDeathUpdate(band, "band", 9)).toBe(null);   // past the roster
		expect(fate.customMemberDeathUpdate({ ...band, isGroup: false }, "band", 1)).toBe(null);
		expect(fate.customMemberDeathUpdate(band, "", 1)).toBe(null);
	});

	it("a group down to two keeps both slots, and marks the dead one fallen so they read as dead, not down", () => {
		const pair = bandFlags({ size: 2, memberHp: [4, 0] }).customFollowers.band;
		const update = fate.customMemberDeathUpdate(pair, "band", 1);
		expect(update).toEqual({ "flags.stonetop-pwd.customFollowers.band.memberDead": [null, true] });
		expect(fate.customMemberStruckOff(update, "band")).toBe(false);
		expect(fate.customMemberStruckOff(fate.customMemberDeathUpdate(bandFlags().customFollowers.band, "band", 1), "band")).toBe(true);
		// A mark already there is kept, the array written whole.
		expect(fate.customMemberDeathUpdate({ ...pair, memberHp: [0, 0], memberDead: [true] }, "band", 1))
			.toEqual({ "flags.stonetop-pwd.customFollowers.band.memberDead": [true, true] });
	});

	it("a cut above the floor moves the fallen marks with the rows", () => {
		const band = bandFlags({ memberHp: [0, 0, 3, null], memberDead: [true, null, null, true] }).customFollowers.band;
		expect(fate.customMemberDeathUpdate(band, "band", 1)).toMatchObject({
			"flags.stonetop-pwd.customFollowers.band.memberHp":   [0, 3, null],
			"flags.stonetop-pwd.customFollowers.band.memberDead": [true, null, true],
		});
	});

	it("a fallen member counts as down, and setting their HP above 0 by hand clears the mark", () => {
		const flags = bandFlags({ size: 2, memberHp: [4, 0], memberDead: [null, true] });
		expect(groupFollowerStanding(flags, { ftype: "custom", slug: "band" })).toEqual({ standing: 1, size: 2 });
		// Even a stale HP left in the slot does not stand them up while the mark is on.
		const stale = bandFlags({ size: 2, memberHp: [4, 3], memberDead: [null, true] });
		expect(groupFollowerStanding(stale, { ftype: "custom", slug: "band" })).toEqual({ standing: 1, size: 2 });
		expect(fate.followerReviveUpdate("custom-member", "band", 2, flags, "1"))
			.toEqual({ "flags.stonetop-pwd.customFollowers.band.memberDead": [null, null] });
		expect(fate.followerReviveUpdate("custom-member", "band", 0, flags, 1)).toBeNull();
		expect(fate.followerReviveUpdate("custom-member", "band", 2, flags, 0)).toBeNull();   // not fallen
	});

	it("the sheet's Dead strikes the member off, and the fight's roster count follows", async () => {
		const chat = withChat();
		const { sheet, actor } = fateSheet({ flags: bandFlags() });
		const flags = () => actor.flags["stonetop-pwd"];
		expect(groupFollowerStanding(flags(), { ftype: "custom", slug: "band" })).toEqual({ standing: 3, size: 4 });

		await sheet._resolveFollowerFate("dead", { name: "Member 2", follower: "custom-member", slug: "band", index: 1 });

		expect(groupFollowerStanding(flags(), { ftype: "custom", slug: "band" })).toEqual({ standing: 3, size: 3 });
		expect(flags().customFollowers.band.memberPortrait).toEqual(["a.webp", "c.webp", "d.webp"]);
		// The group itself is not the one who fell.
		expect(flags().customFollowers.band.dead).toBeUndefined();
		expect(chat.mock.calls[0][0].content).toMatch(/Member 2<\/strong> is dead/);
		expect(chat.mock.calls[0][0].content).toMatch(/struck off the group(&#x27;|')s roster/);
	});

	it("at two, Dead leaves the roster as it is and the card says why", async () => {
		const chat = withChat();
		const { sheet, actor } = fateSheet({ flags: bandFlags({ size: 2, memberHp: [4, 0], memberPortrait: ["a.webp", "b.webp"] }) });
		await sheet._resolveFollowerFate("dead", { name: "Member 2", follower: "custom-member", slug: "band", index: 1 });
		const band = actor.flags["stonetop-pwd"].customFollowers.band;
		expect(band.size).toBe(2);
		expect(band.memberHp).toEqual([4, 0]);
		// Marked fallen, so nothing can take them for merely down.
		expect(band.memberDead).toEqual([null, true]);
		expect(groupFollowerStanding(actor.flags["stonetop-pwd"], { ftype: "custom", slug: "band" })).toEqual({ standing: 1, size: 2 });
		expect(chat.mock.calls[0][0].content).toMatch(/down to two/);
		expect(chat.mock.calls[0][0].content).toMatch(/marked fallen/);
	});

	it("the Followers tab draws a fallen member greyed with the Fallen badge, and does not count them standing", async () => {
		const { char, actor } = marshalAt(1, { flags: bandFlags({ size: 2, memberHp: [4, 0], memberDead: [null, true] }) });
		const card = (await followerGroups(char, actor)).custom.find(c => c.slug === "band");
		expect(card.groupMembers.map(m => [m.label, m.dead])).toEqual([["Member 1", false], ["Member 2", true]]);
		expect(card.memberCount).toBe(1);
		const { readFileSync } = await import("node:fs");
		const source = readFileSync("templates/actor/partials/tab-followers.hbs", "utf8");
		const row = /{{#each groupMembers}}([\s\S]*?){{\/each}}/.exec(source.slice(source.indexOf('data-section="roster:custom:')))?.[1] ?? "";
		expect(row).toMatch(/stonetop-crew-member-row{{#if dead}} is-dead{{\/if}}/);
		expect(row).toMatch(/{{#if dead}}<span class="stonetop-follower-dead-badge"[^>]*>.*Fallen/);
	});

	it("a row healed since the dialog opened is left alone", async () => {
		withChat();
		const warn = vi.fn();
		globalThis.ui = { ...(globalThis.ui ?? {}), notifications: { warn } };
		const { sheet, actor } = fateSheet({ flags: bandFlags({ memberHp: [4, 2, 3, null] }) });
		await sheet._resolveFollowerFate("dead", { name: "Member 2", follower: "custom-member", slug: "band", index: 1 });
		expect(actor.flags["stonetop-pwd"].customFollowers.band.size).toBe(4);
		expect(warn).toHaveBeenCalled();
	});

	it("the dialog spends the group's Loyalty and words Dead for the group's roster", () => {
		const { sheet } = fateSheet({ flags: bandFlags(), items: [sirMove()] });
		const dialog = sheet._openFollowerFate({ follower: "custom-member", slug: "band", index: 1, name: "Member 2" });
		expect(dialog._ctx).toMatchObject({ name: "Member 2", loyalty: 2, isGroupMember: true, isCrewMember: false, sir: { canSpare: true } });
		const data = dialog.getData();
		expect(data.spareDesc).toMatch(/group's shared Loyalty \(2 held\)/);
		expect(data.deadDesc).toMatch(/struck off the group's roster/);
	});

	it("Sir, Permission to Die, Sir spends 1 of the group's Loyalty; the member stays at 0 HP on the roster", async () => {
		withChat();
		const { sheet, actor } = fateSheet({ flags: bandFlags(), items: [sirMove()] });
		await sheet._resolveFollowerFate("spare", { name: "Member 2", loyalty: 2, follower: "custom-member", slug: "band", index: 1 });
		const band = actor.flags["stonetop-pwd"].customFollowers.band;
		expect(band.loyalty).toBe(1);
		expect(band.memberHp).toEqual([4, 0, 3, null]);
		expect(band.size).toBe(4);
	});
});

// ── Shield Wall in full, and followers lose Readiness on offense (re-audit, the user's ruling 2026-10-18) ──
const { stubAsk: stubOffenseAsk } = await import("../../fakes/confirm.js");

describe("the crew ordered on the offense, and the Marshal's shield wall", () => {
	/** Open the crew's order, answer the window with `result`, and roll `total`. */
	async function orderCrew(char, actor, result, total = 10) {
		let onRoll = null;
		const spy = vi.spyOn(crewDialogs.OrderFollowersDialog.prototype, "render").mockImplementation(function () { onRoll = this._onRoll; return this; });
		try {
			await crewCardSheet(char, actor).orderFollower({ name: "The Wolves", tags: [], moves: [], exceptional: false }, { ftype: "crew", slug: "" });
		} finally {
			spy.mockRestore();
		}
		char.onOrderFollowersRoll = vi.fn(async () => ({ total }));
		await onRoll({ bonus: 1, rollMode: "normal", followerName: "The Wolves", ...result });
		return char.onOrderFollowersRoll;
	}
	function stubWindow(answer) {
		const { document } = globalThis;
		const { applications } = globalThis.foundry;
		globalThis.document = { createElement: () => ({}) };
		const asked = stubOffenseAsk(answer);
		return { asked, restore: () => { globalThis.document = document; globalThis.foundry.applications = applications; } };
	}
	const crewOf = actor => actor.getFlag(STONETOP_SCOPE, "crew");

	it("a crew holding Readiness ordered to Clash is asked before the dice, and rushing in loses it", async () => {
		const chat = withChat();
		const { char, actor } = marshalAt(2, { flags: { crew: { ...CREW, readiness: 2 } } });
		const { asked, restore } = stubWindow("lose");
		try {
			const rolled = await orderCrew(char, actor, { moveKey: "clash", moveName: "The Wolves: Clash" });
			expect(asked).toHaveBeenCalledTimes(1);
			expect(asked.mock.calls[0][0].window.title).toBe("The Wolves holds 2 Readiness");
			expect(rolled).toHaveBeenCalled();
		} finally {
			restore();
		}
		expect(crewOf(actor).readiness).toBe(0);
		expect(chat.mock.calls.map(c => c[0].content).join(" ")).toContain("The Wolves goes on the offense (Clash)");
	});

	it("a Shield Wall Defend forms the wall, and a shield-bearing crew's 10+ holds 5 on its own", async () => {
		const chat = withChat();
		const { char, actor } = marshalAt(2, { flags: { crew: { ...CREW, gear: { shield: 2 } } } });
		await char.addMove(marshal("Shield Wall")._id);
		await orderCrew(char, actor, { moveKey: "defend", moveName: "The Wolves: Defend", shieldWall: true }, 10);
		expect(crewOf(actor)).toMatchObject({ readiness: 5, shieldWall: true });
		const card = chat.mock.calls.map(c => c[0].content).join(" ");
		expect(card).toContain("holds <strong>5</strong> Readiness (with the shield wall's +2)");
		expect(card).toContain("Shield Wall: they hold formation, and can go on the offensive without losing Readiness.");
		// The pips allow all 5 while formed.
		expect((await crewCard(char, actor)).readinessPips).toHaveLength(5);
	});

	it("a 7-9 Shield Wall Defend holds 3; without shields the wall forms but adds nothing", async () => {
		withChat();
		const shields = marshalAt(2, { flags: { crew: { ...CREW, gear: { shield: 2 } } } });
		await shields.char.addMove(marshal("Shield Wall")._id);
		await orderCrew(shields.char, shields.actor, { moveKey: "defend", shieldWall: true }, 8);
		expect(crewOf(shields.actor).readiness).toBe(3);
		const bare = marshalAt(2, { flags: { crew: { ...CREW } } });
		await bare.char.addMove(marshal("Shield Wall")._id);
		await orderCrew(bare.char, bare.actor, { moveKey: "defend", shieldWall: true }, 8);
		expect(crewOf(bare.actor)).toMatchObject({ readiness: 1, shieldWall: true });
	});

	it("a crew in formation ordered to Clash is asked to hold the wall, and holding keeps it; a plain Defend breaks the wall", async () => {
		const chat = withChat();
		const { char, actor } = marshalAt(2, { flags: { crew: { ...CREW, gear: { shield: 2 }, readiness: 5, shieldWall: true } } });
		await char.addMove(marshal("Shield Wall")._id);
		const { asked, restore } = stubWindow("keep");
		try {
			await orderCrew(char, actor, { moveKey: "clash" });
			expect(asked).toHaveBeenCalledTimes(1);
			expect(asked.mock.calls[0][0].window.title).toBe("The Wolves hold the shield wall");
			expect(asked.mock.calls[0][0].buttons.find(b => b.default)?.action).toBe("keep");
		} finally {
			restore();
		}
		expect(crewOf(actor)).toMatchObject({ readiness: 5, shieldWall: true });
		expect(chat.mock.calls.map(c => c[0].content).join(" ")).toContain("Shield Wall: The Wolves hold formation and keep their 5 Readiness (Clash).");
		// Ordered to Defend without the wall: out of formation. The 5 held stays held (a Defend never lowers the
		// pool), drawn as 5 pips, but the card no longer reads the wall.
		await orderCrew(char, actor, { moveKey: "defend", shieldWall: false }, 10);
		expect(crewOf(actor)).toMatchObject({ readiness: 5, shieldWall: false });
		expect((await crewCard(char, actor)).readinessShieldWall).toBe(false);
	});

	// "As long as they maintain formation" (p.126): breaking it to charge is the player's choice, and it costs.
	it("a crew in formation that breaks it to Clash loses its Readiness and the wall, and the wall stays broken", async () => {
		const chat = withChat();
		const { char, actor } = marshalAt(2, { flags: { crew: { ...CREW, gear: { shield: 2 }, readiness: 5, shieldWall: true } } });
		await char.addMove(marshal("Shield Wall")._id);
		const { restore } = stubWindow("lose");
		let rolled;
		try {
			rolled = await orderCrew(char, actor, { moveKey: "clash" });
		} finally {
			restore();
		}
		expect(rolled).toHaveBeenCalled();
		expect(crewOf(actor)).toMatchObject({ readiness: 0, shieldWall: false });
		expect(chat.mock.calls.map(c => c[0].content).join(" ")).toContain("The Wolves break formation to charge (Clash): they lose all held Readiness, and the shield wall is gone.");
	});

	// The crew card's rule (follower-build.js#crewBearsShield): a shield counts once both its pips are marked.
	it("a half-marked shield gives a Shield Wall Defend no +2", async () => {
		withChat();
		const { char, actor } = marshalAt(2, { flags: { crew: { ...CREW, gear: { shield: 1 } } } });
		await char.addMove(marshal("Shield Wall")._id);
		await orderCrew(char, actor, { moveKey: "defend", shieldWall: true }, 10);
		expect(crewOf(actor)).toMatchObject({ readiness: 3, shieldWall: true });
	});
});
