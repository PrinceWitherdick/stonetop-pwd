import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	ATTACK_FX_MODULES,
	ATTACK_FX_SUGGESTION_SETTING,
	attackFxSuggestionContent,
	missingAttackFxModules,
	postAttackFxSuggestionOnce,
} from "../../module/combat/attack-fx-suggestion.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The one-time card that tells an ALREADY-GREETED world about the attack effects' modules. As with
// the FXMaster card, what is worth guarding is the gate: a world being greeted right now already
// reads the module names on the greeting, a GM with every module has nothing to be told, and a GM
// who switched the effects off must not be sold them back.

// MUTATED and restored rather than replaced, as in fxmaster-suggestion.test.js: `global.game`
// carries the shared i18n table the rest of the suite reads.
const _realGame = global.game;
const _realChatMessage = global.ChatMessage;

let stored;   // the world settings this world has
let created;  // every ChatMessage.create payload

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

const text = html => html.replace(/\s+/g, " ");

beforeEach(() => world());
afterEach(() => {
	global.game = _realGame;
	global.ChatMessage = _realChatMessage;
});

describe("postAttackFxSuggestionOnce", () => {
	it("whispers the card to the GMs of a world greeted before this load, and latches", async () => {
		expect(await postAttackFxSuggestionOnce({ greeted: true })).toBe(true);
		expect(created).toHaveLength(1);
		expect(created[0].whisper).toEqual(["gm1", "gm2"]);
		for (const { name } of ATTACK_FX_MODULES) expect(created[0].content).toContain(name);
		expect(stored[ATTACK_FX_SUGGESTION_SETTING]).toBe(true);

		expect(await postAttackFxSuggestionOnce({ greeted: true })).toBe(false);
		expect(created).toHaveLength(1);
	});

	// The fresh world: its greeting card, posted this same load, names all three already.
	it("latches without posting in a world only being greeted now", async () => {
		expect(await postAttackFxSuggestionOnce({ greeted: false })).toBe(false);
		expect(created).toHaveLength(0);
		expect(stored[ATTACK_FX_SUGGESTION_SETTING]).toBe(true);
	});

	it.each([["JB2A_DnD5e"], ["jb2a_patreon"]])(
		"latches without posting when every module is active (JB2A as %s)", async jb2a => {
			world({ modules: ["sequencer", jb2a, "soundfxlibrary"] });

			expect(await postAttackFxSuggestionOnce({ greeted: true })).toBe(false);
			expect(created).toHaveLength(0);
			expect(stored[ATTACK_FX_SUGGESTION_SETTING]).toBe(true);
		});

	it("latches without posting when the GM has switched the effects off", async () => {
		world({ settings: { attackFx: false } });

		expect(await postAttackFxSuggestionOnce({ greeted: true })).toBe(false);
		expect(created).toHaveLength(0);
		expect(stored[ATTACK_FX_SUGGESTION_SETTING]).toBe(true);
	});

	it("does nothing for a player", async () => {
		world({ isGM: false });

		expect(await postAttackFxSuggestionOnce({ greeted: true })).toBe(false);
		expect(created).toHaveLength(0);
		expect(stored[ATTACK_FX_SUGGESTION_SETTING]).toBeUndefined();
	});

	it("defers rather than latching when ChatMessage isn't up yet", async () => {
		global.ChatMessage = undefined;

		expect(await postAttackFxSuggestionOnce({ greeted: true })).toBe(false);
		expect(stored[ATTACK_FX_SUGGESTION_SETTING]).toBeUndefined();
	});
});

describe("missingAttackFxModules", () => {
	it("counts either JB2A edition, and an installed-but-disabled module as missing", () => {
		world({ modules: ["jb2a_patreon"] });
		global.game.modules.get = id => ({ jb2a_patreon: { active: true }, sequencer: { active: false } })[id];

		expect(missingAttackFxModules().map(m => m.name)).toEqual(["Sequencer", "SoundFx Library"]);
	});
});

describe("attackFxSuggestionContent", () => {
	it("links every module's package page when all are missing", () => {
		const html = attackFxSuggestionContent();
		for (const { url } of ATTACK_FX_MODULES) expect(html).toContain(`href="${url}"`);
	});

	// Only what the world lacks: a world with the pictures is told about the sounds, and nothing
	// on the card describes a half it already has.
	it("names only the missing modules, and only the half they add", () => {
		world({ modules: ["sequencer", "JB2A_DnD5e"] });
		const html = text(attackFxSuggestionContent(missingAttackFxModules()));

		expect(html).toContain("SoundFx Library");
		expect(html).not.toContain("Sequencer");
		expect(html).not.toContain("On the map:");
		expect(html).toContain("At the table:");
	});

	it("joins two missing picture modules with 'and'", () => {
		world({ modules: ["soundfxlibrary"] });
		const html = text(attackFxSuggestionContent(missingAttackFxModules()));

		expect(html).toMatch(/Sequencer<\/a> and <a [^>]*>JB2A<\/a>/);
		expect(html).not.toContain("At the table:");
	});

	it("says attacks still work without the modules, and names the way back out", () => {
		const html = text(attackFxSuggestionContent());
		expect(html).toMatch(/Nothing is broken without them/);
		expect(html).toContain("Attack Effects on the Map");
	});
});
