import { describe, it, expect, vi } from "vitest";
import { Window } from "happy-dom";
import {
	boostOffers, takeBoost, boostButtonFace, holdPreparation, preparationHeld, preparationFor,
	BOLSTER, BOOSTS_FLAG, PREPARATION_FOR_FLAG,
} from "../../../module/actors/character/roll-boosts.js";
import { openBolster, bolsterBodyHtml, readBolsterForm } from "../../../module/actors/character/bolster.js";

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
