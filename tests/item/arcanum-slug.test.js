import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStonetopItemClass } from "../../module/item/StonetopItem.js";
import { isArcanumData } from "../../module/item/createArcanum.js";

// Every arcanum card needs a slug: it is the identity key for each holder's marks, unlock counts
// and owned/identified/flipped lists, so a card without one keys all of that off "".
//
// That is an invariant of the DOCUMENT, and it is stamped here, at _preCreate. It used to be
// repaired by the editor's `getData` — which made a render responsible for fixing stored data,
// and only ever reached cards somebody happened to open in edit mode. A card built by macro or
// console and never edited stayed slug-less while players held marks against it.

beforeEach(() => {
	globalThis.foundry = { utils: { randomID: vi.fn(() => "IDIDIDIDIDIDIDID") } };
	globalThis.game = { items: [] };
});

/**
 * A pending document, as `_preCreate` sees one: the source data already applied to `this`, with
 * `updateSource` patching it before the write.
 */
function pending(source) {
	const Base = class {
		constructor(data) { Object.assign(this, data); }
		async _preCreate() { return undefined; }
	};
	const item = new (createStonetopItemClass(Base))(source);
	item.updateSource = vi.fn(patch => {
		for (const [path, value] of Object.entries(patch)) {
			const keys = path.split(".");
			let at = item;
			for (const key of keys.slice(0, -1)) at = (at[key] ??= {});
			at[keys.at(-1)] = value;
		}
	});
	return item;
}

const arcanum = (flags = {}) => ({
	name: "The Azure Hand", type: "move", system: { moveType: "arcanum" },
	flags: { stonetop: flags },
});

describe("isArcanumData", () => {
	// `move` is the catch-all Item sub-type, so `system.moveType` is what decides.
	it("counts an arcanum card and nothing else", () => {
		expect(isArcanumData(arcanum())).toBe(true);
		expect(isArcanumData({ type: "move", system: { moveType: "inventory" } })).toBe(false);
		expect(isArcanumData({ type: "move", system: { moveType: "basic" } })).toBe(false);
		expect(isArcanumData({ type: "playbook", system: {} })).toBe(false);
		expect(isArcanumData(null)).toBe(false);
	});
});

describe("StonetopItem#_preCreate — the arcanum slug", () => {
	it("stamps one on a card that arrives without", async () => {
		const item = pending(arcanum());
		await item._preCreate({}, {}, {});

		expect(item.updateSource).toHaveBeenCalledTimes(1);
		expect(item.flags.stonetop.slug).toBe("arc-IDIDIDIDIDIDIDID");
	});

	// A card built by macro or console carries no flags at all — the case the editor's repair
	// existed for, and the one that used to slip through when nobody opened it.
	it("stamps one on a card carrying no flags at all", async () => {
		const item = pending({ name: "Hand-built", type: "move", system: { moveType: "arcanum" } });
		await item._preCreate({}, {}, {});

		expect(item.flags.stonetop.slug).toBe("arc-IDIDIDIDIDIDIDID");
	});

	// The one that matters most: a shipped pack card and a card from createArcanumItem both
	// arrive WITH a slug, and rewriting it would orphan every mark in the world pointing at it.
	it("leaves a slug the card already carries alone", async () => {
		const item = pending(arcanum({ slug: "azure-hand" }));
		await item._preCreate({}, {}, {});

		expect(item.updateSource).not.toHaveBeenCalled();
		expect(item.flags.stonetop.slug).toBe("azure-hand");
	});

	// The sidebar's Duplicate copies the whole document, slug and all. Two cards on one slug is
	// two cards wearing each other's play state — marks, unlock counts and the owned/identified/
	// flipped lists are all keyed by it — and the editor doesn't show the slug, so there is no
	// screen on which a GM could even see the clash. Core stamps a copy with
	// `_stats.duplicateSource` (Document#clone's `addSource`), which is what settles it.
	it("re-mints the slug on a copy rather than letting two cards share one identity", async () => {
		const item = pending({
			...arcanum({ slug: "azure-hand" }),
			_stats: { duplicateSource: "Item.abcdefabcdefabcd" },
		});
		await item._preCreate({}, {}, {});

		expect(item.flags.stonetop.slug).toBe("arc-IDIDIDIDIDIDIDID");
	});

	// A duplicate made inside a compendium has no world collection to compare against, which is
	// why the stamp is checked before the sweep and the sweep is skipped there entirely.
	it("re-mints a copy made inside a compendium too", async () => {
		const item = pending({
			...arcanum({ slug: "azure-hand" }), pack: "stonetop.stonetop-arcana",
			_stats: { duplicateSource: "Compendium.stonetop.stonetop-arcana.Item.abcdefabcdefabcd" },
		});
		await item._preCreate({}, {}, {});

		expect(item.flags.stonetop.slug).toBe("arc-IDIDIDIDIDIDIDID");
	});

	// The copies core does not stamp: a macro or a module doing `Item.create(card.toObject())`.
	it("re-mints a slug the world is already using, however the copy was made", async () => {
		globalThis.game = { items: [{ id: "other", flags: { stonetop: { slug: "azure-hand" } } }] };
		const item = pending(arcanum({ slug: "azure-hand" }));
		await item._preCreate({}, {}, {});

		expect(item.flags.stonetop.slug).toBe("arc-IDIDIDIDIDIDIDID");
	});

	// The import that must NOT be re-minted: a pack card landing in a world that has never held
	// it. Rewriting the slug there would orphan every mark in the world pointing at the old one.
	it("leaves an import alone when no card in the world holds its slug", async () => {
		globalThis.game = { items: [{ id: "other", flags: { stonetop: { slug: "mindgem" } } }] };
		const item = pending(arcanum({ slug: "azure-hand" }));
		await item._preCreate({}, {}, {});

		expect(item.updateSource).not.toHaveBeenCalled();
		expect(item.flags.stonetop.slug).toBe("azure-hand");
	});

	// A blank or whitespace slug is not a slug: the marks would key off "" either way.
	it("treats a blank slug as none", async () => {
		for (const blank of ["", "   "]) {
			const item = pending(arcanum({ slug: blank }));
			await item._preCreate({}, {}, {});
			expect(item.flags.stonetop.slug).toBe("arc-IDIDIDIDIDIDIDID");
		}
	});

	// Every other item type goes through this hook too — inventory gear, basic moves, playbooks
	// — and none of them has a slug to mint.
	it("leaves every other kind of item untouched", async () => {
		for (const source of [
			{ name: "Rope", type: "move", system: { moveType: "inventory" } },
			{ name: "Defend", type: "move", system: { moveType: "basic" } },
			{ name: "The Ranger", type: "playbook", system: {} },
		]) {
			const item = pending(source);
			await item._preCreate({}, {}, {});
			expect(item.updateSource, source.name).not.toHaveBeenCalled();
		}
	});

	// A base class that vetoes the create must still veto it.
	it("honours a refusal from the document class beneath it", async () => {
		const Base = class {
			async _preCreate() { return false; }
		};
		const item = new (createStonetopItemClass(Base))();
		Object.assign(item, arcanum());
		item.updateSource = vi.fn();

		expect(await item._preCreate({}, {}, {})).toBe(false);
		expect(item.updateSource).not.toHaveBeenCalled();
	});
});
