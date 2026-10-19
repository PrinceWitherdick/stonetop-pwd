// The system modules the "Import Book Art" macro (and the test-fixtures macro) borrow, handed on
// `game.stonetop.macroModules` rather than imported by their served path.
//
// The macro is a Script macro, outside our module graph, so it used to `import()` these files by
// path. Unbundled, that returned the very module instances the system had already loaded. A release
// runs from one bundled file (scripts/bundle.js), where those paths are no longer part of the running
// system: importing them there loads SECOND copies of everything they pull in, each with its own
// caches (browse.js's folder listings, settings.js's values) that the system's hooks never clear.
//
// These loaders are resolved by whichever build is running, so the macro always gets the system's
// own instances. They stay lazy: nothing here is loaded until the macro asks. The macro keeps its
// path import as the fallback. tests/book2-art/macro-modules.test.js holds the keys, the modules they
// load, and the macro's use of them together.
export const MACRO_MODULES = Object.freeze({
	journalSyncCore: () => import("../hooks/journal-sync-core.js"),
	worldJournalArt: () => import("./world-journal-art.js"),
	posterMaps:      () => import("./poster-maps.js"),
	// Not Import Book Art's: the test-fixtures macro (scripts/local/create-test-characters.js) seeds
	// and clears a three-year timeline through it. Same reason, and a sharper one: the timeline's
	// writes take turns per track, and a second copy of the store would bring a second queue.
	timeline:        () => import("../timeline/timeline-macro-api.js"),
	// The test-fixtures macro's settlement sheets: made by the same createSettlement the sidebar's
	// Create Settlement uses, from the same stat blocks.
	settlement:      () => import("../actors/settlement/settlement-actor.js"),
});
