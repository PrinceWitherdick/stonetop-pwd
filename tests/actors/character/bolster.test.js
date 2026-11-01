import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Window } from "happy-dom";
import {
	boostOffers, takeBoost, boostButtonFace, holdPreparation, preparationHeld, preparationFor,
	BOLSTER, BOOSTS_FLAG, PREPARATION_FOR_FLAG, PREPARATION_ARCANA,
} from "../../../module/actors/character/roll-boosts.js";
import {
	openBolster, bolsterBodyHtml, readBolsterForm, bolsterCardData, bolsterChatText, editPreparationFor, dropPreparation,
	preparationRollOffers, takenPreparationOffer, claimPreparationOffer, returnPreparationOffer, announcePreparationOffer,
	preparationChip,
} from "../../../module/actors/character/bolster.js";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";
import { STEADING_MOVES } from "../../../module/actors/steading/homestead-moves.js";

// Bolster (Book I p.524): hold 1/2/3 Preparation for a week/month/season, and spend 1 for +1 on a roll the
// efforts apply to, after it is made (maximum +1 per roll). The steading's rolls take it too (p.516).

const SCOPE = "stonetop-pwd";

function pc({ id, name, held = null, purpose = undefined, type = "character" }) {
	const tracks = held === null ? {} : { [BOLSTER]: held };
	const store = purpose === undefined ? {} : { [PREPARATION_FOR_FLAG]: purpose };
	const actor = {
		id, uuid: `Actor.${id}`, name, type, isOwner: true, items: [],
		tracks, store,
		getFlag: (scope, key) => (scope === SCOPE ? store[key] : undefined),
		update: vi.fn(async data => {
			for (const [path, value] of Object.entries(data)) {
				const track = path.match(/backgroundChoices\.(.+)$/);
				if (track) tracks[track[1]] = value;
				const flag = path.match(new RegExp(`^flags\\.${SCOPE}\\.(\\w+)$`));
				if (flag) store[flag[1]] = value;
			}
		}),
		typedActor: { moveResources: {
			getMoveResources: () => tracks,
			setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
			usesUpdate: (move, value) => ({ [`flags.${SCOPE}.backgroundChoices.${move}`]: value }),
		} },
	};
	return actor;
}

const MOVE_CARD = `<section class="pbta-chat-card stonetop-roll-card"><div class="stonetop-roll-result partial"><span class="stonetop-roll-result-label">Weak Hit</span></div></section>`;

function card({ boosts = [] } = {}) {
	const flags = { [SCOPE]: boosts.length ? { [BOOSTS_FLAG]: boosts } : {} };
	const message = {
		id: "msg1", flavor: MOVE_CARD, rolls: [{ total: 6, formula: "2d6+0" }], flags,
		getFlag: (scope, key) => flags[scope]?.[key],
		canUserModify: () => true,
		update: vi.fn(async data => {
			for (const [scope, values] of Object.entries(data.flags ?? {})) Object.assign(flags[scope] ??= {}, values);
		}),
	};
	return message;
}

const owners = actor => [{ id: `u-${actor.id}`, isGM: false, active: true }];
const user = id => ({ id: `u-${id}`, isGM: false });
const offers = ({ message = card(), roller, helpers, as }) =>
	boostOffers({ message, roller, helpers, user: user(as), ownersOf: owners }).map(o => `${o.source}:${o.helper.name}`);

describe("Bolster's Preparation as a +1 on a roll card", () => {
	it("offers Preparation on the holder's own roll, without the move on their sheet", () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 1 });
		expect(offers({ roller: vahid, helpers: [vahid], as: "vahid" })).toEqual(["preparation:Vahid"]);
	});

	it("offers none with no Preparation held, and none on another PC's roll", () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 0 });
		expect(offers({ roller: vahid, helpers: [vahid], as: "vahid" })).toEqual([]);
		const ready = pc({ id: "vahid", name: "Vahid", held: 2 });
		const wren = pc({ id: "wren", name: "Wren" });
		expect(offers({ roller: wren, helpers: [ready], as: "vahid" })).toEqual([]);
	});

	it("offers it on the steading's roll (p.516: Bolster for a coming season), and nothing else there", () => {
		const steading = { id: "st", type: "stonetop", name: "Stonetop" };
		const vahid = pc({ id: "vahid", name: "Vahid", held: 2 });
		expect(offers({ roller: steading, helpers: [vahid], as: "vahid" })).toEqual(["preparation:Vahid"]);
	});

	it("takes 1 Preparation off the track and shifts the roll by one", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 2 });
		const message = card();
		const [offer] = boostOffers({ message, roller: vahid, helpers: [vahid], user: user("vahid"), ownersOf: owners });
		const shiftRoll = vi.fn(async () => {});
		const taken = await takeBoost(message, offer, { shiftRoll, cardFlavor: f => f });
		expect(taken).toBe(true);
		expect(vahid.tracks[BOLSTER]).toBe(1);
		expect(message.flags[SCOPE][BOOSTS_FLAG]).toEqual([{ source: "preparation", by: "Actor.vahid", name: "Vahid" }]);
	});

	it("is a maximum of +1 per roll, whoever holds Preparation", () => {
		const steading = { id: "st", type: "stonetop", name: "Stonetop" };
		const vahid = pc({ id: "vahid", name: "Vahid", held: 2 });
		const message = card({ boosts: [{ source: "preparation", by: "Actor.blodwen", name: "Blodwen" }] });
		expect(offers({ message, roller: steading, helpers: [vahid], as: "vahid" })).toEqual([]);
		const own = card({ boosts: [{ source: "preparation", by: "Actor.vahid", name: "Vahid" }] });
		expect(offers({ message: own, roller: vahid, helpers: [vahid], as: "vahid" })).toEqual([]);
	});

	it("names what the Preparation was for in the button's tooltip", () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 1, purpose: "the bear hunt" });
		const face = boostButtonFace({ source: "preparation", helper: vahid, held: 1, cost: 1 });
		expect(face.tip).toContain("the bear hunt");
	});
});

describe("holding Preparation", () => {
	it("sets the hold (Bolstering again replaces it) and records its purpose in one update", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 1, purpose: "old" });
		await holdPreparation(vahid, 3, " a month of drills ");
		expect(vahid.update).toHaveBeenCalledTimes(1);
		expect(vahid.update.mock.calls[0][1]).toEqual({ stonetopMove: BOLSTER });
		expect(preparationHeld(vahid)).toBe(3);
		expect(preparationFor(vahid)).toBe("a month of drills");
	});

	it("never holds more than 3", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid" });
		await holdPreparation(vahid, 7);
		expect(preparationHeld(vahid)).toBe(3);
	});
});

describe("using Bolster", () => {
	it("asks how long and what for, then holds that much Preparation", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid" });
		const ask = vi.fn(async () => ({ hold: 2, purpose: "the Fae" }));
		expect(await openBolster(vahid, { ask })).toBe(2);
		expect(preparationHeld(vahid)).toBe(2);
		expect(preparationFor(vahid)).toBe("the Fae");
	});

	it("holds nothing when the window is closed", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 1 });
		expect(await openBolster(vahid, { ask: async () => null })).toBeNull();
		expect(vahid.update).not.toHaveBeenCalled();
	});

	it("reads the picked amount of time and the purpose off the window", () => {
		const doc = new Window().document;
		const form = doc.body.appendChild(doc.createElement("form"));
		form.innerHTML = bolsterBodyHtml(pc({ id: "vahid", name: "Vahid" }));
		expect(form.querySelectorAll('input[name="bolsterHold"]').length).toBe(3);
		expect(readBolsterForm(form)).toEqual({ hold: 1, purpose: "" });
		// happy-dom does not uncheck a radio's siblings; a browser does.
		for (const radio of form.querySelectorAll('input[name="bolsterHold"]')) radio.checked = radio.value === "3";
		form.querySelector('input[name="preparationFor"]').value = "winter stores";
		expect(readBolsterForm(form)).toEqual({ hold: 3, purpose: "winter stores" });
	});
});

// Where a player finds the move. The homefront moves are not put on a sheet by default, so before this
// card nothing reached the Bolster window short of dragging the move in from the compendium.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");

describe("the Special Moves tab's Bolster card", () => {
	afterEach(() => vi.unstubAllGlobals());
	const i18n = () => vi.stubGlobal("game", { i18n: { format: (key, data) => `${key} ${JSON.stringify(data)}` } });

	it("says nothing while no Preparation is held", () => {
		expect(bolsterCardData(pc({ id: "vahid", name: "Vahid" }))).toEqual({ held: 0, hint: "" });
		expect(bolsterCardData(pc({ id: "vahid", name: "Vahid", held: 0, purpose: "winter" }))).toEqual({ held: 0, hint: "" });
	});

	it("says how much is held and what for, or just how much when nothing was written", () => {
		i18n();
		const card = bolsterCardData(pc({ id: "vahid", name: "Vahid", held: 2, purpose: "winter stores" }));
		expect(card.held).toBe(2);
		expect(card.hint).toBe('stonetop.specialMoves.bolster.heldHint {"held":2,"purpose":"winter stores"}');
		expect(bolsterCardData(pc({ id: "vahid", name: "Vahid", held: 1 })).hint)
			.toBe('stonetop.specialMoves.bolster.heldHintNoPurpose {"held":1}');
	});

	it("is drawn on the tab with its own button, opened for whoever may edit the sheet", () => {
		const hbs = read("templates/actor/partials/tab-special-moves.hbs");
		expect(hbs).toContain('{{localize "stonetop.specialMoves.bolster.title"}}');
		expect(hbs).toContain('<button type="button" class="stonetop-bolster-open-btn">');
		const sheet = read("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain("context.stonetop.bolster = bolsterCardData(this.actor);");
		const wired = sheet.indexOf('html.find(".stonetop-bolster-open-btn").on("click", () => openBolster(this.actor));');
		expect(wired).toBeGreaterThan(-1);
		expect(sheet.lastIndexOf("if (!this.isEditable) return;", wired)).toBeGreaterThan(-1);
		const en = JSON.parse(read("languages/en.json")).stonetop.specialMoves.bolster;
		expect(Object.keys(en).sort()).toEqual([
			"button", "dropButton", "dropHint", "editButton", "editHint", "heldHint", "heldHintNoPurpose", "summary", "title",
		]);
	});

	it("is listed on the steading's Homefront Moves for reference, rolling nothing there", () => {
		const row = STEADING_MOVES.find(m => m.label === "Bolster");
		expect(row).toMatchObject({ reference: true, interactive: false, rollable: false, stat: null });
		expect(row.description).toContain("Special Moves tab");
	});
});

// "Say how and answer the GM's questions" (p.524): the GM sees what was laid in, and what it replaced.
describe("Bolster in chat", () => {
	it("says how long, how much, what for, and what it replaced", () => {
		const vahid = pc({ id: "vahid", name: "Vahid" });
		expect(bolsterChatText(vahid, 2, "laying in extra stores for winter"))
			.toBe("Vahid Bolstered for a month or so and holds 2 Preparation (laying in extra stores for winter).");
		expect(bolsterChatText(vahid, 3, "")).toBe("Vahid Bolstered for the better part of a season and holds 3 Preparation.");
		expect(bolsterChatText(vahid, 1, "the bear hunt", { held: 2, purpose: "winter" }))
			.toBe("Vahid Bolstered for a week or so and holds 1 Preparation (the bear hunt). It replaces the 2 Preparation held before (winter).");
	});

	it("posts that line once the Preparation is held", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 1, purpose: "winter" });
		const post = vi.fn(async () => {});
		await openBolster(vahid, { ask: async () => ({ hold: 2, purpose: "the Fae" }), post });
		expect(post).toHaveBeenCalledWith(vahid, BOLSTER,
			"Vahid Bolstered for a month or so and holds 2 Preparation (the Fae). It replaces the 1 Preparation held before (winter).");
	});
});

// "Preparation lasts until it is spent, until it no longer applies or makes sense, or until the PC Bolsters
// again" (p.525).
describe("changing or letting go of Preparation", () => {
	it("changes what it is for, keeping how much is held, and says so", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 2, purpose: "winter stors" });
		const post = vi.fn(async () => {});
		expect(await editPreparationFor(vahid, { ask: async () => "winter stores", post })).toBe(true);
		expect(preparationHeld(vahid)).toBe(2);
		expect(preparationFor(vahid)).toBe("winter stores");
		expect(post.mock.calls[0][2]).toBe("Vahid's 2 Preparation is now written down as for: winter stores.");
	});

	it("changes nothing when closed, unchanged, or with nothing held", async () => {
		const post = vi.fn(async () => {});
		const vahid = pc({ id: "vahid", name: "Vahid", held: 2, purpose: "winter" });
		expect(await editPreparationFor(vahid, { ask: async () => null, post })).toBe(false);
		expect(await editPreparationFor(vahid, { ask: async () => "winter", post })).toBe(false);
		const none = pc({ id: "none", name: "None", held: 0 });
		const ask = vi.fn();
		expect(await editPreparationFor(none, { ask, post })).toBe(false);
		expect(ask).not.toHaveBeenCalled();
		expect(post).not.toHaveBeenCalled();
	});

	it("lets it go once asked, clearing what it was for, and says so", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 2, purpose: "the Fae" });
		const post = vi.fn(async () => {});
		expect(await dropPreparation(vahid, { confirm: async () => false, post })).toBe(false);
		expect(preparationHeld(vahid)).toBe(2);
		expect(await dropPreparation(vahid, { confirm: async () => true, post })).toBe(true);
		expect(preparationHeld(vahid)).toBe(0);
		expect(preparationFor(vahid)).toBe("");
		expect(post).toHaveBeenCalledWith(vahid, BOLSTER, "Vahid's 2 Preparation (the Fae) no longer applies, and is gone.");
	});

	it("draws both buttons only while something is held, wired for whoever may edit", () => {
		const hbs = read("templates/actor/partials/tab-special-moves.hbs");
		expect(hbs).toContain("{{#if (and stonetop.bolster.held this.editable)}}");
		const sheet = read("module/actors/character/StonetopCharacterSheet.js");
		const at = sheet.indexOf('html.find(".stonetop-bolster-open-btn")');
		const wiring = sheet.slice(at, at + 400);
		expect(wiring).toContain('html.find(".stonetop-bolster-edit-btn").on("click", () => editPreparationFor(this.actor));');
		expect(wiring).toContain('html.find(".stonetop-bolster-drop-btn").on("click", () => dropPreparation(this.actor));');
	});
});

// "PCs can Bolster for a coming season and spend the Preparation on the roll(s)" (p.516). Spring's card is
// rolled from a hand-over the GM settles, so its Preparation is a line in that window.
describe("Preparation on spring's handed-over Seasons Change", () => {
	it("offers one unticked line per PC holding any", () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 2, purpose: "a rite to Danu" });
		const offers = preparationRollOffers([vahid, pc({ id: "none", name: "None" }), pc({ id: "s", name: "S", held: 1, type: "steading" })]);
		expect(offers).toHaveLength(1);
		expect(offers[0]).toMatchObject({ key: "preparation:Actor.vahid", applied: false, holder: vahid });
		expect(offers[0].label).toBe("+1: Vahid spends 1 Preparation (2 held, a rite to Danu). One per roll.");
	});

	it("takes the first line ticked, pays for it, and says the rest bought nothing", async () => {
		const a = pc({ id: "a", name: "A", held: 1 });
		const b = pc({ id: "b", name: "B", held: 1 });
		const offers = preparationRollOffers([a, b]);
		const { taken, extra } = takenPreparationOffer(offers, ["stormMiss", "preparation:Actor.b", "preparation:Actor.a"]);
		expect(taken.holder).toBe(a);
		expect(extra).toBe(1);
		expect(takenPreparationOffer(offers, ["stormMiss"])).toEqual({ taken: null, extra: 0 });
		expect(await claimPreparationOffer(taken)).toBe(true);
		expect(preparationHeld(a)).toBe(0);
		expect(preparationHeld(b)).toBe(1);
		const post = vi.fn(async () => {});
		await announcePreparationOffer(taken, "Seasons Change: Spring", { extra, post });
		expect(post.mock.calls[0][2]).toBe(
			"A spends 1 Preparation for +1 on Seasons Change: Spring. Only one Preparation counts on a roll (maximum +1), so no one else's was spent.");
	});

	it("tells the GM, and pays nothing, when the holder spent their last since the window opened", async () => {
		const a = pc({ id: "a", name: "A", held: 1 });
		const [offer] = preparationRollOffers([a]);
		a.tracks[BOLSTER] = 0;
		const warn = vi.fn();
		expect(await claimPreparationOffer(offer, { warn })).toBe(false);
		expect(warn).toHaveBeenCalledWith("A has no Preparation left to spend, so this roll goes without its +1.");
	});

	it("gives a claimed line's Preparation back, for a card that never went out", async () => {
		const a = pc({ id: "a", name: "A", held: 2 });
		const [offer] = preparationRollOffers([a]);
		await claimPreparationOffer(offer);
		expect(preparationHeld(a)).toBe(1);
		await returnPreparationOffer(offer);
		expect(preparationHeld(a)).toBe(2);
	});

	it("is in spring's hand-over window for the party in play, paid before the card, and marked done once it is up", () => {
		const sheet = read("module/actors/steading/StonetopSteadingSheet.js");
		const at = sheet.indexOf("data-action='ask-hopeful'");
		const body = sheet.slice(at, at + 7000);
		expect(body).toContain("offers: [stormMiss, ...prepOffers]");
		expect(body).toContain("preparationRollOffers(partyCharacters().filter(a => !isOutOfPlaySafe(a)))");
		expect(body).toContain("modifier: (prompted.situational ?? 0) + (prepTaken ? 1 : 0)");
		const claim = body.indexOf("await claimPreparationOffer(prepPicked)");
		const card = body.indexOf("await postSeasonsRollPrompt(");
		const posted = body.indexOf("posted = true;");
		const marked = body.indexOf('steading.seasonStepFlags("fortunesRoll", year, seasonId)');
		expect(claim).toBeGreaterThan(-1);
		expect(claim).toBeLessThan(card);
		expect(card).toBeLessThan(posted);
		expect(posted).toBeLessThan(marked);
		expect(marked).toBeLessThan(body.indexOf("await spend();"));
		expect(body.indexOf("await spend();")).toBeLessThan(body.indexOf("await announcePreparationOffer(prepTaken"));
		// A failure before the card is up gives the Preparation and the button back; after it, neither.
		const giveBack = body.slice(body.indexOf("if (!posted) {"));
		expect(giveBack.indexOf("await returnPreparationOffer(prepTaken)")).toBeGreaterThan(-1);
		expect(giveBack.indexOf("await returnPreparationOffer(prepTaken)")).toBeLessThan(giveBack.indexOf("askHopefulBtn.disabled = false;"));
	});
});

// A length of prayer beads: "When you Bolster by spending downtime ... with the prayer beads, hold Preparation
// (as per the Bolster move)." Its card's pips are the Bolster track.
describe("the prayer beads' Preparation", () => {
	function model(held, purpose = "fasting") {
		const actor = pc({ id: "vahid", name: "Vahid", held, purpose });
		const self = Object.create(StonetopCharacter.prototype);
		Object.assign(self, {
			_actor: actor,
			_moveResources: actor.typedActor.moveResources,
			_inventory: {
				resources: { "other-arcanum": 2, "length-of-prayer-beads": 1 },
				setResource: vi.fn(async () => {}),
				resourceDeletionData: slug => ({ [`flags.${SCOPE}.inventory.resources.-=${slug}`]: null }),
			},
		});
		return { actor, self };
	}

	it("reads the beads' pips off the Bolster track, and every other arcanum's off its own", () => {
		const { self } = model(3);
		expect(PREPARATION_ARCANA).toContain("length-of-prayer-beads");
		expect(self._arcanumResources()).toEqual({ "other-arcanum": 2, "length-of-prayer-beads": 3 });
	});

	it("writes the beads' pips to the Bolster track, and empties what it was for at 0", async () => {
		const { actor, self } = model(1);
		await self.setArcanumResource("length-of-prayer-beads", 3, { render: false });
		expect(preparationHeld(actor)).toBe(3);
		expect(preparationFor(actor)).toBe("fasting");
		expect(actor.update.mock.calls[0][1]).toMatchObject({ render: false, stonetopMove: BOLSTER });
		await self.setArcanumResource("length-of-prayer-beads", 0);
		expect(preparationHeld(actor)).toBe(0);
		expect(preparationFor(actor)).toBe("");
		await self.setArcanumResource("other-arcanum", 1);
		expect(self._inventory.setResource).toHaveBeenCalledWith("other-arcanum", 1, undefined);
	});

	it("writes a click as a change from what the card showed, so a +1 spent meanwhile is kept", async () => {
		const { actor, self } = model(3);
		actor.tracks[BOLSTER] = 2; // a roll card spent one; the beads card still showed 3
		expect(await self.setArcanumResource("length-of-prayer-beads", 2, { from: 3 })).toBe(true);
		expect(preparationHeld(actor)).toBe(1);
		expect(actor.update.mock.calls[0][1]).toEqual({ stonetopMove: BOLSTER });
		// A click that changes nothing once clamped writes nothing, so the sheet redraws itself.
		expect(await self.setArcanumResource("length-of-prayer-beads", 3, { from: 3 })).toBe(false);
		expect(actor.update).toHaveBeenCalledTimes(1);
	});

	it("takes the character's spending turn, as every other Preparation spend does", () => {
		const src = read("module/actors/character/StonetopCharacter.js");
		const at = src.indexOf("async setArcanumResource(");
		expect(src.slice(at, at + 600)).toContain("return inSpenderTurn(this._actor, async () => {");
	});

	it("redraws the sheet on a beads click, which the header and the Bolster card also show", () => {
		const sheet = read("module/actors/character/StonetopCharacterSheet.js");
		const at = sheet.indexOf("PREPARATION_ARCANA.includes(slug)");
		const wiring = sheet.slice(at, at + 700);
		expect(wiring).toContain("setArcanumResource(slug, newVal, { from: shown })");
		expect(wiring).not.toContain("render: false");
		expect(wiring).toContain("if (!wrote) this.render(false);");
	});

	it("brings pips ticked before the change onto the Bolster track, keeping the larger, and drops the old count", async () => {
		const { actor, self } = model(0);
		self._inventory.resources = { "other-arcanum": 2, "length-of-prayer-beads": 2 };
		expect(await self.adoptPrayerBeadPips()).toBe(true);
		expect(preparationHeld(actor)).toBe(2);
		expect(actor.update.mock.calls[0][0]).toMatchObject({ [`flags.${SCOPE}.inventory.resources.-=length-of-prayer-beads`]: null });
		const kept = model(3);
		kept.self._inventory.resources = { "length-of-prayer-beads": 1 };
		expect(await kept.self.adoptPrayerBeadPips()).toBe(true);
		expect(preparationHeld(kept.actor)).toBe(3);
		const none = model(1);
		none.self._inventory.resources = { "other-arcanum": 2 };
		expect(await none.self.adoptPrayerBeadPips()).toBe(false);
		expect(none.actor.update).not.toHaveBeenCalled();
	});
});

// Held for weeks of play and read by any roll the efforts apply to, so it is in sight on the header, beside
// Inspiration's and Rapport's pills.
describe("the header's Preparation chip", () => {
	it("is drawn only while some is held, in words, with what it is for", () => {
		expect(preparationChip(pc({ id: "v", name: "V", held: 0 })).show).toBe(false);
		const chip = preparationChip(pc({ id: "v", name: "V", held: 2, purpose: "the bear hunt" }), { editable: true });
		expect(chip).toMatchObject({ show: true, held: 2, label: "Preparation 2" });
		expect(chip.tooltip).toBe("Preparation (Bolster): 2 held, for the bear hunt. Spend 1 for +1 on a roll your efforts apply to, from its card. Click to change what it's for, or let it go.");
		expect(preparationChip(pc({ id: "v", name: "V", held: 1 })).tooltip)
			.toBe("Preparation (Bolster): 1 held. Spend 1 for +1 on a roll your efforts apply to, from its card.");
	});

	it("is a button that changes what it is for where the sheet is editable, a readout where not", () => {
		const hbs = read("templates/actor/partials/actor-header.hbs");
		expect(hbs).toContain('<button type="button" class="stonetop-preparation-chip"');
		expect(hbs).toContain('<span class="stonetop-preparation-chip"');
		// What it is for is the player's own words: plain text, never the HTML a bare data-tooltip is drawn as.
		expect(hbs).toContain('data-tooltip-text="{{stonetop.preparation.tooltip}}"');
		expect(hbs).not.toContain('data-tooltip="{{stonetop.preparation.tooltip}}"');
		const sheet = read("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain("context.stonetop.preparation = preparationChip(this.actor, { editable: context.editable });");
		expect(sheet).toContain('html.find("button.stonetop-preparation-chip").on("click", () => editPreparationFor(this.actor, { offerDrop: true }));');
	});
});

// The chip is the header's one control for Preparation, so its window can also let it go.
describe("the chip's window", () => {
	it("offers \"It no longer applies\" beside Save, and lets it go through the same question", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 2, purpose: "the Fae" });
		let spec;
		const ask = vi.fn(async s => { spec = s; return s.secondary.value; });
		const drop = vi.fn(async () => true);
		const post = vi.fn(async () => {});
		expect(await editPreparationFor(vahid, { ask, drop, post, offerDrop: true })).toBe(true);
		expect(spec.secondary).toMatchObject({ label: "It no longer applies", icon: "fa-xmark" });
		expect(drop).toHaveBeenCalledWith(vahid, { post });
		expect(preparationFor(vahid)).toBe("the Fae");
	});

	it("leaves it off the Special Moves card's window, which has that button of its own", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 2, purpose: "the Fae" });
		let spec;
		await editPreparationFor(vahid, { ask: async s => { spec = s; return null; } });
		expect(spec.secondary).toBeUndefined();
	});

	it("asks with the red destructive button before letting it go", async () => {
		const vahid = pc({ id: "vahid", name: "Vahid", held: 1 });
		const confirm = vi.fn(async () => false);
		await dropPreparation(vahid, { confirm, post: async () => {} });
		expect(confirm.mock.calls[0][0].yes).toMatchObject({ label: "Let it go", className: "stonetop-dialog-btn--danger" });
	});
});
