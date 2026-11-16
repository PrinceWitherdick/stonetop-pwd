// Find-or-create, with no twins. A writer that looks a document up and creates it when nothing is
// found makes two of it when two writers overlap (the playbook library adopting its files at ready
// while a GM presses Save, or the live Introductions sync and a Save during a slow write): both find
// nothing, and both create. So a create runs once per key on this client, and a second ask while the
// first is in flight waits for that one instead of making another.

/** key -> the create in flight for it. */
const _creating = new Map();

/**
 * Run `make` for `key` unless a create for the same key is already in flight, in which case answer
 * with that one's result. The key is let go once the create settles, failed or not.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>|T} make
 * @returns {Promise<T>}
 */
export function createOnce(key, make) {
	if (_creating.has(key)) return _creating.get(key);
	const pending = Promise.resolve().then(make).finally(() => _creating.delete(key));
	_creating.set(key, pending);
	return pending;
}

/** The id of the folder a document sits in: Foundry hands the Folder itself, a plain record its id. */
export const folderIdOf = doc => doc?.folder?.id ?? doc?.folder ?? null;

/**
 * The folder of `type` called `name` directly inside `parentId` (null for the sidebar's top), made
 * with `data` (a colour, a sort, flags) when there is none. Two asks at once make one folder.
 * @param {string} type  the folder's document type ("Item", "JournalEntry")
 * @param {string} name
 * @param {string|null} [parentId]
 * @param {object} [data]  any more of the new folder's fields
 * @returns {Promise<Folder>}
 */
export async function findOrCreateFolder(type, name, parentId = null, data = {}) {
	const parent = parentId ?? null;
	const find = () => (game.folders ?? []).find(f => f.type === type && f.name === name && folderIdOf(f) === parent) ?? null;
	const found = find();
	if (found) return found;
	// Looked for again inside: a create that finished just before this one began has left its folder.
	return createOnce(`folder:${type}:${parent ?? ""}:${name}`,
		() => find() ?? Folder.create({ ...data, name, type, folder: parent }));
}
