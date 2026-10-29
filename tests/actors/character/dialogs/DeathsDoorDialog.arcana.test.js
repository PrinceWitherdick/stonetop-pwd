import { describe, it, expect, vi } from "vitest";
import Handlebars from "handlebars";
import { DeathsDoorDialog } from "../../../../module/actors/character/dialogs/DeathsDoorDialog.js";
import { DEATHS_DOOR_STATE } from "../../../../module/actors/character/deaths-door.js";
import { readRepo } from "../../../fakes/css.js";
import { escHtml } from "../../../../module/utils/strings.js";

// GM-1: a held arcanum whose marked Consequence dictates the 6- (Redwood Effigy, Noruba's Ice Sphere, the
// Hungering Maw). The fate step flags it in gold naming the arcanum and marks the dictated fate as the
// suggestion; every fate stays a button (flagged, never blocked). Which card dictates what is
// deaths-door-arcana.test.js; this is the window drawing it.

// A character sitting on an unresolved 6-, holding the given cards with every box ticked: the box test itself
// is deaths-door-arcana's, so here a ticked map is simply "all of them".
function pendingHero({ owned = [], tether = "" } = {}) {
	const backs = {
		"redwood-effigy":        { title: "Redwood Effigy",       back: "<li>□ When you roll 6- at Death's Door, you have no choice: gain the Revenant insert</li>" },
		"norubas-ice-sphere":    { title: "Noruba's Ice Sphere",  back: "<li>□ When you roll 6- at Death's Door, you have no choice: gain the Ghost insert</li>" },
		"hungering-maw-of-hlad": { title: "Hungering Maw of Hlad", back: "<li>□ The ring wounds your soul. Should you roll a 6- on Death's Door, you die and become a wraith</li>" },
	};
	const character = {
		_actor: { id: "hero-1", name: "Wren" },
		deathsDoorState: DEATHS_DOOR_STATE.FATE_PENDING,
		tether,
		setTether: vi.fn(async t => { character.tether = t; }),
		setPostDeathInsert: vi.fn(async () => {}),
		_arcana: {
			ownedSlugs: new Set(owned),
			leadSlugs:  new Set(),
			boxStates:  Object.fromEntries(Object.keys(backs).map(s => [`${s}:back:0`, true])),
			getArcanum: async slug => (backs[slug]
				? { slug, front: { title: backs[slug].title }, back: { description: backs[slug].back } } : null),
		},
	};
	return character;
}

function windowOn(character) {
	const dialog = new DeathsDoorDialog(character, () => {});
	dialog.renderIfOpen = vi.fn();
	dialog.render = vi.fn();
	dialog._refreshChoices = vi.fn(async () => {});
	dialog._post = vi.fn(async () => {});
	return dialog;
}

// The real template, as DeathsDoorDialog.test.js draws it.
function draw(data) {
	const hb = Handlebars.create();
	hb.registerHelper("or", (...a) => a.slice(0, -1).some(Boolean));
	hb.registerHelper("eq", (a, b) => a === b);
	hb.registerHelper("localize", (key, options) => (Object.keys(options?.hash ?? {}).length
		? game.i18n.format(key, options.hash) : game.i18n.localize(key)));
	hb.registerHelper("escapeHtml", value => escHtml(value));
	hb.registerPartial("stonetop.deaths-door-outcomes", readRepo("templates/dialogs/partials/deaths-door-outcomes.hbs"));
	hb.registerPartial("stonetop.deaths-door-dictates", readRepo("templates/dialogs/partials/deaths-door-dictates.hbs"));
	hb.registerPartial("stonetop.post-death-choices", "");
	return hb.compile(readRepo("templates/dialogs/deaths-door.hbs"))(data);
}

const dictatedButtons = html => [...html.matchAll(/class="(deaths-door-(?:fate|insert)-btn[^"]*)" data-(?:fate|slug)="([^"]+)"/g)]
	.filter(m => m[1].includes("is-dictated")).map(m => m[2]);
const allButtons = html => [...html.matchAll(/class="deaths-door-(?:fate|insert)-btn[^"]*" data-(?:fate|slug)="([^"]+)"/g)].map(m => m[1]);

describe("DeathsDoorDialog: a held arcanum that dictates the 6-", () => {
	it("a window resumed on a pending fate reads the arcana and flags the Effigy's Revenant", async () => {
		const dialog = windowOn(pendingHero({ owned: ["redwood-effigy"] }));
		expect(dialog._step).toBe("result");   // resumed on the fates, not the dice

		await dialog._readDictates();
		const data = dialog.getData();
		expect(data.isMiss).toBe(true);
		expect(data.fates.map(f => [f.key, f.dictated])).toEqual([["last-door", false], ["refuse", true], ["thrall", false]]);
		expect(data.dictates).toHaveLength(1);
		expect(data.dictates[0].text).toContain("Redwood Effigy");
		expect(data.dictates[0].text).toMatch(/Revenant/);

		const html = draw(data);
		expect(html).toContain("deaths-door-dictated");
		expect(html).toContain("Redwood Effigy");
		expect(dictatedButtons(html)).toEqual(["refuse"]);
		// Flagged, never blocked: all three fates are still buttons, none disabled.
		expect(allButtons(html)).toEqual(["last-door", "refuse", "thrall"]);
		expect(html).not.toMatch(/deaths-door-fate-btn[^>]*disabled/);
		expect(html).toContain(game.i18n.localize("stonetop.specialMoves.deathsDoor.dictated.suggested"));
	});

	it("the refuse step marks the dictated insert and keeps the other", async () => {
		const dialog = windowOn(pendingHero({ owned: ["norubas-ice-sphere"] }));
		dialog._step = "fate";
		await dialog._readDictates();
		const data = dialog.getData();
		expect(data.refusalInserts.map(i => [i.slug, i.dictated])).toEqual([["revenant", false], ["ghost", true]]);
		const html = draw(data);
		expect(dictatedButtons(html)).toEqual(["ghost"]);
		expect(allButtons(html)).toEqual(["revenant", "ghost"]);
		expect(html).toContain("Noruba&#x27;s Ice Sphere");
	});

	it("the Hungering Maw flags the Last Door, and on the refuse step marks no insert", async () => {
		const dialog = windowOn(pendingHero({ owned: ["hungering-maw-of-hlad"] }));
		await dialog._readDictates();
		const data = dialog.getData();
		expect(data.fates.find(f => f.dictated)?.key).toBe("last-door");
		expect(data.dictates[0].text).toMatch(/wraith/);

		dialog._step = "fate";
		const fork = dialog.getData();
		expect(fork.refusalInserts.some(i => i.dictated)).toBe(false);
		// "That fate is marked below" only where it is.
		expect(fork.dictatedOthers).toBe("");
		expect(data.dictatedOthers).not.toBe("");
	});

	it("flags nothing for a character holding none of them", async () => {
		const dialog = windowOn(pendingHero({ owned: ["staff-of-the-lidless-orb"] }));
		await dialog._readDictates();
		const data = dialog.getData();
		expect(data.dictates).toEqual([]);
		expect(data.fates.some(f => f.dictated)).toBe(false);
		expect(draw(data)).not.toContain("deaths-door-dictated");
	});

	it("reads them on a render of the fate steps, without holding the render up", async () => {
		const character = pendingHero({ owned: ["redwood-effigy"] });
		let land;
		const getArcanum = character._arcana.getArcanum;
		character._arcana.getArcanum = slug => new Promise(resolve => { land = () => resolve(getArcanum(slug)); });
		const dialog = windowOn(character);
		const read = vi.spyOn(dialog, "_readDictates");
		dialog._syncRoll = () => {};
		// The render up to the frame: what reaches super._render is not this test's business.
		dialog._captureScroll = () => { throw new Error("stop"); };
		// The read has not landed, and the render went on regardless.
		await expect(dialog._render(true, {})).rejects.toThrow("stop");
		expect(read).toHaveBeenCalled();
		expect(dialog._dictates).toEqual([]);
		land();
		await dialog._dictatesRead;
		expect(dialog._dictates.map(d => d.slug)).toEqual(["redwood-effigy"]);
	});

	it("reads the cards again only when what decides them changes", async () => {
		const character = pendingHero({ owned: ["redwood-effigy"] });
		const spy = vi.spyOn(character._arcana, "getArcanum");
		const dialog = windowOn(character);
		await dialog._readDictates();
		await dialog._readDictates();
		expect(spy).toHaveBeenCalledTimes(1);

		// A box unticked: a fresh read, and an open window redrawn with the new answer.
		Object.defineProperty(dialog, "rendered", { get: () => true });
		character._arcana.boxStates = {};
		await dialog._readDictates();
		expect(spy).toHaveBeenCalledTimes(2);
		expect(dialog._dictates).toEqual([]);
		expect(dialog.render).toHaveBeenCalledWith(false);
	});
});

describe("DeathsDoorDialog: Noruba's Ice Sphere as the Ghost's tether", () => {
	it("fills an empty tether with the sphere when the Ghost is taken", async () => {
		const character = pendingHero({ owned: ["norubas-ice-sphere"] });
		const dialog = windowOn(character);
		dialog._step = "fate";
		await dialog._readDictates();

		await dialog._onTakeInsert("ghost");

		expect(character.setPostDeathInsert).toHaveBeenCalledWith("ghost");
		expect(character.setTether).toHaveBeenCalledWith("Noruba's Ice Sphere");
		// Written before the insert's questions are read, so the tether field opens filled.
		expect(character.setTether.mock.invocationCallOrder[0]).toBeLessThan(dialog._refreshChoices.mock.invocationCallOrder[0]);
	});

	it("leaves a tether already written, and writes none for the Revenant or without the sphere", async () => {
		const written = pendingHero({ owned: ["norubas-ice-sphere"], tether: "my mother's grave" });
		const a = windowOn(written);
		await a._readDictates();
		await a._onTakeInsert("ghost");
		expect(written.setTether).not.toHaveBeenCalled();

		const revenant = pendingHero({ owned: ["norubas-ice-sphere"] });
		const b = windowOn(revenant);
		await b._readDictates();
		await b._onTakeInsert("revenant");
		expect(revenant.setTether).not.toHaveBeenCalled();

		const plain = pendingHero({ owned: [] });
		const c = windowOn(plain);
		await c._readDictates();
		await c._onTakeInsert("ghost");
		expect(plain.setTether).not.toHaveBeenCalled();
	});
});
