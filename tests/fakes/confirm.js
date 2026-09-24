import { vi } from "vitest";

/**
 * Answer the next `askWithButtons` window (module/utils/ask-with-buttons.js) without a browser:
 * puts a fake DialogV2 in place whose `wait` presses the button keyed `key` (null closes the
 * window). A button that reads the window's form is handed `form`, as core hands it the real one.
 *
 * The returned spy is `DialogV2.wait`, so a test reads what was asked from `spy.mock.calls[0][0]`:
 * `.content`, `.window.title`, `.buttons` (affirmative first).
 */
export function stubAsk(key, form = null) {
	const wait = vi.fn(async config => {
		const button = config.buttons?.find(b => b.action === key);
		if (!button) return null;
		return button.callback ? button.callback(null, { form }) : key;
	});
	globalThis.foundry ??= {};
	globalThis.foundry.applications ??= {};
	globalThis.foundry.applications.api ??= {};
	globalThis.foundry.applications.api.DialogV2 = { wait };
	return wait;
}

/**
 * Answer the next `confirmOutcome` window: true presses the affirmative ("yes"), false the other
 * ("no"), null closes the window.
 */
export function stubConfirm(answer) {
	return stubAsk(answer === true ? "yes" : answer === false ? "no" : null);
}

/** A form whose named controls are `fields` ({name: {checked, value}}), as a button's `form` reads. */
export function fakeForm(fields = {}) {
	return { elements: { namedItem: name => fields[name] ?? null } };
}
