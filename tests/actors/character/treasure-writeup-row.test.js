import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { describe, it, expect } from "vitest";

import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { TREASURE_CATALOG } from "../../../module/data/treasure-catalog.js";
import { treasureItemData } from "../../../module/utils/treasure-drops.js";
import { ARTIFACT_STATE } from "../../../module/actors/character/artifact-identify.js";

// The Book II write-up, end to end: catalog -> dropped item -> snapshot -> the row that ships.
//
// Each layer is covered on its own elsewhere (the extraction in tests/utils/treasure-drops,
// concealment in buildSnapshot.artifact, the pack source in tests/pack/treasure-items). What
// this proves is that they join up — that a treasure carried onto a sheet actually PRINTS the
// book's text, which is the whole point of putting it there, and that a GM who hides the find
// still gets the concealment the p.430 ladder promises even though the prose now arrives
// pre-filled rather than typed by them.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");

const hbs = Handlebars.create();
hbs.registerHelper("or", (...a) => a.slice(0, -1).some(Boolean));
hbs.registerHelper("and", (...a) => a.slice(0, -1).every(Boolean));
hbs.registerHelper("localize", k => k);
const artifactRow = hbs.compile(read("templates/actor/partials/inv-artifact.hbs"));

const DAGGER = TREASURE_CATALOG.find(e => e.name === "An old bronze dagger");

/** The dagger as `addDroppedInventoryItem` re-plants it on a sheet. */
function droppedDagger(extra = {}) {
	const built = treasureItemData(DAGGER);
	return {
		_id: "item-1", id: "item-1", type: "move", name: built.name,
		system: { ...built.system, moveType: "inventory-custom", ...extra },
	};
}

const rowFor = async (item, view) => {
	const actor = new FakeActorBuilder().withItems([item]).build();
	const snap = await new TestCharacterBuilder(actor).build().buildSnapshot(view);
	return snap.inventory.outfit.treasureSmall[0];
};

describe("a treasure's write-up on the gear row", () => {
	it("reaches the snapshot from the catalog, unasked", async () => {
		const row = await rowFor(droppedDagger());
		expect(row.artifact.lore).toBe(DAGGER.writeup);
		expect(row.artifact.concealed).toBe(false);
	});

	it("prints as prose and bullets in the row that ships", async () => {
		const row = await rowFor(droppedDagger());
		const html = artifactRow({ ...row, stonetop: {} }, { data: { root: { stonetop: {} } } });
		expect(html).toContain('class="stonetop-inv-artifact-lore"');
		expect(html).toContain("Tinged green, but sharp and sturdy.");
		expect(html).toContain("When you Seek Insight about someone while carrying the dagger");
		expect(html).toContain('<li class="question-bullet">What of mine do they most want?</li>');
		expect(html).toContain("Instinct to cause paranoia");
	});

	it("still draws nothing at all on ordinary gear", async () => {
		// The gate had to widen to let an unhidden treasure's write-up through (it used to open
		// only for a flagged artifact or a GM). It must not have widened to everything: a bedroll
		// has no lore, no state and no GM looking, and should still render an empty string
		// rather than a stray empty div under every row on the tab.
		const bedroll = { artifact: { isArtifact: false, lore: "", hint: "", lead: "", concealed: false } };
		const html = artifactRow({ ...bedroll, stonetop: {} }, { data: { root: { stonetop: {} } } });
		expect(html.trim()).toBe("");
	});

	it("is withheld while the GM has the find hidden, and handed over once it is known", async () => {
		const hidden = await rowFor(droppedDagger({ identifyState: ARTIFACT_STATE.UNKNOWN }));
		expect(hidden.artifact.lore).toBe("");
		const hiddenHtml = artifactRow({ ...hidden, stonetop: {} }, { data: { root: { stonetop: {} } } });
		expect(hiddenHtml).not.toContain("Tinged green");
		expect(hiddenHtml).not.toContain("Instinct to cause paranoia");

		const known = await rowFor(droppedDagger({ identifyState: ARTIFACT_STATE.KNOWN }));
		expect(known.artifact.lore).toBe(DAGGER.writeup);
	});
});

// The write-up is HTML now, so the stylesheet has to have an opinion about the tags in it.
// Browser-default paragraph margins would stack a four-paragraph treasure into a wall down the
// gear column, and a bare <ul> would draw the disc bullets this system does not use anywhere.
describe("the stylesheet's opinion of a write-up", () => {
	const CSS = read("styles/stonetop.css");

	it("tightens the paragraphs it now has to lay out", () => {
		expect(CSS).toMatch(/\.stonetop-inv-artifact-lore p\s*\{[^}]*margin:/);
	});

	it("takes the disc off its lists and hangs a spiral instead", () => {
		expect(CSS).toMatch(/\.stonetop-inv-artifact-lore ul\s*\{[^}]*list-style:\s*none/);
		expect(CSS).toMatch(/\.stonetop-inv-artifact-lore li::before\s*\{[^}]*--stonetop-spiral-icon/);
		// And it joins the shared family that positions every spiral marker, rather than
		// carrying its own geometry that could drift from the rest.
		expect(CSS).toContain(".stonetop-inv-artifact-lore li::before,\n.stonetop-arcanum-body li::before");
		expect(CSS).toContain(".stonetop-inv-artifact-lore li,\n.stonetop-arcanum-body li");
	});
});

// A write-up that long can't be the row's resting state: the treasures section would be a wall of
// prose down a column whose every other line is one row. So it folds, and the row rests at what
// the book prints in its own margin — the name, and the tags beside it. What follows is that
// resting shape, the caret that opens it, and the stylesheet that actually does the hiding.
describe("folding the write-up away", () => {
	const CSS = read("styles/stonetop.css");
	const rowHtml = row => artifactRow({ ...row, stonetop: {} }, { data: { root: { stonetop: {} } } });

	it("rests folded, with a caret to open it", async () => {
		const html = rowHtml(await rowFor(droppedDagger()));
		expect(html).toContain("stonetop-inv-artifact-fold is-collapsed");
		expect(html).toContain('class="stonetop-inv-lore-toggle"');
		expect(html).toContain('aria-expanded="false"');
		// Folded is a class, not a missing paragraph: the prose is still in the row, so opening it
		// is a class toggle rather than a re-render (which would lose the tab's scroll position).
		expect(html).toContain("Tinged green, but sharp and sturdy.");
	});

	it("opens for a row this user left open, and says so", async () => {
		const row = await rowFor(droppedDagger());
		row.artifact.loreExpanded = true;   // what the sheet stamps from inventoryLoreExpanded
		const html = rowHtml(row);
		expect(html).not.toContain("is-collapsed");
		expect(html).toContain('aria-expanded="true"');
	});

	it("hangs the fold off the owned item's id, which is what the sheet remembers", async () => {
		const row = await rowFor(droppedDagger());
		expect(row.ownedId).toBe("item-1");
		expect(rowHtml(row)).toContain('data-section="item-1"');
	});

	it("draws no caret on a row with nothing to unfold", () => {
		// A GM's hint with the write-up still owed (p.430): there IS an artifact block on this
		// row, but no prose in it, so it must not sprout a caret that opens onto nothing.
		const owed = { artifact: { isArtifact: true, concealed: true, state: "partial",
			lore: "", hint: "Older than it looks", lead: "" } };
		const html = artifactRow({ ...owed, stonetop: {} }, { data: { root: { stonetop: {} } } });
		expect(html).toContain("Older than it looks");
		expect(html).not.toContain("stonetop-inv-lore-toggle");
	});

	it("leaves the hiding to the stylesheet, and keeps the row's geometry while doing it", () => {
		expect(CSS).toMatch(/\.stonetop-inv-artifact-fold\.is-collapsed \.stonetop-inv-artifact-lore\s*\{[^}]*display:\s*none/);
		// The wrapper is boxless, so the caret and the prose stay direct children of the row and
		// keep the order/flex-basis the shared second-line rule gives them: the caret up on the
		// name's line, the prose alone underneath. A real box could only be in one of those places.
		expect(CSS).toMatch(/\.stonetop-inv-artifact-fold\s*\{[^}]*display:\s*contents/);
	});
});
