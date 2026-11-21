// @vitest-environment happy-dom
// The player's red "a love letter has arrived" notice (love-letter-notice.js): which letters it is
// about, what it says, when it rings, and what a tap does. Plus the arrival stamp it keys off
// (love-letters.js): written on creation and on a Resend, never on an edit.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readCss, ownRule, readRepo } from "../../fakes/css.js";
import { contrastRatio } from "../../fakes/contrast.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import {
	buildLoveLetterData, createLoveLetter, setLoveLetterResolved, loveLetterArrivalKey,
	LOVE_LETTER_SENT_FLAG, LOVE_LETTER_RESOLVED_FLAG,
} from "../../../module/actors/character/love-letters.js";
import {
	ownedLoveLetters, pendingLoveLetters, seenTokens, noticeText, jingleNotes, letterToken,
	refreshLoveLetterNotice, closeLoveLetterNotice, LETTER_NOTICE_ID, LETTER_NOTICE_SEEN_FLAG, jingleWanted,
} from "../../../module/actors/character/love-letter-notice.js";

const CSS = readCss();

function letter(id, { sent = null, created = 100, resolved = false, isLetter = true } = {}) {
	const flags = { [STONETOP_SCOPE]: {} };
	if (isLetter) flags[STONETOP_SCOPE].loveLetter = true;
	if (resolved) flags[STONETOP_SCOPE][LOVE_LETTER_RESOLVED_FLAG] = true;
	if (sent !== null) flags[STONETOP_SCOPE][LOVE_LETTER_SENT_FLAG] = sent;
	return { id, type: "move", name: `Letter ${id}`, flags, _stats: { createdTime: created } };
}

function character(id, items, { owners = ["player"], type = "character" } = {}) {
	const actor = {
		id, name: `Hero ${id}`, type, items,
		testUserPermission: (user, level) => level === "OWNER" && owners.includes(user.id),
		sheet: { render: vi.fn() },
	};
	for (const item of items) item.parent = actor;
	return actor;
}

const player = { id: "player", isGM: false };
const gm = { id: "gm", isGM: true };

const i18n = {
	localize: key => key.split(".").pop(),
	format: (key, data) => `${key.split(".").pop()}:${JSON.stringify(data)}`,
};

describe("which letters the notice is about", () => {
	it("is every unresolved letter on a character the player owns, newest first", () => {
		const a = character("a", [letter("old", { sent: 10 }), letter("new", { sent: 20 }), letter("done", { resolved: true }), letter("move", { isLetter: false })]);
		const b = character("b", [letter("theirs")], { owners: ["someone-else"] });
		const npc = character("c", [letter("npc")], { type: "npc" });
		const rows = ownedLoveLetters([a, b, npc], player);
		expect(rows.map(r => r.item.id)).toEqual(["new", "old"]);
		expect(rows[0].token).toBe("a/new@20");
	});

	it("is nothing for the GM, who wrote them", () => {
		const a = character("a", [letter("x")], { owners: ["player", "gm"] });
		expect(ownedLoveLetters([a], gm)).toEqual([]);
	});

	it("leaves out a letter tapped away in this arrival, and brings it back on a Resend", () => {
		const item = letter("x", { sent: 5 });
		const a = character("a", [item]);
		const seen = seenTokens(ownedLoveLetters([a], player));
		expect(pendingLoveLetters(ownedLoveLetters([a], player), seen)).toEqual([]);
		// The GM's Resend restamps the arrival.
		item.flags[STONETOP_SCOPE][LOVE_LETTER_SENT_FLAG] = 6;
		expect(pendingLoveLetters(ownedLoveLetters([a], player), seen).map(r => r.item.id)).toEqual(["x"]);
	});

	it("keys a letter written before the stamp by when it was created", () => {
		const item = letter("x", { created: 1234 });
		expect(loveLetterArrivalKey(item)).toBe(1234);
		expect(letterToken({ id: "a" }, item)).toBe("a/x@1234");
	});

	it("stores only the letters in hand when tapped, so a resolved or deleted one falls out", () => {
		const a = character("a", [letter("x", { sent: 1 }), letter("y", { sent: 2, resolved: true })]);
		expect(seenTokens(ownedLoveLetters([a], player))).toEqual(["a/x@1"]);
	});
});

describe("what the notice says", () => {
	const rows = (...names) => names.map(name => ({ actor: { name } }));

	it("counts the letters", () => {
		expect(noticeText(rows("A"), 1, i18n)).toBe("noticeOne");
		expect(noticeText(rows("A", "A"), 1, i18n)).toBe('noticeMany:{"count":2}');
	});

	it("names the character only for a player with more than one, and letters for just one of them", () => {
		expect(noticeText(rows("A"), 2, i18n)).toBe('noticeFor:{"text":"noticeOne","name":"A"}');
		expect(noticeText(rows("A", "B"), 2, i18n)).toBe('noticeMany:{"count":2}');
	});
});

describe("the jingle", () => {
	it("rises through four bell notes, each one later than the last", () => {
		const notes = jingleNotes();
		expect(notes.length).toBeGreaterThanOrEqual(4);
		for (let i = 1; i < 4; i++) {
			expect(notes[i].freq).toBeGreaterThan(notes[i - 1].freq);
			expect(notes[i].at).toBeGreaterThan(notes[i - 1].at);
		}
		for (const n of notes) {
			expect(n.dur).toBeGreaterThan(0);
			expect(n.gain).toBeGreaterThan(0);
			expect(n.gain).toBeLessThanOrEqual(1);
		}
	});
});

describe("the arrival stamp", () => {
	beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(777));
	afterEach(() => vi.restoreAllMocks());

	it("is written when a letter is created", async () => {
		const actor = { createEmbeddedDocuments: vi.fn(async (_t, docs) => docs) };
		await createLoveLetter(actor, { name: "Hi" });
		expect(actor.createEmbeddedDocuments.mock.calls[0][1][0].flags[STONETOP_SCOPE][LOVE_LETTER_SENT_FLAG]).toBe(777);
	});

	it("is NOT part of the shape an edit rewrites", () => {
		expect(buildLoveLetterData({ name: "Hi" }).flags[STONETOP_SCOPE][LOVE_LETTER_SENT_FLAG]).toBeUndefined();
	});

	it("is rewritten by a Resend, and left alone by a resolve", async () => {
		const item = { update: vi.fn(async () => {}) };
		await setLoveLetterResolved(item, false);
		expect(item.update).toHaveBeenLastCalledWith({
			[`flags.${STONETOP_SCOPE}.${LOVE_LETTER_RESOLVED_FLAG}`]: false,
			[`flags.${STONETOP_SCOPE}.${LOVE_LETTER_SENT_FLAG}`]: 777,
		});
		await setLoveLetterResolved(item, true);
		expect(item.update).toHaveBeenLastCalledWith({ [`flags.${STONETOP_SCOPE}.${LOVE_LETTER_RESOLVED_FLAG}`]: true });
	});
});

describe("the notice on the screen", () => {
	let actors;
	let flags;

	beforeEach(() => {
		document.body.innerHTML = `<header id="ui-top"><div id="stonetop-time-banner" class="stonetop-time-banner"></div><div id="loading"></div></header>`;
		flags = {};
		actors = [character("a", [letter("x", { sent: 1 })])];
		globalThis.game = {
			actors,
			user: {
				...player,
				getFlag: (scope, key) => flags[`${scope}.${key}`],
				setFlag: vi.fn(async (scope, key, value) => { flags[`${scope}.${key}`] = value; }),
			},
			i18n,
			settings: { get: () => 1 },
		};
	});

	afterEach(() => {
		closeLoveLetterNotice();
		delete globalThis.game;
	});

	// On <body>, above the windows, not in the bar's column, which every window covers.
	it("hangs over the windows, right of the weather/season bar and as tall, an envelope with no words, and drops in", () => {
		const bar = document.getElementById("stonetop-time-banner");
		bar.getBoundingClientRect = () => ({ top: 0, bottom: 40, left: 300, right: 700, width: 400, height: 40 });
		refreshLoveLetterNotice();
		const notice = document.getElementById(LETTER_NOTICE_ID);
		expect(notice).toBeTruthy();
		expect(notice.parentElement).toBe(document.body);
		expect(notice.style.getPropertyValue("--stonetop-letter-notice-y")).toBe("0px");
		expect(notice.style.getPropertyValue("--stonetop-letter-notice-x")).toBe("706px");
		expect(notice.style.getPropertyValue("--stonetop-letter-notice-h")).toBe("40px");
		expect(notice.getAttribute("role")).toBe("alert");
		expect(notice.textContent.trim()).toBe("");
		expect(notice.querySelector(".fa-envelope")).toBeTruthy();
		expect(notice.dataset.tooltip).toBe("noticeOne");
		expect(notice.getAttribute("aria-label")).toBe("noticeOne. noticeOpen");
		expect(notice.classList.contains("is-arriving")).toBe(true);
	});

	it("doesn't drop in again on a repaint with no new letter", () => {
		actors[0].items[0].flags[STONETOP_SCOPE][LOVE_LETTER_SENT_FLAG] = 50;
		refreshLoveLetterNotice();
		const notice = document.getElementById(LETTER_NOTICE_ID);
		notice.classList.remove("is-arriving");
		refreshLoveLetterNotice();
		expect(notice.classList.contains("is-arriving")).toBe(false);
	});

	it("isn't there for the GM", () => {
		game.user.isGM = true;
		refreshLoveLetterNotice();
		expect(document.getElementById(LETTER_NOTICE_ID)).toBeNull();
	});

	it("goes on a tap, remembers why on the user, and opens the letter on Moves", async () => {
		refreshLoveLetterNotice();
		document.getElementById(LETTER_NOTICE_ID).click();
		await vi.waitFor(() => expect(actors[0].sheet.render).toHaveBeenCalledWith(true));
		expect(document.getElementById(LETTER_NOTICE_ID)).toBeNull();
		expect(game.user.setFlag).toHaveBeenCalledWith(STONETOP_SCOPE, LETTER_NOTICE_SEEN_FLAG, ["a/x@1"]);
		expect(actors[0].sheet._activateTabOnRender).toBe("moves");
		expect(actors[0].sheet._revealLoveLettersOnRender).toBe(true);
		// And it stays gone until a new letter arrives.
		refreshLoveLetterNotice();
		expect(document.getElementById(LETTER_NOTICE_ID)).toBeNull();
		actors[0].items.push(letter("y", { sent: 2 }));
		refreshLoveLetterNotice();
		expect(document.getElementById(LETTER_NOTICE_ID)).toBeTruthy();
	});
});

describe("the jingle's own switch", () => {
	// A fake interface channel that counts the bell partials struck on it.
	function fakeAudio() {
		const node = () => ({ connect: n => n ?? node(), gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
		const ctx = {
			state: "running", currentTime: 0, gainNode: node(), struck: 0,
			createOscillator() { ctx.struck++; return { ...node(), frequency: {}, start() {}, stop() {} }; },
			createGain: () => node(),
		};
		return { locked: false, interface: ctx };
	}

	let jingleOn;
	beforeEach(() => {
		document.body.innerHTML = `<header id="ui-top"></header>`;
		jingleOn = true;
		globalThis.game = {
			actors: [character("a", [letter(`j${Math.random()}`, { sent: Math.random() })])],
			user: { ...player, getFlag: () => [], setFlag: vi.fn() },
			i18n,
			audio: fakeAudio(),
			settings: { get: (scope, key) => (key === "loveLetterJingle" ? jingleOn : 1) },
		};
	});
	afterEach(() => {
		closeLoveLetterNotice();
		delete globalThis.game;
	});

	it("is a per-browser setting on the Preferences tab, on by default", () => {
		const settings = readRepo("module/settings.js");
		const reg = /register\(SYSTEM_ID, "loveLetterJingle", \{([\s\S]*?)\}\);/.exec(settings)?.[1] ?? "";
		expect(reg).toMatch(/scope:\s*"client"/);
		expect(reg).toMatch(/config:\s*true/);
		expect(reg).toMatch(/default:\s*true/);
		expect(readRepo("module/utils/sheet-preferences.js")).toContain('"loveLetterJingle"');
		const en = JSON.parse(readRepo("languages/en.json"));
		expect(en.stonetop.settings.loveLetterJingle.name).toBeTruthy();
		expect(en.stonetop.settings.loveLetterJingle.hint).toBeTruthy();
	});

	it("rings when it's on", async () => {
		expect(jingleWanted()).toBe(true);
		refreshLoveLetterNotice();
		await vi.waitFor(() => expect(game.audio.interface.struck).toBeGreaterThan(0));
	});

	it("is silent when it's off, and the notice still comes", async () => {
		jingleOn = false;
		expect(jingleWanted()).toBe(false);
		refreshLoveLetterNotice();
		await new Promise(r => setTimeout(r, 20));
		expect(game.audio.interface.struck).toBe(0);
		expect(document.getElementById(LETTER_NOTICE_ID)).toBeTruthy();
	});
});

describe("the notice's look", () => {
	const rule = ownRule(CSS, "#stonetop-letter-notice");
	const value = name => new RegExp(`--stonetop-letter-notice-${name}:\\s*([^;]+);`).exec(rule)?.[1]?.trim();

	// A player at this table reads through Windows Magnifier: AAA against both ends of the red.
	it("is white on red, AAA against both ends of its gradient", () => {
		for (const end of ["top", "bottom"]) {
			expect(contrastRatio(value("ink"), value(end)), `ink on ${end}`).toBeGreaterThanOrEqual(7);
		}
	});

	it("takes pointers, and sits over the windows with core's notifications", () => {
		expect(rule).toMatch(/pointer-events:\s*auto/);
		expect(rule).toMatch(/position:\s*fixed/);
		expect(rule).toMatch(/z-index:\s*var\(--z-index-notification/);
	});

	// The drop and the shake only for a reader who hasn't asked for stillness, either way of asking.
	it("moves only for a reader who hasn't asked for less motion", () => {
		const rules = [...CSS.matchAll(/([^{}]+)\{[^{}]*animation:\s*stonetop-letter-notice-[^{}]*\}/g)];
		expect(rules.length).toBeGreaterThan(0);
		for (const [, selector] of rules) {
			expect(selector.trim()).toMatch(/^:root:not\(\.stonetop-less-motion\) /);
		}
	});
});
