import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { isLoveLetter, isResolvedLoveLetter, isDraftLoveLetter, loveLetterArrivalKey } from "./love-letters.js";
import { TIME_BANNER_ID } from "../../seasons/time-banner.js";
import { SYSTEM_ID } from "../../system-id.js";

// ── "A love letter has arrived" ───────────────────────────────────────────────────────────────
// A red envelope that drops from the top edge of the screen, just right of the weather/season
// bar, when one of the player's characters has a love letter (Book I p.568) they haven't been
// told about yet, and rings a few bells as it comes. The envelope alone, no words (the user's
// call): what it's about is its hover and its accessible name. Without it a letter sits quietly at the top of the Moves tab and
// a player who isn't looking there never knows the GM wrote them anything.
//
// PLAYERS ONLY. The GM wrote the letter; telling them it arrived is noise.
//
// Tapping it puts it away and opens the letter: the character's sheet, on Moves, Love Letters in
// view. It stays away until a NEW letter arrives, and a GM's Resend counts as one (it restamps
// `loveLetterSentAt`, love-letters.js). An edit does not.
//
// What "told about" means is stored on the USER, as the list of letters the player tapped away,
// one token per letter and arrival (`<actorId>/<itemId>@<arrival key>`). On the user rather than
// in the browser so a reload, or a second device, doesn't ring the bells again for a letter the
// player has already been told about. A list rather than a keyed map because a setFlag MERGES
// objects and could never drop a letter that's gone, while it replaces a list whole. Tokens are
// only ever compared for equality, never ordered, so the GM's clock and the player's need not agree.

/** The notice's element id. */
export const LETTER_NOTICE_ID = "stonetop-letter-notice";

/** The user flag holding the tokens of the letters the player has tapped away. */
export const LETTER_NOTICE_SEEN_FLAG = "loveLetterNoticeSeen";

/** @type {HTMLButtonElement|null} The notice, while it's up. */
let notice = null;

/** The newest letter the notice is about, for the tap to open. */
let newest = null;

/** Tokens this session has already rung the bells for. A repaint is silent; only a new token rings. */
const announced = new Set();

/** The gap between the bar's right end and the envelope, in px. */
const BAR_GAP = 6;

/** Watches the bar's size, which changes with the words on it, to keep the envelope at its end. */
let barWatch = null;

/** @type {HTMLElement|null} The bar being watched. */
let watchedBar = null;

let installed = false;

/** One letter's token: which letter on which character, and which arrival of it. */
export function letterToken(actor, item) {
	return `${actor?.id}/${item?.id}@${loveLetterArrivalKey(item) ?? ""}`;
}

/** The characters `user` owns: whose letters are theirs, and how many the notice names among. */
function ownedCharacters(actors, user) {
	return [...(actors ?? [])].filter(a => a?.type === "character" && a.testUserPermission?.(user, "OWNER"));
}

/**
 * Every unresolved love letter on a character this user owns, newest first. The GM owns them all
 * and isn't a reader, so a GM gets none.
 *
 * @param {Iterable<Actor>} actors
 * @param {User} user
 * @returns {{actor: Actor, item: Item, token: string, key: number|null}[]}
 */
export function ownedLoveLetters(actors, user) {
	if (!user || user.isGM) return [];
	const rows = [];
	for (const actor of ownedCharacters(actors, user)) {
		for (const item of actor.items ?? []) {
			// A draft hasn't been sent, so it hasn't arrived.
			if (!isLoveLetter(item) || isResolvedLoveLetter(item) || isDraftLoveLetter(item)) continue;
			rows.push({ actor, item, token: letterToken(actor, item), key: loveLetterArrivalKey(item) });
		}
	}
	// Newest first, for the tap to open. A display order only, so the clocks can disagree here.
	return rows.sort((a, b) => (Number(b.key) || 0) - (Number(a.key) || 0));
}

/**
 * The letters the notice is about: owned, unresolved, and not yet tapped away in this arrival.
 *
 * @param {ReturnType<typeof ownedLoveLetters>} owned
 * @param {Iterable<string>} seen  The user's tapped-away tokens.
 */
export function pendingLoveLetters(owned, seen) {
	const told = new Set(seen ?? []);
	return owned.filter(letter => !told.has(letter.token));
}

/**
 * The tokens to store when the player taps the notice away: every letter they hold right now. Built
 * from what's owned rather than added to what was stored, so a resolved or deleted letter's token
 * falls out on its own and the list never grows past the letters in hand.
 */
export function seenTokens(owned) {
	return owned.map(letter => letter.token);
}

/**
 * What the notice says. Names the character only when it matters: the player owns more than one,
 * and the letters are all for one of them.
 *
 * @param {ReturnType<typeof pendingLoveLetters>} pending
 * @param {number} ownedCharacters  How many characters this player owns.
 * @param {{localize: Function, format: Function}} [i18n]
 */
export function noticeText(pending, ownedCharacters = 1, i18n = game.i18n) {
	const base = pending.length === 1
		? i18n.localize("stonetop.character.moves.loveLetter.noticeOne")
		: i18n.format("stonetop.character.moves.loveLetter.noticeMany", { count: pending.length });
	const names = [...new Set(pending.map(letter => letter.actor?.name))];
	if (ownedCharacters > 1 && names.length === 1) {
		return i18n.format("stonetop.character.moves.loveLetter.noticeFor", { text: base, name: names[0] });
	}
	return base;
}

/**
 * The jingle: a rising run of four bell notes, then the top one again, a hand bell shaken twice.
 * Pure, so the test reads it. `at` and `dur` are seconds from the start.
 */
export function jingleNotes() {
	// E6, G#6, B6, E7, then E7 again, quieter.
	return [
		{ freq: 1318.5, at: 0.00, dur: 0.9, gain: 0.22 },
		{ freq: 1661.2, at: 0.11, dur: 0.9, gain: 0.20 },
		{ freq: 1975.5, at: 0.22, dur: 0.9, gain: 0.18 },
		{ freq: 2637.0, at: 0.33, dur: 1.3, gain: 0.18 },
		{ freq: 2637.0, at: 0.55, dur: 1.1, gain: 0.10 },
	];
}

/**
 * A bell's partials over its fundamental: inharmonic, which is what makes it ring rather than
 * whistle. Each is [ratio, relative gain, relative length].
 */
const BELL_PARTIALS = Object.freeze([[1, 1, 1], [2.76, 0.45, 0.6], [5.4, 0.2, 0.35]]);

/** The whole jingle's level under the Interface volume: turned down a touch (the user's call, 2026-10-03). */
export const JINGLE_LEVEL = 0.7;

/** Has this browser left the jingle on? Its own switch, `loveLetterJingle`; the notice comes either way. */
export function jingleWanted() {
	try {
		return game.settings.get(SYSTEM_ID, "loveLetterJingle") !== false;
	} catch {
		return true;
	}
}

/**
 * Ring the jingle on core's interface channel, so it follows the Interface volume slider. Waits
 * for core's first-gesture unlock: a browser won't sound anything before the player has touched
 * the page, so a letter waiting at load rings on their first click. Never throws.
 */
async function playJingle() {
	try {
		const audio = game.audio;
		if (!audio || !jingleWanted()) return;
		if (audio.locked) await audio.unlock;
		const ctx = audio.interface;
		if (!ctx || !ctx.gainNode) return;
		if (Number(game.settings.get("core", "globalInterfaceVolume")) <= 0) return;
		if (ctx.state === "suspended") await ctx.resume();
		const start = ctx.currentTime + 0.02;
		for (const { freq, at, dur, gain } of jingleNotes()) {
			for (const [ratio, level, length] of BELL_PARTIALS) {
				const t0 = start + at;
				const t1 = t0 + dur * length;
				const osc = ctx.createOscillator();
				const amp = ctx.createGain();
				osc.type = "sine";
				osc.frequency.value = freq * ratio;
				// A struck attack, then the long exponential ring-out.
				amp.gain.setValueAtTime(0.0001, t0);
				amp.gain.exponentialRampToValueAtTime(gain * level * JINGLE_LEVEL, t0 + 0.006);
				amp.gain.exponentialRampToValueAtTime(0.0001, t1);
				osc.connect(amp).connect(ctx.gainNode);
				osc.start(t0);
				osc.stop(t1 + 0.05);
			}
		}
	} catch (err) {
		console.warn("Stonetop | the love-letter jingle didn't play", err);
	}
}

/** The player's tapped-away tokens. */
function storedSeen() {
	const seen = game.user?.getFlag?.(STONETOP_SCOPE, LETTER_NOTICE_SEEN_FLAG);
	return Array.isArray(seen) ? seen : [];
}

/** Drop the notice in again: the class carries the animation, so take it off, reflow, put it back. */
function drop() {
	if (!notice) return;
	notice.classList.remove("is-arriving");
	void notice.offsetWidth;
	notice.classList.add("is-arriving");
}

/** Build the empty notice. */
function build() {
	const button = document.createElement("button");
	button.type = "button";
	button.id = LETTER_NOTICE_ID;
	button.className = "stonetop-letter-notice";
	// Read out the moment it lands: a letter is news, and some readers at this table can't see it.
	button.setAttribute("role", "alert");
	button.innerHTML = `<i class="stonetop-letter-notice__icon fa-solid fa-envelope" aria-hidden="true"></i>`;
	button.addEventListener("animationend", ev => {
		if (ev.target === button) button.classList.remove("is-arriving");
	});
	button.addEventListener("click", onTap);
	return button;
}

/**
 * Hang the envelope from the top edge just right of the weather/season bar, as tall as the bar,
 * or centred at the top of the map column when there's no bar.
 *
 * ON <body>, NOT IN `#ui-top` with the bar. Core's middle column is the app layer (z-index 30),
 * under every window, so a sheet dragged up to the top of the screen buried it. Core's own
 * notifications live on <body> above the windows for the same reason, and so does this. Being
 * out of the column it has to be told where the bar is: its end, top and height are read off
 * it each time the envelope is put up, whenever the bar changes size, and on a window resize.
 */
function place() {
	if (!notice) return;
	const column = document.getElementById("ui-top");
	const bar = document.getElementById(TIME_BANNER_ID);
	const onBar = !!bar?.isConnected;
	watchBar(onBar ? bar : null);
	const anchor = onBar ? bar.getBoundingClientRect() : column?.getBoundingClientRect();
	if (!anchor) return;
	const x = onBar ? anchor.right + BAR_GAP : anchor.left + (anchor.width - notice.offsetWidth) / 2;
	notice.style.setProperty("--stonetop-letter-notice-y", `${Math.round(anchor.top)}px`);
	notice.style.setProperty("--stonetop-letter-notice-x", `${Math.round(x)}px`);
	if (onBar) notice.style.setProperty("--stonetop-letter-notice-h", `${Math.round(anchor.height)}px`);
	else notice.style.removeProperty("--stonetop-letter-notice-h");
}

/** Follow the bar's size (a longer weather word widens it), so the envelope stays at its end. */
function watchBar(bar) {
	if (bar === watchedBar) return;
	barWatch?.disconnect();
	barWatch = null;
	watchedBar = bar;
	if (!bar || typeof ResizeObserver !== "function") return;
	barWatch = new ResizeObserver(() => place());
	barWatch.observe(bar);
}

/** Take the notice down. */
export function closeLoveLetterNotice() {
	notice?.remove();
	notice = null;
	newest = null;
	watchBar(null);
}

/** Put the notice up, bring it up to date, or take it down, from the letters this player holds now. */
export function refreshLoveLetterNotice() {
	const owned = ownedLoveLetters(game.actors ?? [], game.user);
	const pending = pendingLoveLetters(owned, storedSeen());
	if (!pending.length) return closeLoveLetterNotice();
	if (!globalThis.document?.body) return;
	if (!notice) {
		notice = build();
		document.body.append(notice);
	}
	place();
	newest = pending[0];
	const text = noticeText(pending, ownedCharacters(game.actors, game.user).length);
	const open = game.i18n.localize("stonetop.character.moves.loveLetter.noticeOpen");
	// No words on the envelope: the hover says what it's about, the name says that and what a press does.
	notice.setAttribute("aria-label", `${text}. ${open}`);
	notice.dataset.tooltip = text;

	const fresh = pending.filter(letter => !announced.has(letter.token));
	if (!fresh.length) return;
	for (const letter of fresh) announced.add(letter.token);
	drop();
	playJingle();
}

/** The tap: put the notice away for every letter in hand, and open the newest one. */
async function onTap() {
	const letter = newest;
	const owned = ownedLoveLetters(game.actors ?? [], game.user);
	closeLoveLetterNotice();
	try {
		await game.user.setFlag(STONETOP_SCOPE, LETTER_NOTICE_SEEN_FLAG, seenTokens(owned));
	} catch (err) {
		console.warn("Stonetop | couldn't remember the love-letter notice was read", err);
	}
	const sheet = letter?.actor?.sheet;
	if (!sheet) return;
	// Both one-shots are consumed by the sheet's next render (StonetopCharacterSheet#_render).
	sheet._activateTabOnRender = "moves";
	sheet._revealLoveLettersOnRender = true;
	sheet.render(true);
}

/** Does this item change touch a love letter's being in front of its reader? */
function touchesLetters(item) {
	return item?.type === "move" && item.parent?.type === "character" && isLoveLetter(item);
}

/**
 * Keep the notice in step with the letters. Idempotent, called once from the `ready` hook, after
 * the weather/season bar it hangs under is up.
 */
export function installLoveLetterNotice() {
	if (installed) return;
	installed = true;
	if (game.user?.isGM) return;

	// A letter written, resolved, resent or deleted. Item hooks fire on every client the letter
	// reaches, so a GM's write on their screen lands here on the player's.
	for (const hook of ["createItem", "updateItem", "deleteItem"]) {
		Hooks.on(hook, item => { if (touchesLetters(item)) refreshLoveLetterNotice(); });
	}
	// The player tapped it away on another device, or this one's write came back.
	Hooks.on("updateUser", (user, changed) => {
		if (user?.id === game.user?.id && changed?.flags?.[STONETOP_SCOPE] !== undefined) refreshLoveLetterNotice();
	});
	// A character handed to (or taken from) this player brings its letters with it.
	Hooks.on("updateActor", (actor, changed) => {
		if (actor?.type === "character" && changed?.ownership !== undefined) refreshLoveLetterNotice();
	});
	// The bar it hangs under going up or down, or the screen it's centred on changing size.
	Hooks.on("clientSettingChanged", key => {
		if (String(key ?? "").endsWith(".timeBannerShown")) requestAnimationFrame(place);
	});
	window.addEventListener("resize", () => place());

	refreshLoveLetterNotice();
}
