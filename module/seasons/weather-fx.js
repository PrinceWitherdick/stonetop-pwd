import { deletionEntry } from "../utils/foundry-compat.js";
import { warn } from "../utils/logger.js";
import { getSetting } from "../settings.js";
import { WEATHER_FX_PARTS, WEATHER_FX_SETTING } from "./weather-fx-parts.js";

// ── The weather on the canvas ─────────────────────────────────────────────────
// Optional integration with FXMaster (https://github.com/gambit07/fxmaster): when the GM posts
// a weather from the picker, the scene the table is on gets the particles to match. Storm rolls,
// rain starts falling. Without the module none of this runs and nothing here errors.
//
// FXMaster keeps its particle effects in a scene flag, `flags.fxmaster.effects`, as
// `{ <key>: { type, options } }`, and redraws the canvas on any update that touches that path
// (its own `updateScene` handler). So this writes the flag directly rather than going through
// FXMaster's two hooks, and the reason is that neither hook can express "set the weather to
// this":
//
//  • `fxmaster.switchParticleEffect` TOGGLES — it removes `core_<type>` if it is already there.
//    Posting rain twice would turn the rain off.
//  • `fxmaster.updateParticleEffects` MERGES under a fresh `randomID()` each call, so posting
//    weather three times leaves three rains running, none of which we could ever find again.
//
// Our own stable keys give us the third thing: replace ours, leave everything else alone. A GM
// who has hung fireflies or embers on their scene keeps them through a change of weather, and
// the weather they got last time goes away without being hunted for.

/**
 * The module we integrate with, and the paid sibling that stands in for it.
 *
 * FXMaster+ (Gambit's Patreon build, `fxmaster-plus`) is an ADD-ON: it registers its extra
 * effects into the base module's `CONFIG.fxmaster.particleEffects` and keeps them in the base
 * module's scene flag, which is why FXMASTER_ID below is both "the module" and "the flag
 * namespace" and stays the base id under either. The second id is checked all the same, because
 * a table that paid for + calls what it has FXMaster+, and a control that hid itself from them
 * would be wrong for a reason they could never guess from the screen.
 */
export const FXMASTER_ID = "fxmaster";
export const FXMASTER_PLUS_ID = "fxmaster-plus";

/**
 * The world setting the whole integration hangs off, and the one piece of state behind the
 * picker's Pause button — see `weatherFxPaused`.
 *
 * Defined in the leaf beside the seven parts it switches, and re-exported here so the callers that
 * already reach for it through this module keep working. settings.js registers it from the same
 * constant, which is the point: it used to spell the key as a literal there and read it through
 * this one, and the two only ever agreed by hand.
 */
export { WEATHER_FX_SETTING };

/** Scene-flag key prefix for the effects WE own. Everything under it is ours to replace. */
export const FX_KEY_PREFIX = "stonetop-weather-";

/**
 * Which way the wind blows, as an FXMaster heading in degrees: 0 is east (particles travel to the
 * right), 90 is south (down), 180 is west (right to left across the map).
 *
 * One constant for one sky. Cloud takes this heading outright and `driven` leans the falling
 * particles the same way, so turning the weather around is this number and nothing else.
 */
export const WIND_DIRECTION = 180;

/** Straight down, in those same degrees. */
const DOWN = 90;

/**
 * The heading of something falling in that wind: `lean` degrees off vertical, tipped downwind.
 * `driven(0)` falls straight; a blizzard is most of the way to sideways.
 *
 * Read off WIND_DIRECTION rather than written out, so the whole sky turns together and a hand
 * -picked number cannot be left pointing into the wind. Assumes a horizontal wind (0 or 180); 270
 * would be an updraft, which is not weather this table has a use for.
 */
const driven = lean => DOWN + Math.sign(WIND_DIRECTION - DOWN) * lean;

/**
 * What each sky looks like on the canvas: FXMaster particle effects, in draw order.
 *
 * Three skies draw NOTHING, and that is the feature rather than a gap — `sun`, `heat` ("not a
 * cloud in sight") and `cold` ("very cold, very clear, very still") are the book's own clear
 * days, so posting one of them takes the last weather off the scene and leaves the map alone.
 *
 * `options` values are BARE — `density: 0.06`, not `{ value: 0.06 }`. What is stored in the flag
 * is not what FXMaster's effect classes read: `drawParticleEffects` wraps every stored option on
 * its way in (`Object.fromEntries(Object.entries(options).map(([k, v]) => [k, { value: v }]))`)
 * before merging the result over its parameter DESCRIPTORS. So the `.value` a descriptor carries
 * is FXMaster's to add, and a `{ value }` we write here arrives as `{ value: { value: 0.06 } }`:
 * `computeMaxParticlesFromView` reads `density.value`, gets an object, and `Number(obj) || 0`
 * makes it 0 particles, while `_applySpeedToConfig` and `_applyAlphaToConfig` multiply by an
 * object and get NaN. Nothing draws, silently, under every sky. FXMaster's own shipped presets
 * store bare (`{ scale: 2, density: 1.5, alpha: 1 }`), and so does the form its config dialog
 * writes (`parseFloat`). Verified against FXMaster 7.5.2.
 *
 * `tint` is the exception that proves it: its descriptor's value is itself the object
 * `{ value: "#FFFFFF", apply: false }` and the effect reads `tint.value.apply`, so the bare form
 * of a tint IS `{ value, apply }`.
 *
 * Every magnitude below is inside the range of the descriptor for THAT effect, which is not the
 * same as the base range (density 0.1-5, speed 0.1-5, alpha 0-1, scale 0.1-5). Nothing in
 * FXMaster clamps, so a number over the max is simply used, and the ones that matter here are
 * far tighter than the base: `clouds` density is 0.001-0.2 (default 0.03), `fog` density is
 * 0.01-0.15 (default 0.08), `snowstorm` density is 0.05-1, `hail` density is 0.05-2. Cloud
 * density therefore reads on a 0.02-0.2 scale rather than a 0.3-2 one; the ordering across the
 * skies is the thing to preserve when tuning, not the absolute numbers.
 *
 * `direction` is a heading in degrees and FXMaster's zero points EAST: 0 drives particles to the
 * right, 90 straight down, 180 right to left. Left unset, each effect derives its own from the
 * rotation behaviour in its config, and those defaults assume no wind at all. `clouds` comes out
 * at 90, so cloud slid DOWN the map instead of blowing across it, while `rain` comes out at 75,
 * drifting slightly to the right: two winds at right angles to each other, in the same sky.
 *
 * So there is one wind here, out of the east, at `WIND_DIRECTION`. Cloud runs before it and
 * everything that falls leans into it, harder the worse the weather gets. Nothing about a scene
 * says which way its own wind should blow (a battle map carries no compass FXMaster can read), so
 * what there is to get right is that the sky agrees with itself.
 *
 * `fog` is the exception, and keeps no heading at all: its rotation spread is a full circle, so
 * every particle already goes its own way and a heading would only re-centre a circle. Haze sits
 * on the ground rather than blowing across it.
 *
 * FXMaster's `clouds` carries most of the sky's mood, so it appears under most weathers at
 * different densities and speeds: a few drifting for `fair`, a lid of them for `cloud`, racing
 * for `wind`, and dark and fast under the storms.
 *
 * `scale` multiplies the drop sprite (`_applyScaleToConfig` scales every `scale`/`scaleStatic`
 * behaviour by it, times the grid's own size over 100), and every falling sky sets one because
 * FXMaster's default of 1 is not a raindrop anyone can see over a map. Rain's own sprite is
 * already faint by design — its alpha behaviour fades each drop from 0.7 to 0.1 over its life,
 * and the `alpha` option cannot lift that, since its descriptor maxes out at the 1 we are
 * already on — so size is the only lever there is. For reference, the module's own presets sit
 * at 1.5 for `drizzle`, 2 for `acid-rain` and 4 for `hurricane`, against the 1 our plain rain
 * used to take by default. What matters when tuning is that the drops never SHRINK as the
 * weather worsens, which the tests pin.
 */
export const SKY_EFFECTS = Object.freeze({
	sun:  [],
	heat: [],
	cold: [],

	fair:  [{ type: "clouds", options: { density: 0.02, speed: 0.6, alpha: 0.45, direction: WIND_DIRECTION } }],
	cloud: [{ type: "clouds", options: { density: 0.12, speed: 0.8, alpha: 0.8,  direction: WIND_DIRECTION } }],
	wind:  [{ type: "clouds", options: { density: 0.06, speed: 3.4, alpha: 0.6,  direction: WIND_DIRECTION } }],
	haze:  [{ type: "fog",    options: { density: 0.1,  speed: 0.4, alpha: 0.35 } }],

	rain: [
		{ type: "clouds", options: { density: 0.06, speed: 1, alpha: 0.55, direction: WIND_DIRECTION } },
		{ type: "rain",   options: { density: 0.8, speed: 1.2, scale: 1.6, direction: driven(10) } },
	],
	downpour: [
		{ type: "clouds", options: { density: 0.12, speed: 1.6, alpha: 0.7, direction: WIND_DIRECTION } },
		{ type: "rain",   options: { density: 2.4, speed: 2, scale: 1.9, direction: driven(15) } },
	],
	// The one weather that tints: a storm's light is the half of it the particles cannot show,
	// and slate-grey cloud is what tells a storm from a heavy shower at a glance.
	storm: [
		{ type: "clouds", options: {
			density: 0.16, speed: 2.4, alpha: 0.85, direction: WIND_DIRECTION,
			tint: { value: "#6f7683", apply: true },
		} },
		{ type: "rain",   options: { density: 2.6, speed: 2.6, scale: 2.1, direction: driven(20) } },
		{ type: "hail",   options: { density: 0.5, speed: 2.2, direction: driven(20) } },
	],
	// No tornado effect exists in FXMaster, so the row that names them gets the worst storm the
	// module can draw: cloud tearing across at full speed over driven rain.
	tornado: [
		{ type: "clouds", options: {
			density: 0.2, speed: 4.6, alpha: 0.9, direction: WIND_DIRECTION,
			tint: { value: "#5f6570", apply: true },
		} },
		{ type: "rain",   options: { density: 2.2, speed: 3.4, scale: 2.3, direction: driven(25) } },
	],

	// driven(25) is the exact mirror of snow's own default heading of 65: FXMaster already tips
	// snow a quarter of the way off vertical, it just tips it the other way.
	snow:     [{ type: "snow",      options: { density: 1, speed: 0.9, direction: driven(25) } }],
	// Density 1 is snowstorm's own maximum, which is what a blizzard should be.
	blizzard: [{ type: "snowstorm", options: { density: 1, speed: 2.6, direction: driven(30) } }],
});

/**
 * Is FXMaster installed and switched on in this world?
 *
 * `globalThis.game`, not a bare `game?.` — optional chaining guards a missing PROPERTY, not a
 * missing binding, so `game?.modules` still throws a ReferenceError where `game` was never
 * declared at all. It always is inside Foundry; it is not in a test, and this is the one
 * function whose whole job is answering a question about the world from outside it.
 */
export function fxMasterActive() {
	const modules = globalThis.game?.modules;
	return [FXMASTER_ID, FXMASTER_PLUS_ID].some(id => modules?.get?.(id)?.active === true);
}

/**
 * Is the weather kept off the canvas?
 *
 * The setting is a checkbox in the config screen ("Weather on the Scene") and a Pause button on
 * the picker, and those are ONE switch rather than two that have to agree: a pause living
 * somewhere else would be a second thing to read before anyone could say why it had stopped
 * raining. Read through here rather than off `getSetting` at each call site, so "paused" is a
 * word the code says rather than a negation every reader has to perform.
 *
 * Only ever asked AFTER `fxMasterActive`, which is what keeps a world that never registered the
 * setting (a test, an older build) from being asked the question at all.
 */
export function weatherFxPaused() {
	return !getSetting(WEATHER_FX_SETTING);
}

/**
 * Which parts of the sky this world has switched off, one at a time, under the main switch (see
 * WEATHER_FX_PARTS and the settings that hang off it).
 *
 * A world that has never touched any of them gets the whole sky: only an explicit `false` counts
 * as off, so an unregistered key, a test's bare settings fake and a fresh world all read as on.
 *
 * Returned as a shape rather than applied here, because the thing that uses it is
 * `weatherFxUpdate`, which is pure and has to stay that way for the tests to be able to read the
 * sky it builds without standing a world up around it.
 *
 * @returns {{types: Set<string>, tint: boolean}}
 */
export function weatherFxDisabled() {
	const off = { types: new Set(), tint: false };
	for (const part of WEATHER_FX_PARTS) {
		if (getSetting(part.setting) !== false) continue;
		if (part.tint) off.tint = true;
		else off.types.add(part.type);
	}
	return off;
}

/**
 * The scene the weather belongs on: the one the TABLE is on, not the one this GM happens to be
 * looking at. A GM prepping next week's dungeon on a second scene should not have today's
 * blizzard land there, and the players would never see it if it did. Falls back to the viewed
 * scene for a world with nothing activated.
 */
export function weatherScene() {
	return globalThis.game?.scenes?.active ?? globalThis.canvas?.scene ?? null;
}

/**
 * The scene update that puts `sky` on the canvas: our effects set, and any of OURS that this
 * sky doesn't use deleted. Pure, so the tests can read the update rather than a mock's history.
 *
 * Deletions go through `deletionEntry`, because `setFlag` MERGES — without them, yesterday's
 * rain would still be falling under today's clear sky, with nothing on screen to say where it
 * came from. Only keys under our prefix are ever touched. The shim matters here rather than
 * being tidiness: the hand-built `-=` prefix still works on v13/v14, but core's
 * `_migrateDeletionKey` warns about it with no `once`, so a change of weather that dropped three
 * effects printed three stack traces, every time, forever — and on v16 the leaf stops being
 * migrated at all, at which point the old sky is never taken off the scene.
 *
 * A part the world has switched off is left out of the sky HERE rather than being skipped at
 * write time, and that is what makes turning one off take effect on a canvas it is already
 * falling on: an effect missing from the sky we are laying is an effect of ours on the scene
 * that nothing claims, which the deletion pass below then takes off.
 *
 * @param   {string} sky      A WEATHER_SKIES key.
 * @param   {object} current  The scene's existing `flags.fxmaster.effects`.
 * @param   {{types: Set<string>, tint: boolean}} [disabled]  From `weatherFxDisabled`. Omitted,
 *          the whole sky is drawn, which is what keeps this readable as "what this weather looks
 *          like" with no world attached.
 * @returns {object|null} An update object for `Scene#update`, or null when nothing would change.
 */
export function weatherFxUpdate(sky, current = {}, disabled = null) {
	const effects = SKY_EFFECTS[sky] ?? null;
	if (!effects) return null;

	// One pass to the flag paths, and the same effects named again as the set the deletion pass
	// spares. Only `type` and `options` are written, so nothing else on a table row can reach the
	// scene flag by accident.
	const kept = keptEffects(effects, disabled);
	const update = {};
	for (const fx of kept) {
		const key = `${FX_KEY_PREFIX}${fx.type}`;
		const options = { ...fx.options };
		// Already exactly this, so writing it again would be a scene update, a broadcast to every
		// connected client, and a full teardown and rebuild of every emitter on every canvas, all
		// to arrive back where the sky already was. `refreshWeatherFx` is documented as safe to run
		// twice and IS run twice, and every part of the config screen reconciles on change.
		if (sameEffect(current?.[key], fx)) continue;
		Object.assign(options, staleOptionDeletions(fx));
		update[`flags.${FXMASTER_ID}.effects.${key}`] = { type: fx.type, options };
	}
	Object.assign(update, dropOurs(current, new Set(kept.map(fx => `${FX_KEY_PREFIX}${fx.type}`))));
	return Object.keys(update).length ? update : null;
}

/**
 * Every option key any sky sets on a given effect type. Derived from the table rather than listed,
 * so a new option on one weather cannot be forgotten here.
 */
const OPTION_KEYS = (() => {
	const out = new Map();
	for (const effects of Object.values(SKY_EFFECTS)) {
		for (const fx of effects) {
			const seen = out.get(fx.type) ?? new Set();
			for (const key of Object.keys(fx.options ?? {})) seen.add(key);
			out.set(fx.type, seen);
		}
	}
	return out;
})();

/**
 * The `-=` entries that take LAST sky's options off this one.
 *
 * A dotted update path does not REPLACE the object at its end. `flags` is an ObjectField, and
 * v13's `_updateDiff` merges into it — `mergeObject(existing, ours, {insertKeys: true,
 * insertValues: true, performDeletions: true})`, recursive by default — so the merge walks into
 * `options` and every key the new sky does not mention survives from the old one. A storm's
 * slate-grey `tint` therefore went on painting the next light shower, a downpour's `scale: 1.2`
 * kept the drops oversized under plain rain, and unticking "Weather Effects: Storm Light" mid-storm
 * did nothing at all: `keptEffects` copies the options WITHOUT the tint, and the merge put it
 * straight back. Naming the absent keys is what makes the write mean "these options and no others".
 *
 * `performDeletions` is exactly what mergeObject does with a `-=` key, on both the merge path and
 * the insert path (which re-merges a fresh object), so nothing is ever left holding one.
 */
function staleOptionDeletions(fx) {
	const drop = {};
	for (const key of OPTION_KEYS.get(fx.type) ?? []) {
		if (!(key in (fx.options ?? {}))) drop[`-=${key}`] = null;
	}
	return drop;
}

/** Is the scene already holding exactly this effect? One level of options, which is all they are. */
function sameEffect(stored, fx) {
	if (!stored || stored.type !== fx.type) return false;
	const want = fx.options ?? {};
	const have = stored.options ?? {};
	const keys = Object.keys(want);
	if (keys.length !== Object.keys(have).length) return false;
	return keys.every(key => {
		const a = want[key], b = have[key];
		// `tint` is the only nested one, and it is two scalars.
		if (a && b && typeof a === "object" && typeof b === "object") {
			const inner = Object.keys(a);
			return inner.length === Object.keys(b).length && inner.every(k => a[k] === b[k]);
		}
		return a === b;
	});
}

/**
 * One sky's effects with the switched-off parts taken out.
 *
 * The tint is the odd one, because it is not an effect but an option ON one: switching it off has
 * to leave the cloud in the sky and take the colour out of it, so that row copies the options
 * without it rather than dropping the whole effect. Copies rather than edits, since SKY_EFFECTS
 * is the shared table every weather is built from and a delete in place would put the storm's
 * light out for the rest of the session.
 */
function keptEffects(effects, disabled) {
	if (!disabled) return effects;

	const kept = [];
	for (const fx of effects) {
		if (disabled.types?.has?.(fx.type)) continue;
		if (!disabled.tint || !fx.options?.tint) { kept.push(fx); continue; }
		const options = { ...fx.options };
		delete options.tint;
		kept.push({ ...fx, options });
	}
	return kept;
}

/**
 * The deletions that take every effect of OURS off a scene, except the ones `keep` names.
 *
 * Shared by the two writers rather than written twice, because "ours, and only ever ours" is the
 * promise this whole file makes to a GM who has hung their own fireflies on the scene — and a
 * pause that swept a key the weather never laid would break it just as thoroughly as a post
 * would. One loop, one prefix test, both callers.
 */
function dropOurs(current, keep = new Set()) {
	const update = {};
	for (const key of Object.keys(current ?? {})) {
		if (!key.startsWith(FX_KEY_PREFIX) || keep.has(key)) continue;
		const [deleteKey, deleteValue] = deletionEntry(`flags.${FXMASTER_ID}.effects.${key}`);
		update[deleteKey] = deleteValue;
	}
	return update;
}

/**
 * The scene update that takes the weather off the canvas and leaves the sky itself alone: the
 * pause. Pure, for the same reason `weatherFxUpdate` is.
 *
 * The steading still says storm and the card in the log still says storm — what stops is the
 * rain on the map. Nothing here remembers what was taken off, and nothing needs to: the weather
 * is on the steading, so resuming re-derives the particles from the sky the world is actually in
 * rather than from a snapshot that could have gone stale while it sat.
 *
 * @param   {object} current  The scene's existing `flags.fxmaster.effects`.
 * @returns {object|null} An update object for `Scene#update`, or null when we had nothing there.
 */
export function weatherFxClearUpdate(current = {}) {
	const update = dropOurs(current);
	return Object.keys(update).length ? update : null;
}

/**
 * Put a sky on the table's scene, if the GM has FXMaster and hasn't paused it.
 *
 * Every reason to do nothing is a quiet one. This runs off the back of posting the weather to
 * chat, which is the thing the GM actually asked for; a missing module, a world with no active
 * scene or a scene this user cannot update are all ordinary, and none of them is worth a
 * notification over a card that went out fine.
 *
 * @param   {string} sky
 * @returns {Promise<boolean>} true when the scene was written.
 */
export async function applyWeatherFx(sky) {
	// Against SKY_EFFECTS rather than current-weather.js's WEATHER_SKIES, which is the same set of
	// keys — the first test in weather-fx.test.js exists to keep it that way. Reading it from here
	// is what leaves this module with no import back to current-weather.js, and current-weather.js
	// now calls IN here (`announceWeather`), so the pair would otherwise be a cycle.
	//
	// `Object.hasOwn`, not a truthiness test: SKY_EFFECTS is a plain frozen object, so `sky` of
	// "toString" would find Object.prototype's method, pass the guard, and reach weatherFxUpdate,
	// which would throw trying to iterate a function. The clear skies are legitimately `[]` here.
	if (!Object.hasOwn(SKY_EFFECTS, String(sky))) return false;
	if (!fxMasterActive() || weatherFxPaused()) return false;

	const scene = writableWeatherScene();
	if (!scene) return false;

	const current = scene.getFlag?.(FXMASTER_ID, "effects") ?? {};
	return commitWeatherFx(scene, weatherFxUpdate(sky, current, weatherFxDisabled()));
}

/**
 * Take the weather off the canvas, leaving the sky the world is in exactly where it was.
 *
 * The pause half of the picker's button. Deliberately does NOT consult `weatherFxPaused`, because
 * this is called at the moment that switch goes off: asking it here would mean the one write that
 * has to happen is the one write that is refused.
 *
 * @returns {Promise<boolean>} true when the scene was written.
 */
export async function clearWeatherFx() {
	if (!fxMasterActive()) return false;

	const scene = writableWeatherScene();
	if (!scene) return false;

	return commitWeatherFx(scene, weatherFxClearUpdate(scene.getFlag?.(FXMASTER_ID, "effects") ?? {}));
}

/** The scene the weather goes on, or null when this user may not write it. */
function writableWeatherScene() {
	const scene = weatherScene();
	return scene?.canUserModify?.(globalThis.game?.user, "update") ? scene : null;
}

/**
 * Send one weather update to the scene, swallowing a refusal.
 *
 * A no-op update is `false` rather than an error: "the canvas already looked like that" is the
 * ordinary answer to posting the same weather twice, or to pausing a scene we never drew on.
 */
async function commitWeatherFx(scene, update) {
	if (!update) return false;
	try {
		await scene.update(update);
		return true;
	} catch (err) {
		// Whatever asked for this has already happened: the card is posted, or the GM has already
		// watched the button flip. A scene that refused the write is a canvas that stayed as it
		// was, which is a smaller thing than the console needs to shout about, but not so small
		// it should vanish.
		warn("couldn't change the weather on the scene", err);
		return false;
	}
}
