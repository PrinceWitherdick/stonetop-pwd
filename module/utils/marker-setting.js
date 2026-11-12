import { SYSTEM_ID } from "../system-id.js";

/**
 * A world setting that holds markers, `{ [key]: true }`: the rulebooks a GM forgot in this world
 * (books/rulebooks.js) and the library playbooks they deleted here (playbooks/playbook-library.js).
 * Both are read before the setting may be registered, so a read never throws, and a write is made
 * only when the marker changes, so an ordinary pick costs no second write.
 */
export function readMarkers(setting) {
	try {
		const stored = globalThis.game?.settings?.get?.(SYSTEM_ID, setting);
		return (stored && typeof stored === "object") ? stored : {};
	} catch { /* setting not registered in this world */ }
	return {};
}

/** Set (`on`) or clear the marker `key` in `setting`. */
export async function setMarker(setting, key, on) {
	const now = readMarkers(setting);
	if (!!now[key] === on) return;
	const next = { ...now };
	if (on) next[key] = true;
	else delete next[key];
	await globalThis.game?.settings?.set?.(SYSTEM_ID, setting, next);
}
