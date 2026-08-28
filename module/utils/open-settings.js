import { SYSTEM_ID } from "../system-id.js";
import { flashHighlight } from "./flash-highlight.js";

// ── Jumping to a system setting ──────────────────────────────────────────────
// "Open Configure Settings and land on the row" as one call, for the places in the UI that offer
// a way out to the preference behind what the reader is looking at.
//
// The window opening is the promise; everything after it is best effort. Foundry's Configure
// Settings is core's, its markup is core's, and a version that renames a class or moves a tab
// must leave the GM looking at an open settings window rather than at a console error. So each
// step below is separately optional, and the failure of any of them costs the reader a scroll.
//
// Finding the row matters more here than it looks. This system registers around twenty settings
// a GM can see, and "we opened the settings for you" followed by a wall of unrelated checkboxes
// is barely better than telling them where to look — which is what the startup card already does
// in words (hooks/Ready.js).

/**
 * The class the row wears while it fades.
 *
 * Its rule is UNSCOPED, unlike almost everything else in the stylesheet, because the element it
 * goes on lives inside core's own window and no `.stonetop` ancestor reaches it. Safe all the
 * same: a rule this specific can only ever paint an element we put this class on ourselves.
 */
export const SETTING_FLASH_CLASS = "stonetop-setting-flash";

/** How long the row stays lit. Must match the CSS animation. */
export const SETTING_FLASH_MS = 2600;

/**
 * Open Configure Settings and show `key`, one of this system's own settings.
 *
 * @param   {string} key  The setting key as registered, without the system id.
 * @returns {Promise<boolean>} true when the settings window was opened. NOT whether the row was
 *          found: the caller offered a way to the settings, and the settings are what opened.
 */
export async function openSystemSetting(key) {
	const app = globalThis.game?.settings?.sheet;
	if (!app?.render) return false;

	await app.render(true);

	// Best effort from here: the window is what we promised, and every step below is separately
	// optional (see the header).
	const row = await findSettingRow(app, `${SYSTEM_ID}.${key}`);
	if (row) {
		showTabFor(app, row);
		row.scrollIntoView?.({ block: "center", behavior: "smooth" });
		flashHighlight(row, { className: SETTING_FLASH_CLASS, duration: SETTING_FLASH_MS });
	}
	return true;
}

/**
 * Open Configure Settings on this system's own category, without singling out a row.
 *
 * For the "everything else lives over there" button on the character sheet's Preferences tab:
 * the tab carries the dozen settings a player is likely to want, and this is the way out to the
 * rest — the world-wide options, the GM-only gates, and whatever modules registered.
 *
 * The category is revealed by looking up ONE of our settings and showing the tab it sits on,
 * the same best-effort walk `openSystemSetting` makes, minus the scroll and the flash: there is
 * no one row this button is about, and lighting an arbitrary one would say there was. The key is
 * only a probe for "which tab are this system's settings on", so any registered, visible
 * (`config: true`) key serves — it is the FONT one because that is also the first row the
 * Preferences tab lists, so the two open on the same neighbourhood.
 *
 * @returns {Promise<boolean>} true when the settings window was opened, as above.
 */
export async function openSystemSettings() {
	const app = globalThis.game?.settings?.sheet;
	if (!app?.render) return false;

	await app.render(true);

	const row = await findSettingRow(app, `${SYSTEM_ID}.sheetFont`);
	if (row) showTabFor(app, row);
	return true;
}

/**
 * The `.form-group` holding the setting with this id, once the window has painted one.
 *
 * Found by the input's NAME, which core builds as `<namespace>.<key>` (SettingsConfig's
 * `_prepareCategoryData`, read off v13) because that is how the submitted form maps back onto
 * settings: it is the one attribute the row cannot lose and still work. `data-setting-id` rides
 * along as a second guess, since core stamps that on the rows of its bespoke setting forms and
 * could reasonably grow it here. The GROUP comes back rather than the input, because lighting a
 * lone checkbox lights four pixels.
 *
 * Looked for twice, a frame apart. Configure Settings is an ApplicationV2 on every core this
 * system supports and its `render()` resolves with the DOM in place, so the first look almost
 * always has it. The second is for an AppV1 one, where `render` returns before the paint.
 *
 * Searched INSIDE the settings window, not across the document. A setting's name is not unique to
 * one window — a second Configure Settings popout, a module's own settings editor, a keybinding or
 * preset screen that mirrors the same names — and the first match anywhere on the page is what a
 * document-wide query returns. The flash and the scroll then landed in a window the GM had not
 * asked about, and `showTabFor` went on to read a `[data-tab]` out of that foreign tree and click
 * it in this one. The `app` root is the same one `showTabFor` resolves, resolved the same way.
 */
async function findSettingRow(app, id) {
	const selector = `[name="${id}"], [data-setting-id="${id}"]`;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt) await nextFrame();
		const root = appRoot(app);
		const found = root?.querySelector?.(selector);
		if (found) return found.closest?.(".form-group") ?? found;
	}
	return null;
}

/**
 * An Application's root element, jQuery or not — the same question `showTabFor` asks, asked once.
 *
 * NOT `element?.[0] ?? element`: indexed access on a <form> root returns its first CONTROL, and
 * core is one `tag: "form"` away from making that the silent answer.
 */
function appRoot(app) {
	return app?.element?.jquery ? app.element[0] : app?.element;
}

/**
 * Show the category the row sits in, by clicking its entry in the sidebar.
 *
 * Configure Settings is a two-pane category browser in v13: every category's `<section class="tab"
 * data-tab="system">` is in the document at once and only the active one shows, which is why the
 * row is findable before its pane is. What reveals it is a `<button data-action="tab"
 * data-tab="system">` in the sidebar's `nav.tabs`.
 *
 * Clicked rather than driven through an API, because a click is what works on both window
 * frameworks: AppV2 delegates it off the frame, AppV1 binds it with jQuery, and a native
 * `.click()` sets off either. There is no version of this whose method name we have to guess.
 */
function showTabFor(app, row) {
	const tab = row.closest?.("[data-tab]")?.dataset?.tab;
	if (!tab) return;
	// jQuery or not, the same way front-on-open.js asks. See `appRoot`.
	appRoot(app)?.querySelector?.(`nav [data-tab="${tab}"], .tabs [data-tab="${tab}"]`)?.click?.();
}

/** One frame, or one turn of the event loop where there are no frames (a test, a headless run). */
function nextFrame() {
	return new Promise(resolve => {
		// Called ON globalThis rather than through a saved reference: an unbound
		// `requestAnimationFrame` throws "Illegal invocation" in a browser.
		if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(() => resolve());
		else setTimeout(resolve, 0);
	});
}
