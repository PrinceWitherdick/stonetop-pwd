import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

/**
 * HAVE WHAT YOU NEED, run for a follower — and the crew's Supplies button, which used to
 * claim to be a different move than it was.
 *
 * The move is a PLAYER move (Book I, Expeditions p.326): "when you decide that you had
 * something all along, transfer a mark (or marks) from your 'undefined' inventory to a
 * specific item or a slot." A follower reaches it the way a follower reaches any player
 * move — Order Followers, p.462: "when you direct your follower to do something that would
 * trigger a player move, and they do it, they trigger the move." It is not a playbook move,
 * so the p.463 exclusion ("followers don't have access to the PC's playbook moves") does not
 * touch it, and it has no roll, so Order Followers' +1/+0/disadvantage never applies.
 *
 * The book does not leave this to inference. On p.327 Rhianna runs it for Andras, a follower:
 * "She moves one of his undefined ◇ to a slot on the FOLLOWER SHEET, writing in 'mess kit.'"
 * And the group sidebar on p.472 names the crew for it outright:
 *
 *   "Members of a group usually Outfit with the same gear, but the player can have
 *    individuals load up with different items… Likewise, the PC can direct ONE CREW MEMBER
 *    to Have What They Need and add an item to their inventory, WITHOUT the rest of the crew
 *    each producing the same item. Keeping track of this is the player's responsibility."
 *
 * The crew was the one follower type the sheet refused the move to, citing that same page.
 * These lock down the three things that fixes:
 *
 *  1. a group asks WHICH member, and files the item the way the book writes it —
 *     "◇ ◇ litter (Lowri)" on the crew's inventory list (p.473);
 *  2. a singular follower does not ask, because it IS the member; and
 *  3. the Supplies button restocks Supplies and says so. Outfit (p.306) sets a follower's
 *     WHOLE load — "Followers need to Outfit, too!" (p.307) — and the crew's load is the
 *     diamond list above that section, which this button has never touched.
 */

const SCOPE = "stonetop-pwd";

function makeSheet(flags = {}) {
	const actor = new FakeActorBuilder().withFlags(flags).build();
	actor.id = "actor-1";
	actor.isOwner = true;
	actor.typedActor = { getUsesPerSupply: vi.fn(() => 5) };
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

// Capture the prompt and answer it the way Foundry hands a dialog its jQuery-ish `html`.
function captureDialog() {
	let data = null;
	global.Dialog = vi.fn(function (d) { data = d; this.render = vi.fn(); });
	return {
		get data() { return data; },
		get memberOptions() {
			const m = /<select class="stonetop-hwtn-member[^>]*>(.*?)<\/select>/s.exec(data.content);
			return m ? [...m[1].matchAll(/<option value="([^"]*)"/g)].map(o => o[1]) : null;
		},
		// `item` is what the player typed; `member` is the <select>'s current value, or null
		// when the prompt drew no picker at all (a singular follower).
		add: ({ item, member = null }) => data.buttons.add.callback([{
			querySelector: sel => {
				if (sel === ".stonetop-hwtn-item")   return { value: item };
				if (sel === ".stonetop-hwtn-member") return member === null ? null : { value: member };
				return null;
			},
		}]),
	};
}

beforeEach(() => {
	global.ChatMessage = { create: vi.fn(), getSpeaker: vi.fn(() => ({})) };
});

afterEach(() => {
	delete global.ChatMessage;
	delete global.Dialog;
});

describe("_followerMemberNames — who a group can produce for", () => {
	it("names the crew's named individuals first, then numbers the anonymous tail after them", () => {
		const { sheet } = makeSheet({ crew: { size: 4, individuals: [{ name: "Lowri" }, { name: "Glaw" }] } });
		expect(sheet._followerMemberNames("crew", "")).toEqual([
			"Lowri", "Glaw", "Crew member 3", "Crew member 4",
		]);
	});

	it("falls back to a numbered label for a named individual who has no name yet", () => {
		const { sheet } = makeSheet({ crew: { size: 2, individuals: [{ name: "" }, { name: "Eira" }] } });
		expect(sheet._followerMemberNames("crew", "")).toEqual(["Crew member 1", "Eira"]);
	});

	// "You've got a crew of stalwarts, six or so residents of Stonetop" (Crew, p.126) — the
	// default a crew with no size stored yet still has.
	it("defaults an unsized crew to the Marshal's half-dozen", () => {
		const { sheet } = makeSheet({ crew: { name: "The Stalwarts" } });
		expect(sheet._followerMemberNames("crew", "")).toHaveLength(6);
	});

	it("numbers a custom group follower's members, which are all anonymous", () => {
		const { sheet } = makeSheet({ customFollowers: { warband: { isGroup: true, size: 3 } } });
		expect(sheet._followerMemberNames("custom", "warband")).toEqual(["Member 1", "Member 2", "Member 3"]);
	});

	// A group at its two-member floor keeps a dead member's row, marked fallen (memberDead). The dead
	// produce nothing, so the picker leaves them out; a member who is only down at 0 HP is still offered,
	// and each keeps the number their roster row carries.
	it("leaves a custom group's fallen member out of the picker, but keeps one who is only down", () => {
		const { sheet } = makeSheet({ customFollowers: { band: {
			name: "The Band", isGroup: true, size: 3, memberHp: [0, 0, 4], memberDead: [true, null, null],
		} } });
		expect(sheet._followerMemberNames("custom", "band")).toEqual(["Member 2", "Member 3"]);
		const dialog = captureDialog();
		sheet._onHaveWhatTheyNeed("custom", "band", "The Band");
		expect(dialog.memberOptions).toEqual(["Member 2", "Member 3"]);
	});

	// Both floor members marked fallen: nobody is left to direct, and the prompt must not fall
	// back to the singular wording as if the group itself were one follower.
	it("opens no prompt for a custom group whose every member has fallen, and says why", () => {
		const { sheet } = makeSheet({ customFollowers: { band: {
			name: "The Band", isGroup: true, size: 2, memberHp: [0, 0], memberDead: [true, true],
		} } });
		const warn = vi.fn();
		const prevUi = global.ui;
		global.ui = { ...prevUi, notifications: { ...prevUi?.notifications, warn } };
		try {
			const dialog = captureDialog();
			sheet._onHaveWhatTheyNeed("custom", "band", "The Band");
			expect(dialog.data).toBeNull();
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("every member has fallen"));
		} finally {
			global.ui = prevUi;
		}
	});

	// A singular follower IS the member, so there is nobody to choose between.
	it("answers empty for a follower who is not a group", () => {
		const { sheet } = makeSheet({ customFollowers: { andras: { name: "Andras" } } });
		expect(sheet._followerMemberNames("custom", "andras")).toEqual([]);
		expect(sheet._followerMemberNames("animal-companion", "")).toEqual([]);
	});
});

describe("_onHaveWhatTheyNeed — a follower produces a needed item", () => {
	it("asks a singular follower nothing but what they produce, and files it plainly", async () => {
		const { sheet, actor } = makeSheet({ customFollowers: { andras: { name: "Andras" } } });
		const dialog = captureDialog();

		sheet._onHaveWhatTheyNeed("custom", "andras", "Andras");
		expect(dialog.memberOptions).toBeNull();

		await dialog.add({ item: "mess kit" });
		expect(actor.getFlag(SCOPE, "customFollowers.andras.gear")).toEqual([
			{ label: "mess kit", checked: true },
		]);
	});

	// p.472: ONE crew member produces it, "without the rest of the crew each producing the
	// same item" — so the item is filed against that member by name, and only that member.
	it("makes a group pick one member, and writes the item down against them", async () => {
		const { sheet, actor } = makeSheet({ crew: { size: 3, individuals: [{ name: "Lowri" }] } });
		const dialog = captureDialog();

		sheet._onHaveWhatTheyNeed("crew", "", "The Stalwarts");
		expect(dialog.memberOptions).toEqual(["Lowri", "Crew member 2", "Crew member 3"]);

		// The book's own notation for exactly this: Rhianna "writes '◇ ◇ litter (Lowri)' on
		// her crew's inventory list" (p.473).
		await dialog.add({ item: "litter", member: "Lowri" });
		expect(actor.getFlag(SCOPE, "crew.details.gear")).toEqual([
			{ label: "litter (Lowri)", checked: true },
		]);
	});

	// The crew's shared kit is the pip map at crew.gear; a thing ONE member dug out is not
	// shared, so it must not land there.
	it("keeps a member's produced item out of the crew's shared inventory pips", async () => {
		const { sheet, actor } = makeSheet({ crew: { size: 2, gear: { bow: 1 } } });
		const dialog = captureDialog();

		sheet._onHaveWhatTheyNeed("crew", "", "The Stalwarts");
		await dialog.add({ item: "chalk", member: "Crew member 1" });

		expect(actor.getFlag(SCOPE, "crew.gear")).toEqual({ bow: 1 });
	});

	it("appends rather than replacing, so a second member can produce their own thing", async () => {
		const { sheet, actor } = makeSheet({ crew: { size: 2 } });

		const first = captureDialog();
		sheet._onHaveWhatTheyNeed("crew", "", "The Stalwarts");
		await first.add({ item: "litter", member: "Crew member 1" });

		const second = captureDialog();
		sheet._onHaveWhatTheyNeed("crew", "", "The Stalwarts");
		await second.add({ item: "supplies", member: "Crew member 2" });

		expect(actor.getFlag(SCOPE, "crew.details.gear")).toEqual([
			{ label: "litter (Crew member 1)", checked: true },
			{ label: "supplies (Crew member 2)", checked: true },
		]);
	});

	it("writes nothing when the player names no item", async () => {
		const { sheet, actor } = makeSheet({ crew: { size: 2 } });
		const dialog = captureDialog();

		sheet._onHaveWhatTheyNeed("crew", "", "The Stalwarts");
		await dialog.add({ item: "   ", member: "Crew member 1" });

		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});
});

describe("_onRestockCrewSupplies — one full diamond of supplies per member", () => {
	// "By default, one ◇ of supplies contains 4 uses, but you add Stonetop's current
	// Prosperity to that" (p.88): getUsesPerSupply, 4+0 when Prosperity can't be read.
	it("fills one set per member, to 4+Prosperity uses each", async () => {
		const { sheet, actor } = makeSheet({ crew: { size: 4 } });
		await sheet._onRestockCrewSupplies();
		expect(actor.getFlag(SCOPE, "crew.supplies")).toEqual([5, 5, 5, 5]);
	});

	it("tracks the roster rather than a fixed six", async () => {
		const { sheet, actor } = makeSheet({ crew: { size: 9 } });
		await sheet._onRestockCrewSupplies();
		expect(actor.getFlag(SCOPE, "crew.supplies")).toHaveLength(9);
	});

	it("counts named individuals past the stored size, the way the roster does", async () => {
		const { sheet, actor } = makeSheet({
			crew: { size: 1, individuals: [{ name: "Lowri" }, { name: "Glaw" }, { name: "Eira" }] },
		});
		await sheet._onRestockCrewSupplies();
		expect(actor.getFlag(SCOPE, "crew.supplies")).toHaveLength(3);
	});

	// The crew's LOAD (Outfit's actual business, p.306) lives in the pip map, and restocking
	// food is not Outfitting. If this button ever grows into the whole move it should do so
	// deliberately, not by accident.
	it("leaves the crew's carried gear alone", async () => {
		const { sheet, actor } = makeSheet({ crew: { size: 2, gear: { bow: 1, "thick-hides": 2 } } });
		await sheet._onRestockCrewSupplies();
		expect(actor.getFlag(SCOPE, "crew.gear")).toEqual({ bow: 1, "thick-hides": 2 });
	});

	it("posts under its own name, not Outfit's", async () => {
		const { sheet } = makeSheet({ crew: { size: 2 } });
		await sheet._onRestockCrewSupplies();
		const [{ content }] = global.ChatMessage.create.mock.calls[0];
		expect(content).toContain("Restock supplies");
		expect(content).not.toContain("Outfit");
	});
});
