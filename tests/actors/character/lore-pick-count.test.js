// A playbook lore list's count, read one way for the creation wizard and the Details tab
// (lore-pick-count.js), and the Details tab holding a list to its most: the Would-Be Hero's Fear &
// Anger print "(choose 1, maybe 2)" and "(choose 2, maybe 3)", and a 3rd fear or 4th anger used to
// tick straight through on the sheet while the wizard refused it.

import { describe, it, expect, vi } from "vitest";
import Handlebars from "handlebars";
import { Window } from "happy-dom";
import { readRepo } from "../../fakes/css.js";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";
import {
	lorePickMax, lorePickMin, loreTickFits, markLoreCaps,
} from "../../../module/actors/character/lore-pick-count.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

const FEARS = "fear-and-anger-fears";
const ANGER = "fear-and-anger-anger";
const WBH_STATS = { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: -1 };
const PACK = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const packLore = slug => PACK.get(slug).flags.stonetop.lore;
const pick = (slug, max) => ({ slug, ...(max ? { max } : {}) });

function hero(counts = {}) {
	const { char, actor } = buildLiveCharacter({
		slug: "the-would-be-hero", name: "The Would-Be Hero", stats: WBH_STATS, seedStartingMoves: false,
		flags: { "lore.counts": counts },
	});
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return { char, actor, sheet: new (createStonetopCharacterSheetClass(Base))() };
}

// The sheet's lore, capped as getData caps it.
async function cappedLore(char, sheet) {
	const lore = (await char.buildSnapshot()).playbook.lore;
	await sheet._capLoreLists(lore);
	return lore;
}

const entry = (lore, slug) => lore.entries.find(e => e.slug === slug);

function renderLore(lore) {
	const hb = Handlebars.create();
	hb.registerHelper("eq", (a, b) => a === b);
	hb.registerHelper("or", (...args) => args.slice(0, -1).find(Boolean) ?? args.at(-2));
	hb.registerHelper("and", (...args) => args.slice(0, -1).every(Boolean));
	hb.registerPartial("stonetop.section-heading", "<h3>{{title}}</h3>");
	hb.registerPartial("stonetop.lore-arcana-image", "");
	hb.registerPartial("stonetop.lore-options-edit", readRepo("templates/actor/partials/lore-options-edit.hbs"));
	hb.registerPartial("stonetop.lore-options-readonly", readRepo("templates/actor/partials/lore-options-readonly.hbs"));
	const doc = new Window().document;
	// The snapshot's getters (hasEntries, hasColumnBreak) live on its prototype, as Foundry's
	// renderTemplate lets them through.
	doc.body.innerHTML = hb.compile(readRepo("templates/actor/partials/lore-section.hbs"))({ lore, editMode: true },
		{ allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true });
	return doc;
}

describe("a lore list's count (lore-pick-count.js)", () => {
	it("reads 'choose N, maybe M' as N at least and M at most", () => {
		expect(lorePickMax({ description: "<p><em>(choose 1, maybe 2)</em></p>" })).toBe(2);
		expect(lorePickMin({ description: "<p><em>(choose 1, maybe 2)</em></p>" })).toBe(1);
		expect(lorePickMax({ description: "<p><em>(choose 2, maybe 3)</em></p>" })).toBe(3);
		expect(lorePickMin({ description: "<p><em>(choose 2, maybe 3)</em></p>" })).toBe(2);
	});

	it("reads the other ways the book counts, and a plain 'choose N' is a cap too", () => {
		expect(lorePickMax({ description: "(choose 3)" })).toBe(3);
		expect(lorePickMax({ description: "(pick 1 or 2)" })).toBe(2);
		expect(lorePickMax({ description: "(choose 1\u20133)" })).toBe(3);
		expect(lorePickMin({ description: "(choose 1\u20133)" })).toBe(1);
		// "(choose 1 per tale)" over the Fox's two tales.
		expect(lorePickMax({ description: "(choose 1 per tale)", tales: 2 })).toBe(2);
	});

	it("puts no cap on a list with no count", () => {
		expect(lorePickMax({ description: "", options: [{ slug: "a", type: "text" }] })).toBe(Infinity);
		expect(lorePickMin({ description: "", options: [{ slug: "a", type: "text" }] })).toBe(0);
		expect(lorePickMax({ description: "<p>Answer at least 2 of these.</p>", options: [] })).toBe(Infinity);
		expect(lorePickMax({ description: "Some prose.", options: [pick("a", 2), pick("b")] })).toBe(Infinity);
		// A bare list of single boxes is a "pick 1", as the wizard has always read it.
		expect(lorePickMax({ description: "", options: [pick("a"), pick("b")] })).toBe(1);
	});

	it("is the wizard's own reading, for every playbook's lore", () => {
		const dialog = Object.create(CharacterOnboardingDialog.prototype);
		for (const doc of PACK.values()) {
			for (const section of doc.flags.stonetop.lore ?? []) {
				expect(dialog._parseLorePickMax(section)).toBe(lorePickMax(section));
				expect(dialog._parseLorePickMin(section)).toBe(lorePickMin(section));
			}
		}
		const wbh = new Map(packLore("the-would-be-hero").map(s => [s.slug, s]));
		expect(dialog._parseLorePickMax(wbh.get(FEARS))).toBe(2);
		expect(dialog._parseLorePickMax(wbh.get(ANGER))).toBe(3);
	});

	it("lets a tick through up to the cap, and an untick always", () => {
		expect(loreTickFits(2, { fire: 1 }, "alone", 1)).toBe(true);
		expect(loreTickFits(2, { fire: 1, alone: 1 }, "violence", 1)).toBe(false);
		expect(loreTickFits(2, { fire: 1, alone: 1, violence: 1 }, "fire", 0)).toBe(true);
		// A twice-taken option is two of the list's.
		expect(loreTickFits(2, { a: 1 }, "a", 2)).toBe(true);
		expect(loreTickFits(2, { a: 1, b: 1 }, "a", 2)).toBe(false);
	});

	it("leaves a section with no count, or none in the playbook's lore, unmarked", () => {
		const options = [{ slug: "a", type: "checkbox", count: 1 }];
		const caps = markLoreCaps(
			[{ slug: "free", options }, { slug: "unknown", options: [{ slug: "b", type: "checkbox", count: 1 }] }],
			[{ slug: "free", description: "Some prose.", options: [pick("a", 2), pick("b")] }],
		);
		expect(caps.size).toBe(0);
		expect(options[0].atCap).toBeUndefined();
	});
});

describe("the Details tab holds a lore list to its most", () => {
	it("disables the unticked fears once 2 are ticked, and leaves the ticked ones live", async () => {
		const { char, sheet } = hero({ [`${FEARS}:fire`]: 1, [`${FEARS}:alone`]: 1, [`${ANGER}:bullying`]: 1 });
		const lore = await cappedLore(char, sheet);

		const fears = entry(lore, FEARS).options;
		expect(fears.every(o => o.atCap)).toBe(true);
		expect(fears.filter(o => o.capDisabled).map(o => o.slug))
			.toEqual(fears.map(o => o.slug).filter(s => s !== "fire" && s !== "alone"));
		// Anger at 1 of 3: nothing disabled. The story is all writing and has no cap.
		expect(entry(lore, ANGER).options.some(o => o.atCap || o.capDisabled)).toBe(false);
		expect(entry(lore, "fear-and-anger-story").options.some(o => "atCap" in o)).toBe(false);

		const doc = renderLore(lore);
		const box = slug => doc.querySelector(`.stonetop-lore-option-check[data-lore-slug="${FEARS}"][data-option-slug="${slug}"]`);
		expect(box("fire").checked).toBe(true);
		expect(box("fire").disabled).toBe(false);
		expect(box("alone").disabled).toBe(false);
		expect(box("violence").disabled).toBe(true);
		expect(box("violence").closest(".stonetop-lore-option").classList.contains("is-disabled")).toBe(true);
		expect(box("fire").closest(".stonetop-lore-option").classList.contains("is-disabled")).toBe(false);
		const anger = doc.querySelector(`.stonetop-lore-option-check[data-lore-slug="${ANGER}"][data-option-slug="cruelty"]`);
		expect(anger.disabled).toBe(false);
	});

	it("refuses a 4th anger past the disabled boxes, takes an untick, and never refuses a short list", async () => {
		const full = { [`${ANGER}:bullying`]: 1, [`${ANGER}:cruelty`]: 1, [`${ANGER}:injustice`]: 1 };
		const { char, actor, sheet } = hero(full);
		await cappedLore(char, sheet);
		const counts = () => actor.getFlag(SYSTEM_ID, "lore.counts");
		const cb = (optionSlug, checked) => ({ checked, dataset: { loreSlug: ANGER, optionSlug, idx: "0" } });

		const fourth = cb("cowardice", true);
		await sheet._onLoreOptionCheck(fourth);
		expect(fourth.checked).toBe(false);
		expect(counts()[`${ANGER}:cowardice`] ?? 0).toBe(0);

		await sheet._onLoreOptionCheck(cb("bullying", false));
		expect(counts()[`${ANGER}:bullying`]).toBe(0);

		// Down to 2, then 1: short of "choose 2" is a flag elsewhere, never a refusal here.
		await sheet._onLoreOptionCheck(cb("cruelty", false));
		expect(counts()[`${ANGER}:cruelty`]).toBe(0);
		const back = cb("cowardice", true);
		await sheet._onLoreOptionCheck(back);
		expect(back.checked).toBe(true);
		expect(counts()[`${ANGER}:cowardice`]).toBe(1);
	});
});
