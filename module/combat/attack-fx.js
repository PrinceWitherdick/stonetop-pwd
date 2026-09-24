import { SYSTEM_ID } from "../system-id.js";
import { isAttackFxOn } from "../settings.js";
import { resolveSync } from "../utils/foundry-compat.js";
import { warn } from "../utils/logger.js";
import { prefersReducedMotion } from "../utils/reduced-motion.js";
import { touching } from "../fight/engagements.js";
import { gridOf, tokenLevel, tokenRect } from "../fight/fight-state.js";
import {
	FX_KINDS, LAND_WITHOUT_ANIMATION_MS, REACTION_SOUNDS, SOUND_FILES,
	blowDelivery, blowKind, blowSounds, fxFile, fxFilesFor, onTargetSize, swingSize,
} from "./attack-fx-table.js";

// ── Attack effects on the map ─────────────────────────────────────────────────────────────────
// Optional integration with Sequencer (https://github.com/fantasycalendar/FoundryVTT-Sequencer)
// and JB2A's animations for what a blow LOOKS like, and the SoundFx Library module for what it
// SOUNDS like. Three moments: a blow landing (damage rolled at a target, attack-flow.js's
// rollAndPostDamage), a ranged 6- going wide (attack-flow.js#maybeMissFx), and Apply actually
// taking HP off a token (attack-flow.js#applyOwedDamage). What each blow is lives in
// attack-fx-table.js; this file is the part that talks to the canvas and the speakers.
//
// NOT FXMASTER. FXMaster ran "special effects" once, and v8 removed them with a notice to use
// Sequencer instead; what it keeps is a bare one-video call that plays on the caller's screen
// alone. Sequencer broadcasts an effect to everyone viewing the scene by itself, with the random
// choices (which swing, which way it is mirrored, where a miss lands) seeded so every client sees
// the same one, which is why there is no socket code here.
//
// THE SOUNDS DO NOT GO THROUGH SEQUENCER. A Sequencer sound plays only for a client viewing the
// scene it was made on, and a client that runs with the game canvas switched off (which a player
// reading the table through a screen magnifier may well do) never views any scene at all. Core's
// AudioHelper broadcast has no such gate, so the blind player hears every blow the sighted ones
// see. Its timing still follows the animation: the landing sound is a step in the same Sequence,
// placed after the flight, so a 90-foot arrow thunks later than a 15-foot one.
//
// NEVER IN THE WAY. Every entry point is synchronous, returns nothing and swallows its own
// failure into a console warning. It is called from inside the damage chain, after steps that
// cannot be taken back (a locked attack card, an emptied quiver, HP written), and a JB2A key
// renamed in some update must cost the table a flourish, never a damage card.

export const SEQUENCER_ID = "sequencer";
export const JB2A_IDS = Object.freeze(["JB2A_DnD5e", "jb2a_patreon"]);
export const SOUNDFX_ID = "soundfxlibrary";

/**
 * At most this many animations per blow. An area attack can take in a crowd; a dozen overlapping
 * swings is noise, and every one of them is a video every client decodes at once.
 */
export const MAX_ANIMATED_TARGETS = 6;

/** How long before a flight ends its landing sound starts, so the thunk meets the arrowhead. */
const LANDING_LEAD_MS = 250;

/** Loud enough to hear over table talk, under the dice. Core's Interface slider scales it. */
const SOUND_VOLUME = 0.8;

const FLIGHTS = new Set(["throw", "projectile"]);

const moduleActive = id => globalThis.game?.modules?.get?.(id)?.active === true;

/**
 * Can this client draw attack animations? The world switch, Sequencer, either JB2A, and a canvas
 * to draw on. `globalThis`, as fxMasterActive explains, so a test without a world gets a no.
 */
export function attackVisualsReady() {
	return isAttackFxOn()
		&& moduleActive(SEQUENCER_ID) && JB2A_IDS.some(moduleActive)
		&& typeof globalThis.Sequence === "function"
		&& !!globalThis.Sequencer?.Database
		&& globalThis.canvas?.ready === true;
}

/** Can this client play attack sounds? The world switch and the SoundFx Library; no Sequencer needed. */
export function attackSoundsReady() {
	return isAttackFxOn()
		&& moduleActive(SOUNDFX_ID)
		&& typeof globalThis.foundry?.audio?.AudioHelper?.play === "function";
}

const knownKeys = new Set();
/** Misses, remembered only against the database they were looked up in (see jb2aHas). */
const missedKeys = new Set();
let missedIn = null;
let missedAtLength = -1;

/**
 * Does Sequencer's database hold this JB2A key (or a branch under it)?
 *
 * Not `Sequencer.Database.entryExists`, which matches any entry that merely STARTS with the text
 * ("jb2a.sword.melee.01.whi" answers yes, with a deprecation warning), and not `getEntry`, which
 * puts an error notification on the screen for every miss. A hit is remembered for good; a miss only
 * while the database is unchanged, since JB2A fills it on `sequencer.ready`, after the first scene
 * is drawn, so an early "no" may not stay one. Without that, every Patreon-only key a free world
 * lacks is a full scan of thousands of entries on every blow.
 */
export function jb2aHas(path) {
	if (knownKeys.has(path)) return true;
	const entries = globalThis.Sequencer?.Database?.flattenedEntries;
	if (!Array.isArray(entries)) return false;
	if (entries !== missedIn || entries.length !== missedAtLength) {
		missedKeys.clear();
		missedIn = entries;
		missedAtLength = entries.length;
	}
	if (missedKeys.has(path)) return false;
	const found = entries.some(entry => entry === path || entry.startsWith(`${path}.`));
	(found ? knownKeys : missedKeys).add(path);
	return found;
}

/**
 * The token for `ref` on the scene this client is looking at, or null.
 *
 * `ref` is whatever the attack flow has: a token's uuid (a target row, a foe's `foeUuid`), an
 * actor's uuid (a character hit by a counter-attack, whose row names the actor), or the document
 * itself. An actor counts only when it has ONE token here, or the one this user has selected; a
 * character standing on the map twice has no single place a blow comes from, which is the rule
 * fight/damage-seed.js#rollerCombatant keeps too.
 */
export function tokenOnScene(ref) {
	const scene = globalThis.canvas?.scene;
	if (!ref || !scene) return null;
	const doc = typeof ref === "string" ? resolveSync(ref) : ref;
	if (!doc) return null;
	if (doc.documentName === "Token") return doc.parent?.id === scene.id ? doc : null;
	if (doc.token) return doc.token.parent?.id === scene.id ? doc.token : null;
	const here = (doc.getActiveTokens?.(false, true) ?? []).filter(t => t?.parent?.id === scene.id);
	if (here.length === 1) return here[0];
	return here.find(t => t.object?.controlled) ?? null;
}

/** Whether two tokens stand in contact, by the Fight tab's own rule (engagements.js#touching). */
function inContact(a, b) {
	return touching(
		{ rect: tokenRect(a), level: tokenLevel(a) },
		{ rect: tokenRect(b), level: tokenLevel(b) },
		gridOf(globalThis.canvas?.scene),
	);
}

/** Sequencer wants the placeable where there is one; a document is its fallback. */
const placeable = token => token?.object ?? token;

const gmIds = () => (globalThis.game?.users?.filter?.(u => u.isGM) ?? []).map(u => u.id);

/**
 * Who may see and hear a blow between these tokens, or null for everyone. A hidden token keeps it to
 * the GMs: a foe the GM has not revealed must not be given away by the arc of its own swing, by an
 * arrow flying out of apparently empty ground, or by the sound of either. A whispered roll keeps it to
 * the GMs and the roller, as maybeMissFx keeps a whispered miss off the map (attack-flow.js).
 */
function audienceFor(ends, whispered = false) {
	if (!whispered && !ends.some(t => t?.hidden)) return null;
	const self = whispered ? globalThis.game?.user?.id : null;
	return [...new Set([...gmIds(), ...(self ? [self] : [])])];
}

/**
 * The parts of an effect every delivery shares: the levels both ends stand on, and who may see it
 * (audienceFor), worked out for the whole blow or else from this effect's own ends.
 */
function frame(effect, ends, audience = null) {
	const levels = [...new Set(ends.map(tokenLevel).filter(Boolean))];
	if (levels.length && typeof effect.onLevels === "function") effect.onLevels(levels);
	const who = audience ?? audienceFor(ends);
	if (who) effect.forUsers(who);
	return effect;
}

function onTargetEffect(sequence, file, target, audience = null) {
	const effect = sequence.effect().file(file)
		.atLocation(placeable(target))
		.size(onTargetSize(target.width, target.height), { gridUnits: true })
		.fadeIn(250).fadeOut(500);
	return frame(effect, [target], audience);
}

/** One blow's animation from `source` at `target`, or null when this world has no file for it. */
function blowEffect(sequence, { kind, delivery, source, target, missed, audience }) {
	const file = fxFile(fxFilesFor(kind, delivery), jb2aHas);
	if (!file) return null;
	if (delivery === "onTarget") return onTargetEffect(sequence, file, target, audience);
	const effect = sequence.effect().file(file).atLocation(placeable(source));
	if (delivery === "swing") {
		effect.rotateTowards(placeable(target))
			.anchor({ x: 0.4, y: 0.5 })
			.size(swingSize(source.width), { gridUnits: true });
	} else {
		effect.stretchTo(placeable(target));
		if (missed) effect.missed(true);
	}
	effect.randomizeMirrorY();
	return frame(effect, [source, target], audience);
}

/**
 * Play one of SOUND_FILES' sounds for everyone at the table, or only for `audience` (audienceFor).
 *
 * `AudioHelper.play(data, true)` plays it here and pushes it to every other client, canvas or
 * none; `{recipients}` pushes it to those users alone, leaving out this client, which has already
 * played it. A file that fails to load rejects the local play; that is a warning, not a stopped blow.
 */
function broadcastSound(key, audience = null) {
	const files = SOUND_FILES[key];
	if (!files?.length) return;
	const src = files[Math.floor(Math.random() * files.length)];
	const self = globalThis.game?.user?.id;
	const others = audience?.filter(id => id !== self) ?? null;
	const push = others ? (others.length ? { recipients: others } : false) : true;
	const played = globalThis.foundry.audio.AudioHelper.play(
		{ src, volume: SOUND_VOLUME, channel: "interface", autoplay: true, loop: false }, push);
	Promise.resolve(played).catch(fxFailed);
}

function fxFailed(err) {
	warn("an attack effect didn't play", err);
}

/** Run `work` without waiting on it, and without letting it throw into the caller. */
function fireAndForget(work) {
	try {
		Promise.resolve(work()).catch(fxFailed);
	} catch (err) {
		fxFailed(err);
	}
}

/**
 * The blow itself: each target's animation, and the blow's sounds, timed to it where there is an
 * animation to time them to.
 */
async function runBlow({ attacker, weapon, blow, moveKey, targets, missed, whispered }) {
	const visuals = attackVisualsReady();
	const sounds = attackSoundsReady();
	if (!visuals && !sounds) return;

	const { kind, thrownCapable } = blowKind({ weapon, blow });
	const source = tokenOnScene(attacker);
	const struck = (targets ?? []).map(t => tokenOnScene(t?.uuid ?? t)).filter(Boolean);
	// For the whole blow: a hidden foe's swing is not heard by a player it was not shown to.
	const audience = audienceFor([source, ...struck], whispered);
	const deliveryAt = target => blowDelivery(kind, {
		thrownCapable, moveKey, touching: !!(source && target && inContact(source, target)),
	});
	// The blow's sounds follow its FIRST target: a volley is heard once, however many it strikes.
	const delivery = deliveryAt(struck[0] ?? null);
	// A miss is only ever shown for something that flies: a sword that missed is a GM's move.
	if (missed && !FLIGHTS.has(delivery)) return;

	const cues = sounds ? blowSounds(kind, delivery, { missed }) : [];
	const startCues = cues.filter(c => c.at !== "land");
	const landCues = cues.filter(c => c.at === "land");
	const playCues = list => list.forEach(c => setTimeout(() => broadcastSound(c.sound, audience), Number(c.at) || 0));

	const sequence = visuals && source ? new globalThis.Sequence({ moduleName: SYSTEM_ID, softFail: true }) : null;
	let animated = 0;
	let lastFlight = null;
	if (sequence) {
		// The sounds heard as the blow starts go first, so they start with the animation rather than
		// after it: an effect step does not hold the next one back, a finished-wait would.
		if (startCues.length) sequence.thenDo(() => playCues(startCues));
		for (const target of struck.slice(0, MAX_ANIMATED_TARGETS)) {
			const at = deliveryAt(target);
			if (missed && !FLIGHTS.has(at)) continue;
			const effect = blowEffect(sequence, { kind, delivery: at, source, target, missed, audience });
			if (!effect) continue;
			animated += 1;
			if (FLIGHTS.has(at)) lastFlight = effect;
		}
		if (lastFlight) {
			// Wait for the flight Sequencer actually chose (the 90-foot arrow is the longest), then
			// the landing: its sound, and the flask's fire where it broke.
			lastFlight.waitUntilFinished(-LANDING_LEAD_MS);
			if (landCues.length) sequence.thenDo(() => playCues(landCues.map(c => ({ ...c, at: 0 }))));
			const landing = missed ? [] : (FX_KINDS[kind]?.landing ?? []);
			const landFile = landing.length ? fxFile(landing, jb2aHas) : null;
			if (landFile) for (const target of struck.slice(0, MAX_ANIMATED_TARGETS)) onTargetEffect(sequence, landFile, target, audience);
		}
	}

	if (animated > 0) {
		// A flight that drew nothing never reaches its landing step, so the landing sound is timed
		// by hand below instead; with a flight, the sequence carries every cue.
		if (!lastFlight && landCues.length) playCues(landCues.map(c => ({ ...c, at: LAND_WITHOUT_ANIMATION_MS })));
		await sequence.play();
		return;
	}

	// Nothing to draw (no Sequencer, a token off this scene, no file for this blow): the sounds on
	// their own, the landing at about when an arrow would have arrived.
	playCues(startCues);
	playCues(landCues.map(c => ({ ...c, at: LAND_WITHOUT_ANIMATION_MS })));
}

/**
 * A blow landed: damage was just rolled at `targets`. Draws the swing, throw or shot from the
 * attacker's token to each target's, and plays the blow's sounds.
 *
 * @param {object} p
 * @param {Actor|TokenDocument|string|null} p.attacker  who struck (null: nobody on the map, a
 *   follower striking beside their character, which still sounds)
 * @param {object|null} p.weapon  the card's weapon record
 * @param {string} [p.blow]       the blow's printed name, for a stat block's nameless weapon
 * @param {string} [p.moveKey]    the attack move's key, which decides whether a spear flies
 * @param {{uuid: string}[]} p.targets  the damage card's targets
 * @param {boolean} [p.whispered]  the roll was not posted for everyone: kept to the GMs and the roller
 */
export function playBlowFx({ attacker = null, weapon = null, blow = "", moveKey = "", targets = [], whispered = false } = {}) {
	fireAndForget(() => runBlow({ attacker, weapon, blow, moveKey, targets, missed: false, whispered }));
}

/** A shot or a throw went wide (a ranged attack's 6-): the flight lands beside the target. */
export function playMissFx({ attacker = null, weapon = null, blow = "", moveKey = "", targets = [] } = {}) {
	fireAndForget(() => runBlow({ attacker, weapon, blow, moveKey, targets, missed: true }));
}

async function runReactions(rows, whispered) {
	const reacting = (rows ?? []).filter(r => r?.reaction);
	if (!reacting.length) return;
	const sounds = attackSoundsReady();
	const visuals = attackVisualsReady();
	const audience = audienceFor(reacting.map(r => tokenOnScene(r.uuid)), whispered);

	// One sound for one press of Apply: the burst if anyone was hurt, else the clank.
	const reaction = reacting.some(r => r.reaction === "burst") ? "burst" : "clank";
	if (sounds) broadcastSound(REACTION_SOUNDS[reaction], audience);

	if (!visuals) return;
	const file = fxFile(fxFilesFor("burst", "onTarget"), jb2aHas);
	const hurt = reacting.filter(r => r.reaction === "burst")
		.map(r => tokenOnScene(r.uuid)).filter(Boolean).slice(0, MAX_ANIMATED_TARGETS);
	if (!file || !hurt.length) return;
	const sequence = new globalThis.Sequence({ moduleName: SYSTEM_ID, softFail: true });
	for (const token of hurt) onTargetEffect(sequence, file, token, audience);
	await sequence.play();
}

/**
 * Apply took effect: a burst on every token that lost HP, and a sound for the press, a clank when
 * the armor held everything.
 *
 * @param {{uuid: string, reaction: "burst"|"clank"|null}[]} rows  attack-fx-table.js#hitReaction per row
 * @param {{whispered?: boolean}} [p]  the damage card was whispered: kept to the GMs and whoever pressed
 */
export function playHitReactions(rows, { whispered = false } = {}) {
	fireAndForget(() => runReactions(rows, whispered));
}

/**
 * Hide this system's animations from a reader who has asked their system for less motion, and
 * leave their sounds alone.
 *
 * A `createSequencerEffect` hook, because it is the one that fires on EVERY client, on the effect
 * about to be drawn there; the pre-create hook that could cancel it runs only on the client that
 * started it, which is the wrong reader to ask. Opacity zero rather than ending the effect: it
 * still runs its full length, so nothing timed off it (the landing sound) moves.
 */
export function hideAttackFxForReducedMotion(effect) {
	if (effect?.data?.moduleName !== SYSTEM_ID || !prefersReducedMotion()) return;
	effect.data.opacity = 0;
}
