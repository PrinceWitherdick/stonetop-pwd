import {resolvedFlagProperty} from "../character/StonetopFlags.js";

/**
 * A steading's `system.<path>` read the way the steading reads it: its mirrored flag copy
 * (`steading.system.<path>`, which StonetopSteading#setSystemValues keeps) first, then the
 * document's own system data, then `defaultValue`. THE one implementation, behind
 * StonetopSteading#getSystemValue and the character side's utils/world.js#effectiveProsperity.
 * A module of its own, importing only the flag reader, so neither side has to import the other
 * (and a test that mocks utils/world.js still has a steading that reads its own values).
 *
 * A null in the mirror is an answer (the steading's own reading) unless `nullIsMissing`, which
 * reads past it to the system value, as effectiveProsperity always has.
 *
 * @param {Actor|null} steading
 * @param {string} path  under `system`, e.g. "attributes.prosperity.value"
 * @param {{defaultValue?: *, nullIsMissing?: boolean}} [options]
 */
export function steadingSystemValue(steading, path, { defaultValue, nullIsMissing = false } = {}) {
	if (!steading) return defaultValue;
	const mirrored = foundry.utils.getProperty(resolvedFlagProperty(steading, "steading") ?? {}, `system.${path}`);
	if (mirrored !== undefined && !(nullIsMissing && mirrored === null)) return mirrored;
	const own = foundry.utils.getProperty(steading.system ?? {}, path);
	return own !== undefined ? own : defaultValue;
}
