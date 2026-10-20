// WHO TRAVELS WITH THE PARTY (follower-party.js), the user's ruling of 2026-10-02: every follower card
// carries the "in the party" toggle custom cards always had. Unset, an animal companion and a crew are
// in, initiates and beasts are out; a tick or an untick stores an explicit boolean beside that kind's
// other flags. Make Camp feeds "each member of the party" (Book I p.79), and a fed follower regains HP
// there (p.248), so the camp, the expedition and the Struggle as One setup all read it here.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { loadPlaybookDefs } from "../../fakes/sourcePack.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { newSetupDraft } from "../../../module/struggle/struggle-setup.js";
import {
	FOLLOWER_PARTY_DEFAULTS, followerFeedsItself, followerInPartyFlags, followerMouths, followerPartyPath, partyFollowers, partyMouths,
} from "../../../module/actors/character/follower-party.js";

const BLESSED = loadPlaybookDefs().byName.get("The Blessed");

function sheetFor(char, actor) {
	actor.typedActor = char;
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

describe("the party toggle's one reading", () => {
	it("defaults the companion and the crew in, initiates, beasts and custom followers out", () => {
		expect(FOLLOWER_PARTY_DEFAULTS).toEqual({ "animal-companion": true, crew: true, initiate: false, beast: false, custom: false });
		expect(followerInPartyFlags({}, "animal-companion")).toBe(true);
		expect(followerInPartyFlags({}, "crew")).toBe(true);
		expect(followerInPartyFlags({}, "initiate", "enfys")).toBe(false);
		expect(followerInPartyFlags({}, "beast", "ox")).toBe(false);
		expect(followerInPartyFlags({ customFollowers: { hound: {} } }, "custom", "hound")).toBe(false);
	});

	it("reads an explicit boolean over the default, stored beside each kind's other flags", () => {
		const flags = {
			animalCompanion: { party: false },
			crew:            { party: false },
			initiatesParty:  { enfys: true },
			beastParty:      { ox: true },
			customFollowers: { hound: { party: true } },
		};
		expect(followerInPartyFlags(flags, "animal-companion")).toBe(false);
		expect(followerInPartyFlags(flags, "crew")).toBe(false);
		expect(followerInPartyFlags(flags, "initiate", "enfys")).toBe(true);
		expect(followerInPartyFlags(flags, "beast", "ox")).toBe(true);
		expect(followerInPartyFlags(flags, "custom", "hound")).toBe(true);
		expect([
			followerPartyPath("animal-companion"), followerPartyPath("crew"), followerPartyPath("initiate", "enfys"),
			followerPartyPath("beast", "ox"), followerPartyPath("custom", "hound"),
		]).toEqual(["animalCompanion.party", "crew.party", "initiatesParty.enfys", "beastParty.ox", "customFollowers.hound.party"]);
	});

	it("counts the crew as its roster, a custom group as the members still with it, anyone else as one", () => {
		const flags = {
			crew: { name: "The Wolves", size: 6, individuals: [{ name: "Bryn" }, { name: "Cai" }] },
			customFollowers: { band: { isGroup: true, size: 3, memberDead: [true, null, null] } },
		};
		const cards = [
			{ ftype: "crew", slug: "", party: true },
			{ ftype: "custom", slug: "band", party: true },
			{ ftype: "animal-companion", slug: "", party: true },
			{ ftype: "initiate", slug: "enfys", party: false },
			{ ftype: "custom", slug: "lost", party: true, dead: true },
		];
		expect(followerMouths(flags, cards[0])).toBe(6);
		expect(followerMouths(flags, cards[1])).toBe(2);
		expect(partyFollowers(cards).map(c => c.ftype)).toEqual(["crew", "custom", "animal-companion"]);
		// The companion travels but feeds itself (p.304), so it is no mouth.
		expect(partyMouths(flags, partyFollowers(cards))).toBe(8);
	});

	// Book I p.304: "Pack animals can graze or browse ... The Ranger's pet wolf can probably fend for
	// itself ... but well-heeled hounds probably need to be fed from the party's supplies."
	it("counts no mouth for an animal that feeds itself, and one for a hound", () => {
		const flags = {
			customFollowers: {
				nag:   { typeLabel: "beast follower", portraitIcon: "fas fa-horse" },
				goat:  { typeLabel: "livestock", portraitIcon: "fas fa-wheat-awn" },
				rex:   { typeLabel: "beast follower", portraitIcon: "fas fa-dog" },
				guide: { typeLabel: "follower", portraitIcon: "fas fa-user" },
			},
		};
		const mouths = c => followerMouths(flags, { party: true, ...c });
		expect(mouths({ ftype: "animal-companion", slug: "" })).toBe(0);
		expect(mouths({ ftype: "beast", slug: "mule" })).toBe(0);
		expect(mouths({ ftype: "beast", slug: "horse" })).toBe(0);
		expect(mouths({ ftype: "beast", slug: "dog-follower" })).toBe(1);
		expect(mouths({ ftype: "custom", slug: "nag" })).toBe(0);
		expect(mouths({ ftype: "custom", slug: "goat" })).toBe(0);
		expect(mouths({ ftype: "custom", slug: "rex" })).toBe(1);
		expect(mouths({ ftype: "custom", slug: "guide" })).toBe(1);
		expect(mouths({ ftype: "initiate", slug: "enfys" })).toBe(1);
		expect(followerFeedsItself(flags, { ftype: "beast", slug: "pig" })).toBe(true);
		expect(followerFeedsItself(flags, { ftype: "crew", slug: "" })).toBe(false);
	});

	// A custom follower made from a beast records which one (data/beasts.js#followerInputFromBeast), so a hound
	// renamed and given a horse's portrait still eats, and a mule relabelled "pack animal" still grazes.
	it("reads the beast a custom follower was made from over its label and glyph", () => {
		const flags = {
			customFollowers: {
				rex: { beastSlug: "dog-follower", typeLabel: "war beast", portraitIcon: "fas fa-horse" },
				ned: { beastSlug: "mule", typeLabel: "pack animal", portraitIcon: "fas fa-dog" },
			},
		};
		expect(followerFeedsItself(flags, { ftype: "custom", slug: "rex" })).toBe(false);
		expect(followerFeedsItself(flags, { ftype: "custom", slug: "ned" })).toBe(true);
	});
});

describe("the toggle on a built-in card", () => {
	// The shared card body draws the toggle for every built-in card, naming its kind so the handler
	// writes the right flag; the custom card's own toggle names its kind too.
	it("is drawn on every built-in card's body in edit mode, and on the custom card", () => {
		const hbs = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../templates/actor/partials/tab-followers.hbs"), "utf8");
		const body = hbs.slice(hbs.indexOf('{{#*inline "stonetopFollowerCardBody"}}'), hbs.indexOf("{{/inline}}", hbs.indexOf('{{#*inline "stonetopFollowerCardBody"}}')));
		expect(body).toMatch(/\{\{#if edit\.card\}\}\{\{#unless \(eq ftype "custom"\)\}\}[\s\S]*class="stonetop-follower-party-check" data-ftype="\{\{ftype\}\}" data-slug="\{\{slug\}\}"/);
		expect(hbs).toContain('class="stonetop-follower-party-check" data-ftype="custom" data-slug="{{slug}}"');
	});

	const blessed = (flags = {}) => buildLiveCharacter({
		slug: "the-blessed", name: "The Blessed",
		flags: { "background.selected": "initiate", "background.choices": { enfys: true, seren: true }, ...flags },
	});

	it("draws initiates out of the party until one is ticked in", async () => {
		const { char, actor } = blessed();
		const sheet = sheetFor(char, actor);
		const party = () => Object.fromEntries(sheet._buildFollowersData(BLESSED).initiates.map(c => [c.slug, c.party]));
		expect(party()).toEqual({ enfys: false, seren: false });

		await sheet._onFollowerPartyToggle({ currentTarget: { dataset: { ftype: "initiate", slug: "enfys" }, checked: true } });
		expect(actor.update).toHaveBeenLastCalledWith({ "flags.stonetop-pwd.initiatesParty.enfys": true });
		expect(party()).toEqual({ enfys: true, seren: false });
	});

	// The Struggle as One setup starts a follower in when the card says they travel (struggle-setup.js
	// reads the card's `party`), so a ticked initiate is in from the start and an unticked one is not.
	it("starts a ticked initiate in the Struggle as One setup, and leaves an unticked one out", async () => {
		const { char, actor } = blessed({ "initiatesParty.seren": true });
		const followers = await sheetFor(char, actor).orderableFollowers();
		const roster = [{ actorId: "a1", followers: followers.map(f => ({ ...f, fkey: `a1:${f.ftype}:${f.slug}` })) }];
		const draft = newSetupDraft(roster);
		expect(draft.followers["a1:initiate:seren"].include).toBe(true);
		expect(draft.followers["a1:initiate:enfys"].include).toBe(false);
	});

	it("still writes a custom card's toggle where it always lived", async () => {
		const { char, actor } = blessed();
		const sheet = sheetFor(char, actor);
		await sheet._onFollowerPartyToggle({ currentTarget: { dataset: { ftype: "custom", slug: "hound" }, checked: true } });
		expect(actor.update).toHaveBeenLastCalledWith({ "flags.stonetop-pwd.customFollowers.hound.party": true });
		// A checkbox drawn before the ftype rode on it reads as a custom card's.
		await sheet._onFollowerPartyToggle({ currentTarget: { dataset: { slug: "mule" }, checked: false } });
		expect(actor.update).toHaveBeenLastCalledWith({ "flags.stonetop-pwd.customFollowers.mule.party": false });
	});
});
