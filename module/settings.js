import { DEFAULT_ROOT as DEFAULT_BOOK2_ART_ROOT } from "./book2-art/art-root.js";
import { POSTER_MAPS, posterMapSlugOf } from "./book2-art/poster-map-catalog.js";
import { SYSTEM_ID } from "./system-id.js";
import { WEATHER_FX_PARTS, WEATHER_FX_SETTING } from "./seasons/weather-fx-parts.js";
import { isPrimaryGM } from "./utils/primary-gm.js";

/**
 * A weather-effect setting changed, so the canvas has to catch up with it: unticking Fog must
 * take the fog off the map it is already drifting across, not wait for the next posted weather.
 *
 * Reached through `game.stonetop` rather than by importing seasons/current-weather.js, which is
 * how everything in this file reaches outward (see the threat board's onChange below):
 * current-weather.js reads settings.js, so an import back the other way would be a cycle.
 *
 * ONE client does the work. onChange fires on every connected client and what it leads to is a
 * scene update, so without the guard every GM at the table races the same write.
 *
 * ONE pass per save, too. This hangs off all eight weather switches, and core's SettingsConfig
 * applies a form one `game.settings.set` at a time — so a GM who unticks Fog, Hail and Snow and
 * presses Save fired three of these in a row, each a scene write, a broadcast, and a teardown and
 * rebuild of every emitter on every connected client's canvas, when only the last one's state was
 * ever visible. Debounced the way the rest of the codebase does it (IntroductionsDialog,
 * WelcomeDialog), so a save is one reconcile however many boxes it touched.
 */
let _debouncedReconcile = null;
function reconcileWeatherFx() {
	// Built on first call rather than at module load. This file is evaluated while the system's
	// entry point is still pulling its imports in, and reaching into `foundry.utils` that early
	// would fail at load time — where there is no setting change to blame it on — instead of at a
	// moment a reader could act on.
	_debouncedReconcile ??= foundry.utils.debounce(() => {
		if (isPrimaryGM()) globalThis.game?.stonetop?.refreshWeatherFx?.();
	}, 100);
	return _debouncedReconcile();
}

export function registerSettings() {
	// -- WORLD SETTINGS ------------------------------------------

	// NB: there is no general "moduleVersion" stamp. Each versioned pass owns the version
	// it last ran for — `journalSyncVersion` (seeded journal refresh), `book2ArtSyncVersion`
	// (durable art re-apply), `idMigrationFinishedFor` (the id sweep) — so one pass shipping
	// a new version can't silently mark the others as already done for it.

	// Whether the one-time import of the JournalEntry compendiums into the world
	// has run (see hooks/SeedCompendiums.js). Set true after the first GM load so
	// the gazetteer is seeded exactly once and never re-duplicated.
	game.settings.register(SYSTEM_ID, "seedingComplete", {
		name: "Compendium Seeding Complete",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Which system id the Phase 3 id-migration sweep last completed for. Stores the id
	// rather than a boolean so a future rename re-runs it, and so a brand-new world (which
	// has nothing to sweep) can be stamped without pretending a migration happened.
	game.settings.register(SYSTEM_ID, "idMigrationFinishedFor", {
		name: "System ID Migration Completed For",
		scope: "world",
		config: false,
		type: String,
		default: ""
	});

	// Whether the one-time import of the Monsters (stonetop-bestiary) actor compendium
	// into the world's Actors sidebar has run (see hooks/SeedActors.js). Independent of
	// `seedingComplete` (which covers the JournalEntry packs) so an established world whose
	// journals were seeded long ago still imports the monster sheets on the first load
	// after this shipped. Set true after the first GM load so the bestiary is seeded once.
	game.settings.register(SYSTEM_ID, "bestiaryActorsSeeded", {
		name: "Bestiary Actors Seeded",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether this world has had the retired "The World" wrapper folder un-nested (see
	// hooks/SeedCompendiums.unnestSeededWorldRootOnce). Older seeds grouped the four
	// gazetteer trees under a single "The World" folder, which pushed the deep Bestiary
	// codex past Foundry's folder-render depth; the migration lifts the trees to the
	// sidebar root and deletes the wrapper. Set true once it has run (no-op on fresh worlds).
	game.settings.register(SYSTEM_ID, "worldRootUnnested", {
		name: "World Root Un-nested",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the seeded world Bestiary's actor subfolders have been collapsed (see
	// hooks/SeedActors.collapseBestiaryActorSubfoldersOnce). The tree was seeded
	// Bestiary > section > region > creature > actor; that depth hid the deepest monsters
	// past Foundry's folder-render limit, so the migration flattens it to Bestiary > section
	// > actor. Set true once it has run (no-op on worlds seeded from the collapsed compendium).
	game.settings.register(SYSTEM_ID, "bestiaryActorFoldersCollapsed", {
		name: "Bestiary Actor Folders Collapsed",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the lettered Place-of-Interest pins already on this world's scenes have been
	// opened up to players (see hooks/Ready.js _revealLandmarkNotesOnce). They were written
	// without global visibility and owned by the GM who placed them, which Foundry 14 reads
	// as "GM's private note"; new pins are written public at creation. Once per world rather
	// than every load, so a GM who later hides a pin on purpose keeps that decision.
	game.settings.register(SYSTEM_ID, "landmarkNotesRevealed", {
		name: "Landmark Map Pins Revealed",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the one-time import of the Book II "Treasures & Wonders" items from the
	// stonetop-items compendium into the world's Items sidebar has run (see
	// hooks/SeedItems.js). Independent of the journal/bestiary seeds so an established
	// world still gets the treasure library on the first load after this shipped. Set
	// true after the first GM load so the treasures are seeded once and never duplicated.
	game.settings.register(SYSTEM_ID, "treasureItemsSeeded", {
		name: "Treasure Items Seeded",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether this world has had the system's new-world core setting defaults applied.
	// Used to seed Foundry's Automatic Token Rotation world setting off only during a
	// fresh world's first GM load, without surprising already-established worlds.
	game.settings.register(SYSTEM_ID, "coreSettingDefaultsApplied", {
		name: "Core Setting Defaults Applied",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether this world has had players granted Foundry's ACTOR_CREATE permission
	// (see hooks/Ready.js _ensurePlayerActorCreationGrant). Independent of the fresh-
	// world gate above so ESTABLISHED worlds — which skip the new-world defaults —
	// still get the grant the actor-backed steading roster depends on. One-time: once
	// set, a GM who later revokes the permission keeps it revoked.
	game.settings.register(SYSTEM_ID, "playerActorCreationGranted", {
		name: "Player Actor Creation Granted",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// The system version whose shipped journal content was last rolled into the
	// world's seeded copies (see hooks/SeedCompendiums.js). When this trails the
	// running version, the update pass refreshes pristine (un-edited) seeded
	// journals and records the new version here.
	game.settings.register(SYSTEM_ID, "journalSyncVersion", {
		name: "Journal Sync Version",
		scope: "world",
		config: false,
		type: String,
		default: ""
	});

	// The system version each ONE-TIME REPAIR SWEEP last completed under, keyed by the sweep's own
	// name: `{ arcanumSlugs: "1.5.3", … }`. See migration/once-per-version.js.
	//
	// ONE registration for all of them, rather than a setting apiece. These sweeps arrive a couple
	// at a time and each is a full-world scan — every Item in the sidebar, every Note on every
	// Scene, every embedded item on every Actor — run on the primary GM's blocking `onReady`. They
	// were added ungated on the argument that each is idempotent, which is true and is not the
	// same as free: idempotent buys correctness, not the scan. Worse, an ungated sweep records
	// nothing about having run, so no later maintainer can tell a sweep that is still needed from
	// one that has been a no-op in every world for a year, and none of them can ever be deleted.
	//
	// Keyed by version rather than latched to a boolean so a sweep that is really "bring this up
	// to the CURRENT design" runs again after an upgrade that changes the design — which is what
	// the pin refits actually are.
	game.settings.register(SYSTEM_ID, "repairSweepVersions", {
		name: "Repair Sweep Versions",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// Fingerprint of the seeded gazetteer folder colour scheme last applied in this
	// world (see hooks/SeedCompendiums.syncSeededFolderColors). When it trails the
	// current scheme — a fresh install, or a system update that added/retinted a
	// category — the sync recolours any still-default folders and records the new
	// signature. A content signature rather than a one-shot flag so later colour
	// changes propagate; the sync recolours folders at the default or still holding a colour
	// from the previous scheme, so re-running can't fight a GM's own tint.
	game.settings.register(SYSTEM_ID, "seededFolderColorsSignature", {
		name: "Seeded Folder Colours Signature",
		scope: "world",
		config: false,
		type: String,
		default: ""
	});

	// Whether the GM wants the automatic start-of-session chat reminders (currently
	// the Destined "+Omens" roll, see hooks/StonetopSingleton.js remindDestinedOmenRoll).
	// World-scoped: showing the table its session-start upkeep is a per-world decision,
	// and only the GM posts the card, so a per-browser client toggle would never match
	// who actually fires it. Defaults on; GMs who don't want the nudge can untick it.
	game.settings.register(SYSTEM_ID, "startOfSessionReminders", {
		name: "stonetop.settings.startOfSessionReminders.name",
		hint: "stonetop.settings.startOfSessionReminders.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	// Posts a chat card the moment a PC is reduced to 0 HP, naming the 0-HP move they
	// actually trigger (Death's Door, or their post-death insert's own move). On by default:
	// the book has the whole table react to a PC going down, and without it the moment can
	// pass unnoticed. The card never forces the roll — the book explicitly allows holding it
	// off "until the scene wraps up" — so a GM who wants the moment kept quiet turns it off.
	game.settings.register(SYSTEM_ID, "deathsDoorPrompt", {
		name: "stonetop.settings.deathsDoorPrompt.name",
		hint: "stonetop.settings.deathsDoorPrompt.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	// Opens the 0-HP walkthrough on the dying player's own screen as well as posting the card,
	// so the moment doesn't wait on someone noticing a line of chat. Subordinate to the setting
	// above: a table that has turned the announcement off doesn't want a window either.
	//
	// The dialog is still only an invitation — its Cancel closes it and the card stays in chat —
	// so the book's "hold the roll off until the scene wraps up" is intact. Turn this off to
	// leave the card as the only nudge.
	game.settings.register(SYSTEM_ID, "deathsDoorAutoOpen", {
		name: "stonetop.settings.deathsDoorAutoOpen.name",
		hint: "stonetop.settings.deathsDoorAutoOpen.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	// Adds the "Shift Up" / "Shift Down" buttons to move roll cards in chat, letting the
	// GM bump a roll's result to a higher or lower tier (see _chatWireRollShifting /
	// _onRollShift in stonetop.js). Only the GM ever sees them. Off by default — it's a
	// niche GM tool most tables never reach for, and the buttons add a row to every roll
	// card. World-scoped: whether the table uses tier-shifting is a per-world call, and
	// only the GM acts on it.
	game.settings.register(SYSTEM_ID, "chatShiftButtons", {
		name: "stonetop.settings.chatShiftButtons.name",
		hint: "stonetop.settings.chatShiftButtons.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
	});

	// When on (the default), only the GM may author custom moves — players don't see
	// the "+ Custom Move" button or the edit pencils, and the create/edit handlers are
	// no-ops for them. Existing custom moves still display and roll for everyone; this
	// only gates AUTHORING. Off lets any player author on their own character.
	game.settings.register(SYSTEM_ID, "customMovesGmOnly", {
		name: "stonetop.settings.customMovesGmOnly.name",
		hint: "stonetop.settings.customMovesGmOnly.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	// As customMovesGmOnly, but for homebrew arcana (minor & major). When on (the
	// default), only the GM sees the per-tier "Create arcanum" buttons at the foot
	// of the arcana tab's Major / Minor sections; existing arcana still render and
	// the editor still opens for whoever owns the card. (The Artifact Creation
	// inspiration wizard now lives in the sidebar "Create Item → Arcanum" chooser,
	// which is GM-side.) Kept independent of customMovesGmOnly so a GM can permit
	// one and not the other.
	game.settings.register(SYSTEM_ID, "arcanaCreationGmOnly", {
		name: "stonetop.settings.arcanaCreationGmOnly.name",
		hint: "stonetop.settings.arcanaCreationGmOnly.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	// When on (the default), creating a blank Monster from "Create Actor" opens the
	// guided worksheet (Book I "Dangers") that computes HP/armor/damage from tag
	// picks. Off drops straight to a blank stat block. Imports, compendium drops,
	// and duplicates are never intercepted, only manual blank creates.
	game.settings.register(SYSTEM_ID, "monsterBuilderEnabled", {
		name: "stonetop.settings.monsterBuilderEnabled.name",
		hint: "stonetop.settings.monsterBuilderEnabled.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	// Whether players may PEEK at a card's BACK before unlocking it. A card's OWNER always
	// sees its back once unlocked (every spot filled), regardless of this setting —
	// unlocking is their own achievement. This switch is the separate peek: on lets
	// players open the back of a not-yet-unlocked card; off (the default) keeps an
	// un-unlocked back hidden until the GM clicks "Reveal back to player" on it. The GM
	// always sees both sides. See the per-card visibility model in
	// StonetopCharacterSheet.getData / CharacterArcana.
	game.settings.register(SYSTEM_ID, "arcanaPlayersSeeBothSides", {
		name: "stonetop.settings.arcanaPlayersSeeBothSides.name",
		hint: "stonetop.settings.arcanaPlayersSeeBothSides.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
	});

	// Identifying artifacts, Book I pp.430-431. When on, a Book II treasure dropped onto a
	// character sheet lands with its tags, Value and ○ uses withheld, so the table plays out
	// "describe it… hint at more than meets the eye" and a PC has to Know Things about it.
	// Off by default: that's how every existing world already behaves, and a GM who prefers to
	// hand treasure over plainly can still hide individual pieces from the row's own control.
	game.settings.register(SYSTEM_ID, "artifactsStartUnidentified", {
		name: "stonetop.settings.artifactsStartUnidentified.name",
		hint: "stonetop.settings.artifactsStartUnidentified.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
	});

	// The flagship "threats on the map" option. When on, each threat pin also draws its
	// full book card on the canvas, anchored to the pin and panning/zooming with the
	// scene, with a live doom track the GM ticks right there. Off by default: the safe
	// path is a pin that opens the card in a window (works everywhere, no canvas overlay).
	game.settings.register(SYSTEM_ID, "threatOnCanvasCards", {
		name: "stonetop.settings.threatOnCanvasCards.name",
		hint: "stonetop.settings.threatOnCanvasCards.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
		onChange: () => game.stonetop?.threatBoard?.refresh?.(),
	});

	// Whether the one-time "Welcome to Stonetop" fresh-start CHAT card has been posted in
	// this world (hooks/Ready.js _postStartupWelcomeMessageOnce). Distinct from
	// `gmWelcomeShown` above despite the similar name: that one records that the GM
	// dismissed the Welcome GUIDE's auto-pop-up, this one that the orientation card has
	// been posted to chat. World-scoped — the card is public, and only the GM posts it.
	game.settings.register(SYSTEM_ID, "startupWelcomeShown", {
		name: "Startup Welcome Chat Card Posted",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the "(TEST ONLY) Populate World" dev macro has been seeded into the
	// world's Macro Directory (see hooks/Ready.js _ensureTestPopulateMacro). Set true
	// after the first GM load so it's added exactly once — a GM who later deletes it
	// keeps it gone rather than having it reappear every reload.
	game.settings.register(SYSTEM_ID, "testPopulateMacroSeeded", {
		name: "Test Populate Macro Seeded",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the "Import Book II Art" macro has been seeded into the world's Macro
	// Directory (see hooks/Ready.js _ensureBook2ArtMacro). Set true after the first
	// GM load so it's added exactly once — a GM who later deletes it keeps it gone.
	game.settings.register(SYSTEM_ID, "book2ArtMacroSeeded", {
		name: "Book II Art Macro Seeded",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the one-time "you can import your book art" chat reminder has been posted
	// (see hooks/Ready.js _postBook2ArtReminderOnce). Resolved exactly once for a GM who
	// is past the first-session Welcome guide (finished session zero or ticked "Don't show
	// this again"): the card is whispered if no art is on disk yet, otherwise it's simply
	// marked done. World-scoped — "has this world been nudged" is world state, and only the
	// GM posts/acts on it.
	game.settings.register(SYSTEM_ID, "book2ArtReminderShown", {
		name: "Book Art Import Reminder Shown",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// RETIRED KEY: "peopleCropRebuildOffered". Superseded by bookArtRebuildOffered below and
	// no longer registered — nothing reads it, and Foundry simply ignores a stored value whose
	// key it does not know, so leaving it registered bought nothing. Named here so the key is
	// not reused: a world upgraded from an older build still HOLDS a `true` under it, and a new
	// setting reusing the name would silently start out latched shut in exactly those worlds.

	// RETIRED KEY: "peopleArtRebuildOffered". Superseded by bookArtRebuildOffered below, for the
	// same reason and by the same rule as the retirement above. Named here so it is not reused.

	// Whether the one-time "this book art can be rebuilt from pictures you already have" offer has
	// been made (hooks/Ready.js _offerBookArtRebuildOnce). World-scoped: it is a property of this
	// world's art folder, not of whoever happens to be logged in.
	//
	// A NEW key rather than reusing either of the two above, deliberately, and this is now the
	// THIRD time the same trap has come up. Each earlier flag was set the moment a world was
	// offered the work that existed THEN — detail portraits, then square faces — so reusing one
	// would latch every world that already answered shut against work that did not exist yet, and
	// the new pictures would silently never be cut. Nothing throws; the offer is simply never made.
	// Re-asking costs one card in the worlds that have new work; staying latched costs the feature
	// entirely. THE RULE: when this offer grows to cover a new kind of cut, mint a new key.
	//
	// Safe to re-ask: findWork returns falsy when there is nothing left to cut, so a world that
	// is already complete stays silent and never sets this at all.
	game.settings.register(SYSTEM_ID, "bookArtRebuildOffered", {
		name: "Book Art Rebuild Offered",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the one-time "your import did not finish — want to pick up the rest?" offer has been
	// made (hooks/Ready.js _offerPartialArtImportOnce). World-scoped like its siblings: it is a
	// property of this world's art folder, not of whoever is logged in.
	//
	// Unlike the rebuild above, saying yes needs the GM's PDFs again, because the missing pictures
	// were never extracted and nothing on disk can stand in for them. That is also why the offer
	// exists at all: a run that fails on some illustrations reports success, the failures scroll
	// past in the console, and what the GM is left with is a few entries that never got a picture
	// and no reason to connect the two.
	//
	// Safe to re-ask: findWork returns falsy for a complete import, so a world with nothing missing
	// stays silent and never sets this.
	game.settings.register(SYSTEM_ID, "partialArtImportOffered", {
		name: "Partial Art Import Offered",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the one-time "the GM playbook is a source too" offer has been made in this world
	// (hooks/Ready.js _offerGmPlaybookArtOnce). A world that imported before that PDF was wired in
	// has no way to learn it: the art it would add is BETTER copies of maps that already look
	// fine, plus two diagrams on a tab whose placeholder they may never open.
	//
	// Safe to re-ask, and the reason is the same as the partial import above: findWork returns
	// falsy for a world that already has the playbook art (and for one that has imported nothing
	// at all, which the "Import Your Book Art" nudge owns), so neither latches this.
	game.settings.register(SYSTEM_ID, "gmPlaybookArtOffered", {
		name: "GM Playbook Art Offered",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the one-time "you already have these poster maps — want them as Scenes?" offer
	// has been made in this world (hooks/WorldSetup.js offerPosterMapScenesOnce). The map
	// images live in the durable art folder, which outlives the world they were imported in,
	// so a brand-new world can find them waiting and rebuild the Scenes without a second PDF
	// import. World-scoped, and only set once the offer has ACTUALLY been made, so a GM who
	// supplies maps later still gets asked.
	game.settings.register(SYSTEM_ID, "posterMapScenesOffered", {
		name: "Poster Map Scenes Offered",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// The durable folder (a top-level data path, OUTSIDE the system folder) the "Import
	// Book Art" macro writes extracted illustrations to. Living outside systems/stonetop-pwd
	// is what keeps the art across a system update or reinstall; the runtime re-apply
	// (hooks/Ready.js -> book2-art/reapply.js) re-points documents at it after an update.
	game.settings.register(SYSTEM_ID, "book2ArtRoot", {
		name: "Book II Art Folder",
		scope: "world",
		config: false,
		type: String,
		// Shared with book2ArtRoot()'s fallback, so a world that never set this and a world
		// whose setting can't be read resolve art to the same folder.
		default: DEFAULT_BOOK2_ART_ROOT
	});

	// What a browse of that folder says sits in FRONT of it on this host, learned from a real
	// listing and published so clients that cannot browse can still resolve art.
	//
	// Empty on a self-hosted Foundry: the art folder is served straight out of the user data path,
	// so `<root>/assets/people/x.webp` is both the identity and the URL. Not empty where user files
	// live elsewhere — The Forge redirects a `data` upload into its Assets Library and serves it
	// from `https://assets.forge-vtt.com/<userId>/`, so the bare path 404s and every art index
	// computed by comparing the two comes out empty. Vendor-neutral by construction: the value is
	// whatever the host actually returned, never a hostname this system knows about.
	//
	// World-scoped because the People gallery and the treasure drop both run on PLAYER clients,
	// which have no way to browse and so no way to work this out for themselves.
	game.settings.register(SYSTEM_ID, "book2ArtPrefix", {
		name: "Book Art URL Prefix",
		scope: "world",
		config: false,
		type: String,
		default: ""
	});

	// Whether every Stonetop map pin wears its name, or waits for the cursor.
	//
	// ON by default, because the poster maps this system labels are the UNLABELLED printing of
	// artwork the books print labelled, and a name you have to go hunting for with a mouse is not
	// a name on a map. Off gives core's own behaviour back, which is the right answer for a table
	// that would rather look at the drawing, or one running a scene where the map is on screen
	// for its own sake.
	//
	// This is the DEFAULT rather than the whole answer: `mapPinNamesByMap` below overrides it per
	// poster map, and this is what every map without an override of its own follows, including
	// every scene that is not a poster map at all (a dungeon the GM drew, with site pins on it).
	//
	// Still one switch for every FAMILY of pin, though. The lettered discs, the place markers and
	// the threat/hazard/site pins share a treatment (the cream-on-pill label in
	// hooks/StonetopNoteLabels.js) and differ only in WHEN it shows, so a GM who wants a quieter
	// map wants a quieter map, not a quieter third of one.
	//
	// `config: false` because it is shown inside the Map Pin Names menu registered below, next to
	// the per-map rows it is the fallback for. Split across two places in the settings window, a
	// GM turning "always show names" off and watching one map ignore them would have no way to
	// see why.
	game.settings.register(SYSTEM_ID, "alwaysShowMapPinNames", {
		name: "stonetop.settings.alwaysShowMapPinNames.name",
		hint: "stonetop.settings.alwaysShowMapPinNames.hint",
		scope: "world",
		config: false,
		type: Boolean,
		default: true,
		onChange: () => applyMapPinLabelMode(),
	});

	// Per-map overrides of the switch above, as a { poster map slug -> boolean } map.
	//
	// SPARSE ON PURPOSE, and that is the whole design: a slug is present only once a GM has said
	// something about that map, so absent means "follow the world default" rather than "off". A
	// dense record of all five would freeze whatever the default happened to be on the day the
	// setting was first written, and a GM who later flipped the default would watch every map
	// ignore it.
	//
	// Keyed by SLUG rather than Scene id, so the answer survives deleting a poster map's Scene
	// and building it again from the same artwork, which the ready-flow offer does routinely.
	// It is the same shape and the same keys as `regionalMapMarkers`, for the same reason.
	//
	// Only the five poster maps are switchable. Every other scene follows the world default,
	// because there is nothing to list it under: this is a settings menu, not a per-scene sheet,
	// and a world can hold any number of scenes with our pins on them.
	game.settings.register(SYSTEM_ID, "mapPinNamesByMap", {
		name: "Map Pin Names By Map",
		scope: "world",
		config: false,
		type: Object,
		default: {},
		onChange: () => applyMapPinLabelMode(),
	});

	game.settings.registerMenu(SYSTEM_ID, "mapPinNameSettings", {
		name: "stonetop.settings.mapPinNameSettings.name",
		label: "stonetop.settings.mapPinNameSettings.label",
		hint: "stonetop.settings.mapPinNameSettings.hint",
		icon: "fas fa-map-signs",
		type: _createMapPinNameSettingsApp(),
		// World-scoped, so only a GM can write it. An unrestricted menu would open for players
		// and then throw on save, which is worse than not offering it.
		restricted: true,
	});

	// Which poster maps have had their named-place markers laid down, as a { map slug -> keys }
	// map. Per MAP rather than one flag for the set, and that is the whole point of the shape:
	// the Scenes can arrive years apart (a GM who imported the Vicinity, then the World's End
	// with the next book), and a single latch would have marked whichever existed first and left
	// the others bare forever.
	//
	// The KEY still says "regional" because it is already written into every world that has run
	// this pass, and it covered exactly the regional maps when it was named. Renaming it would
	// orphan every record, which reads as "nothing has ever been marked here" and re-lays every
	// pin the GM has since deleted on purpose.
	//
	// Latched at all, rather than re-checked every load, for the same reason
	// `landmarkNotesRevealed` is: after the first pass a GM who DELETES a marker meant it —
	// a place the party has not found yet, or a name they would rather write themselves — and a
	// pass that puts it back on every reload is arguing with them. A slug is recorded only once
	// a Scene for that map has actually been visited, so a map with no Scene yet, or one whose
	// picture the positions do not fit, stays pending rather than being written off.
	game.settings.register(SYSTEM_ID, "regionalMapMarkers", {
		name: "Regional Map Markers Placed",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// Which Book II treasures have their illustration on disk under `book2ArtRoot`, as a
	// { catalog slug -> path within the art folder } map (module/data/treasure-catalog.js).
	// Unlike every other kind of book art, a treasure is not a document: its Item is built
	// the moment a player drags the line off a journal, so there is nothing to write art
	// onto ahead of time. This index is the answer to "does this world have art for that
	// treasure, and where?" — the GM-side passes (the Import Book Art macro and
	// book2-art/reapply.js) browse the folder and publish it here, and treasure-drops.js
	// reads it synchronously when building the drop. World-scoped so players (who cannot
	// browse files) get it broadcast like any setting.
	game.settings.register(SYSTEM_ID, "treasureArt", {
		name: "Treasure Art On Disk",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// Which of the GM playbook's flowcharts have been extracted to disk under `book2ArtRoot`, as a
	// { diagram slug -> path within the art folder } map. The same shape and the same reason as
	// `treasureArt`: nothing in any compendium points at these two pictures, so the only way the
	// GM Toolkit's Core Loop tab can tell "imported" from "not imported" is to read an index the
	// GM-side passes publish. World-scoped like the rest, though this one is read only on a GM's
	// own sheet — a broadcast setting costs nothing and keeps the four indexes alike.
	game.settings.register(SYSTEM_ID, "gmDiagramArt", {
		name: "GM Playbook Diagrams On Disk",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// Which "People of Stonetop" portraits have their illustration on disk under `book2ArtRoot`,
	// as a { manifest out path -> display name } map. Like a treasure, a resident/neighbor
	// portrait points at no document: the steading sheet's image gallery reads this broadcast
	// index so even players (who cannot browse files) can pick from it. The GM-side passes (the
	// Import Book Art macro and book2-art/reapply.js) browse the folder and publish it here.
	// World-scoped so it reaches every client like any setting.
	game.settings.register(SYSTEM_ID, "peopleArt", {
		name: "People Art On Disk",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// Which of those portraits also have their hand-authored SQUARE face on disk, as a
	// { illustration out path -> square out path } map. A SECOND index rather than richer values
	// in `peopleArt`, deliberately: that setting's shape is `{ out -> name }` in every world that
	// already has one, and consumers join the two by `out`, so nothing needs migrating and a
	// world whose GM has not re-run the rebuild simply has no entries here and keeps offering the
	// whole illustration. Same publishers as `peopleArt`.
	game.settings.register(SYSTEM_ID, "peoplePortraitArt", {
		name: "People Square Portraits On Disk",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// The system version whose Book II art was last re-applied to the compendia. When
	// this trails the running version, the re-apply pass re-points documents at the
	// durable art on disk and records the new version here (see book2-art/reapply.js).
	game.settings.register(SYSTEM_ID, "book2ArtSyncVersion", {
		name: "Book II Art Sync Version",
		scope: "world",
		config: false,
		type: String,
		default: ""
	});

	// Whether the GM has dismissed the "first session" Welcome guide's automatic
	// pop-up (see dialogs/WelcomeDialog.js). While false, the guide opens for the
	// GM on every world load; ticking "Don't show this automatically" sets it true.
	game.settings.register(SYSTEM_ID, "gmWelcomeShown", {
		name: "GM Welcome Guide Dismissed",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Which session-zero walkthroughs THIS world has finished (Character Introductions
	// and Let Spring Burst Forth). Set when a walkthrough's final button is pressed;
	// once both are true the Welcome guide stops auto-opening (sessionZeroComplete in
	// dialogs/walkthrough-resume.js). World-scoped on purpose: "has this world finished
	// its first session" is world state, so a fresh world starts over — unlike the
	// client-scoped `walkthroughResume` below, which would leak completion across every
	// world opened in the same browser. Shape: { introductions: <bool>, springBurst: <bool> }.
	game.settings.register(SYSTEM_ID, "sessionZeroDone", {
		name: "Session Zero Walkthroughs Complete",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// Answers the GM records in the "Let spring burst forth" walkthrough (see
	// dialogs/SpringBurstDialog.js) — the first-session notes that have no document
	// of their own (who's most hopeful, the season's chosen gain/hook, and what
	// excites each player about their PC). Shape: { hopeful, gain, excites: { <actorId>: text } }.
	game.settings.register(SYSTEM_ID, "springBurstAnswers", {
		name: "Let Spring Burst Forth Answers",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// Answers recorded in the guided Character Introductions (see
	// dialogs/IntroductionsDialog.js) — what each PC established about themselves and
	// Stonetop. GM-written (only a GM can write a world setting): the GM types the
	// narration rounds and HARVESTS each player's own `flags.stonetop-pwd.intro` flag
	// (the player-driven answer/ask steps) into here for the Chronicle. Compiled into the
	// shared "Chronicle" journal (utils/chronicle.js). Shape, keyed by actor id:
	//   { <actorId>: {
	//       r1, r2, r3: "<text>",                    // narration rounds (GM-typed)
	//       step4: { answers: [ { q: <questionIndex>, a: "<text>" }, … ], passed: <bool> },
	//       step6: { answers: [ { q, a }, … ], passed: <bool> },   // ask step
	//       r4..r7: { q, a }                          // LEGACY single-answer rounds, read-only
	//   } }
	// step4 folds the old r4/r5 "answer" rounds into one looping step (up to 4 answers,
	// one per playbook question); step6 folds r6/r7. The compiler reads both the step
	// lists and the legacy r4–r7 keys, so already-run worlds keep compiling unchanged.
	game.settings.register(SYSTEM_ID, "introductionsAnswers", {
		name: "Character Introductions Answers",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// GM-driven session cursor for the guided Character Introductions — whose turn it is
	// and which step (see dialogs/IntroductionsDialog.js). Only the PRIMARY GM writes it;
	// every client reacts through this registered onChange (which fires on all clients, GM
	// and player, on the first write too — unlike Hooks.on("updateSetting")) to open/focus/
	// close the dialog on the active player's screen. `nonce` bumps on every write so a
	// Back-to-the-same-step still fires onChange (Foundry suppresses equal-value writes).
	// `pcOrder` is the GM-authored turn order (actor ids) so players seed their roster from
	// the cursor rather than their own scene-scoped game.combat. Shape:
	//   { active: <bool>, phase: <0-6>, activeActorId: "<id>",
	//     activeUserId: "<owning player's user id>", pcOrder: [ "<id>", … ], nonce: <int> }.
	game.settings.register(SYSTEM_ID, "introCursor", {
		name: "Character Introductions Cursor",
		scope: "world",
		config: false,
		type: Object,
		default: { active: false, phase: 0, activeActorId: "", activeUserId: "", pcOrder: [], nonce: 0 },
		onChange: value => game.stonetop?.onIntroCursor?.(value),
	});

	// Notes the GM records in the Expedition walkthrough (see dialogs/ExpeditionDialog.js).
	// Expeditions recur, so this is a growing log of trips, each compiled into its own
	// "Expedition: …" page in the shared Chronicle (utils/chronicle-core.js). Shape:
	//   { currentId: "<id>",                     // the trip the dialog is editing
	//     list: [ { id, title, createdAt,
	//               journey: { origin, destination },  // slugs into module/data/travel-times.js
	//               chart: { route, checks: { warmClothes: true }, notes },
	//               outfit, requisition, prep, running,   // single-text step notes
	//               home: { checks, notes } }, … ] }      // oldest trip first
	// Only the two journey SLUGS are stored, never the solved route: the travel graph is frozen
	// compile-time data, so recomputing costs nothing and there is no snapshot to go stale.
	game.settings.register(SYSTEM_ID, "expeditionAnswers", {
		name: "Expedition Walkthrough Notes",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// The system-macro hotbar layout version this client has been snapped to (see
	// hooks/Ready.js _SYSTEM_MACROS / _reorderSystemMacros). Bumping _HOTBAR_LAYOUT_VERSION
	// re-snaps the system macros into their new canonical slots once, then leaves the
	// GM's own arrangement alone again. Per-client because the hotbar is per-user;
	// starts at 0 so a fresh world (and any pre-versioning world) arranges on first load.
	game.settings.register(SYSTEM_ID, "systemHotbarLayoutVersion", {
		name: "System Hotbar Layout Version",
		scope: "client",
		config: false,
		type: Number,
		default: 0
	});

	// Optional FXMaster integration: when the GM posts a weather from the picker, put the
	// matching particles on the scene the table is on (module/seasons/weather-fx.js).
	//
	// Registered whether or not FXMaster is installed, because a setting cannot be added later
	// in the load without the world's saved value being read before it exists. The hint says
	// what it needs; without the module the toggle is simply inert, which is cheaper than a
	// config screen that changes shape depending on what else is installed.
	//
	// Default ON. It only ever fires on an explicit "Post the weather", it writes nothing but
	// its own keys, and a GM who has FXMaster and rolls Stonetop's weather is the person this
	// was built for. Off leaves the canvas entirely alone.
	//
	// The Weather picker shows this same switch as a Pause button (dialogs/WeatherDialog.js),
	// which is where a GM will actually reach for it: mid-session, with a blizzard on the map.
	// ONE setting behind both, so "why is nothing happening on the map" has one answer. The
	// button does the extra half a checkbox cannot: it takes what is already falling off the
	// scene on the way down, and puts the world's current sky back on the way up.
	// The key comes from the same leaf the seven parts below it come from, and NOT from a literal
	// here: weather-fx.js reads it through `WEATHER_FX_SETTING`, and a rename that touched only one
	// of the two failed in the worst direction there is — the box still on the settings screen and
	// ticked, `getSetting` answering undefined, `weatherFxPaused` reading that as paused, and the
	// canvas weather simply dead with nothing anywhere to say why.
	// The KEY comes from the constant; the two i18n strings stay literals, because the registration
	// suite greps this file for them to find en.json entries nothing declares.
	game.settings.register(SYSTEM_ID, WEATHER_FX_SETTING, {
		name: "stonetop.settings.weatherSceneFx.name",
		hint: "stonetop.settings.weatherSceneFx.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
		onChange: reconcileWeatherFx,
	});

	// The parts of the sky, one switch each, sitting directly under the main one: a table that
	// cannot stand the fog can put the fog out and keep the rain. Registered in a loop off
	// WEATHER_FX_PARTS in that table's own order, which IS the order they appear in Configure
	// Settings, so the seven read as a block under the switch they hang off rather than as seven
	// unrelated checkboxes. Their names and hints are derived from the key for the same reason:
	// a row added to the table is a row on the screen, with nothing here to keep in step.
	//
	// Default ON, every one. Off is a thing a table asks for, and the world that has never been
	// asked gets the whole sky.
	for (const part of WEATHER_FX_PARTS) {
		game.settings.register(SYSTEM_ID, part.setting, {
			name: `stonetop.settings.${part.setting}.name`,
			hint: `stonetop.settings.${part.setting}.hint`,
			scope: "world",
			config: true,
			type: Boolean,
			default: true,
			onChange: reconcileWeatherFx,
		});
	}

	// The season last picked in the Weather roll dialog (see dialogs/WeatherDialog.js),
	// so it reopens to where the GM left off. Client-scoped — it's a GM convenience,
	// not shared world state.
	//
	// `{ key, for }`: the WEATHER_SEASONS key picked, and the campaign season (a SEASON_IDS
	// key, or null in a world with no Seasons Change stamped) it was picked under. The pair
	// is what lets the steading's clock take over the moment the season turns while still
	// honouring a deliberate pick within a season — see defaultWeatherSeason in utils/weather.js.
	// Untyped rather than Object so the bare-string value written by builds before the pairing
	// survives the upgrade; the resolver reads both shapes.
	game.settings.register(SYSTEM_ID, "weatherSeason", {
		name: "Weather Roll Season",
		scope: "client",
		config: false,
		default: {}
	});

	// Reload-resume state for the GM walkthroughs — the session-zero pair (Character
	// Introductions, Let Spring Burst Forth) and Run an Expedition (see
	// dialogs/walkthrough-resume.js). The dialogs don't
	// survive a browser refresh, so each records where it is and whether it's open, and
	// hooks/Ready.js reopens any that were still open at the page they were on. Client-
	// scoped because this is per-user, local UI state (which browser had a dialog open).
	// Completion lives in the world-scoped `sessionZeroDone` setting above instead, so it
	// doesn't leak across worlds. Records are keyed by world id (this client blob would
	// otherwise reopen an open dialog in every world opened in this browser; see
	// walkthrough-resume.js). Shape:
	//   { "<worldId>": {
	//       introductions: { open: <bool>, phase: <0-8>, pcIndex: <int> },
	//       springBurst:   { open: <bool>, step: <int>, delegated: <bool> },
	//       expedition:    { open: <bool>, step: <int> } } }
	game.settings.register(SYSTEM_ID, "walkthroughResume", {
		name: "Walkthrough Resume State",
		scope: "client",
		config: false,
		type: Object,
		default: {}
	});

	// -- CLIENT SPECIFIC SETTINGS --------------------------------

	// Which worlds this user has had the Setting Overview journal auto-opened in (see
	// hooks/Ready.js). Per-client so each player gets the fresh-start orientation the first
	// time they connect, GM included, without re-popping every load.
	//
	// Keyed by world id, NOT a bare boolean. Client settings live in browser localStorage
	// under namespace.key alone, so a flat `true` leaked across worlds: open a second world
	// in the same browser and the gate read already-set, and nobody who had seen the
	// Overview once ever got their new world's orientation. Same fix, and same reason, as
	// the world-keyed `walkthroughResume` below. Shape: { "<worldId>": true }.
	// A legacy flat `true` is folded under the current world by migrateFlatSettingOverviewShown.
	game.settings.register(SYSTEM_ID, "settingOverviewShown", {
		name: "Setting Overview Shown",
		scope: "client",
		config: false,
		type: Object,
		default: {}
	});

	// NB: the GM-steading auto-assignment once-gate is NOT a setting — it's a per-user
	// WORLD flag on the GM's own User document (see hooks/Ready.js
	// _assignSteadingToUnassignedGm). It used to be a client-scoped setting here, but those
	// live in browser localStorage keyed only by namespace.key, so the flag leaked across
	// worlds and a fresh world read it already-set — silently skipping the assignment.

	game.settings.register(SYSTEM_ID, "sheetFont", {
		name: "stonetop.settings.sheetFont.name",
		hint: "stonetop.settings.sheetFont.hint",
		scope: "client",
		config: true,
		type: String,
		choices: {
			"libre-caslon":   "stonetop.settings.sheetFont.libreCaslon",
			"im-fell-english": "stonetop.settings.sheetFont.imFellEnglish",
			"signika":         "stonetop.settings.sheetFont.signika",
		},
		// Shared with applySheetFont's fallback (see _DEFAULT_FONT) so "the default font"
		// means one thing.
		default: _DEFAULT_FONT,
		onChange: value => applySheetFont(value),
	});

	game.settings.register(SYSTEM_ID, "sheetFontScale", {
		name: "stonetop.settings.sheetFontScale.name",
		hint: "stonetop.settings.sheetFontScale.hint",
		scope: "client",
		config: true,
		type: String,
		choices: {
			"0.9":  "stonetop.settings.sheetFontScale.smaller",
			"1":    "stonetop.settings.sheetFontScale.normal",
			"1.1":  "stonetop.settings.sheetFontScale.large",
			"1.25": "stonetop.settings.sheetFontScale.larger",
			"1.4":  "stonetop.settings.sheetFontScale.largest",
		},
		default: "1",
		onChange: value => applySheetFontScale(value),
	});

	// CLASSIC vs MODERN sheet layout: the table's answer, one person's override of it, and
	// one toggle per sheet.
	//
	// MODERN is what ships: the vertical icon tab rail hung off the window's edge, the
	// character's stat block at the head of its Moves tab, the steading's stat band at the
	// head of Overview with its homefront moves on a tab of their own, and the NPC's quick
	// facts inside Details. CLASSIC is the layout before that: a horizontal text tab strip
	// inside the sheet body, with each of those blocks pinned above it.
	//
	// `worldSheetLayout` is the table's answer, and the one the chat card's buttons flip. It
	// defaults to MODERN, which is what a world created on this release gets. A world that
	// already existed when the redesign landed is stamped CLASSIC on its first load instead,
	// so nobody's sheets rearrange themselves under them mid-campaign — see
	// utils/sheet-layout.js, which also whispers the GM the offer to try the new one.
	//
	// `sheetLayout` is one person's override of that, defaulting to "world" (follow the
	// table). It has to be a tri-state rather than a checkbox, because a client setting lives
	// in browser localStorage keyed only by namespace.key and so is SHARED by every world on
	// this browser (the same trap settingOverviewShown documents above). A boolean here would
	// mean a GM running an old campaign and a new one on one browser could not have classic
	// in the first and modern in the second: whichever world they opened last would win. Only
	// an explicit override lives per browser; the real answer lives per world.
	//
	// Effective classic for a sheet is then `<resolved master> && classicLayout<Sheet>` (see
	// isClassicLayout below). A modern master is modern everywhere however the children are
	// set; a classic master is classic on every sheet whose own box is still ticked. That is
	// why the children default TRUE: one flip brings the whole old layout back, and nothing
	// moves for anyone who never opens the settings window.
	//
	// The Monster sheet has no tabs and never took part in the redesign, so it gets no toggle.
	game.settings.register(SYSTEM_ID, "worldSheetLayout", {
		name: "stonetop.settings.worldSheetLayout.name",
		hint: "stonetop.settings.worldSheetLayout.hint",
		scope: "world",
		config: true,
		type: String,
		choices: {
			"modern":  "stonetop.settings.worldSheetLayout.modern",
			"classic": "stonetop.settings.worldSheetLayout.classic",
		},
		default: "modern",
		onChange: () => _rerenderActorSheets(),
	});

	// Whether this world's layout has been answered once (see stampWorldLayoutBaseline).
	// Stamped on the first GM load after the redesign shipped, fresh world or not, so the
	// stamp never runs twice and can never overwrite a choice the GM has since made.
	game.settings.register(SYSTEM_ID, "worldSheetLayoutChosen", {
		name: "World Sheet Layout Chosen",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// Whether the "your sheets stayed classic, here is how to try the new ones" card has been
	// whispered to this world's GMs. Its own flag rather than riding on the stamp above: chat
	// is not always up that early in a load, and that card is the only notice an upgraded
	// table ever gets that the modern layout exists, so a lost one has to be re-offered.
	game.settings.register(SYSTEM_ID, "classicLayoutNoticeShown", {
		name: "Classic Layout Notice Shown",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});

	// The id of that card, so every later flip EDITS it instead of posting another one. There is
	// exactly one layout card in a world's chat log at a time and it always shows the layout
	// currently in force; flipping back and forth would otherwise leave a trail of cards, most
	// of them describing a state the table left. Empty until the card is first posted, and
	// re-filled if it is ever deleted. See utils/sheet-layout.js showLayoutCard.
	game.settings.register(SYSTEM_ID, "layoutCardId", {
		name: "Sheet Layout Card Message Id",
		scope: "world",
		config: false,
		type: String,
		default: ""
	});

	// RETIRED KEY: "classicLayout". This is the same switch, re-registered as the tri-state
	// described above rather than the boolean it started as. It never shipped, so no world is
	// carrying a value that needs migrating, but a browser that ran a pre-release build still
	// holds one in localStorage (client settings outlive their registration there) — so the
	// name is named here rather than reused, and _classicMaster reads any unrecognized value
	// as "follow the world".
	game.settings.register(SYSTEM_ID, "sheetLayout", {
		name: "stonetop.settings.sheetLayout.name",
		hint: "stonetop.settings.sheetLayout.hint",
		scope: "client",
		config: true,
		type: String,
		choices: {
			"world":   "stonetop.settings.sheetLayout.world",
			"modern":  "stonetop.settings.sheetLayout.modern",
			"classic": "stonetop.settings.sheetLayout.classic",
		},
		default: "world",
		onChange: () => _rerenderActorSheets(),
	});

	// The three per-sheet boxes are WORLD, for the reason `sheetLayout` above is a tri-state and
	// not a checkbox: a client setting lives in browser localStorage keyed only by namespace.key,
	// so a boolean one is shared by every world on that browser. Registered as client, these were
	// exactly the trap that comment warns about — a GM running an upgraded campaign and a new one
	// side by side who unticked "Classic Layout: NPC Sheets" in the second silently took the first
	// one's NPC sheets modern too, with no setting anywhere that could let the two differ. Pressing
	// "Go Back to the Classic Layout" in either world re-ticked the box for both.
	//
	// They belong with the master they qualify: effective classic is `<world master> && <this box>`,
	// so both halves are the table's answer. The per-person escape hatch is `sheetLayout`, which
	// stays client-scoped and still overrides the lot. Only a GM writes these, which the one caller
	// (utils/sheet-layout.js setWorldSheetLayout) already gates on.
	game.settings.register(SYSTEM_ID, "classicLayoutCharacter", {
		name: "stonetop.settings.classicLayoutCharacter.name",
		hint: "stonetop.settings.classicLayoutCharacter.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
		onChange: () => _rerenderActorSheets(),
	});

	game.settings.register(SYSTEM_ID, "classicLayoutSteading", {
		name: "stonetop.settings.classicLayoutSteading.name",
		hint: "stonetop.settings.classicLayoutSteading.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
		onChange: () => _rerenderActorSheets(),
	});

	game.settings.register(SYSTEM_ID, "classicLayoutNpc", {
		name: "stonetop.settings.classicLayoutNpc.name",
		hint: "stonetop.settings.classicLayoutNpc.hint",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
		onChange: () => _rerenderActorSheets(),
	});

	// How long you must hover a section before its edit pencil fades in (seconds).
	// Drives the --st-edit-reveal-delay CSS variable. The pencils stay clickable
	// while still invisible, so this only affects when they become visible.
	game.settings.register(SYSTEM_ID, "editPencilRevealDelay", {
		name: "stonetop.settings.editPencilRevealDelay.name",
		hint: "stonetop.settings.editPencilRevealDelay.hint",
		scope: "client",
		config: true,
		type: Number,
		range: { min: 0, max: 3, step: 0.1 },
		default: 1,
		onChange: value => applyEditPencilRevealDelay(value),
	});

	// NO "HIDE ROLLABLE ICON" SETTING. It used to sit here, between the pencil delay and the
	// roll-mode switch, and it hid the dice icon on move rows and stat rows. Both icons are
	// gone outright: a move is rolled by its TITLE and a stat by its whole CELL, so the switch
	// had nothing left to hide but the labels themselves. A registered setting that changes
	// nothing is worse than no setting — it reads as a promise the sheet does not keep.
	//
	// Nothing needs cleaning up on a world that had it set: an unregistered client setting is
	// simply never read again, and the root class it drove is no longer applied by anything.

	// WHERE advantage and disadvantage are chosen, and it is one place or the other.
	//
	// OFF (the default) is how the system shipped for most of its life: a sticky Advantage /
	// Normal / Disadvantage selector on the character sheet's Moves sidebar and on the
	// steading's Homefront Moves, written to a flag on the actor and applying to every roll
	// until it is put back. ON hides both selectors and asks in the pre-roll window instead,
	// which starts at Normal every time (module/dialogs/RollDialog.js) — a question that is
	// asked cannot be forgotten, at the price of a window on every roll.
	//
	// Per-client, because it decides what THIS user's sheets draw and what THIS user's clicks
	// open. The mode itself stays a flag on the actor, so a table can mix the two safely: the
	// window's answer overrides the selector for that one roll and never writes to it.
	game.settings.register(SYSTEM_ID, "askRollModeEachRoll", {
		name: "stonetop.settings.askRollModeEachRoll.name",
		hint: "stonetop.settings.askRollModeEachRoll.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: false,
		// The selectors are rendered, so turning this on or off has to repaint the sheets that
		// carry them — otherwise the control the setting just hid stays on screen and writable.
		onChange: () => _rerenderActorSheets(),
	});

	// Prompt for a one-off situational modifier before each 2d6 move/stat roll on the
	// character sheet (a held bonus, a GM-granted +1, etc.). Read at roll time (RollDialog.js);
	// Shift-clicking the roll skips the prompt.
	//
	// Only consulted when the window is not already opening for the mode: "Ask How to Roll
	// Each Time" carries the stepper with it. So both off is no window at all, this one alone
	// is the stepper alone, and the other one is both halves whatever this says.
	game.settings.register(SYSTEM_ID, "promptRollModifier", {
		name: "stonetop.settings.promptRollModifier.name",
		hint: "stonetop.settings.promptRollModifier.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: false,
	});

	// Open actor sheets (character / steading / monster / NPC) in Edit mode instead of
	// Play mode. Read once when the sheet is constructed; the header wrench still
	// toggles modes per-sheet afterward. The NPC sheet additionally requires ownership
	// (a non-owner has nothing to edit), so it opens in Play mode for everyone else.
	game.settings.register(SYSTEM_ID, "openSheetsInEditMode", {
		name: "stonetop.settings.openSheetsInEditMode.name",
		hint: "stonetop.settings.openSheetsInEditMode.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: false,
	});

	// Reopen the document sheets (characters, steadings, monsters, NPCs, items, journals)
	// this user had open when they reload, at the same position and size. Per-client
	// because window layout is personal, not shared world state. Defaults on. The
	// live tracking + restore lives in utils/window-restore.js.
	game.settings.register(SYSTEM_ID, "restoreWindowsOnReload", {
		name: "stonetop.settings.restoreWindowsOnReload.name",
		hint: "stonetop.settings.restoreWindowsOnReload.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
	});

	// Snapshot of the sheets this user had open at last reload, keyed by document
	// uuid -> { left, top, width, height, minimized, tabs, editMode } (see
	// utils/window-restore.js).
	// Internal (not shown in the settings menu); rewritten continuously as windows
	// open, close, and move.
	game.settings.register(SYSTEM_ID, "openWindowsState", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Strip the decorative animations, transitions, and hover-zoom image popups
	// from Stonetop UI for users who find them distracting or are motion-sensitive.
	// Drives the `stonetop-reduce-motion` root class.
	game.settings.register(SYSTEM_ID, "reduceMotion", {
		name: "stonetop.settings.reduceMotion.name",
		hint: "stonetop.settings.reduceMotion.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: false,
		onChange: value => applyReduceMotion(value),
	});

	// Superseded by "sheetSizes" below, which remembers height as well and covers every
	// actor sheet rather than just the character. Still registered, and still READ as a
	// fallback, so a user who had a width remembered here keeps it — the value moves over
	// the first time they resize. Nothing writes to it any more.
	game.settings.register(SYSTEM_ID, "characterSheetWidths", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Remembers each actor sheet's SIZE so it reopens as the user last left it — character,
	// steading, monster and NPC alike. Per-user (client) and per-actor: a map of actor id ->
	// {width, height}. Actor ids are unique across types, so one map serves them all.
	// Internal (not shown in the settings menu).
	game.settings.register(SYSTEM_ID, "sheetSizes", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Remembers which collapsible crew follower sections (Inventory / Roster /
	// Group Fight) each character left expanded, so the sheet reopens in the same
	// state. Per-user (client) and per-actor: a map of actor id -> array of open
	// section ids. Internal (not shown in the settings menu).
	game.settings.register(SYSTEM_ID, "crewSectionsOpen", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Remembers which sidebar move groups (Basic Moves / Expedition Moves) each
	// character left collapsed, so the sheet reopens in the same state. These
	// default to expanded, so we store the *collapsed* ids (absence = open).
	// Per-user (client) and per-actor: a map of actor id -> array of collapsed
	// section ids. Internal (not shown in the settings menu).
	game.settings.register(SYSTEM_ID, "movesSectionsCollapsed", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Remembers which Arcana sections (Major / Minor arcanum) each character left
	// collapsed, so the sheet reopens in the same state. These default to expanded,
	// so we store the *collapsed* ids (absence = open). Per-user (client) and
	// per-actor: a map of actor id -> array of collapsed section ids. Internal.
	game.settings.register(SYSTEM_ID, "arcanaSectionsCollapsed", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Remembers which reverse-side arcanum content sections (e.g. "Consequences") each
	// character left EXPANDED. Unlike the Major / Minor sections above, these default to
	// COLLAPSED — they're long, secondary reference — so we store the *expanded* ids
	// (absence = collapsed). Per-user (client) and per-actor: a map of actor id -> array
	// of expanded section ids. Internal (not shown in the settings menu).
	game.settings.register(SYSTEM_ID, "arcanaContentExpanded", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Remembers which individual arcanum CARDS each character left collapsed (clamped to
	// just their title bar). Like the Major / Minor sections, cards default to EXPANDED, so
	// a card id (its slug) present here means that card should reopen collapsed. Per-user
	// (client) and per-actor: a map of actor id -> array of collapsed card slugs. Internal.
	game.settings.register(SYSTEM_ID, "arcanaCardsCollapsed", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Remembers which gear rows each character left with their write-up UNFOLDED. A Book II
	// treasure arrives carrying the book's whole printed sidebar (data/treasure-catalog.js),
	// which is several paragraphs down a column whose other rows are one line each, so the
	// write-up folds away and the row rests at what the book prints in the margin: the name
	// and the tags beside it. Like arcanaContentExpanded above, the fold defaults SHUT, so
	// this is the EXPANDED list — an id present here means that row reopens showing its
	// write-up. Keyed by the owned Item's id, which is what the row carries. Per-user
	// (client) and per-actor: a map of actor id -> array of item ids. Internal.
	game.settings.register(SYSTEM_ID, "inventoryLoreExpanded", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Remembers which sheet sections each actor's viewer folded shut with the heading
	// caret (the one beside the section edit pencil) — character AND steading, keyed by
	// the caret's own collapse id rather than the edit-section id, since two groups can
	// share one edit section. Sections default to expanded, so we store the *collapsed*
	// ids (absence = open). Per-user (client) and per-actor: a map of actor id -> array
	// of collapsed section ids. Internal (not shown in the settings menu).
	game.settings.register(SYSTEM_ID, "sheetSectionsCollapsed", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	// Remembers whether each character left the whole moves sidebar (Roll Modifier
	// + Basic / Expedition move lists) collapsed, so the sheet reopens the same way.
	// The sidebar defaults to expanded. Per-user (client) and per-actor: a map of
	// actor id -> boolean. Internal (not shown in the settings menu).
	game.settings.register(SYSTEM_ID, "characterSidebarCollapsed", {
		scope: "client",
		config: false,
		type: Object,
		default: {},
	});

	game.settings.register(SYSTEM_ID, "showRollStatChips", {
		name: "stonetop.settings.showRollStatChips.name",
		hint: "stonetop.settings.showRollStatChips.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
		onChange: () => _rerenderActorSheets(),
	});

	game.settings.register(SYSTEM_ID, "showMoveDescriptionsInChat", {
		name: "stonetop.settings.showMoveDescriptionsInChat.name",
		hint: "stonetop.settings.showMoveDescriptionsInChat.hint",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
		onChange: value => applyMoveDescriptionBodyClass(value),
	});

	game.settings.register(SYSTEM_ID, "hoverDescriptionsEnabled", {
		name: "stonetop.settings.hoverDescriptionsEnabled.name",
		hint: "stonetop.settings.hoverDescriptionsEnabled.hint",
		scope: "client",
		config: false,
		type: Boolean,
		default: true,
	});

	for (const key of HOVER_DESCRIPTION_SETTING_KEYS) {
		game.settings.register(SYSTEM_ID, key, {
			name: `stonetop.settings.${key}.name`,
			hint: `stonetop.settings.${key}.hint`,
			scope: "client",
			config: false,
			type: Boolean,
			default: true,
		});
	}

	game.settings.registerMenu(SYSTEM_ID, "hoverDescriptionSettings", {
		name: "stonetop.settings.hoverDescriptionSettings.name",
		label: "stonetop.settings.hoverDescriptionSettings.label",
		hint: "stonetop.settings.hoverDescriptionSettings.hint",
		icon: "fas fa-info-circle",
		type: _createHoverDescriptionSettingsApp(),
		restricted: false,
	});
}

export const HOVER_DESCRIPTION_SETTING_KEYS = [
	"hoverDescriptionsStats",
	"hoverDescriptionsBasicMoves",
	"hoverDescriptionsPlaybookMoves",
	"hoverDescriptionsTraits",
	"hoverDescriptionsGearTags",
	"hoverDescriptionsMonsterRefs",
	"hoverDescriptionsInvocations",
	"hoverDescriptionsVitals",
	"hoverDescriptionsMonsterTags",
	"hoverDescriptionsSteadingStats",
	"hoverDescriptionsValues",
	"hoverDescriptionsDebilities",
	// The two below are what make `hoverDescriptionsEnabled` a true master switch. Both
	// were previously ungated, so turning every listed toggle off still left cross-link
	// summaries hovering in journals, on sheets and in the session-zero dialogs.
	"hoverDescriptionsJournalLinks",
	"hoverDescriptionsLoreTerms",
];

/**
 * A settings SUBMENU application, from the four things that actually differ between them.
 *
 * Every one of these is the same window: 520 wide, height to content, resizable, closing on
 * submit, rendering one template under `templates/settings/` and writing what it collected. Only
 * the id, the title, the template and the two data methods are the menu's own, so only those are
 * asked for.
 *
 * The template path is built from SYSTEM_ID rather than written out. Two of these used to hard-
 * code `systems/stonetop-pwd/...` and one did not, which is exactly the kind of disagreement a
 * package rename turns into a blank window with nothing logged.
 *
 * `classes` CARRIES "stonetop", which is what dresses the window: the header bar, the content
 * background, the focus glow and `--stonetop-font-scale` are all scoped to that class on purpose.
 * `FormApplication` contributes only `["form"]` and nothing adds ours at runtime — the one
 * `classList.add("stonetop")` in the system is for actor sheets — so a menu without it opened in
 * core's dark chrome while its own form rules still applied, which reads as half-styled rather
 * than unstyled and is easy to live with without noticing. The id rides along as the second class
 * so a menu can still be reached on its own for anything particular to it.
 */
function _createSettingsMenuApp({ id, titleKey, template, getData, update }) {
	return class StonetopSettingsMenuApp extends FormApplication {
		static get defaultOptions() {
			const base = super.defaultOptions;
			return foundry.utils.mergeObject(base, {
				id,
				// SPREAD RATHER THAN LISTED, because `mergeObject` REPLACES an array where it
				// merges an object: writing the two names out would quietly drop core's own `form`
				// class, which is what its field and button layout hangs off.
				classes: [...(base.classes ?? []), "stonetop", id],
				title: game.i18n.localize(titleKey),
				template: `systems/${SYSTEM_ID}/templates/settings/${template}`,
				width: 520,
				height: "auto",
				resizable: true,
				closeOnSubmit: true,
			});
		}

		async getData() { return getData(); }

		async _updateObject(_event, formData) { return update(formData); }
	};
}

function _createHoverDescriptionSettingsApp() {
	return _createSettingsMenuApp({
		id: "stonetop-hover-description-settings",
		titleKey: "stonetop.settings.hoverDescriptionSettings.title",
		template: "hover-descriptions.hbs",
		getData: () => ({
			enabled: getSetting("hoverDescriptionsEnabled"),
			settings: HOVER_DESCRIPTION_SETTING_KEYS.map(key => ({
				key,
				name: game.i18n.localize(`stonetop.settings.${key}.name`),
				hint: game.i18n.localize(`stonetop.settings.${key}.hint`),
				enabled: getHoverDescriptionSetting(key, { ignoreMaster: true }),
			})),
		}),
		update: async (formData) => {
			await setSetting("hoverDescriptionsEnabled", !!formData.hoverDescriptionsEnabled);
			for (const key of HOVER_DESCRIPTION_SETTING_KEYS) {
				await setSetting(key, !!formData[key]);
			}
			_rerenderActorSheets();
		},
	});
}

/**
 * The three answers a poster map can give about its pins' names, as the values its select carries.
 *
 * "Follow the world setting" is the EMPTY one on purpose: it is the absence of an override, and
 * the record it decodes to is sparse, so a map that has never been switched keeps following the
 * default after the default itself changes. A dense record would have frozen whatever the default
 * happened to be on the day the menu was first saved.
 */
export const MAP_PIN_NAME_CHOICES = Object.freeze({ follow: "", always: "on", hover: "off" });

/**
 * Each choice's wire value against the label that offers it, IN MENU ORDER.
 *
 * The template renders this rather than spelling the three values out again. It used to do the
 * latter, and the encoding then lived in two places that a test had to scrape the .hbs to hold
 * together — because the failure was silent: change a value on one side only and every row
 * decodes as "follow", so opening the menu and saving it wipes every override the world holds.
 */
const MAP_PIN_NAME_OPTIONS = Object.freeze([
	[MAP_PIN_NAME_CHOICES.follow, "stonetop.settings.mapPinNameSettings.followDefault"],
	[MAP_PIN_NAME_CHOICES.always, "stonetop.settings.mapPinNameSettings.alwaysShow"],
	[MAP_PIN_NAME_CHOICES.hover, "stonetop.settings.mapPinNameSettings.hoverOnly"],
]);

/**
 * One row per poster map for the menu's template, from the stored record.
 *
 * The two explicit options are selected only by an actual override, never by the default. A
 * following map's row has to read "follow the world setting", or a GM could not tell which maps
 * they have switched from which are merely agreeing with the default today.
 */
export function mapPinNameRows(perMap = {}) {
	return POSTER_MAPS.map(map => {
		const override = perMap?.[map.slug];
		// ONE value, not three booleans that have to stay mutually exclusive by hand.
		const chosen = override === true ? MAP_PIN_NAME_CHOICES.always
			: override === false ? MAP_PIN_NAME_CHOICES.hover
				: MAP_PIN_NAME_CHOICES.follow;
		return {
			slug: map.slug,
			// The map's own shipped name, which is what its Scene is called, so a row and the
			// scene it governs are recognisably the same thing. Not localized, for the same
			// reason the Scene's name is not.
			name: map.name,
			chosen,
			options: MAP_PIN_NAME_OPTIONS.map(([value, labelKey]) => ({
				value, labelKey, selected: value === chosen,
			})),
		};
	});
}

/**
 * The record to store, from the menu's submitted form.
 *
 * Rebuilt rather than merged into what is already stored, so a map handed back to the default is
 * REMOVED. Merging would leave a stale override in place under a row now reading "follow the
 * world setting", which is the one bug this shape exists to prevent.
 *
 * Anything that is not one of the two explicit answers means "follow", which covers both the
 * empty option and a row the form did not carry at all.
 *
 * The rows are named `map.<slug>`, and BOTH shapes that name can arrive in are read. v13's
 * FormApplication hands `_updateObject` a FormDataExtended's `object`, which keys by the raw
 * field name and so stays flat; anything that dot-expands it on the way (a core change, or a
 * subclass that calls expandObject) would deliver `{map: {<slug>: ...}}` instead. Reading only
 * the flat one and being wrong would not throw and would not log: every row would decode as
 * "follow", so the next save would quietly wipe every override the world holds. Reading both
 * costs one `??`.
 */
export function mapPinNameRecord(formData = {}) {
	const perMap = {};
	for (const map of POSTER_MAPS) {
		const choice = formData?.[`map.${map.slug}`] ?? formData?.map?.[map.slug];
		if (choice === MAP_PIN_NAME_CHOICES.always) perMap[map.slug] = true;
		else if (choice === MAP_PIN_NAME_CHOICES.hover) perMap[map.slug] = false;
	}
	return perMap;
}

/**
 * The Map Pin Names menu: the world default, then one row per poster map.
 *
 * Thin on purpose: the tristate the rows encode and decode is in mapPinNameRows/mapPinNameRecord
 * above, where it can be checked without standing up a FormApplication.
 *
 * Mirrors _createHoverDescriptionSettingsApp: same FormApplication shape, same save-and-apply
 * ending, so the two menus behave alike for a GM who has used either.
 */
function _createMapPinNameSettingsApp() {
	return _createSettingsMenuApp({
		id: "stonetop-map-pin-name-settings",
		titleKey: "stonetop.settings.mapPinNameSettings.title",
		template: "map-pin-names.hbs",
		getData: () => ({
			enabled: getAlwaysShowMapPinNames(),
			maps: mapPinNameRows(getObjectSetting("mapPinNamesByMap")),
		}),
		update: async (formData) => {
			// ONLY WHAT ACTUALLY CHANGED. `game.settings.set` broadcasts whatever it is handed,
			// identical value or not, and each of these fires `applyMapPinLabelMode` on every
			// connected client — a full walk of the notes layer setting `refreshState` on each
			// pin. Pressing Save without touching anything used to repaint every client twice;
			// changing one switch repainted for the other as well.
			const wantDefault = !!formData.alwaysShowMapPinNames;
			if (wantDefault !== getAlwaysShowMapPinNames()) {
				await setSetting("alwaysShowMapPinNames", wantDefault);
			}
			const wantMaps = mapPinNameRecord(formData);
			if (!foundry.utils.objectsEqual(wantMaps, getObjectSetting("mapPinNamesByMap"))) {
				await setSetting("mapPinNamesByMap", wantMaps);
			}
			// No repaint here: both settings are world-scoped, so core broadcasts each write and
			// fires its onChange on every connected client. Repainting from the form as well
			// would leave the saving GM doing it twice and every player once, which is the same
			// picture for more work.
		},
	});
}

const _FONT_MAP = {
	"libre-caslon":    '"Libre Caslon Text", serif',
	"im-fell-english": '"IM Fell English", serif',
	"signika":         "Signika, sans-serif",
};

/**
 * How far a run of UPPERCASE has to be pushed DOWN, per face, to sit optically centred in a box
 * that centres its EM box — published as `--st-caps-nudge` for any letterspaced small-caps pill
 * to read (the Condemned brand is the first).
 *
 * Why it cannot be one number in the stylesheet: capitals have no descenders, so their ink fills
 * only the upper part of the em box and centring that box leaves the empty descender space pooling
 * underneath. The size of that gap is `(capHeight + descent - ascent) / 2`, which is a property of
 * the FACE — and these three disagree by a factor of ten. IM Fell English is an antique face with
 * a very deep descent and needs ~0.155em; Libre Caslon needs ~0.016em. A constant tuned on either
 * is visibly wrong on the other, which is exactly how the brand pill came to sit high for everyone
 * on the default font while measuring perfect against the one it had been tuned against.
 *
 * CSS has no way to ask a font for its cap height that is safe to rely on yet (`1cap` gets close,
 * but centring caps also needs ascent and descent, and `text-box-trim` is newer still) — so the
 * numbers are measured per face and travel with the font that needs them.
 * Measured with condemn-tag-fonts.mjs in the verify harness; re-measure if a face is added here.
 */
const _FONT_CAPS_NUDGE = {
	"libre-caslon":    "0.016em",
	"im-fell-english": "0.155em",
	"signika":         "0.073em",
};

// The registered default for `sheetFont`. Shared with the fallback below so an
// unreadable/unrecognized value lands on the same font a fresh client gets, rather
// than a second, different "default" only the fallback path can produce.
const _DEFAULT_FONT = "signika";

export function applySheetFont(value) {
	// One resolved key for both properties, so an unrecognised setting cannot land on one font's
	// family with another font's caps nudge — which would be worse than either on its own.
	const key = _FONT_MAP[value] ? value : _DEFAULT_FONT;
	document.documentElement.style.setProperty("--font-stonetop", _FONT_MAP[key]);
	document.documentElement.style.setProperty("--st-caps-nudge", _FONT_CAPS_NUDGE[key]);
}

export function applySheetFontScale(value) {
	const scale = Number(value);
	const safe  = Number.isFinite(scale) && scale > 0 ? scale : 1;
	document.documentElement.style.setProperty("--stonetop-font-scale", String(safe));
}

export function applyEditPencilRevealDelay(value) {
	const seconds = Number(value);
	const safe    = Number.isFinite(seconds) && seconds >= 0 ? seconds : 1;
	document.documentElement.style.setProperty("--st-edit-reveal-delay", `${safe}s`);
}

export function applyReduceMotion(value) {
	document.documentElement.classList.toggle("stonetop-reduce-motion", !!value);
}

// Whether the pre-roll window asks how the roll is going out (Advantage / Normal /
// Disadvantage) instead of the sticky selector on the character and steading sheets.
// The two are exclusive by design: whichever one is answering, the other is not drawn.
export function getAskRollModeEachRollSetting() {
	return globalThis.game?.settings?.get?.(SYSTEM_ID, "askRollModeEachRoll") ?? false;
}

// Whether to prompt for a one-off situational modifier before a move/stat roll. Ignored
// while the mode is being asked per roll, since that window carries the stepper anyway.
export function getPromptRollModifierSetting() {
	return globalThis.game?.settings?.get?.(SYSTEM_ID, "promptRollModifier") ?? false;
}

// Whether actor sheets should open in Edit mode rather than Play mode.
export function getOpenSheetsInEditMode() {
	return globalThis.game?.settings?.get?.(SYSTEM_ID, "openSheetsInEditMode") ?? false;
}

/**
 * Which sheets have a CLASSIC toggle, and what each one's setting is called.
 *
 * Spelled out rather than built from the argument: the settings suite proves every
 * registered key is read by searching the source for the quoted key, so a key assembled
 * at runtime is invisible to it and the setting fails the build as dead.
 * See tests/utils/settings-registration.test.js.
 */
export const CLASSIC_LAYOUT_KEYS = {
	character: "classicLayoutCharacter",
	steading:  "classicLayoutSteading",
	npc:       "classicLayoutNpc",
};

/**
 * The resolved master switch: is this client's sheet layout CLASSIC?
 *
 * The personal `sheetLayout` override wins whenever it names a layout; "world" (its default)
 * defers to the table's `worldSheetLayout`, which is what makes a fresh world modern and an
 * upgraded one classic on a browser that opens both. Any OTHER stored value is read as
 * "follow the world" rather than guessed at, so a value left behind by a build that kept a
 * boolean under this key resolves to the world's answer instead of pinning a layout nobody
 * chose.
 *
 * Throws if either key is unregistered; its one caller owns the try/catch. See isClassicLayout.
 */
function _classicMaster(settings) {
	const mine = settings.get(SYSTEM_ID, "sheetLayout");
	if (mine === "classic") return true;
	if (mine === "modern")  return false;
	return settings.get(SYSTEM_ID, "worldSheetLayout") === "classic";
}

/**
 * Should this sheet render the CLASSIC layout - a horizontal text tab strip with the stat
 * block / stat band / quick facts pinned above it - rather than the MODERN one, where the
 * tabs are an icon rail off the window's edge and those blocks live on a tab?
 *
 * Two switches, ANDed: the resolved master (above) and the sheet's own toggle. A modern
 * master is modern everywhere, whatever the children say.
 *
 * Answers false for an unrecognized sheet and for a game whose settings are not registered:
 * a sheet class is constructible in a unit test, and MODERN is what ships, so "modern" is
 * the right answer when there is nothing to read.
 *
 * The try/catch is what actually delivers that second promise, and `??` cannot stand in for
 * it: core's `ClientSettings#get` THROWS on a key it has no registration for rather than
 * returning undefined. `layoutClasses` is called from the static `defaultOptions` getter of all
 * three sheet classes — i.e. at construction — so any sheet built before `registerSettings()`
 * has finished (a module erroring inside its own `init` hook, a partially failed system init)
 * would otherwise throw on open instead of quietly rendering modern.
 *
 * @param {"character"|"steading"|"npc"} sheet
 * @returns {boolean}
 */
export function isClassicLayout(sheet) {
	const key = CLASSIC_LAYOUT_KEYS[sheet];
	if (!key) return false;
	const settings = globalThis.game?.settings;
	if (typeof settings?.get !== "function") return false;
	try {
		if (!_classicMaster(settings)) return false;
		return !!settings.get(SYSTEM_ID, key);
	} catch {
		return false;
	}
}

/**
 * The frame marker the conditional CSS hangs off, ready to spread into a sheet's
 * `defaultOptions.classes`. Empty in the modern layout.
 *
 * Every classic CSS rule COMPOUNDS this with the sheet's own frame classes
 * (`.stonetop-layout-classic.pbta.sheet.actor.character`), never descends from it - the
 * marker lands on the same element as those classes, not on an ancestor.
 */
export function layoutClasses(sheet) {
	return isClassicLayout(sheet) ? ["stonetop-layout-classic"] : [];
}

/**
 * Re-stamp that same marker on a rendered sheet's frame. The other half of the pair, and the
 * load-bearing one: `layoutClasses` seeds `defaultOptions` at construction, but `_replaceHTML`
 * only replaces the contents of `.window-content` and never rebuilds the frame's class list —
 * so without this, flipping the setting on an open sheet re-renders classic markup under modern
 * CSS (or the reverse) until it is closed and reopened.
 *
 * Call from `_render`, after `super._render`.
 *
 * @param {Application} app
 * @param {"character"|"steading"|"npc"} sheet
 */
export function stampLayoutClass(app, sheet) {
	app?.element?.[0]?.classList.toggle("stonetop-layout-classic", isClassicLayout(sheet));
}

/**
 * A setting read that survives being asked too early, and caches only a real answer.
 *
 * Two rules, both learned the hard way and both easy to get subtly wrong a second time, so they
 * are written once here rather than at each reader.
 *
 * READ IN A TRY. Optional chaining is not the guard this needs: `game.settings` exists long
 * before our keys are on it, and `get` THROWS for a key it has never been told about. These are
 * asked from inside a PIXI refresh pass that can run before registration (a Scene painted during
 * startup), and that throw would come out mid-pass and take the note redraw with it.
 *
 * NEVER CACHE A READ THAT HAD NOTHING TO GIVE. Before the setting is registered the read comes
 * back undefined, and caching the fallback then would freeze the shipped default over whatever
 * the world actually wants for the rest of the session. `isValid` is what tells the two apart,
 * so it must accept every real answer — an EMPTY record is one (a world where no map has been
 * switched yet), a missing one is not.
 */
const _settingCache = new Map();
function _cachedSetting(key, isValid, fallback) {
	if (_settingCache.has(key)) return _settingCache.get(key);
	let value;
	try {
		value = globalThis.game?.settings?.get?.(SYSTEM_ID, key);
	} catch (_) {
		return fallback;
	}
	if (!isValid(value)) return fallback;
	_settingCache.set(key, value);
	return value;
}

/**
 * Do this world's map pins wear their names by default, or wait for the cursor?
 *
 * The DEFAULT, not the last word: showMapPinNamesOn below is what the drawing code asks, and a
 * poster map with an answer of its own overrides this one. Read it directly only to show or set
 * the default itself.
 *
 * TRUE when there is nothing to read: the harmless answer before registration is the shipped
 * default rather than a silently quieter map.
 */
export function getAlwaysShowMapPinNames() {
	return _cachedSetting("alwaysShowMapPinNames", v => typeof v === "boolean", true);
}

/**
 * Do the pins on THIS scene wear their names, or wait for the cursor?
 *
 * The question every map pin actually asks, and the one the drawing code should be asking:
 * a label is painted onto a scene, and which scene it is is what decides the answer.
 *
 * Narrowest answer first. If the scene is one of the five poster maps and that map has an
 * override recorded, the override wins outright. Otherwise the world default answers, which is
 * also the answer for every scene that is not a poster map at all.
 *
 * Cached beside the default it falls back to, and dropped by the same applyMapPinLabelMode: this
 * runs once per pin per refresh pass, on every note on the canvas, so it is on the hot path of
 * something that repaints whenever the cursor moves over a pin.
 *
 * Both reads go through `_cachedSetting`, which is what keeps them safe to ask from a PIXI
 * refresh before the settings are registered: a failed read there lands on the shipped default
 * rather than painting a silently quieter map.
 */
export function showMapPinNamesOn(scene) {
	const slug = posterMapSlugOf(scene);
	if (slug) {
		const override = _perMapPinNames()[slug];
		if (typeof override === "boolean") return override;
	}
	return getAlwaysShowMapPinNames();
}

/** The stored per-map record, cached, and never cached from a read that had nothing to give. */
function _perMapPinNames() {
	return _cachedSetting(
		"mapPinNamesByMap",
		v => !!v && typeof v === "object" && !Array.isArray(v),
		{},
	);
}

/**
 * Push the label setting onto the notes already drawn, so flipping it takes effect on the map the
 * GM is looking at rather than on their next reload.
 *
 * `refreshState` is the narrowest flag that does it: core recomputes tooltip visibility from the
 * cursor in Note#_refreshState, and our wrapper rides that same pass, so one flag both turns the
 * labels on and hands them back to core when the switch goes off.
 *
 * Registered as the `onChange` of BOTH settings behind the decision, the world default and the
 * per-map overrides, which is what makes it the right place to drop the cached answers: every
 * change to either comes through here, and nothing else can change them.
 */
export function applyMapPinLabelMode() {
	_settingCache.clear();
	for (const note of globalThis.canvas?.notes?.placeables ?? []) {
		if (note?.renderFlags?.set) note.renderFlags.set({ refreshState: true });
		else note?.refresh?.();
	}
}

export function getSetting(key) {
	return game.settings.get(SYSTEM_ID, key);
}

/**
 * A plain-object setting, read tolerantly: `{}` rather than a throw when the key is not
 * registered in this world (an older build, or a unit test that never called registerSettings),
 * and `{}` rather than a surprise when the stored value is a scalar or an array.
 *
 * The broadcast art indexes (`treasureArt`, `peopleArt`, `peoplePortraitArt`) are all read this
 * way, from several unrelated consumers — the People gallery, the portrait re-point pass — each
 * of which had grown its own copy of this try/catch and its own shape guard.
 */
export function getObjectSetting(key) {
	try {
		const value = globalThis.game?.settings?.get?.(SYSTEM_ID, key);
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch (_) {
		return {};
	}
}

/**
 * The key a world-keyed setting stores its records under.
 *
 * Client settings live in browser localStorage under `namespace.key` alone, with no world in
 * the path — so any client-scoped "have they seen this yet?" flag leaks across every world
 * opened in the same browser unless it nests its records by world itself. Two settings do
 * exactly that (`walkthroughResume`, `settingOverviewShown`), and they have to agree on what
 * the key IS, so it is defined once here.
 */
export function worldKey() {
	return globalThis.game?.world?.id ?? "";
}

// ── Setting Overview once-gate (per client, per world) ─────────────────────────
// Stored world-keyed so seeing the Overview in one world can't suppress it in the
// next (see the registration above).

function _settingOverviewStore() {
	return globalThis.game?.settings?.get?.(SYSTEM_ID, "settingOverviewShown");
}

/** The stored world map, or null when the value is absent or still the legacy shape. */
function _settingOverviewMap(stored) {
	return stored?.constructor === Object ? stored : null;
}

/**
 * Is `stored` the pre-world-keying value — a bare `true` that applied to every world?
 *
 * Not simply `stored === true`. The setting is now declared `type: Object`, and Foundry
 * casts a stored value to its declared type by CONSTRUCTING it (Setting#_castType falls
 * through to `new Object(value)` for any non-primitive type), so a legacy boolean comes
 * back as a Boolean WRAPPER object, not a boolean. It answers to valueOf() either way.
 */
function _settingOverviewLegacyShown(stored) {
	if (stored === null || stored === undefined) return false;
	if (_settingOverviewMap(stored)) return false;
	return !!stored.valueOf?.();
}

/** Has this client already been shown the Overview in THIS world? */
export function getSettingOverviewShown() {
	const stored = _settingOverviewStore();
	// A legacy value still answers for every world until the migration below has run, so
	// an upgrade mid-session can't re-pop the Overview on the very next load.
	if (_settingOverviewLegacyShown(stored)) return true;
	return !!_settingOverviewMap(stored)?.[worldKey()];
}

export function markSettingOverviewShown() {
	const map = { ..._settingOverviewMap(_settingOverviewStore()) };
	map[worldKey()] = true;
	return setSetting("settingOverviewShown", map);
}

/**
 * One-time migration of the pre-world-keying flat shape. It carried no world attribution,
 * so — as with migrateFlatWalkthroughResume — attribute it to the world this browser is in
 * now, which is where it was most likely written. Every OTHER world then correctly
 * re-offers the Overview once, which is the whole point of the fix. Idempotent: after it
 * runs the value is a world map and this is a no-op.
 */
export function migrateFlatSettingOverviewShown() {
	if (!_settingOverviewLegacyShown(_settingOverviewStore())) return;
	return markSettingOverviewShown();
}

/**
 * The three per-sheet layout boxes, which shipped CLIENT-scoped and are now WORLD-scoped
 * (see their registration above for why they had to move).
 */
export const CLASSIC_LAYOUT_SETTINGS = Object.freeze([
	"classicLayoutCharacter",
	"classicLayoutSteading",
	"classicLayoutNpc",
]);

// The registered default for all three. Only a stored value that DISAGREES with it is worth
// carrying over — agreeing with the default is exactly what an absent world setting already
// means, and writing it would create a Setting document that says nothing.
const _CLASSIC_LAYOUT_DEFAULT = true;

/**
 * Which of the three still need their old client value carried into the world scope.
 *
 * Pure — takes the storage and the set of world Setting keys that already exist, returns
 * `[{key, value}]` — so the rule can be tested without a Foundry world.
 *
 * Two things it must never do:
 *  - OVERWRITE. A world Setting document for the key means the GM has already answered under
 *    the new scope; the localStorage entry beside it is a fossil.
 *  - GUESS. Only the two exact JSON booleans a Boolean client setting can hold are acted on.
 */
export function planClassicLayoutAdoption({ storage, worldKeys, systemId = SYSTEM_ID, keys = CLASSIC_LAYOUT_SETTINGS } = {}) {
	if (!storage) return [];
	const already = worldKeys instanceof Set ? worldKeys : new Set(worldKeys ?? []);
	const plan = [];
	for (const key of keys) {
		const storedKey = `${systemId}.${key}`;
		if (already.has(storedKey)) continue;
		const raw = storage.getItem?.(storedKey);
		if (raw !== "true" && raw !== "false") continue;
		const value = raw === "true";
		if (value === _CLASSIC_LAYOUT_DEFAULT) continue;
		plan.push({ key, value });
	}
	return plan;
}

/**
 * Carry a GM's pre-move choice for the three layout boxes into the world scope, once.
 *
 * A world-scoped setting never reads localStorage, so without this a GM who had unticked
 * "Classic Layout: Character Sheets" to run the modern sheet got the registered default `true`
 * back on the upgrade, and every sheet in the world silently reverted to classic. The old value
 * is still sitting in their browser under the same `<namespace>.<key>` string, unread.
 *
 * GM-only but deliberately NOT primary-GM-only: the value lives in whichever GM's BROWSER it was
 * set from, so gating it to the elected primary would throw the choice away whenever that is not
 * the GM who made it. Two GMs adopting at once write the same key; the no-overwrite rule above
 * makes that idempotent, and a genuine disagreement between two browsers has no better answer
 * than last-write-wins.
 *
 * `copy-settings.js` does not cover this: that migration re-namespaces settings for the system-id
 * rename, and a change of SCOPE moves the value between two different stores entirely.
 */
export async function adoptClassicLayoutScope({ game = globalThis.game, storage = globalThis.localStorage } = {}) {
	if (!game?.user?.isGM) return { adopted: 0 };
	// The Setting documents themselves — ClientSettings has no API for "is this key stored?",
	// and `get` would hand back the registered default without saying it was a default. Nothing
	// to read means nothing can be told apart, and guessing would clobber a real choice.
	const worldStore = game.settings?.storage?.get?.("world");
	if (!worldStore) return { adopted: 0 };
	const plan = planClassicLayoutAdoption({ storage, worldKeys: new Set([...worldStore].map(doc => doc?.key)) });
	// Written through the same `game` the plan was read from, rather than the module-level
	// `setSetting`, so the read and the write can never end up talking to different worlds.
	for (const { key, value } of plan) await game.settings.set(SYSTEM_ID, key, value);
	return { adopted: plan.length };
}

/** A positive, whole pixel count, or null for anything that isn't one. */
function _px(v) {
	const n = Math.round(Number(v));
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Last-used size for a given actor sheet as `{width, height}`, either of which may be null
 * if nothing usable is stored. Never returns null itself, so callers can destructure.
 *
 * Falls back to the retired "characterSheetWidths" map for the width, so upgrading doesn't
 * throw away a width the user had already established. Height has no legacy source — a
 * sheet that only ever stored a width reopens at its default height, once. That map only
 * ever held characters; other actor types simply never match it.
 */
export function getSheetSize(actorId) {
	if (!actorId) return { width: null, height: null };
	const size = globalThis.game?.settings?.get?.(SYSTEM_ID, "sheetSizes")?.[actorId];
	const legacy = globalThis.game?.settings?.get?.(SYSTEM_ID, "characterSheetWidths")?.[actorId];
	return {
		width: _px(size?.width) ?? _px(legacy),
		height: _px(size?.height),
	};
}

/**
 * Store an actor sheet's size. Each dimension is validated and kept independently, so a
 * caller that only knows one of them (or whose window is mid-animation and reports a junk
 * value for the other) can't wipe the good one.
 */
export function setSheetSize(actorId, { width, height } = {}) {
	if (!actorId) return;
	const w = _px(width), h = _px(height);
	if (w === null && h === null) return;

	const current = getSheetSize(actorId);
	const next = { width: w ?? current.width, height: h ?? current.height };
	// Avoid redundant writes: settings.set round-trips through the server for the
	// client store and this is called off a debounce on every resize frame.
	if (next.width === current.width && next.height === current.height) return;

	const map = globalThis.game?.settings?.get?.(SYSTEM_ID, "sheetSizes") ?? {};
	return game.settings.set(SYSTEM_ID, "sheetSizes", { ...map, [actorId]: next });
}

// Per-actor, per-user list of collapsible section ids (sorted, de-duped), or []
// if nothing stored yet. Shared by the crew follower sections and the sidebar
// move groups, which differ only in the setting key they persist under.
function getSectionList(key, actorId) {
	if (!actorId) return [];
	const arr = globalThis.game?.settings?.get?.(SYSTEM_ID, key)?.[actorId];
	return Array.isArray(arr) ? arr : [];
}

function setSectionList(key, actorId, sections) {
	if (!actorId) return;
	const next = Array.from(new Set(sections ?? [])).sort();
	const map  = globalThis.game?.settings?.get?.(SYSTEM_ID, key) ?? {};
	const prev = Array.isArray(map[actorId]) ? [...map[actorId]].sort() : [];
	if (next.join("|") === prev.join("|")) return; // avoid redundant writes
	return game.settings.set(SYSTEM_ID, key, { ...map, [actorId]: next });
}

// The collapsible crew follower sections a character left expanded.
export function getCrewSectionsOpen(actorId) {
	return getSectionList("crewSectionsOpen", actorId);
}

export function setCrewSectionsOpen(actorId, sections) {
	return setSectionList("crewSectionsOpen", actorId, sections);
}

// The sidebar move groups a character left collapsed. Move groups default to
// expanded, so an id present here means that group should reopen collapsed.
export function getMovesSectionsCollapsed(actorId) {
	return getSectionList("movesSectionsCollapsed", actorId);
}

export function setMovesSectionsCollapsed(actorId, sections) {
	return setSectionList("movesSectionsCollapsed", actorId, sections);
}

// The Arcana sections (Major / Minor) a character left collapsed. They default to
// expanded, so an id present here means that section should reopen collapsed.
export function getArcanaSectionsCollapsed(actorId) {
	return getSectionList("arcanaSectionsCollapsed", actorId);
}

export function setArcanaSectionsCollapsed(actorId, sections) {
	return setSectionList("arcanaSectionsCollapsed", actorId, sections);
}

// The reverse-side arcanum content sections (e.g. Consequences) a character left
// expanded. These default to collapsed, so an id present here means that section
// should reopen expanded.
export function getArcanaContentExpanded(actorId) {
	return getSectionList("arcanaContentExpanded", actorId);
}

export function setArcanaContentExpanded(actorId, sections) {
	return setSectionList("arcanaContentExpanded", actorId, sections);
}

// The individual arcanum cards a character left collapsed (clamped to their title
// bar). They default to expanded, so a card slug present here means that card should
// reopen collapsed.
export function getArcanaCardsCollapsed(actorId) {
	return getSectionList("arcanaCardsCollapsed", actorId);
}

export function setArcanaCardsCollapsed(actorId, slugs) {
	return setSectionList("arcanaCardsCollapsed", actorId, slugs);
}

// The gear rows whose artifact / treasure write-up this user left unfolded. Write-ups
// default to folded away, so an owned Item id present here means that row reopens with
// its write-up showing.
export function getInventoryLoreExpanded(actorId) {
	return getSectionList("inventoryLoreExpanded", actorId);
}

export function setInventoryLoreExpanded(actorId, itemIds) {
	return setSectionList("inventoryLoreExpanded", actorId, itemIds);
}

// The sheet sections (character and steading alike) this user folded shut with the
// heading caret. They default to expanded, so an id present here means that section
// should reopen collapsed.
export function getSheetSectionsCollapsed(actorId) {
	return getSectionList("sheetSectionsCollapsed", actorId);
}

export function setSheetSectionsCollapsed(actorId, sections) {
	return setSectionList("sheetSectionsCollapsed", actorId, sections);
}

// Whether a character left the whole moves sidebar collapsed (defaults to false /
// expanded). Per-actor, per-user.
export function getSidebarCollapsed(actorId) {
	if (!actorId) return false;
	const map = globalThis.game?.settings?.get?.(SYSTEM_ID, "characterSidebarCollapsed");
	return !!map?.[actorId];
}

export function setSidebarCollapsed(actorId, collapsed) {
	if (!actorId) return;
	const next = !!collapsed;
	const map  = globalThis.game?.settings?.get?.(SYSTEM_ID, "characterSidebarCollapsed") ?? {};
	if (next === !!map[actorId]) return; // avoid redundant writes
	return game.settings.set(SYSTEM_ID, "characterSidebarCollapsed", { ...map, [actorId]: next });
}

export function getHoverDescriptionSetting(key, { ignoreMaster = false } = {}) {
	const settings = globalThis.game?.settings;
	const masterEnabled = ignoreMaster ? true : settings?.get?.(SYSTEM_ID, "hoverDescriptionsEnabled") ?? true;
	const settingEnabled = settings?.get?.(SYSTEM_ID, key) ?? true;
	return masterEnabled && settingEnabled;
}

export function getRollStatChipsSetting() {
	return globalThis.game?.settings?.get?.(SYSTEM_ID, "showRollStatChips") ?? true;
}

export function applyMoveDescriptionBodyClass(show) {
	document.body.classList.toggle("stonetop-hide-roll-descriptions", !show);
}

export function setSetting(key, value) {
	return game.settings.set(SYSTEM_ID, key, value);
}

/**
 * Write a setting that MAY be world-scoped, from a place a non-GM could reach.
 *
 * Only a GM may write a world setting: core rejects a player-side call outright rather than
 * quietly no-opping, so every dialog that persists GM-prep answers had grown its own
 * `if (!game.user?.isGM) return` beside its own `setSetting`. Four copies of one rule is four
 * places for the fifth caller not to look — and forgetting it does not degrade, it throws.
 *
 * The scope is read off the registration rather than assumed, so this is safe to use for any
 * key: a client-scoped one is written normally whoever is asking.
 *
 * Silent by design. These are autosave paths on prep tools a player has no business writing;
 * the console line is for whoever is debugging why a write did not land.
 */
export function setWorldSetting(key, value) {
	const scope = globalThis.game?.settings?.settings?.get?.(`stonetop-pwd.${key}`)?.scope;
	if (scope === "world" && !globalThis.game?.user?.isGM) {
		console.debug(`Stonetop | skipped world-setting write to "${key}": not a GM.`);
		return Promise.resolve();
	}
	return setSetting(key, value);
}

function _rerenderActorSheets() {
	for (const app of Object.values(globalThis.ui?.windows ?? {})) {
		if (app?.actor) app.render(false);
	}
}
