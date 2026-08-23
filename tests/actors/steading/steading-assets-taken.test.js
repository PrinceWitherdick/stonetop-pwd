import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { describe, it, expect, vi } from "vitest";

import { StonetopSteading } from "../../../module/actors/steading/StonetopSteading.js";

// An asset out on requisition, on the sheet that ships. It reads struck through and its
// tooltip names where it went, so a GM looking at the Assets card can see that the wagon is
// gone and which expedition has it without opening the walkthrough. Clicking the name is what
// brings it home (the handler is in StonetopSteadingSheet.js).
//
// The wording itself is proven in tests/utils/requisition-asset.test.js. What this covers is
// the wiring: the snapshot carrying the line, and the template printing it on the right
// element with the class the return handler listens for.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");

// The Overview tab mounts a dozen partials (the stat bar, the section pencils, the people
// tables). None of them is the Assets card, so each is stubbed to nothing, read off the
// template itself so a newly mounted partial does not break this suite. What is under test
// is one <li>, rendered off the file that ships.
const hbs = Handlebars.create();
const OVERVIEW_HBS = read("templates/actor/partials/steading-tab-overview.hbs");
for (const [, name] of OVERVIEW_HBS.matchAll(/\{\{>\s*"([^"]+)"/g)) hbs.registerPartial(name, "");
const overview = hbs.compile(OVERVIEW_HBS);

function steadingActor(assets) {
	const actor = {
		name: "Stonetop",
		type: "stonetop",
		system: {},
		flags: { stonetop: { steading: { assets } } },
		getFlag: (_scope, key) => (key === "steading" ? actor.flags.stonetop.steading : null),
		setFlag: vi.fn((_scope, _key, value) => { actor.flags.stonetop.steading = value; }),
		update: vi.fn(),
	};
	return actor;
}

/** Just the Assets card, rendered off the real template. */
function assetsCard(assets) {
	const stonetop = new StonetopSteading(steadingActor(assets));
	const html = overview({
		stonetop: {
			assets: (stonetop._flags.assets ?? []).map(a => ({
				...a,
				takenTooltip: assetTooltip(a),
			})),
			edit: {}, canEdit: true,
			places: [], silver: {}, gold: {},
		},
	});
	const from = html.indexOf('class="steading-list steading-assets-list"');
	return html.slice(from, html.indexOf("</ul>", from));
}

// Read through the same helpers the snapshot uses, so the card under test is fed exactly what
// buildSnapshot feeds it (proven below).
const { assetTakenTooltip: assetTooltip } =
	await import("../../../module/utils/requisition-asset.js");

describe("the snapshot hands the sheet the one line that says where an asset went", () => {
	it("labels an asset out on an expedition, and leaves an on-hand one blank", async () => {
		const steading = new StonetopSteading(steadingActor([
			{ name: "A wagon", checked: false, takenBy: { expedition: { id: "trip-1", title: "The Wandering Tower" } } },
			{ name: "Horses", checked: true },
		]));

		const snap = await steading.buildSnapshot();

		// The tooltip is the whole line plus the sheet's affordance, so it carries the wording:
		// a second `takenLabel` field beside it was stamped on every render and read by nothing.
		expect(snap.assets[0]).toMatchObject({
			name: "A wagon",
			takenTooltip: "Out on The Wandering Tower. Click to return",
		});
		expect(snap.assets[1]).toMatchObject({ name: "Horses", takenTooltip: "" });
		// Derived for the sheet, never written back onto the stored list.
		expect(steading._flags.assets[0].takenTooltip).toBeUndefined();
	});
});

describe("the Assets card on the sheet that ships", () => {
	it("strikes through an asset that is out, and names where it went on hover", () => {
		const card = assetsCard([
			{ name: "A wagon", checked: false, takenBy: { expedition: { id: "trip-1", title: "The Wandering Tower" } } },
		]);

		expect(card).toContain("steading-list-item is-taken");
		// The class the return handler listens for, and the index it sends back.
		expect(card).toContain("steading-asset-taken");
		expect(card).toContain('data-index="0"');
		expect(card).toContain('data-tooltip="Out on The Wandering Tower. Click to return"');
	});

	it("names the character when a player took it through the Requisition move", () => {
		const card = assetsCard([
			{ name: "A wagon", checked: false, takenBy: { name: "Wren", id: "hero1" } },
		]);
		expect(card).toContain('data-tooltip="Taken by Wren. Click to return"');
	});

	it("leaves an on-hand asset plain, with nothing to click and no tooltip", () => {
		const card = assetsCard([{ name: "Horses", checked: true }]);

		expect(card).toContain("steading-asset-name");
		expect(card).not.toContain("steading-asset-taken");
		expect(card).not.toContain("is-taken");
		expect(card).not.toContain("data-tooltip");
	});

	it("keeps each row's index tied to the stored slot, past a blank one", () => {
		const card = assetsCard([
			{ name: "Horses", checked: true },
			{ name: "", checked: false },
			{ name: "A wagon", checked: false, takenBy: { name: "Wren", id: "hero1" } },
		]);
		// The struck-through row is the third stored slot, and must send 2 back on a click.
		const taken = card.slice(card.indexOf("steading-asset-taken"));
		expect(taken).toContain('data-index="2"');
	});
});

describe("the strikethrough has somewhere to come from", () => {
	const CSS = read("styles/stonetop.css");

	it("still styles the struck-through asset the template asks for", () => {
		expect(CSS).toContain(".steading-list-item.is-taken");
		expect(CSS).toMatch(/\.steading-asset-taken\s*\{[^}]*text-decoration:\s*line-through/);
	});
});
