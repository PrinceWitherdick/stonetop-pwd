// Would-Be Hero audit (2026-09-27). Speak Truth to Power's "If they refuse, gain +1 Resolve" (Resolve CAPPED
// at 2, the user's ruling: the +1 is lost at 2), In Over Your Head's "When another PC rescues you from danger,
// mark XP", A Force to Be Reckoned With's 12+ hook, Anger is a Gift's righteous angers named on its card, and
// the two move-data fixes (Up With People back to the hero's own 2 pips, the partner's Rapport stored apart
// by up-with-people.js; Anger is a Gift's "and/or your course").

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import {
	ANGER_IS_A_GIFT, A_FORCE_TO_BE_RECKONED_WITH, FORCE_TURNED_TABLES_FLAG, REFUSED_FLAG, RESCUED_FLAG, RIGHTEOUS_ANGER_LORE,
	VOICE_ASKED_FLAG, VOICE_OF_EXPERIENCE,
	forceTurnedTables, gainRefusedResolve, inOverYourHeadCardHtml, markRescuedXp, righteousAngers,
	righteousAngerSubtitle, speakTruthRefusedActions, wireWouldBeHeroCards,
} from "../../../module/actors/character/would-be-hero-cards.js";
import { WBH_HERO_FLAG } from "../../../module/actors/character/WouldBeHeroAsterisk.js";
import { buildLiveCharacter, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { readRepo } from "../../fakes/css.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

const SCOPE = SYSTEM_ID;
const WBH = { slug: "the-would-be-hero", name: "The Would-Be Hero" };

/** A Would-Be Hero holding `resolve` on Anger is a Gift (seeded from the pack, track and all). */
function hero({ resolve = 0, moves = [], unlearnedAnger = false, lore = null } = {}) {
	const flags = {};
	if (resolve) flags["moves.backgroundChoices"] = { [ANGER_IS_A_GIFT]: resolve };
	if (lore) flags["lore.counts"] = lore;
	const made = buildLiveCharacter({ ...WBH, flags, items: moves.map(name => makeLiveItem({ name, type: "move", system: { moveType: "playbook" } })) });
	if (unlearnedAnger) {
		const anger = made.actor.items.find(i => i.name === ANGER_IS_A_GIFT);
		anger.flags = { ...(anger.flags ?? {}), [SCOPE]: { learned: false } };
	}
	made.actor.id = "wren";
	made.actor.isOwner = true;
	return made;
}
const resolveHeld = char => char.moveResources.getMoveResources()[ANGER_IS_A_GIFT] ?? 0;

function message({ writable = true, actorId = "wren" } = {}) {
	const flags = {};
	return {
		id: "m1", speaker: { actor: actorId }, flags,
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { (flags[scope] ??= {})[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete flags[scope]?.[key]; }),
		canUserModify: () => writable,
	};
}

describe("Speak Truth to Power's refusal", () => {
	it("puts the button on every tier, its tooltip naming the cap", () => {
		const actions = speakTruthRefusedActions();
		expect(Object.keys(actions)).toEqual(["success", "partial", "failure"]);
		expect(actions.failure).toContain("They refused: +1 Resolve");
		expect(actions.failure).toContain("at 2 the +1 is lost");
	});

	it("adds 1 Resolve to Anger is a Gift, and loses it when already holding 2", async () => {
		const none = hero();
		expect(await gainRefusedResolve(none.actor)).toEqual({ added: 1, held: 1, max: 2 });
		expect(resolveHeld(none.char)).toBe(1);
		const one = hero({ resolve: 1 });
		expect(await gainRefusedResolve(one.actor)).toEqual({ added: 1, held: 2, max: 2 });
		const full = hero({ resolve: 2 });
		expect(await gainRefusedResolve(full.actor)).toEqual({ added: 0, held: 2, max: 2 });
		expect(resolveHeld(full.char)).toBe(2);
	});

	it("gains nothing without Anger is a Gift learned", async () => {
		const off = hero({ unlearnedAnger: true });
		expect(await gainRefusedResolve(off.actor)).toBeNull();
		expect(resolveHeld(off.char)).toBe(0);
	});
});

describe("In Over Your Head's Mark XP", () => {
	it("is on its posted card for a learned owner, and on no other move's", () => {
		const { actor } = hero({ moves: ["In Over Your Head"] });
		expect(inOverYourHeadCardHtml(actor, "In Over Your Head")).toContain("stonetop-in-over-your-head-xp");
		expect(inOverYourHeadCardHtml(actor, "Tough Love")).toBe("");
		expect(inOverYourHeadCardHtml(hero().actor, "In Over Your Head")).toBe("");
	});

	// A move a player wrote under the book's name acts as itself (owns-move.js#bookMoveName): it marks no XP,
	// and it does not count as the book's learned copy for anyone else's card either.
	it("is on no card of a move a player wrote under its name", () => {
		const { actor } = hero({ moves: ["In Over Your Head"] });
		const homebrew = makeLiveItem({ name: "In Over Your Head", type: "move", flags: { [SCOPE]: { custom: true } } });
		expect(inOverYourHeadCardHtml(actor, "In Over Your Head", homebrew)).toBe("");
		expect(inOverYourHeadCardHtml(actor, "In Over Your Head", actor.items.find(i => i.name === "In Over Your Head")))
			.toContain("stonetop-in-over-your-head-xp");
		const writer = hero().actor;
		writer.items.push(homebrew);
		expect(inOverYourHeadCardHtml(writer, "In Over Your Head")).toBe("");
	});

	it("marks 1 XP and posts the receipt with its Undo", async () => {
		const { actor } = hero({ moves: ["In Over Your Head"] });
		actor.system.attributes.xp.value = 3;
		const create = vi.fn(async () => ({}));
		expect(await markRescuedXp(actor, { create })).toBe(true);
		expect(actor.system.attributes.xp.value).toBe(4);
		expect(create.mock.calls[0][0].content).toContain("In Over Your Head");
		expect(create.mock.calls[0][0].content).toContain("Undo XP Gain");
		expect(create.mock.calls[0][0].flags[SCOPE]).toBeTruthy();
	});

	it("is put on both of the sheet's description-only posts (the Moves tab and the hotbar)", () => {
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet.match(/inOverYourHeadCardHtml\(this\.actor, /g)).toHaveLength(2);
	});
});

describe("the card buttons, wired", () => {
	let saved;
	beforeEach(() => { saved = { actors: globalThis.game.actors, user: globalThis.game.user }; globalThis.game.user = { id: "u-wren", isGM: false }; });
	afterEach(() => { globalThis.game.actors = saved.actors; globalThis.game.user = saved.user; });

	const rendered = html => {
		const root = new Window().document.createElement("div");
		root.innerHTML = html;
		return root;
	};

	it("the refusal adds 1 Resolve once, and a re-render finds the card spent", async () => {
		const { actor, char } = hero({ resolve: 1 });
		globalThis.game.actors = { get: id => (id === actor.id ? actor : undefined) };
		const card = message();
		const notify = { info: vi.fn(), warn: vi.fn() };
		const root = rendered(speakTruthRefusedActions().partial);
		wireWouldBeHeroCards(card, root, { notify });
		root.querySelector(".stonetop-speak-truth-refused").click();
		await vi.waitFor(() => expect(notify.info).toHaveBeenCalled());
		expect(resolveHeld(char)).toBe(2);
		expect(card.getFlag(SCOPE, REFUSED_FLAG)).toBe(true);
		const again = rendered(speakTruthRefusedActions().partial);
		wireWouldBeHeroCards(card, again, { notify });
		expect(again.querySelector(".stonetop-speak-truth-refused").disabled).toBe(true);
	});

	it("at 2 Resolve the refusal answers the card but says the +1 is lost", async () => {
		const { actor, char } = hero({ resolve: 2 });
		globalThis.game.actors = { get: id => (id === actor.id ? actor : undefined) };
		const card = message();
		const notify = { info: vi.fn(), warn: vi.fn() };
		const root = rendered(speakTruthRefusedActions().failure);
		wireWouldBeHeroCards(card, root, { notify });
		root.querySelector(".stonetop-speak-truth-refused").click();
		await vi.waitFor(() => expect(notify.info).toHaveBeenCalled());
		expect(notify.info.mock.calls[0][0]).toContain("is lost");
		expect(resolveHeld(char)).toBe(2);
		expect(card.getFlag(SCOPE, REFUSED_FLAG)).toBe(true);
	});

	it("In Over Your Head's button marks XP once, and is dead for someone who cannot write the card", async () => {
		const { actor } = hero({ moves: ["In Over Your Head"] });
		actor.system.attributes.xp.value = 0;
		globalThis.game.actors = { get: id => (id === actor.id ? actor : undefined) };
		const card = message();
		const create = vi.fn(async () => ({}));
		const root = rendered(inOverYourHeadCardHtml(actor, "In Over Your Head"));
		wireWouldBeHeroCards(card, root, { create });
		root.querySelector(".stonetop-in-over-your-head-xp").click();
		await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(actor.system.attributes.xp.value).toBe(1);
		expect(card.getFlag(SCOPE, RESCUED_FLAG)).toBe(true);

		const locked = rendered(inOverYourHeadCardHtml(actor, "In Over Your Head"));
		wireWouldBeHeroCards(message({ writable: false }), locked, { create });
		expect(locked.querySelector(".stonetop-in-over-your-head-xp").disabled).toBe(true);
	});
});

describe("A Force to Be Reckoned With's hook", () => {
	let saved;
	beforeEach(() => { saved = globalThis.ChatMessage; globalThis.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) }; });
	afterEach(() => { globalThis.ChatMessage = saved; });

	it("stamps the card it turned the tables on", async () => {
		const card = message();
		expect(await forceTurnedTables({}, card)).toBe(true);
		expect(card.getFlag(SCOPE, FORCE_TURNED_TABLES_FLAG)).toBe(true);
		// A roll whose message was not found still answers.
		expect(await forceTurnedTables({}, null)).toBe(true);
	});

	// The asterisk: the first 12+ with the move learned crosses off "Would-be" (the user's ruling).
	it("crosses off \"Would-be\" on the first 12+, once, for the learned copy", async () => {
		const { actor } = hero({ moves: [A_FORCE_TO_BE_RECKONED_WITH] });
		await forceTurnedTables(actor, message());
		expect(actor.getFlag(SCOPE, WBH_HERO_FLAG)).toBe(true);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("A Would-Be Hero No Longer");
		await forceTurnedTables(actor, message());
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
	});

	it("an un-learned copy crosses nothing off", async () => {
		const { actor } = hero({ moves: [A_FORCE_TO_BE_RECKONED_WITH] });
		const force = actor.items.find(i => i.name === A_FORCE_TO_BE_RECKONED_WITH);
		force.flags = { ...(force.flags ?? {}), [SCOPE]: { learned: false } };
		await forceTurnedTables(actor, message());
		expect(actor.getFlag(SCOPE, WBH_HERO_FLAG)).toBeFalsy();
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});
});

describe("Voice of Experience's free question: \"Ask it\"", () => {
	let saved;
	beforeEach(() => {
		saved = { actors: globalThis.game.actors, user: globalThis.game.user, chat: globalThis.ChatMessage };
		globalThis.game.user = { id: "u-wren", isGM: false };
		globalThis.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
	});
	afterEach(() => { globalThis.game.actors = saved.actors; globalThis.game.user = saved.user; globalThis.ChatMessage = saved.chat; });

	const LINE = `<p class="stonetop-free-question" data-free-question="${VOICE_OF_EXPERIENCE}"><em>Free question (Voice of Experience): What is about to happen?</em></p>`;
	const rendered = html => {
		const root = new Window().document.createElement("div");
		root.innerHTML = html;
		return root;
	};
	const withHero = over => {
		const made = hero({ moves: [VOICE_OF_EXPERIENCE], ...over });
		globalThis.game.actors = { get: id => (id === made.actor.id ? made.actor : undefined) };
		return made;
	};

	it("asking it crosses off \"Would-be\", and the card latches", async () => {
		const { actor } = withHero();
		const card = message();
		const root = rendered(LINE);
		wireWouldBeHeroCards(card, root);
		const btn = root.querySelector(".stonetop-free-question .stonetop-voice-asked");
		expect(btn.textContent).toBe("Ask it");
		btn.click();
		await vi.waitFor(() => expect(actor.getFlag(SCOPE, WBH_HERO_FLAG)).toBe(true));
		expect(card.getFlag(SCOPE, VOICE_ASKED_FLAG)).toBe(true);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		// Re-rendered: shown as asked, and dead.
		const again = rendered(LINE);
		wireWouldBeHeroCards(card, again);
		const shown = again.querySelector(".stonetop-voice-asked");
		expect(shown.disabled).toBe(true);
		expect(shown.classList.contains("is-chosen")).toBe(true);
	});

	it("is not offered once \"Would-be\" is already crossed off, for an un-learned copy, or to someone who cannot write the card", () => {
		const { actor } = withHero();
		actor.setFlag(SCOPE, WBH_HERO_FLAG, true);
		const crossed = rendered(LINE);
		wireWouldBeHeroCards(message(), crossed);
		expect(crossed.querySelector(".stonetop-voice-asked")).toBeNull();

		const off = withHero();
		const voice = off.actor.items.find(i => i.name === VOICE_OF_EXPERIENCE);
		voice.flags = { ...(voice.flags ?? {}), [SCOPE]: { learned: false } };
		const unlearned = rendered(LINE);
		wireWouldBeHeroCards(message(), unlearned);
		expect(unlearned.querySelector(".stonetop-voice-asked")).toBeNull();

		withHero();
		const locked = rendered(LINE);
		wireWouldBeHeroCards(message({ writable: false }), locked);
		expect(locked.querySelector(".stonetop-voice-asked")).toBeNull();
	});

	it("a non-Would-Be Hero's Voice of Experience line gets no button", () => {
		const made = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", items: [makeLiveItem({ name: VOICE_OF_EXPERIENCE, type: "move", system: { moveType: "playbook" } })] });
		made.actor.id = "wren";
		made.actor.isOwner = true;
		globalThis.game.actors = { get: id => (id === "wren" ? made.actor : undefined) };
		const root = rendered(LINE);
		wireWouldBeHeroCards(message(), root);
		expect(root.querySelector(".stonetop-voice-asked")).toBeNull();
	});
});

describe("Anger is a Gift's righteous angers", () => {
	const LORE = [{ slug: RIGHTEOUS_ANGER_LORE, options: [
		{ slug: "bullying", description: "Bullying, slavery, and oppression." },
		{ slug: "cruelty", description: "Wanton cruelty and unnecessary suffering." },
		{ slug: "injustice", description: "Injustice and inequality." },
	] }];

	it("names the picks in the book's order, and nothing with none picked", () => {
		const counts = { [`${RIGHTEOUS_ANGER_LORE}:injustice`]: 1, [`${RIGHTEOUS_ANGER_LORE}:bullying`]: 1, [`${RIGHTEOUS_ANGER_LORE}:cruelty`]: 0 };
		expect(righteousAngers(LORE, counts)).toEqual(["Bullying, slavery, and oppression", "Injustice and inequality"]);
		expect(righteousAngerSubtitle(LORE, counts)).toBe("Burns with righteous anger at: Bullying, slavery, and oppression; Injustice and inequality");
		expect(righteousAngerSubtitle(LORE, {})).toBeNull();
	});

	it("rides Anger is a Gift's card on the Moves tab, read off the Details tab's picks", async () => {
		const { char } = hero({ lore: { [`${RIGHTEOUS_ANGER_LORE}:cruelty`]: 1, [`${RIGHTEOUS_ANGER_LORE}:loved-ones`]: 1 } });
		const section = await char._buildMovesSection(await char.playbook(), char._buildOwnedMovesMap(), 1);
		const moves = section.find(c => c.key === "playbook").moves;
		expect(moves.find(m => m.name === ANGER_IS_A_GIFT).subtitle).toBe("Burns with righteous anger at: Wanton cruelty and unnecessary suffering; Threats to your loved ones");
		expect(moves.find(m => m.name === "Up With People").subtitle).toBeNull();
		const hbs = readRepo("templates/actor/partials/move-group.hbs");
		expect(hbs).toContain('{{#if subtitle}}<p class="stonetop-move-note stonetop-move-subtitle">{{subtitle}}</p>{{/if}}');
	});
});

describe("the move data", () => {
	const pack = rel => JSON.parse(readRepo(`packs/src/stonetop-items/playbook-moves/the-would-be-hero/${rel}`)).system;

	it("gives Up With People the hero's own 2 Rapport only: the partner's 1 is stored apart (up-with-people.test.js)", () => {
		const { resource } = pack("up-with-people.json");
		expect(resource.max).toBe(2);
		expect(resource.labels).toBeUndefined();
		expect(resource.spendOptions).toHaveLength(4);
		const exported = JSON.parse(readRepo("data/playbook-moves.json"));
		const list = Array.isArray(exported) ? exported : Object.values(exported).flat();
		const shipped = list.find(m => m?.name === "Up With People").resource;
		expect(shipped.max).toBe(2);
		expect(shipped.labels).toBeUndefined();
	});

	it("prints Anger is a Gift's last spend in the book's words", () => {
		const { resource, description } = pack("anger-is-a-gift.json");
		expect(resource.spendOptions[4]).toBe("Keep your footing, position, and/or your course despite what befalls you");
		expect(description).toContain(resource.spendOptions[4]);
	});
});
