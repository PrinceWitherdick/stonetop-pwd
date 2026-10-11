// "The first time you use any move marked with an asterisk (*), cross off 'Would-be' on the front page."
// On first USE, not on gaining the move (the user's ruling, 2026-09-27; Book I: "Caradoc uses Big Damn
// Hero and crosses 'Would-be' off his playbook"). Every use point calls asteriskMoveUsed; crossed off is
// the flag (WBH_HERO_FLAG) alone, and it stays.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as asterisk from "../../../module/actors/character/WouldBeHeroAsterisk.js";
import {
	ASTERISK_MOVES,
	asteriskMoveUsed,
	asteriskUseCounts,
	crossOffWouldBe,
	canRestoreWouldBe,
	restoreWouldBe,
	heroDisplayName,
	WBH_HERO_FLAG,
} from "../../../module/actors/character/WouldBeHeroAsterisk.js";
import { playbookTitle } from "../../../module/utils/playbook-actors.js";
import { readRepo } from "../../fakes/css.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// `slug` is what the guards read and `playbook` is only the label, so they default together
// and can be set apart.
function makeActor({ playbook = "The Would-Be Hero", slug = "the-would-be-hero", isHero = false, moves = ASTERISK_MOVES, unlearned = [] } = {}) {
	const flags = { [WBH_HERO_FLAG]: isHero || undefined };
	return {
		type: "character",
		name: "Wren",
		system: { playbook: { name: playbook, slug } },
		items: moves.map(name => ({
			type: "move", name, system: {},
			flags: unlearned.includes(name) ? { [SYSTEM_ID]: { learned: false } } : {},
		})),
		getFlag: (_scope, key) => flags[key],
		setFlag: vi.fn(async (_scope, key, value) => { flags[key] = value; }),
	};
}

describe("heroDisplayName", () => {
	it("renames the Would-Be Hero to The Hero once crossed off", () => {
		expect(heroDisplayName("The Would-Be Hero", true)).toBe("The Hero");
	});

	it("keeps the Would-Be Hero name until crossed off", () => {
		expect(heroDisplayName("The Would-Be Hero", false)).toBe("The Would-Be Hero");
	});

	it("leaves other playbooks untouched", () => {
		expect(heroDisplayName("The Blessed", true)).toBe("The Blessed");
	});
});

describe("gaining a starred move crosses nothing off", () => {
	it("no createItem hook announces a gain any more", () => {
		const main = readRepo("stonetop.js");
		expect(main).not.toMatch(/maybeAnnounceBecameHero/);
		expect(asterisk.maybeAnnounceBecameHero).toBeUndefined();
		expect(asterisk.ownsAsteriskMove).toBeUndefined();
	});

	it("owning all four, unused, still reads as The Would-Be Hero", () => {
		expect(playbookTitle(makeActor())).toBe("The Would-Be Hero");
		expect(playbookTitle(makeActor({ isHero: true }))).toBe("The Hero");
	});

	it("the pack's four carry no dead asterisk data", () => {
		for (const slug of ["a-force-to-be-reckoned-with", "big-damn-hero", "undaunted", "voice-of-experience"]) {
			const doc = JSON.parse(readRepo(`packs/src/stonetop-items/playbook-moves/the-would-be-hero/${slug}.json`));
			expect(ASTERISK_MOVES).toContain(doc.name);
			expect(doc.system.asterisk).toBeUndefined();
			expect(doc.system.description).toContain("First use crosses off \"Would-be\"");
		}
	});
});

describe("asteriskMoveUsed", () => {
	let saved;
	beforeEach(() => {
		saved = globalThis.ChatMessage;
		globalThis.ChatMessage = { create: vi.fn(), getSpeaker: vi.fn(() => ({})) };
	});
	afterEach(() => { globalThis.ChatMessage = saved; });

	it.each(ASTERISK_MOVES)("crosses off Would-be and announces on the first use of %s", async name => {
		const actor = makeActor({ moves: [name] });
		expect(await asteriskMoveUsed(actor, name)).toBe(true);
		expect(actor.setFlag).toHaveBeenCalledWith(SYSTEM_ID, WBH_HERO_FLAG, true);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		const content = ChatMessage.create.mock.calls[0][0].content;
		expect(content).toContain("A Would-Be Hero No Longer");
		expect(content).toContain(name);
		expect(playbookTitle(actor)).toBe("The Hero");
	});

	it("crosses off once: a second use, of the same move or another, announces nothing", async () => {
		const actor = makeActor();
		expect(await asteriskMoveUsed(actor, "Undaunted")).toBe(true);
		expect(await asteriskMoveUsed(actor, "Undaunted")).toBe(false);
		expect(await asteriskMoveUsed(actor, "Big Damn Hero")).toBe(false);
		expect(actor.setFlag).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
	});

	it("does not re-announce for someone already crossed off", async () => {
		const actor = makeActor({ isHero: true });
		expect(await asteriskMoveUsed(actor, "Undaunted")).toBe(false);
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("an un-learned copy crosses nothing off", async () => {
		const actor = makeActor({ unlearned: ["Undaunted"] });
		expect(asteriskUseCounts(actor, "Undaunted")).toBe(false);
		expect(await asteriskMoveUsed(actor, "Undaunted")).toBe(false);
		expect(actor.setFlag).not.toHaveBeenCalled();
	});

	it("a move not held crosses nothing off", async () => {
		const actor = makeActor({ moves: ["Big Damn Hero"] });
		expect(await asteriskMoveUsed(actor, "Undaunted")).toBe(false);
		expect(actor.setFlag).not.toHaveBeenCalled();
	});

	it("a move without the asterisk crosses nothing off", async () => {
		const actor = makeActor({ moves: ["Tough Love"] });
		expect(await asteriskMoveUsed(actor, "Tough Love")).toBe(false);
		expect(actor.setFlag).not.toHaveBeenCalled();
	});

	it("a non-Would-Be Hero holding a starred move never crosses anything off", async () => {
		const actor = makeActor({ playbook: "The Heavy", slug: "the-heavy" });
		expect(await asteriskMoveUsed(actor, "Undaunted")).toBe(false);
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	// The guard reads the slug: this playbook RENAMES ITSELF, and a player may retitle it besides.
	it("still fires for a Would-Be Hero whose playbook has been retitled", async () => {
		const actor = makeActor({ playbook: "The Hero" });
		expect(await asteriskMoveUsed(actor, "Undaunted")).toBe(true);
	});

	it("does not fire for another playbook renamed to look like this one", async () => {
		const actor = makeActor({ playbook: "The Would-Be Hero", slug: "the-heavy" });
		expect(await asteriskMoveUsed(actor, "Undaunted")).toBe(false);
	});

	it("losing the move later does not un-cross it", async () => {
		const actor = makeActor({ moves: ["Undaunted"] });
		await asteriskMoveUsed(actor, "Undaunted");
		actor.items = [];
		expect(playbookTitle(actor)).toBe("The Hero");
		expect(asteriskUseCounts(actor, "Undaunted")).toBe(false);
	});

	// A use the sheet cannot see (A Force's first paragraph, a leap made at the table) is a box the player
	// ticks: an owner-only "I used it" button on each starred move's Moves-tab card while still Would-be.
	it("the Moves tab offers the manual cross-off on a starred move's card, while it would still count", () => {
		const hbs = readRepo("templates/actor/partials/move-group.hbs");
		expect(hbs).toContain("{{#if (and owned (lookup @root.stonetop.asteriskUse name))}}");
		expect(hbs).toMatch(/class="stonetop-inline-btn stonetop-asterisk-used" data-move-name="\{\{name\}\}"/);
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toMatch(/context\.stonetop\.asteriskUse = this\.isEditable\s*\?\s*Object\.fromEntries\(ASTERISK_MOVES\.filter\(name => asteriskUseCounts\(this\.actor, name\)\)/);
		expect(sheet).toMatch(/button\.stonetop-asterisk-used[\s\S]{0,900}asteriskMoveUsed\(this\.actor, moveName\)/);
		// Which cards get it: the learned starred moves of a Would-Be Hero not yet crossed off.
		const actor = makeActor({ unlearned: ["Undaunted"] });
		expect(ASTERISK_MOVES.filter(name => asteriskUseCounts(actor, name)))
			.toEqual(["A Force to Be Reckoned With", "Big Damn Hero", "Voice of Experience"]);
		expect(ASTERISK_MOVES.filter(name => asteriskUseCounts(makeActor({ isHero: true }), name))).toEqual([]);
	});

	it("crossOffWouldBe without a move still announces, once", async () => {
		const actor = makeActor();
		expect(await crossOffWouldBe(actor)).toBe(true);
		expect(await crossOffWouldBe(actor)).toBe(false);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create.mock.calls[0][0].content).not.toContain("used");
	});
});

// A player pressed "I used it" for a use that never happened (user bug report, 2026-10-09): nothing on the
// sheet un-crossed it. The header's edit-mode button writes "Would-be" back in.
describe("restoreWouldBe", () => {
	let saved;
	beforeEach(() => {
		saved = globalThis.ChatMessage;
		globalThis.ChatMessage = { create: vi.fn(), getSpeaker: vi.fn(() => ({})) };
	});
	afterEach(() => { globalThis.ChatMessage = saved; });

	it("writes Would-be back in, says so, and the next starred use crosses it off again", async () => {
		const actor = makeActor({ moves: ["Undaunted"] });
		await asteriskMoveUsed(actor, "Undaunted");
		ChatMessage.create.mockClear();
		expect(await restoreWouldBe(actor)).toBe(true);
		// FALSE, not removed: the grandfathering leaves a flag written either way alone.
		expect(actor.setFlag).toHaveBeenLastCalledWith(SYSTEM_ID, WBH_HERO_FLAG, false);
		expect(playbookTitle(actor)).toBe("The Would-Be Hero");
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("A Would-Be Hero Again");
		expect(asteriskUseCounts(actor, "Undaunted")).toBe(true);
		expect(await asteriskMoveUsed(actor, "Undaunted")).toBe(true);
		expect(playbookTitle(actor)).toBe("The Hero");
	});

	it("does nothing for a hero still Would-be, or another playbook", async () => {
		expect(canRestoreWouldBe(makeActor())).toBe(false);
		expect(await restoreWouldBe(makeActor())).toBe(false);
		expect(canRestoreWouldBe(makeActor({ slug: "the-heavy", isHero: true }))).toBe(false);
		expect(canRestoreWouldBe(makeActor({ isHero: true }))).toBe(true);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("the header offers it to the owner, in edit mode alone", () => {
		const hbs = readRepo("templates/actor/partials/actor-header.hbs");
		expect(hbs).toContain("{{#if stonetop.wouldBeRestorable}}{{#unless stonetop.postDeathInsert.activeInsert}}");
		expect(hbs).toContain('class="stonetop-inline-btn stonetop-would-be-restore"');
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toMatch(/context\.stonetop\.wouldBeRestorable = this\.isEditable && canRestoreWouldBe\(this\.actor\)/);
		expect(sheet).toMatch(/button\.stonetop-would-be-restore[\s\S]{0,900}restoreWouldBe\(this\.actor\)/);
		const css = readRepo("styles/stonetop.css");
		expect(css).toMatch(/\.stonetop-playbook-row \.stonetop-would-be-restore \{\s*display: none;/);
		expect(css).toMatch(/\.stonetop-edit-mode \.stonetop-playbook-row \.stonetop-would-be-restore \{\s*display: inline-flex;/);
	});
});
