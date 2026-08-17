/**
 * Single source of truth for the package id that namespaces everything this system
 * stores inside a world: flag scopes, setting namespaces, sheet registrations and
 * compendium pack ids.
 *
 * Deliberately a hardcoded literal rather than `game.system.id`:
 *  - `game` does not exist at module-evaluation time, and
 *  - deriving it from the runtime would make the stored data namespace follow the
 *    install directory name, so a renamed or forked folder would silently orphan a
 *    world's data.
 */

/** The id in system.json. Changing this changes where world data is read and written. */
export const SYSTEM_ID = "stonetop-pwd";

/**
 * The id this system is being renamed to. Used only by the bridge migration, which
 * copies world data from SYSTEM_ID into this namespace and then re-points world.json.
 * See module/migration/.
 */
export const RENAME_TARGET_ID = null;

/**
 * Older ids this system shipped under, newest first. These are READ-ONLY fallback
 * rungs: a world that predates a rename still resolves its data through them.
 *
 * ⚠ NOT a list of things to migrate. "stonetop" is also ITEM_FLAG_SCOPE — the scope
 * shipped compendium item content, journal checkbox progress (`flags.stonetop.checks`)
 * and hover summaries live under, on purpose. Rewriting it would break the pack content
 * contract. The migration's source scope is SYSTEM_ID and nothing else.
 */
export const LEGACY_FLAG_SCOPES = Object.freeze(["stonetop_pwd", "stonetop"]);

/**
 * Scope for flags that ride along with shipped compendium content rather than with the
 * system install. Intentionally decoupled from SYSTEM_ID — do not codemod it.
 */
export const ITEM_FLAG_SCOPE = "stonetop";

/**
 * Per-document stamp written by the migration into the NEW scope, recording which scope
 * the document's data came from. Its presence means "this document has been cut over",
 * which is what lets read paths stop falling back to the old scope for that document —
 * a deep merge across scopes would resurrect sub-keys the system deliberately deletes
 * (see CharacterArcana#removeArcanum).
 */
export const CUTOVER_KEY = "__migratedFrom";

/**
 * Has `doc` been cut over into `scope`? The one reading of the stamp — the migration's
 * idempotency (skip a document already copied) and the read paths' fallback decision
 * (stop consulting the old scope) are the same question, so they ask it the same way.
 */
export function isCutOver(doc, scope = SYSTEM_ID, key = CUTOVER_KEY) {
	return doc?.flags?.[scope]?.[key] !== undefined;
}

/** Compendium pack names shipped by this system, without the package prefix. */
export const PACK_NAMES = Object.freeze([
	"stonetop-items",
	"stonetop-arcana",
	"stonetop-journal",
	"stonetop-bestiary",
	"stonetop-macros"
]);

/** Fully-qualified pack id for one of PACK_NAMES, e.g. "stonetop_pwd.stonetop-items". */
export function packId(name, scope = SYSTEM_ID) {
	return `${scope}.${name}`;
}

/**
 * The five shipped packs, fully qualified. Import these; do not retype the literal pack path.
 *
 * Here rather than beside their first caller because a pack id is the package id plus a pack
 * name, and both halves already live in this file. ITEMS_PACK and ARCANA_PACK used to be
 * declared in actors/character/StonetopFlags.js, which meant a module wanting the journal pack
 * had no shared constant to reach for and typed the literal instead. StonetopFlags re-exports
 * both so its existing importers are unaffected.
 */
export const ITEMS_PACK    = packId("stonetop-items");
export const ARCANA_PACK   = packId("stonetop-arcana");
export const JOURNAL_PACK  = packId("stonetop-journal");
export const BESTIARY_PACK = packId("stonetop-bestiary");
export const MACROS_PACK   = packId("stonetop-macros");
