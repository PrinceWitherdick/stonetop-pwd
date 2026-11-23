// Whether a document update wrote, or removed, a flag. An update hook sees a removal as a `-=key`
// entry, so both spellings count. Guarded by tests/utils/touches-flag.test.js.

import { SYSTEM_ID } from "../system-id.js";

/** Whether an update object (any level of `changes`) sets or removes `key`. */
export function touchesKey(scoped, key) {
	return typeof scoped === "object" && scoped !== null && (key in scoped || `-=${key}` in scoped);
}

/** Whether an actor update wrote, or removed, one of this system's top-level flags. */
export function touchesFlag(changes, flag) {
	return touchesKey(changes?.flags?.[SYSTEM_ID], flag);
}
