import { ITEM_FLAG_SCOPE, SYSTEM_ID } from "../system-id.js";
import { slugify } from "../utils/strings.js";
import { playbookIconPath } from "../utils/playbook-actors.js";

/**
 * EVERY PLAYBOOK THE WORLD KNOWS: the nine the book prints (shipped in the items pack) plus any
 * HOMEBREW playbook a GM built or imported (world Items, see PlaybookBuilderDialog).
 *
 * A homebrew playbook is a world `type:"playbook"` Item whose `flags.stonetop.homebrew` is set,
 * and its moves are world `type:"move"` Items carrying `flags["stonetop-pwd"].homebrewPlaybook = <slug>`
 * (HOMEBREW_MOVE_FLAG). The playbook's CONTENT sits under `flags.stonetop` like a shipped
 * playbook's (StonetopPlaybook reads it there); the move marker sits under the system id beside
 * the custom-move flag, because a character's copy of the move is read and written at runtime and
 * only the system id passes getFlag/setFlag's scope check.
 * THE FLAG IS THE IDENTITY, not the folder they sit in: a GM tidying the sidebar is harmless, and
 * an official Fox move dragged into the world (no flag) never doubles the Fox's list.
 *
 * World Items, not a world compendium, because the readers that need a homebrew playbook's intro
 * questions and move groups are synchronous, and because homebrew arcana and custom moves already
 * live there (FoundryArcanaRepository, CustomMoveDialog).
 *
 * Everything here reads `game.items` through one index rebuilt on any Item create/update/delete
 * (the FoundryArcanaRepository pattern). It stores LIVE Item references, so an edit is read fresh.
 */

/** The nine shipped playbooks: slug, display name (what a move's `system.playbook` holds), picker blurb. */
export const SHIPPED_PLAYBOOKS = Object.freeze([
	{ slug: "the-blessed",       name: "The Blessed",       complexity: "Medium",       desc: "Nature priest. Speaks to spirits and beasts. Works subtle magics via sacred markings and materials." },
	{ slug: "the-fox",           name: "The Fox",           complexity: "Low",          desc: "Clever, quick, and skillful. Not above bending the rules or fighting dirty. Can be quite the charmer, too." },
	{ slug: "the-heavy",         name: "The Heavy",         complexity: "Low / Medium", desc: "Not just a violent individual, our violent individual. A champion, yes, but a bit of a liability, too." },
	{ slug: "the-judge",         name: "The Judge",         complexity: "Low",          desc: "Settler of disputes, chronicler, and divine bulwark against chaos. Insightful, tough, not necessarily persuasive." },
	{ slug: "the-lightbearer",   name: "The Lightbearer",   complexity: "High",         desc: "Invokes divine power via flame and candle. Beacon of hope, charity, and mercy. Fiery foe of the dark." },
	{ slug: "the-marshal",       name: "The Marshal",       complexity: "High",         desc: "Leads the town's militia, plus a crew of followers. Makes choices about who lives and who dies." },
	{ slug: "the-ranger",        name: "The Ranger",        complexity: "Low",          desc: "At home in the wild, the one you want with you when you travel. A resourceful guide and deadly hunter." },
	{ slug: "the-seeker",        name: "The Seeker",        complexity: "High",         desc: "Collector of lost lore and power, with potent artifacts that might well lead to their ruin." },
	{ slug: "the-would-be-hero", name: "The Would-Be Hero", complexity: "Medium",       desc: "They're in over their head and full of fear and anger, but they just might outshine us all." },
].map(Object.freeze));

const SHIPPED_BY_SLUG = new Map(SHIPPED_PLAYBOOKS.map(p => [p.slug, p]));
const SHIPPED_NAMES   = new Set(SHIPPED_PLAYBOOKS.map(p => p.name.toLowerCase()));

/**
 * Slugs a homebrew playbook may never take. The post-death inserts are `type:"playbook"` Items
 * too (deaths-door.js POST_DEATH_INSERT_SLUGS), so they are listed here rather than imported, to
 * keep this module free of the death machinery.
 */
const RESERVED_SLUGS = new Set([...SHIPPED_BY_SLUG.keys(), "revenant", "ghost", "thrall"]);

/** Every homebrew slug starts with this, so no future shipped playbook can collide with one. */
export const HOMEBREW_SLUG_PREFIX = "homebrew-";

/** Generic art for a homebrew playbook with no picture of its own. */
export const HOMEBREW_PLAYBOOK_IMG = "icons/svg/book.svg";

export function isShippedPlaybookSlug(slug) {
	return SHIPPED_BY_SLUG.has(String(slug ?? ""));
}

export function shippedPlaybookInfo(slug) {
	return SHIPPED_BY_SLUG.get(String(slug ?? "")) ?? null;
}

export function isShippedPlaybookName(name) {
	return SHIPPED_NAMES.has(String(name ?? "").trim().toLowerCase());
}

/** The homebrew record on a playbook Item's flags, or null. */
function _homebrewMeta(item) {
	return item?.flags?.[ITEM_FLAG_SCOPE]?.homebrew ?? null;
}

/**
 * Is this a homebrew playbook Item? A world playbook with the homebrew flag, whose slug is
 * neither a shipped one nor a post-death insert's (a stray copy of the Fox stays the Fox's).
 */
export function isHomebrewPlaybookItem(item) {
	if (item?.type !== "playbook" || !_homebrewMeta(item)) return false;
	const slug = item.system?.slug;
	return !!slug && !RESERVED_SLUGS.has(slug);
}

/** The flag key (under the system id) naming the homebrew playbook a move belongs to. */
export const HOMEBREW_MOVE_FLAG = "homebrewPlaybook";

/**
 * The flag key (under the system id, beside HOMEBREW_MOVE_FLAG) marking a homebrew playbook's move
 * as one of an INSERT's: `{ key, list }` (homebrew-bundle.js). Insert moves are never offered as
 * the playbook's own (homebrewPlaybookMoves leaves them out); the insert's tab offers them.
 */
export const HOMEBREW_INSERT_FLAG = "homebrewInsert";

/** The insert a homebrew move belongs to (`{key, list}`), or null for any other move. */
export function homebrewInsertOf(item) {
	if (!homebrewMoveSlug(item)) return null;
	const ins = item.flags?.[SYSTEM_ID]?.[HOMEBREW_INSERT_FLAG];
	return ins?.key ? { key: String(ins.key), list: String(ins.list ?? "") } : null;
}

/** The slug of the homebrew playbook this move belongs to, or null for any other move. */
export function homebrewMoveSlug(item) {
	if (item?.type !== "move") return null;
	return item.flags?.[SYSTEM_ID]?.[HOMEBREW_MOVE_FLAG] || null;
}

export function isHomebrewPublished(item) {
	return !!_homebrewMeta(item)?.published;
}

// ---- The world index ------------------------------------------------------------------------

let _index = null;
let _indexedItemsRef = null;
let _hooksBound = false;
let _generation = 0;

/** Drop the index; the next read rebuilds it. Exported for tests and for the builder's saves. */
export function invalidatePlaybookCatalog() { _index = null; _generation++; }

/**
 * Bumped whenever the index is dropped (a world playbook or move created, edited or deleted): a
 * reader that builds something costly from the catalog (FoundryMoveRepository's homebrew move
 * definitions) keeps it while this stays the same.
 */
export function playbookCatalogGeneration() { return _generation; }

function _bindHooks() {
	if (_hooksBound) return;
	const Hooks = globalThis.Hooks;
	if (!Hooks?.on) return;
	// Only a WORLD playbook or move can change what the index holds; a move ticked or a gear change
	// on a character (an embedded Item, which fires the same hooks) leaves it be.
	const onItem = item => { if (!item?.parent && (item?.type === "playbook" || item?.type === "move")) invalidatePlaybookCatalog(); };
	for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, onItem);
	_hooksBound = true;
}

function _worldItems(items) {
	if (items) return items;
	return globalThis.game?.items ?? null;
}

/**
 * Build (or reuse) the index over `items`. A caller passing its own `items` (a test, a dry run)
 * gets a one-off index that is never cached, so it cannot poison the world's.
 */
function _catalog(items) {
	const explicit = !!items;
	const source = _worldItems(items);
	if (!source) return { bySlug: new Map(), byName: new Map(), movesBySlug: new Map() };
	if (!explicit && _index && _indexedItemsRef === source) return _index;
	const bySlug = new Map();
	const byName = new Map();
	const movesBySlug = new Map();
	for (const item of source) {
		if (isHomebrewPlaybookItem(item)) {
			const slug = item.system.slug;
			if (!bySlug.has(slug)) bySlug.set(slug, item);
			const key = String(item.name ?? "").trim().toLowerCase();
			if (key && !byName.has(key)) byName.set(key, item);
			continue;
		}
		const moveSlug = homebrewMoveSlug(item);
		if (moveSlug) {
			const list = movesBySlug.get(moveSlug) ?? [];
			list.push(item);
			movesBySlug.set(moveSlug, list);
		}
	}
	const built = { bySlug, byName, movesBySlug };
	if (!explicit) {
		_bindHooks();
		_index = built;
		_indexedItemsRef = source;
	}
	return built;
}

export function homebrewPlaybookBySlug(slug, items) {
	if (!slug) return null;
	return _catalog(items).bySlug.get(slug) ?? null;
}

export function homebrewPlaybookByName(name, items) {
	const key = String(name ?? "").trim().toLowerCase();
	if (!key) return null;
	return _catalog(items).byName.get(key) ?? null;
}

/** Every homebrew playbook Item, sorted by name. */
export function homebrewPlaybooks(items) {
	return [..._catalog(items).bySlug.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Every world move Item flagged as the homebrew playbook `slug`'s, whatever its name says (a fresh array). */
export function homebrewMovesOfSlug(slug, items) {
	return [...(_catalog(items).movesBySlug.get(slug) ?? [])];
}

/**
 * A homebrew playbook's moves, by the playbook's DISPLAY NAME (what a move's `system.playbook`
 * holds, and what every move lookup is keyed by). Only flagged moves whose `system.playbook`
 * still names this playbook count, so a move mid-rename, or one a GM re-pointed, is not doubled.
 */
export function homebrewPlaybookMoves(name, items) {
	// No homebrew playbook may take a book playbook's name (playbookNameProblem), so the nine skip the index.
	if (isShippedPlaybookName(name)) return [];
	const pb = homebrewPlaybookByName(name, items);
	if (!pb) return [];
	const moves = _catalog(items).movesBySlug.get(pb.system.slug) ?? [];
	// An INSERT's moves are not the playbook's own: Level Up, onboarding and the starting moves never
	// offer them (the insert's tab does, homebrewInsertMoves).
	return moves.filter(m => m.system?.playbook === pb.name && !homebrewInsertOf(m));
}

/**
 * The moves of one insert (`key`) of a homebrew playbook, by the playbook's display name, or of
 * every insert when `key` is omitted.
 */
export function homebrewInsertMoves(name, key = null, items) {
	if (isShippedPlaybookName(name)) return [];
	const pb = homebrewPlaybookByName(name, items);
	if (!pb) return [];
	const moves = _catalog(items).movesBySlug.get(pb.system.slug) ?? [];
	return moves.filter(m => {
		if (m.system?.playbook !== pb.name) return false;
		const ins = homebrewInsertOf(m);
		return !!ins && (key === null || ins.key === key);
	});
}

/** A world move Item by id, but ONLY when it is a homebrew playbook move (see FoundryMoveRepository). */
export function homebrewMoveById(id, items) {
	if (!id) return null;
	const source = _worldItems(items);
	const item = source?.get?.(id) ?? null;
	return homebrewMoveSlug(item) ? item : null;
}

/**
 * Every playbook's display name: the nine shipped, then the homebrew ones (by name). This is the
 * list the "any other playbook" picks (Versatile) and a background's foreign moves read, so a
 * DRAFT homebrew playbook is left out unless asked for: a half-reviewed import never reaches a
 * player, through the picker (homebrewPickerRows) or through another playbook's moves.
 */
export function allPlaybookNames({ includeHomebrew = true, drafts = false, items } = {}) {
	const names = SHIPPED_PLAYBOOKS.map(p => p.name);
	if (!includeHomebrew) return names;
	return [...names, ...homebrewPlaybooks(items).filter(i => drafts || isHomebrewPublished(i)).map(i => i.name)];
}

/**
 * The art for a playbook: the shipped badge for a shipped slug, else the playbook Item's own
 * picture, else a generic book. `playbookIconPath` alone hands back a path to a file that does
 * not exist for any slug it does not know.
 */
export function playbookAvatar(slug, doc = null, items) {
	if (isShippedPlaybookSlug(slug)) return playbookIconPath(slug);
	const item = doc ?? homebrewPlaybookBySlug(slug, items);
	const img = item?.img;
	if (img && img !== "icons/svg/item-bag.svg") return img;
	return slug ? HOMEBREW_PLAYBOOK_IMG : null;
}

/**
 * The picker's homebrew rows, in the shape PlaybookPickerDialog draws. A GM sees drafts too
 * (marked), a player only published playbooks: a half-reviewed import never reaches a player.
 */
export function homebrewPickerRows({ isGM = false, items } = {}) {
	return homebrewPlaybooks(items)
		.filter(i => isGM || isHomebrewPublished(i))
		.map(i => {
			const picker = i.flags?.[ITEM_FLAG_SCOPE]?.picker ?? {};
			return {
				uuid:        i.uuid,
				name:        i.name,
				slug:        i.system.slug,
				img:         playbookAvatar(i.system.slug, i),
				complexity:  String(picker.complexity ?? ""),
				description: String(picker.summary ?? ""),
				author: String(picker.author ?? ""),
				homebrew:    true,
				draft:       !isHomebrewPublished(i),
			};
		});
}

/** A homebrew playbook's own Introductions questions ({step3, step4, step6}), or null. */
export function homebrewIntroData(slug, items) {
	const intro = homebrewPlaybookBySlug(slug, items)?.flags?.[ITEM_FLAG_SCOPE]?.introductions;
	if (!intro || typeof intro !== "object") return null;
	const list = v => Array.isArray(v) ? v.map(q => String(q ?? "").trim()).filter(Boolean) : [];
	return {
		step3: String(intro.step3 ?? "").trim() || null,
		step4: list(intro.step4),
		step6: list(intro.step6),
	};
}

/** A homebrew playbook's move groups ([{key, label, moves}]) by display name, or null. */
export function homebrewMoveGroups(name, items) {
	const groups = homebrewPlaybookByName(name, items)?.flags?.[ITEM_FLAG_SCOPE]?.moveGroups;
	if (!Array.isArray(groups) || !groups.length) return null;
	return groups
		.filter(g => g && Array.isArray(g.moves) && g.moves.length)
		.map((g, i) => ({ key: String(g.key || `group-${i + 1}`), label: String(g.label ?? ""), moves: g.moves.map(String) }));
}

// ---- Minting --------------------------------------------------------------------------------

/**
 * A fresh slug for a homebrew playbook called `name`: `homebrew-<slugified name>`, with a numeric
 * suffix when that is taken. Minted ONCE, at creation; a rename never changes it, because every
 * character holding the playbook links to it by slug.
 */
export function mintHomebrewSlug(name, items) {
	const base = HOMEBREW_SLUG_PREFIX + (slugify(name) || "playbook");
	const taken = _catalog(items).bySlug;
	if (!taken.has(base) && !RESERVED_SLUGS.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate) && !RESERVED_SLUGS.has(candidate)) return candidate;
	}
}

/**
 * Why `name` cannot be a homebrew playbook's name, or null when it can. Moves link to their
 * playbook by display name, so two playbooks sharing one would share one move list: this is a
 * data guard, not a stat rule, and it blocks the save.
 *
 * @param {string} name
 * @param {object} [opts]
 * @param {string} [opts.ownSlug]  the playbook being renamed, which may keep its own name
 */
export function playbookNameProblem(name, { ownSlug = null, items } = {}) {
	const trimmed = String(name ?? "").trim();
	if (!trimmed) return "empty";
	if (isShippedPlaybookName(trimmed)) return "shipped";
	const other = homebrewPlaybookByName(trimmed, items);
	if (other && other.system?.slug !== ownSlug) return "taken";
	return null;
}
