import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	FXMASTER_PACKAGE_URL,
	FXMASTER_SUGGESTION_SETTING,
	fxMasterSuggestionContent,
	postFxMasterSuggestionOnce,
} from "../../module/seasons/fxmaster-suggestion.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The one-time card that tells a GM the weather can also fall on the map. What is worth guarding
// is entirely the GATE: a card that arrives on a fresh world's first load buries the greeting, a
// card that arrives for a GM who already has FXMaster is a pitch for something they own, and a
// card that arrives twice is the kind of thing a GM disables a system over.

// MUTATED and restored rather than replaced: `global.game` carries the shared i18n table the rest
// of the suite reads (tests/setup.js), and swapping the object out would take it away from
// whatever runs next in this file.
const _realGame = global.game;
const _realChatMessage = global.ChatMessage;

let stored;   // the world settings this world has
let created;  // every ChatMessage.create payload

/**
 * Stand up a world.
 * @param {object} opts
 * @param {boolean} opts.isGM      Is the user asking a GM?
 * @param {string[]} opts.modules  Active module ids.
 * @param {object} opts.settings   Stonetop settings already stored in this world.
 */
function world({ isGM = true, modules = [], settings = {} } = {}) {
	stored = { ...settings };
	created = [];
	global.game = {
		...(_realGame ?? {}),
		user: { isGM },
		modules: { get: id => (modules.includes(id) ? { active: true } : undefined) },
		settings: {
			get: (scope, key) => (scope === SYSTEM_ID ? stored[key] : undefined),
			set: (scope, key, value) => { stored[key] = value; return Promise.resolve(value); },
		},
	};
	global.ChatMessage = {
		create: vi.fn(async data => { created.push(data); return data; }),
		getWhisperRecipients: vi.fn(() => [{ id: "gm1" }, { id: "gm2" }]),
	};
}

// The world state that means "the GM is past the first-session guide", which is the earliest
// moment this card is allowed to appear.
const PAST_THE_GUIDE = { gmWelcomeShown: true };

beforeEach(() => world());
afterEach(() => {
	global.game = _realGame;
	global.ChatMessage = _realChatMessage;
});

describe("postFxMasterSuggestionOnce", () => {
	it("whispers the card to the GMs when FXMaster is missing, and latches", async () => {
		world({ settings: PAST_THE_GUIDE });

		expect(await postFxMasterSuggestionOnce()).toBe(true);
		expect(created).toHaveLength(1);
		expect(created[0].whisper).toEqual(["gm1", "gm2"]);
		expect(created[0].content).toContain("FXMaster");
		expect(stored[FXMASTER_SUGGESTION_SETTING]).toBe(true);

		// Second load: the flag is what stops it, so nothing else has to.
		expect(await postFxMasterSuggestionOnce()).toBe(false);
		expect(created).toHaveLength(1);
	});

	// The point of latching in the quiet case: a GM who installs FXMaster, tries it, and turns it
	// off again must not then be sold it back.
	it.each([["fxmaster"], ["fxmaster-plus"]])(
		"stays quiet and latches when %s is already active", async id => {
			world({ modules: [id], settings: PAST_THE_GUIDE });

			expect(await postFxMasterSuggestionOnce()).toBe(false);
			expect(created).toHaveLength(0);
			expect(stored[FXMASTER_SUGGESTION_SETTING]).toBe(true);
		});

	// An INACTIVE module is a world that cannot draw weather, so the card is still owed.
	it("posts when FXMaster is installed but switched off in this world", async () => {
		world({ settings: PAST_THE_GUIDE });
		global.game.modules.get = id => (id === "fxmaster" ? { active: false } : undefined);

		expect(await postFxMasterSuggestionOnce()).toBe(true);
	});

	// The held case, and the one that has to NOT latch: a fresh world sits here for as many loads
	// as session zero takes, and the card is owed at the end of them.
	it("holds, without latching, while the Welcome guide still auto-opens", async () => {
		world();

		expect(await postFxMasterSuggestionOnce()).toBe(false);
		expect(created).toHaveLength(0);
		expect(stored[FXMASTER_SUGGESTION_SETTING]).toBeUndefined();
	});

	it("posts once both session-zero walkthroughs are done, without the guide being dismissed", async () => {
		world({ settings: { sessionZeroDone: { introductions: true, springBurst: true } } });

		expect(await postFxMasterSuggestionOnce()).toBe(true);
	});

	it("does nothing for a player, who can neither install a module nor write the flag", async () => {
		world({ isGM: false, settings: PAST_THE_GUIDE });

		expect(await postFxMasterSuggestionOnce()).toBe(false);
		expect(created).toHaveLength(0);
		expect(stored[FXMASTER_SUGGESTION_SETTING]).toBeUndefined();
	});

	// Ready.js runs this in a sweep that starts before chat necessarily has its API; answering
	// "not yet" leaves the flag clear so the next load posts, rather than eating the one card.
	it("defers rather than latching when ChatMessage isn't up yet", async () => {
		world({ settings: PAST_THE_GUIDE });
		global.ChatMessage = undefined;

		expect(await postFxMasterSuggestionOnce()).toBe(false);
		expect(stored[FXMASTER_SUGGESTION_SETTING]).toBeUndefined();
	});
});

describe("fxMasterSuggestionContent", () => {
	// Collapsed, because the source wraps its paragraphs and a phrase the reader sees on one line
	// can be split across two in the file.
	const html = () => fxMasterSuggestionContent().replace(/\s+/g, " ");

	it("links the package page the GM has to reach to act on it", () => {
		expect(html()).toContain(`href="${FXMASTER_PACKAGE_URL}"`);
	});

	// The card exists to be ignorable. If it ever stops saying that the weather works without the
	// module, it has become a warning about a broken world instead of an offer.
	it("says the weather still works without the module, and names the way back out", () => {
		expect(html()).toMatch(/Nothing is broken without it/);
		expect(html()).toContain("Weather on the Scene");
	});
});
