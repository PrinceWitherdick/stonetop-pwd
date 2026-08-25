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

	// ONE CALL, MANY CARDS: dragging the arcana folder into the sidebar. `_preCreate` runs per
	// document against the collection as it STANDS, so it cannot see the siblings arriving beside
	// it — and two cards on one slug inside a single import both looked unique and both went in,
	// which is precisely the collision this hook exists to prevent, arriving by the gesture most
	// likely to produce it. Core hands every document in one call the SAME options object, which
	// is what lets a card claim its slug for the ones behind it.
	it("tells one card in a batch from another, though neither is in the world yet", async () => {
		const options = {};
		const first = pending(arcanum({ slug: "azure-hand" }));
		const second = pending(arcanum({ slug: "azure-hand" }));

		await first._preCreate({}, options, {});
		await second._preCreate({}, options, {});

		expect(first.flags.stonetop.slug).toBe("azure-hand");
		expect(second.flags.stonetop.slug).toBe("arc-IDIDIDIDIDIDIDID");
	});

	// And a SEPARATE call starts fresh, so an import of the same card into a world that does not
	// hold it is still left alone — the case a batch-wide memory must not break.
	it("does not carry a claim over into the next create call", async () => {
		const first = pending(arcanum({ slug: "azure-hand" }));
		await first._preCreate({}, {}, {});

		const later = pending(arcanum({ slug: "azure-hand" }));
		await later._preCreate({}, {}, {});

		expect(later.updateSource).not.toHaveBeenCalled();
		expect(later.flags.stonetop.slug).toBe("azure-hand");
	});

	// The world directory is walked ONCE per call, not once per card. Against a world holding the
	// seeded catalogs, an eighty-card import was eighty walks of the whole Items sidebar.
	it("reads the world's items once for the whole batch", async () => {
		let reads = 0;
		const items = [{ id: "other", flags: { stonetop: { slug: "mindgem" } } }];
		globalThis.game = { get items() { reads += 1; return items; } };

		const options = {};
		for (let i = 0; i < 5; i++) await pending(arcanum({ slug: `card-${i}` }))._preCreate({}, options, {});

		expect(reads).toBe(1);
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
