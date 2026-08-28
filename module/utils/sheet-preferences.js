/**
 * The player-facing client settings, grouped for the character sheet's Preferences tab.
 *
 * The tab is a SURFACE, not a second home. Every control on it reads and writes the same
 * `game.settings` key the Foundry settings menu writes, so the two can never disagree and a
 * value set in either place applies the moment it is set — the registrations in
 * module/settings.js already carry the `onChange` that repaints or re-renders. Nothing here
 * stores a preference of its own.
 *
 * That is also why a row's LABEL, HINT, CHOICES and RANGE are read off the registration rather
 * than restated here or in the template. A hint edited in settings.js reaches the tab with no
 * second edit, and a row cannot ship describing behaviour the setting no longer has. The only
 * thing this file states is which keys a player is offered and in what order.
 *
 * Scope is per-PLAYER, not per-character: these are all client-scoped, and several of them
 * (`sheetFont`, `reduceMotion`, `sheetFontScale`) are applied by setting a variable or a class
 * on `document.documentElement`, so one character's sheet could not hold its own value even if
 * it wanted to. The tab is where a player finds them, not what owns them.
 *
 * NB the keys below are quoted literals on purpose, not built from a loop or a prefix:
 * tests/utils/settings-registration.test.js proves every registered key is read somewhere by
 * searching the source for the quoted key, and a key assembled at runtime is invisible to it.
 */

import { SYSTEM_ID } from "../system-id.js";

/**
 * The groups, in the order the tab draws them, and the keys each one carries.
 *
 * `menu` names a `game.settings.registerMenu` id to offer as a "More…" button under the
 * group — the hover descriptions are fourteen separate toggles behind a submenu of their
 * own, and re-listing them here would be a second copy of a list that already exists.
 */
export const PREFERENCE_GROUPS = [
	{
		id: "appearance",
		titleKey: "stonetop.sheet.preferences.appearance",
		// Font SIZE first: it is the one most likely to be wanted and the reason the tab exists.
		keys: ["sheetFontScale", "sheetFont", "sheetLayout", "editPencilRevealDelay", "reduceMotion"],
	},
	{
		id: "rolling",
		titleKey: "stonetop.sheet.preferences.rolling",
		keys: [
			"askRollModeEachRoll",
			"promptRollModifier",
			"promptDamageModifier",
			"showRollStatChips",
			"showMoveDescriptionsInChat",
		],
	},
	{
		id: "windows",
		titleKey: "stonetop.sheet.preferences.windows",
		keys: ["openSheetsInEditMode", "restoreWindowsOnReload"],
	},
	{
		id: "hover",
		titleKey: "stonetop.sheet.preferences.hover",
		// The master switch here, the fourteen it masters behind the button.
		keys: ["hoverDescriptionsEnabled"],
		menu: "hoverDescriptionSettings",
	},
];

/**
 * Every key the tab is allowed to write.
 *
 * The change handler reads its key from a `data-pref` attribute, so without an allow-list any
 * element that grew one could write any registered setting — including the WORLD-scoped ones
 * (`classicLayoutCharacter`, the GM-only gates) that a player must not touch and that Foundry
 * would reject noisily on their client and apply for everyone on the GM's. Membership of this
 * set is the whole permission check; keep it derived from the groups so adding a row to a group
 * is the only edit an added row needs.
 */
export const PREFERENCE_KEYS = new Set(PREFERENCE_GROUPS.flatMap(group => group.keys));

/**
 * Keys the tab offers to a GM and nobody else.
 *
 * `openSheetsInEditMode` decides which mode every actor sheet OPENS in, and a GM is the only
 * person at the table for whom that is a working habit rather than a one-off: they open other
 * people's sheets, the steading, monsters and NPCs all session, and they are the only one who
 * can edit most of them. A player opens their own character, which they can already flip with
 * the header wrench.
 *
 * Gated HERE rather than at registration, because `registerSettings` runs on the `init` hook and
 * `game.user` does not exist yet — there is no `isGM` to ask at the moment the `config` flag
 * would have to be decided. This means the row is absent from the TAB for a player while the
 * setting itself stays in Foundry's own Configure Settings list, which is the surface a player
 * has to already know about to reach.
 *
 * The gate is applied on the write path as well as the read one (see `setPreference`): the tab's
 * change handler takes its key from a `data-pref` attribute, so hiding the control without
 * refusing the key would leave the setting one hand-edited attribute from being written anyway.
 */
export const GM_ONLY_KEYS = new Set(["openSheetsInEditMode"]);

/** Whether this client is offered `key` at all. */
function offeredToThisUser(key) {
	if (!GM_ONLY_KEYS.has(key)) return true;
	return !!globalThis.game?.user?.isGM;
}

/** Localize a registration string, tolerating one that is already plain text. */
function loc(value) {
	if (!value) return "";
	return globalThis.game?.i18n?.localize?.(value) ?? value;
}

/** The registration behind a key, or undefined on a client that has not registered it yet. */
function registration(key) {
	return globalThis.game?.settings?.settings?.get?.(`${SYSTEM_ID}.${key}`);
}

/**
 * One row's view-model, or null if the key is not registered on this client.
 *
 * Null rather than a throw: the settings suite and the sheet tests build this context against a
 * partial `game`, and a missing registration should cost that one row rather than the tab.
 *
 * The shape a row takes is decided by the registration, in the order Foundry's own settings
 * menu decides it: `choices` makes a select, a `range` makes a slider, and anything else is the
 * checkbox its Boolean type implies.
 */
function buildRow(key) {
	if (!offeredToThisUser(key)) return null;
	const cfg = registration(key);
	if (!cfg) return null;

	let value;
	try {
		value = globalThis.game?.settings?.get?.(SYSTEM_ID, key);
	} catch {
		// A registered-but-unreadable setting (a client mid-boot) takes its default rather
		// than drawing an empty control that would write `undefined` on the first touch.
		value = cfg.default;
	}
	if (value === undefined) value = cfg.default;

	const row = { key, label: loc(cfg.name), hint: loc(cfg.hint) };

	if (cfg.choices) {
		row.isChoice = true;
		// String() both sides: `sheetFontScale` stores its scale as a STRING ("1.25") so its
		// choice keys can be numbers, and an option compared as a number to a string never
		// matches — which shows as a select that opens with nothing selected.
		row.choices = Object.entries(cfg.choices).map(([optValue, optLabel]) => ({
			value:    optValue,
			label:    loc(optLabel),
			selected: String(value) === String(optValue),
		}));
		return row;
	}

	if (cfg.range) {
		const number = Number(value);
		row.isRange = true;
		row.min     = cfg.range.min;
		row.max     = cfg.range.max;
		row.step    = cfg.range.step;
		row.value   = Number.isFinite(number) ? number : Number(cfg.default) || 0;
		// The readout beside the slider. A range with no number showing is a control whose
		// current value can only be guessed at from the handle's position.
		row.display = formatRange(row.value, cfg.range.step);
		return row;
	}

	row.isCheck = true;
	row.checked = !!value;
	return row;
}

/**
 * A range value as the readout shows it: as many decimals as the step implies, so a 0.1-step
 * slider reads "1.0" and "1.5" rather than "1" and "1.5" jumping a character wide as it drags.
 */
export function formatRange(value, step) {
	const decimals = String(step ?? 1).split(".")[1]?.length ?? 0;
	return Number(value).toFixed(decimals);
}

/**
 * The groups as the template draws them, current values and all.
 *
 * Rebuilt on every render rather than cached: a value can change from the Foundry settings
 * menu, from another sheet's copy of this tab, or from a `game.settings.set` anywhere else, and
 * a cached row would draw the stale one.
 */
export function buildPreferenceGroups() {
	if (!globalThis.game?.settings?.settings) return [];
	return PREFERENCE_GROUPS
		.map(group => {
			const menu = group.menu ? buildMenu(group.menu) : null;
			return {
				id:    group.id,
				title: loc(group.titleKey),
				// The id this group's fold is remembered under. Built here rather than in the
				// template because Handlebars has no string concatenation and the sheet's fold
				// store is a flat set of ids shared with every other section on the sheet — so
				// the prefix is what keeps a group called "details" from folding the Details
				// tab's own section of that name.
				collapse: `preferences-${group.id}`,
				rows:  group.keys.map(buildRow).filter(Boolean),
				menu,
			};
		})
		// A group whose every key failed to resolve is a heading over nothing.
		.filter(group => group.rows.length || group.menu);
}

/** The "More…" button's view-model, or null if that submenu is not registered here. */
function buildMenu(id) {
	const menu = globalThis.game?.settings?.menus?.get?.(`${SYSTEM_ID}.${id}`);
	if (!menu) return null;
	return { id, label: loc(menu.label ?? menu.name), hint: loc(menu.hint) };
}

/**
 * Write one preference, coercing the raw DOM value to the type its registration declares.
 *
 * Coerced here rather than at the call site because the DOM hands back strings for everything
 * (a range's `.value` is "1.5", not 1.5) and Foundry stores what it is given: a Number setting
 * written as a string survives the round trip but arrives at `applyEditPencilRevealDelay` as
 * one, and every later read gets a string where the code expects a number.
 *
 * @param {string} key   a member of PREFERENCE_KEYS; anything else is refused
 * @param {unknown} raw  the control's value (`.checked` for a checkbox, `.value` otherwise)
 * @returns {Promise<boolean>} whether the write happened
 */
export async function setPreference(key, raw) {
	if (!PREFERENCE_KEYS.has(key) || !offeredToThisUser(key)) return false;
	const cfg = registration(key);
	if (!cfg) return false;

	let value = raw;
	if (cfg.type === Boolean) value = !!raw;
	else if (cfg.type === Number) {
		const number = Number(raw);
		if (!Number.isFinite(number)) return false;
		value = number;
	} else value = String(raw);

	await globalThis.game?.settings?.set?.(SYSTEM_ID, key, value);
	return true;
}

/**
 * Open one of the registered settings submenus (the hover-description list).
 *
 * Instantiated from the registration rather than imported: the submenu classes are built inside
 * module/settings.js by a factory that is not exported, and the registry already holds the one
 * the menu button names.
 */
export function openPreferenceMenu(id) {
	const menu = globalThis.game?.settings?.menus?.get?.(`${SYSTEM_ID}.${id}`);
	if (!menu?.type) return false;
	new menu.type().render(true);
	return true;
}
