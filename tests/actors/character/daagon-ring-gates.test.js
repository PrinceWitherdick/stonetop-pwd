// The Ring of Daagon's gates (wave 3 audit, Book II pp.560-561).
//
// DAA-5: "When you make the last mark, you unlock the ring's mysteries and may Call Up the Deep Ones
// (see reverse) while wearing the ring. The ring itself becomes a follower." (p.560). The "Add as
// follower" button and Call Up used to need only a visible back, so a GM reveal or the peek setting
// let a bearer with no marks call the deep ones. The Ring only: every other summon is as it was.
//
// DAA-2: "this batch breaks free of your control and are no longer followers" (p.561). A broken-free
// batch kept its Order, Clash/Let Fly, shared Loyalty and Send Them Back buttons.
//
// DAA-6: Call Up's window had one fixed DOM id, so two Ring-bearers on one client shared it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { loadPlaybookDefs } from "../../fakes/sourcePack.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { CallUpDeepOnesDialog } from "../../../module/actors/character/dialogs/CallUpDeepOnesDialog.js";
import { StonetopDialog } from "../../../module/utils/stonetop-dialog.js";
import { RING_SOURCE_UUID, SERVANT_SOURCE_UUID, summonUnlocked } from "../../../module/data/servant-of-daagon.js";

vi.mock("../../../module/utils/ask-with-buttons.js", async importOriginal => ({
	...(await importOriginal()),
	confirmOutcome: vi.fn(async () => true),
}));

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SEEKER = loadPlaybookDefs().byName.get("The Seeker");

function sheetOver(actor) {
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return new (createStonetopCharacterSheetClass(Base))();
}

/** A bare actor whose Ring card is (or is not) unlocked. */
function bearer({ unlocked, followers = {} }) {
	const actor = {
		name: "Corvin", items: [],
		getFlag: (_scope, key) => (key === "customFollowers" ? followers : undefined),
		update: vi.fn(async () => {}),
	};
	actor.typedActor = {
		getArcanum: vi.fn(async slug => ({ slug })),
		isArcanumUnlocked: vi.fn(async () => unlocked),
		arcanaBoxStates: {},
	};
	return actor;
}

beforeEach(() => {
	global.ui = { notifications: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
	global.foundry = { ...global.foundry, utils: { ...global.foundry?.utils, randomID: () => "fresh" } };
});

describe("the Ring becomes a follower only once its mysteries are unlocked (DAA-5)", () => {
	it("gates the Ring's summon alone", () => {
		expect(summonUnlocked("ring-of-daagon", false)).toBe(false);
		expect(summonUnlocked("ring-of-daagon", true)).toBe(true);
		expect(summonUnlocked("blackwood-fetishes", false)).toBe(true);
	});

	it("refuses to add the Ring before the last mark, and adds it after", async () => {
		const locked = bearer({ unlocked: false });
		await sheetOver(locked)._onArcanaSummon("ring-of-daagon");
		expect(locked.update).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("last mark"));

		const open = bearer({ unlocked: true });
		await sheetOver(open)._onArcanaSummon("ring-of-daagon");
		const written = open.update.mock.calls[0][0]["flags.stonetop-pwd.customFollowers.fresh"];
		expect(written.sourceUuid).toBe(RING_SOURCE_UUID);
	});

	it("leaves every other arcanum's summon as it was", async () => {
		const actor = bearer({ unlocked: false });
		await sheetOver(actor)._onArcanaSummon("blackwood-fetishes");
		expect(actor.update).toHaveBeenCalled();
	});

	it("refuses Call Up before the last mark, even with a Ring follower already on the tab", async () => {
		const render = vi.spyOn(CallUpDeepOnesDialog.prototype, "render");
		const actor = bearer({ unlocked: false, followers: { ring: { name: "The Ring", sourceUuid: RING_SOURCE_UUID, loyalty: 1 } } });
		await sheetOver(actor)._onCallUpDeepOnes();
		expect(render).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("last mark"));
		render.mockRestore();
	});
});

describe("a batch that broke free is no longer a follower (DAA-2)", () => {
	const ring  = { name: "The Ring", sourceUuid: RING_SOURCE_UUID, loyalty: 2, hpMax: 0 };
	const batch = { name: "Servants of Daagon", sourceUuid: SERVANT_SOURCE_UUID, hpMax: 6, hpCurrent: 6 };
	const cards = flags => {
		const { char, actor } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", flags });
		actor.typedActor = char;
		return Object.fromEntries(sheetOver(actor)._buildFollowersData(SEEKER).custom.map(c => [c.slug, c]));
	};

	it("keeps the Ring's shared Loyalty and the Order button while the batch serves", () => {
		const { deep } = cards({ "customFollowers.ring": ring, "customFollowers.deep": batch });
		expect(deep.sharedLoyalty).toBe(true);
		expect(deep.loyaltySlug).toBe("ring");
		expect(deep.canOrder).toBe(true);
	});

	it("drops Loyalty, shared or own, and with it the Order button, once it broke free", () => {
		const { deep } = cards({ "customFollowers.ring": ring, "customFollowers.deep": { ...batch, brokenFree: true } });
		expect(deep.sharedLoyalty).toBeFalsy();
		expect(deep.loyalty).toBeNull();
		expect(deep.canOrder).toBeFalsy();
	});

	it("draws no Clash / Let Fly and no Send Them Back on it, only a way to remove it", () => {
		const hbs = readFileSync(resolve(ROOT, "templates/actor/partials/tab-followers.hbs"), "utf8");
		const fight = hbs.slice(hbs.lastIndexOf("{{#unless brokenFree}}", hbs.indexOf('stonetopOrderButton ftype="custom" moveKey="clash"')));
		expect(fight.indexOf('moveKey="clash"')).toBeLessThan(fight.indexOf("{{/unless}}"));
		const servant = hbs.slice(hbs.indexOf("{{#if isServant}}"));
		const free = servant.slice(servant.indexOf("{{#if brokenFree}}"), servant.indexOf("{{else}}"));
		expect(free).toContain("stonetop-follower-remove");
		expect(free).not.toContain("stonetop-send-back");
		expect(servant.slice(servant.indexOf("{{else}}"))).toContain("stonetop-send-back");
	});
});

describe("the Servant table is cited where the book prints it (DAA-7)", () => {
	// The Mysteries side, with Call Up, the Servant table and Send Them Back, is printed p.561;
	// p.560 is the Ring's front.
	it("cites p.561 for the Servant moves", () => {
		const src = readFileSync(resolve(ROOT, "module/data/servant-of-daagon.js"), "utf8");
		const at = src.indexOf("export const SERVANT_MOVE_OPTIONS");
		expect(src.slice(at - 300, at)).toContain("Book II p.561");
		expect(src.slice(at - 300, at)).not.toMatch(/\(Book II p\.560\)/);
	});
});

describe("Call Up's window is one per character (DAA-6)", () => {
	it("takes an id of the character's own", () => {
		const spy = vi.spyOn(StonetopDialog, "perDocumentOptions");
		new CallUpDeepOnesDialog({ id: "a1", uuid: "Actor.a1" }, { hasRing: true }, vi.fn());
		new CallUpDeepOnesDialog({ id: "b2", uuid: "Actor.b2" }, { hasRing: true }, vi.fn());
		expect(spy.mock.calls.map(c => c.slice(0, 2))).toEqual([
			["stonetop-call-up-deep-ones", "a1"], ["stonetop-call-up-deep-ones", "b2"],
		]);
		expect(StonetopDialog.perDocumentOptions("stonetop-call-up-deep-ones", "a1").id).toBe("stonetop-call-up-deep-ones-a1");
		spy.mockRestore();
	});

	it("no longer fixes one id for every window", () => {
		expect(CallUpDeepOnesDialog.defaultOptions.id).toBeUndefined();
	});
});
