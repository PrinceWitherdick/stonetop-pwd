import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture what the Order dialog is handed, without drawing it.
const opened = [];
vi.mock("../../../module/actors/character/dialogs/OrderFollowersDialog.js", () => ({
	OrderFollowersDialog: class {
		static defaultOptions = { classes: ["stonetop"] };
		constructor(actor, follower, onRoll) { opened.push({ actor, follower, onRoll }); }
		render() { return this; }
	},
}));

import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

/**
 * The character sheet's `orderFollower`, the one door every Order goes through (the Followers tab's
 * buttons and a follower's token on the map), hands a GROUP's members to the dialog, so one of them can
 * be directed on their own: "When a PC directs an individual member of a group, they can trigger moves as
 * if they were a follower themselves" (Book I p.471). That is how Glaw Lets Fly while the rest of the
 * crew Clashes. An order that already names a member (a crew individual's own button) is left alone.
 */

function makeSheet(flags = {}) {
	const actor = new FakeActorBuilder().withFlags(flags).build();
	actor.id = "rhianna";
	actor.isOwner = true;
	actor.typedActor = { onOrderFollowersRoll: vi.fn(async () => ({ total: 8 })) };
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

const crewFlags = {
	crew: {
		name: "The Crew", size: 3,
		individuals: [{ name: "Glaw", tag: "small", traits: ["too serious"] }],
		individualsHp: {}, memberHp: [5, 0],
	},
};

beforeEach(() => { opened.length = 0; });

describe("orderFollower", () => {
	it("offers a crew ordered as a whole each member still standing, with their own tags", async () => {
		const { sheet } = makeSheet(crewFlags);
		await sheet.orderFollower({ name: "The Crew", tags: ["archers"], moves: [], exceptional: false, moveKey: "clash" }, { ftype: "crew", slug: "" });
		expect(opened).toHaveLength(1);
		expect(opened[0].follower).toMatchObject({
			name: "The Crew", tags: ["archers"], moveKey: "clash",
			members: [
				{ key: "named:0", name: "Glaw", tags: ["small", "too serious"] },
				{ key: "anon:0", name: "Crew member 2", tags: [] },
			],
		});
	});

	it("offers no members when the order already names one (a crew individual's own button)", async () => {
		const { sheet } = makeSheet(crewFlags);
		await sheet.orderFollower({ name: "Glaw", tags: ["archers", "small"], member: "Glaw" }, { ftype: "crew", slug: "" });
		expect(opened[0].follower.members).toBeUndefined();
	});

	it("offers no members for a follower who is one person", async () => {
		const { sheet } = makeSheet({ initiateDetails: { enfys: {} } });
		await sheet.orderFollower({ name: "Enfys", tags: ["brave"] }, { ftype: "initiate", slug: "enfys" });
		expect(opened[0].follower.members).toBeUndefined();
	});

	it("offers a custom group's members too", async () => {
		const { sheet } = makeSheet({ customFollowers: { posse: { name: "The Posse", isGroup: true, size: 2 } } });
		await sheet.orderFollower({ name: "The Posse", tags: [] }, { ftype: "custom", slug: "posse" });
		expect(opened[0].follower.members.map(m => m.name)).toEqual(["Member 1", "Member 2"]);
	});

	it("is told by a crew individual's own button that the order is theirs, and by no other button", () => {
		// The Followers tab's real Order-button partial, rendered the two ways the tab calls it.
		const source = fs.readFileSync(path.resolve(import.meta.dirname, "../../../templates/actor/partials/tab-followers.hbs"), "utf8");
		const inline = /\{\{#\*inline "stonetopOrderButton"\}\}[\s\S]*?\{\{\/inline\}\}/.exec(source)?.[0];
		expect(inline).toBeTruthy();
		const render = Handlebars.compile(`${inline}{{> stonetopOrderButton ftype="crew" slug="" moveKey="clash" caption="Clash"}}`
			+ `{{#each individuals}}{{> stonetopOrderButton ftype="crew" slug="" member=orderName caption="Order"}}{{/each}}`);
		const html = render({ orderName: "The Crew", orderTagsCsv: "archers", individuals: [{ orderName: "Glaw", orderTagsCsv: "archers|small" }] });
		const buttons = html.match(/<button[\s\S]*?>/g);
		expect(buttons).toHaveLength(2);
		expect(buttons[0]).not.toContain("data-member");
		expect(buttons[1]).toContain('data-member="Glaw"');
	});

	it("rolls whatever the dialog decides as the character's own Order Followers roll", async () => {
		const { sheet, actor } = makeSheet(crewFlags);
		await sheet.orderFollower({ name: "The Crew", tags: ["archers"] }, { ftype: "crew", slug: "" });
		const result = { bonus: 1, rollMode: "normal", moveName: "Glaw: Let Fly", moveKey: "let-fly", followerName: "Glaw", member: "named:0" };
		await opened[0].onRoll(result);
		// Nothing was spent on a balk, so the roll carries no Loyalty step.
		expect(actor.typedActor.onOrderFollowersRoll).toHaveBeenCalledWith({ ...result, loyaltySpent: null, attack: { ftype: "crew", slug: "", name: "Glaw" } });
	});
});

// They balk (p.466-467): the window's box spends 1 of the crew's Loyalty before the dice, and the roll is
// handed the step so its card can say so. The window also opens on the Loyalty they hold.
describe("orderFollower and a balk", () => {
	it("opens on the Loyalty held, and spends 1 of it before the roll when the box was ticked", async () => {
		const { sheet, actor } = makeSheet({ crew: { ...crewFlags.crew, loyalty: 2 } });
		actor.update = vi.fn(async () => {});
		await sheet.orderFollower({ name: "The Crew", tags: ["archers"] }, { ftype: "crew", slug: "" });
		expect(opened[0].follower.loyalty).toBe(2);
		await opened[0].onRoll({ bonus: 0, rollMode: "normal", moveKey: "defy-danger", followerName: "The Crew", spendLoyalty: true });
		const written = actor.update.mock.calls.map(c => c[0]);
		expect(written.some(u => Object.entries(u).some(([k, v]) => k.endsWith("crew.loyalty") && v === 1))).toBe(true);
		expect(actor.typedActor.onOrderFollowersRoll.mock.calls[0][0].loyaltySpent).toEqual({ from: 2, to: 1 });
	});

	// Front Line Leader (Marshal, p.126): "Spend Presence in lieu of your crew's Loyalty".
	it("hands the crew's window the Marshal's Presence, and pays a balk with it when asked, not with Loyalty", async () => {
		const FLL = "Front Line Leader";
		const { sheet, actor } = makeSheet({ crew: { ...crewFlags.crew, loyalty: 1 } });
		actor.items = [{ type: "move", name: FLL, system: { resource: { max: 2, title: "Presence" } }, flags: {} }];
		const tracks = { [FLL]: 2 };
		actor.typedActor.moveResources = { getMoveResources: () => tracks, setUses: vi.fn(async (move, value) => { tracks[move] = value; }) };
		actor.update = vi.fn(async () => {});
		await sheet.orderFollower({ name: "The Crew", tags: [] }, { ftype: "crew", slug: "" });
		expect(opened[0].follower.presence).toBe(2);
		await opened[0].onRoll({ bonus: 0, rollMode: "normal", moveKey: "defy-danger", followerName: "The Crew", spendLoyalty: true, payWithPresence: true });
		expect(tracks[FLL]).toBe(1);
		expect(actor.update).not.toHaveBeenCalledWith(expect.objectContaining({ "flags.stonetop-pwd.crew.loyalty": 0 }), expect.anything());
		const handed = actor.typedActor.onOrderFollowersRoll.mock.calls[0][0];
		expect(handed.presenceSpent).toEqual({ from: 2, to: 1 });
		expect(handed.loyaltySpent).toBe(null);
	});

	it("offers no Presence to a follower who is not the crew", async () => {
		const { sheet, actor } = makeSheet({ customFollowers: { f1: { name: "Andras", loyalty: 0 } } });
		actor.items = [{ type: "move", name: "Front Line Leader", system: { resource: { max: 2 } }, flags: {} }];
		actor.typedActor.moveResources = { getMoveResources: () => ({ "Front Line Leader": 2 }), setUses: vi.fn() };
		await sheet.orderFollower({ name: "Andras", tags: [] }, { ftype: "custom", slug: "f1" });
		expect(opened[0].follower.presence).toBe(0);
	});
});

// An ordered Clash or Let Fly carries on into the follower's damage (p.462), and a Clash that misses suffers
// the enemy's attack at once (p.215), on the follower's own token (fight/follower-order-attack.js).
describe("orderFollower and an attack", () => {
	it("hands the roll a damage button for Clash and Let Fly, and none for any other move", async () => {
		const { sheet, actor } = makeSheet(crewFlags);
		await sheet.orderFollower({ name: "The Crew", tags: [] }, { ftype: "crew", slug: "" });
		await opened[0].onRoll({ bonus: 0, rollMode: "normal", moveKey: "let-fly", followerName: "Glaw" });
		await opened[0].onRoll({ bonus: 0, rollMode: "normal", moveKey: "defy-danger", followerName: "Glaw" });
		const [first, second] = actor.typedActor.onOrderFollowersRoll.mock.calls.map(c => c[0]);
		expect(first.attack).toEqual({ ftype: "crew", slug: "", name: "Glaw" });
		expect(second).not.toHaveProperty("attack");
	});

	it("strikes the counter-blow when an ordered Clash misses, and not on a hit or another move", async () => {
		const { sheet, actor } = makeSheet(crewFlags);
		sheet._followerSuffersCounter = vi.fn(async () => true);
		await sheet.orderFollower({ name: "The Crew", tags: [] }, { ftype: "crew", slug: "" });
		actor.typedActor.onOrderFollowersRoll.mockResolvedValueOnce({ total: 5 });
		await opened[0].onRoll({ moveKey: "clash", followerName: "The Crew" });
		actor.typedActor.onOrderFollowersRoll.mockResolvedValueOnce({ total: 9 });
		await opened[0].onRoll({ moveKey: "clash", followerName: "The Crew" });
		actor.typedActor.onOrderFollowersRoll.mockResolvedValueOnce({ total: 4 });
		await opened[0].onRoll({ moveKey: "let-fly", followerName: "The Crew" });
		expect(sheet._followerSuffersCounter).toHaveBeenCalledTimes(1);
		expect(sheet._followerSuffersCounter).toHaveBeenCalledWith({ ftype: "crew", slug: "" });
	});
});
