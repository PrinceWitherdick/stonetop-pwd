import { vi } from "vitest";

// StonetopFlags' fragment methods (updateData, deletionData, subKeyData, subKeyDeletionData,
// applyUpdateData, setSubKey) over a plain `store` keyed by flag key, for the per-file fake flags
// that model one namespace as `{ key: value }`. A fragment is written the way the real class writes
// it, `flags.<scope>.<ns>.<key>[.<sub>]` with "-=" for a deletion, and applied as Foundry would:
// a sub-key path sets (or drops) that one key and leaves its siblings alone.
const PREFIX = "flags.fake.ns.";

function apply(store, data) {
	for (const [path, value] of Object.entries(data ?? {})) {
		const rest = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path;
		const dot = rest.indexOf(".");
		const key = dot < 0 ? rest : rest.slice(0, dot);
		const sub = dot < 0 ? null : rest.slice(dot + 1);
		if (sub === null) {
			if (key.startsWith("-=")) delete store[key.slice(2)];
			else store[key] = value;
			continue;
		}
		if (sub.startsWith("-=")) {
			if (store[key] && typeof store[key] === "object") delete store[key][sub.slice(2)];
			continue;
		}
		store[key] = { ...(store[key] && typeof store[key] === "object" ? store[key] : {}), [sub]: value };
	}
}

/** The fragment half of StonetopFlags, over `store`. Spread into a fake flags object. */
export function flagFragmentOps(store) {
	return {
		updateData:         (key, value) => ({ [`${PREFIX}${key}`]: value }),
		deletionData:       key => ({ [`${PREFIX}-=${key}`]: null }),
		subKeyData:         (key, sub, value) => ({ [`${PREFIX}${key}.${sub}`]: value }),
		subKeyDeletionData: (key, sub) => ({ [`${PREFIX}${key}.-=${sub}`]: null }),
		applyUpdateData:    vi.fn(async data => apply(store, data)),
		setSubKey:          vi.fn(async (key, sub, value) => apply(store, { [`${PREFIX}${key}.${sub}`]: value })),
	};
}
