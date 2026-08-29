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
 * (`sheetFont`, `reduceMotion`, `sheetFontScale`, `sheetContrast`, `sheetTexture`, `noItalics`)
 * are applied by setting a variable or a class
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
		id: "accessibility",
		titleKey: "stonetop.sheet.preferences.accessibility",
		// A group of its own, first on the tab, because these are the settings someone arrives
		// LOOKING for — a reader who cannot make out the sheet is not going to browse a list
		// called "Look and Feel" for the one row that fixes it, and the difference between the
		// two headings is the difference between finding it and giving up.
		//
		// Font SIZE first: it is the one most likely to be wanted and the reason the tab exists.
		// Then the three that decide whether the text is legible at all — contrast, the paper
		// grain, and the slant. `reduceMotion` is here rather than below because it is the same
		// kind of setting: a need, not a taste. What stays in Look and Feel is what a reader who
		// can see the sheet fine would still want to change.
		//
		// `noItalics` sits beside the grain because it is the same shape of request — a reader
		// saying a treatment costs them more than it gives — and it is the one key here that
		// reaches past our own windows to the whole client. See its registration in settings.js.
		keys: ["sheetFontScale", "sheetContrast", "sheetTexture", "noItalics", "reduceMotion"],
	},
	{
		id: "appearance",
		titleKey: "stonetop.sheet.preferences.appearance",
		keys: ["sheetFont", "sheetLayout", "editPencilRevealDelay"],
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

/**
 * NO ROW ON THIS TAB IS EVER DRAWN DISABLED BY ANOTHER ROW, and that is worth saying because
 * one of them used to be.
 *
 * Sheet Contrast: High took the paper grain off as part of repainting the page, from a later
 * rule than the grain's own, so "Paper Texture" ticked ON under High Contrast was a switch that
 * saved, reported success and changed nothing on screen. This file answered that by drawing the
 * row disabled with a sentence explaining what was overriding it, which was the right answer to
 * the wrong question: the honest fix was for the contrast palette to stop reaching a setting
 * that is not its own, and it now does (2026-08-28, at the user's request; see the accessibility
 * block at the end of styles/stonetop.css). The two are separate needs and a reader can want
 * either alone.
 *
 * So the machinery that greyed a row out is gone rather than kept empty for a future second
 * case. If one ever turns up, the thing to try FIRST is uncoupling the settings, because a
 * control that flips and does nothing is a design fault wearing an explanation.
 */

/**
 * One setting's current value, falling back to its default on a client that cannot read it —
 * a registered-but-unreadable setting (a client mid-boot) takes its default rather than
 * answering `undefined`, which a control would write back on its first touch.
 *
 * `cfg` is passed in by the one caller that already holds the registration, so a row does not
 * look it up twice.
 */
function settingValue(key, cfg = registration(key)) {
	try {
		const value = globalThis.game?.settings?.get?.(SYSTEM_ID, key);
		return value === undefined ? cfg?.default : value;
	} catch {
		return cfg?.default;
	}
}

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

	const value = settingValue(key, cfg);

	const row = { key, label: loc(cfg.name), hint: loc(cfg.hint) };

	if (cfg.choices) {
		row.isChoice = true;
		// String() both sides: a choice list keys its options by their stored value, and those
		// keys are strings even when the setting's own type is not (Foundry casts the value on
		// read, the keys of the `choices` object it is matched against stay strings). An option
		// compared as a number to a string never matches, which shows as a select that opens
		// with nothing selected.
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
