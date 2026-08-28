import { runStartupMigrations } from "./PbtaSheetConfig.js";
import { theGmToolkit, createGmToolkit, isGmToolkitData, GM_TOOLKIT_DEFAULT_IMG } from "../actors/gmtoolkit/gm-toolkit-actor.js";
import { maybeOfferMigration } from "../migration/announce.js";
import { finishSystemIdMigration } from "../migration/finish-run.js";
import { maybeRescueStrandedWorld } from "../migration/rescue.js";
import { repairAllChronicleFlagScopes } from "../migration/chronicle-flag-scope.js";
import { oncePerVersion, forgetSweep } from "../migration/once-per-version.js";
import { repairCharacterTokenLinks, applyLinkChoices } from "../migration/link-character-tokens.js";
import { CharacterTokenLinkDialog } from "../dialogs/CharacterTokenLinkDialog.js";
import { createArcanumItem, newArcanumSlug, isArcanumData } from "../item/createArcanum.js";
import { renameAllSeasonYearPages } from "../migration/season-year-page-names.js";
import { ensureStonetopSingleton, remindDestinedOmenRoll } from "./StonetopSingleton.js";
import { runWorldSetup, pendingSetupWork } from "./WorldSetup.js";
import { reapplyBook2Art, hasImportedBook2Art } from "../book2-art/reapply.js";
import { clearArtBrowseCache } from "../book2-art/browse.js";
import { BOOK2_ART_MACRO_NAME, findBook2ArtWorldMacro, loadBook2ArtMacroSource, runImportBookArtMacro } from "../book2-art/macro.js";
import { offerDurableArtOnce } from "../book2-art/offer-once.js";
import { openProgressNotification } from "../utils/progress-notification.js";
import { stonetopChatCard } from "../utils/chat.js";
import { stampWorldLayoutBaseline } from "../utils/sheet-layout.js";
import { applySheetFont, applySheetFontScale, applyEditPencilRevealDelay, applyReduceMotion, getSetting, setSetting, getSettingOverviewShown, markSettingOverviewShown, migrateFlatSettingOverviewShown, adoptClassicLayoutScope } from "../settings.js";
import { EndOfSessionDialog } from "../dialogs/EndOfSessionDialog.js";
import { IntroductionsDialog } from "../dialogs/IntroductionsDialog.js";
import { SpringBurstDialog } from "../dialogs/SpringBurstDialog.js";
import { reopenOpenWalkthroughs, sessionZeroComplete } from "../dialogs/walkthrough-resume.js";
import { writeChronicle } from "../utils/chronicle.js";
import { ExpeditionDialog } from "../dialogs/ExpeditionDialog.js";
import { WeatherDialog } from "../dialogs/WeatherDialog.js";
import { refreshWeatherFx } from "../seasons/current-weather.js";
import { WelcomeDialog } from "../dialogs/WelcomeDialog.js";
import { FoundryBasicsDialog } from "../dialogs/FoundryBasicsDialog.js";
import { CharacterCreationDialog } from "../actors/character/dialogs/CharacterCreationDialog.js";
import { creationFlowOpen, registerCreationFlowCleanup } from "../actors/character/creation-flow.js";
import { progressFor } from "../actors/character/onboarding-progress.js";
import { readOnboardingResume, clearOnboardingResume } from "../actors/character/onboarding-resume.js";
import { playbookSlug } from "../utils/playbook-actors.js";
import { rollDieOfFate } from "../utils/die-of-fate.js";
import { LoveLetterDialog } from "../dialogs/LoveLetterDialog.js";
import { StonetopArcanaInspireDialog } from "../item/StonetopArcanaInspireDialog.js";
import { StonetopBrowserDialog } from "../dialogs/StonetopBrowserDialog.js";
import { findVisibleJournal, SETTING_OVERVIEW_JOURNAL } from "../utils/seeded-journals.js";
import { getStonetopSteadingActor, getStonetopSteadingActorOrWarn } from "../utils/world.js";
import { rollMoveFromUuid } from "./HotbarDrop.js";
import { ensureThreatsEntry } from "../threats/threat-store.js";
import { ensureHazardsEntry } from "../hazards/hazard-store.js";
import { STONETOP_SCOPE, ITEM_FLAG_SCOPE, resolvedFlagProperty, resolvedFlags } from "../actors/character/StonetopFlags.js";
import { deletionEntry } from "../utils/foundry-compat.js";
import { markPosterMapScenes } from "../book2-art/poster-maps.js";
import { linkLandmarkNotes, refitLandmarkNotes, revealLandmarkNotesOnce } from "./PlaceOfInterestDrop.js";
import { refitGmPrepPins } from "./ThreatNotePins.js";
import { reconcileSitePins } from "../sites/site-scene-pins.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { migrateAllSteadingPeople, ensurePeopleFolders, backfillAllResidentHomes } from "../actors/steading/steading-people.js";
import { PERSON_DEFAULT_IMG } from "../utils/person-portrait.js";
import { NEW_SHOOT_MARKER, LEGACY_SHOOT_MARKERS } from "../data/follower-actor.js";
import { isDefaultImg } from "../utils/strings.js";
import { updatePlacedTokens } from "../utils/placed-tokens.js";

const _EOS_MACRO_NAME   = "End of Session";
const _EOS_MACRO_IMG    = "systems/stonetop-pwd/assets/icons/macros/truce.svg";
const _EOS_MACRO_SCRIPT = "game.stonetop?.openEndOfSession?.()";
const _EOS_HOTBAR_SLOT  = 10;

// The Chronicle hotbar macro (slot 9): compiles the recorded Introductions + Spring
// Burst answers and expedition log into the shared "The Chronicle" journal and opens it
// (GM-only — saveChronicle is seed-once, so re-running it preserves inline edits). Sits
// just before End of Session and, like it, is handled separately from the slots-1–5
// _SYSTEM_MACROS set and keyed on its command so it won't collide with a user macro of
// the same name.
const _CHRONICLE_MACRO_NAME   = "The Chronicle";
const _CHRONICLE_MACRO_IMG    = "systems/stonetop-pwd/assets/icons/macros/bookmarklet.svg";
const _CHRONICLE_MACRO_SCRIPT = "game.stonetop?.saveChronicle?.()";
const _CHRONICLE_HOTBAR_SLOT  = 9;

// The "(TEST ONLY) Populate World" dev macro, added to the Macro Directory but never
// the hotbar. Its body is the create-test-characters dev script — that file is the single
// source of truth, fetched at runtime (see _ensureTestPopulateMacro). It SHIPS: it is
// un-ignored in .gitignore and named explicitly in the release zip step, so released
// worlds get the macro too. A build that omits it still skips seeding, silently.
const _TEST_MACRO_NAME   = "(TEST ONLY) Populate World";
const _TEST_MACRO_SRC    = "systems/stonetop-pwd/scripts/local/create-test-characters.js";
const _TEST_MACRO_IMG    = "systems/stonetop-pwd/assets/icons/macros/hazard-sign.svg";
const _TEST_MACRO_FOLDER = "For Testing Purposes";

// Retired hotbar macro — the Introductions walkthrough now launches from the
// Welcome guide, so the standalone macro is deleted rather than slotted (see
// _retireIntroductionsMacro). Name + command identify the system-created one.
const _INTRO_MACRO_NAME   = "Character Introductions";
const _INTRO_MACRO_SCRIPT = `\
const w = Object.values(ui.windows).find(w => w.id === "stonetop-introductions");
if (w?.rendered) { w.bringToTop(); return; }
game.stonetop?.openIntroductions?.();`;

// Retired hotbar macros — the two catalogue browsers became one window with a tab each, so
// "Browse Stonetop" replaces both and these are deleted rather than slotted (see
// _retireMergedBrowserMacros). Name + command identify the system-created ones, so a GM's own
// macro that happens to share a name is left alone.
const _RETIRED_BROWSER_MACROS = [
	{ name: "Browse the Arcana",   command: "game.stonetop?.openArcanaBrowser?.()" },
	{ name: "Browse the Bestiary", command: "game.stonetop?.openBestiaryBrowser?.()" },
];

// The ordered system hotbar macros (slots 1–7), in their canonical order. The
// single source of truth for both _ensureHotbarMacro (places any that are missing)
// and _reorderSystemMacros (snaps them into this order). Chronicle (9) / End of Session
// (10) are handled separately below because they also key on their command. Seasons
// Change took the spring icon that Welcome used to carry; Welcome now uses the
// direction-signs. "Write a Love Letter" (slot 5) is GM prep (Book I p.568), and
// "Browse Stonetop" (slot 7) reads GM-hidden compendia and the GM's own NPC notes — a
// GM-only block places these, so they never reach a player's hotbar.
//
// `shared` marks the one macro the whole table uses: the Die of Fate is rolled by whoever
// the fiction points at, not just the GM, so it is created readable by everyone and placed
// on each player's own hotbar at `playerSlot` (see _ensurePlayerHotbarMacros). A player's
// bar is otherwise empty of system macros, so it starts at slot 1 rather than the GM's 6.
const _SYSTEM_MACROS = [
	{ name: "Welcome to Stonetop", img: "systems/stonetop-pwd/assets/icons/macros/direction-signs.svg", command: "game.stonetop?.openWelcome?.()",        slot: 1 },
	{ name: "Seasons Change",      img: "systems/stonetop-pwd/assets/icons/macros/spring.svg",           command: "game.stonetop?.openSeasonsChange?.()", slot: 2 },
	{ name: "Run an Expedition",   img: "systems/stonetop-pwd/assets/icons/macros/treasure-map.svg",     command: "game.stonetop?.openExpedition?.()",     slot: 3 },
	{ name: "Weather",             img: "systems/stonetop-pwd/assets/icons/macros/sun-cloud.svg",        command: "game.stonetop?.openWeather?.()",        slot: 4 },
	{ name: "Write a Love Letter", img: "systems/stonetop-pwd/assets/icons/macros/love-letter.svg",      command: "game.stonetop?.openLoveLetter?.()",     slot: 5 },
	{ name: "Die of Fate",         img: "systems/stonetop-pwd/assets/icons/macros/die-of-fate.svg",      command: "game.stonetop?.rollDieOfFate?.()",      slot: 6, shared: true, playerSlot: 1 },
	// One window over the arcana, the bestiary and the world's people (see
	// dialogs/StonetopBrowserDialog.js), so a magnifying glass rather than any one list's
	// symbol — it is the LOOKING that all three tabs have in common.
	{ name: "Browse Stonetop",     img: "systems/stonetop-pwd/assets/icons/macros/magnifying-glass.svg", command: "game.stonetop?.openBrowser?.()",        slot: 7 },
];

// Bump to re-snap the system macros into their canonical slots once, on every client
// (the per-client `systemHotbarLayoutVersion` setting trails this until then). Bumped
// to 2 when Seasons Change was inserted at slot 2 and the rest shifted right; to 3 when
// Write a Love Letter took slot 5 and Die of Fate moved to slot 6.
//
// Deliberately NOT bumped for the browsers, in either direction: they were APPENDED at slots
// 7-8 rather than inserted, and merging them back into one at slot 7 leaves slots 1-6 exactly
// where they were. _ensureHotbarMacro places a missing macro whatever the layout version, and
// _retireMergedBrowserMacros frees slot 7 for it. Re-snapping would lift every system macro
// off the hotbar and put it back — undoing any arrangement a GM had made — to fix an order
// that isn't wrong.
const _HOTBAR_LAYOUT_VERSION = 3;

export async function onReady() {
	applySheetFont(getSetting("sheetFont"));
	applySheetFontScale(getSetting("sheetFontScale"));
	applyEditPencilRevealDelay(getSetting("editPencilRevealDelay"));
	applyReduceMotion(getSetting("reduceMotion"));
	// Fold the pre-world-keying Setting Overview gate under this world, so every OTHER
	// world stops reading it as already-shown (see settings.js).
	await migrateFlatSettingOverviewShown();
	// Before any sheet renders: carry a GM's pre-move choice for the three classic-layout boxes
	// out of browser localStorage and into the world scope they now live in. Without it an
	// upgraded world silently reverts to the classic layout. See adoptClassicLayoutScope.
	try { await adoptClassicLayoutScope(); }
	catch (err) { console.error("Stonetop | classic-layout scope adoption failed", err); }
	try { await _migrateArmourToArmor(); }
	catch (err) { console.error("Stonetop | armour → armor migration failed", err); }
	// Take retired sheet-preference flags off any actor still carrying one (see
	// _RETIRED_ACTOR_FLAGS). Self-gated to the primary GM, and a no-op in a clean world.
	try { await _dropRetiredActorFlags(); }
	catch (err) { console.error("Stonetop | retired actor-flag sweep failed", err); }
	await _migrateGmPrepPagesToSingleJournal();
	// Convert each steading's plain-text Residents/Neighbors rows into linked NPC actors
	// (idempotent; primary-GM only so two connected GMs can't double-create). Swept every
	// load, not once per world: players can't create actors, so a background that seeds
	// neighbors during onboarding leaves text rows for the GM to pick up here.
	if (isPrimaryGM()) {
		// Un-duplicate any chronicle journal a build with the misfiled flag key re-seeded. Swept
		// every load rather than latched: it is idempotent by construction (nothing is left for
		// it to match once it has run), so there is no gate that can get stuck. See
		// migration/chronicle-flag-scope.js.
		try { await repairAllChronicleFlagScopes(); }
		catch (err) { console.error("Stonetop | chronicle flag-scope repair failed", err); }
		// Give a slug to any arcanum card built before StonetopItem#_preCreate stamped them.
		// Idempotent, but GATED anyway (migration/once-per-version.js): idempotent buys the second
		// run being safe, not the whole Items sidebar being filtered on every load of every session
		// to find the nothing that is left. `_preCreate` is what keeps a slugless card from being
		// made at all now, so this is legacy repair and has a last world to run in.
		try { await oncePerVersion("arcanumSlugs", _stampMissingArcanumSlugs); }
		catch (err) { console.error("Stonetop | arcanum slug sweep failed", err); }
		// Point player tokens back at the characters they stand for. An unlinked PC token carries
		// a private copy of its character, and the two drift because a roll writes to the sheet's
		// Actor while every chat-card button resolves its Actor out of the message speaker — which
		// core rewrites to the TOKEN whenever one is on the canvas. See
		// migration/link-character-tokens.js for the whole account.
		//
		// Gated per version because it is a full walk of every token on every Scene, and
		// `_preCreate` now stamps the link on new characters, so what is left is legacy. The gate
		// is UNSTAMPED again below when the GM leaves a drifted token undecided: an unanswered
		// question is not a finished sweep, and the alternative is a world that quietly never asks
		// again about two characters wearing one name.
		try { await _repairCharacterTokenLinks(); }
		catch (err) { console.error("Stonetop | player-token link repair failed", err); }
		// Catch Chronicle year pages up to the "Year One" naming the sheet and the picker
		// already use. Same shape as the sweep above and for the same reason: it recognises a
		// generated name and writes one, so it is idempotent and needs no gate. The years that
		// go stale are the closed-out ones nobody re-records, so healing on write is not enough.
		// See migration/season-year-page-names.js.
		try { await renameAllSeasonYearPages(); }
		catch (err) { console.error("Stonetop | Chronicle year-page rename failed", err); }
		try { await migrateAllSteadingPeople(); }
		catch (err) { console.error("Stonetop | Residents/Neighbors → NPC conversion failed", err); }
		// Give already-linked Residents of Stonetop a "Stonetop" Home if theirs is blank
		// (new residents get this at creation). One-time, idempotent, GM-only.
		try { await backfillAllResidentHomes(); }
		catch (err) { console.error("Stonetop | Resident Home backfill failed", err); }
		// Pre-create both people folders so a player adding the first member never has to
		// (folder creation is a GM-only right; ensurePeopleFolder returns null for them).
		try { await ensurePeopleFolders(); }
		catch (err) { console.error("Stonetop | ensurePeopleFolders failed", err); }
		try { await _migrateTokenNameplates(); }
		catch (err) { console.error("Stonetop | token-nameplate migration failed", err); }
		try { await _migrateNpcPlaceholderPortraits(); }
		catch (err) { console.error("Stonetop | NPC placeholder-portrait migration failed", err); }
		try { await _migrateTokenImagesToPortraits(); }
		catch (err) { console.error("Stonetop | token-image backfill failed", err); }
		try { await _migrateShootMarker(); }
		catch (err) { console.error("Stonetop | initiate shoot-marker backfill failed", err); }
		try { await _migratePeoplePortraitsToWhole(); }
		catch (err) { console.error("Stonetop | people portrait/frame flip failed", err); }
		// Open the lettered village pins already on this world's scenes up to the players
		// they were always for (once per world; see revealLandmarkNotesOnce), then point any
		// that still open nothing at their Chronicle page (every load; a no-op once linked).
		try { await revealLandmarkNotesOnce(); }
		catch (err) { console.error("Stonetop | landmark map-pin reveal failed", err); }
		try { await linkLandmarkNotes(); }
		catch (err) { console.error("Stonetop | landmark map-pin linking failed", err); }
		// And bring the lettered discs' own formatting up to the current design, which nothing
		// else does: they are written once and never revisited, and they now share the village
		// map with the captions its printing letters, so a size change to either shows up as the
		// other being stale. Silent once they agree.
		try { await refitLandmarkNotes(); }
		catch (err) { console.error("Stonetop | landmark map-pin refit failed", err); }
		// Same bargain for the GM's own prep pins: a site dropped on a scene wears the Sites tab's
		// mound now, and every site pinned before that still wears a threat's torn note.
		//
		// Gated by VERSION rather than latched, which is the right shape for a refit: it is not a
		// one-shot repair but "bring these up to the current design", so it has to run again the
		// next time the design moves — and it does, because the stamp trails the new version. What
		// it stops is walking every Note on every Scene, a third time after the two landmark passes
		// above, on every load in between.
		try { await oncePerVersion("gmPrepPins", refitGmPrepPins); }
		catch (err) { console.error("Stonetop | GM-prep map-pin refit failed", err); }
		// And put the GM's already-placed sites onto the table's maps, for the world that gained
		// its poster Scenes AFTER it wrote its sites up — an ordinary order to do things in, since
		// pinning a site on the walkthrough's map needs no Scene at all. Nothing else does this:
		// the Scene pin was only ever written by a placement, so those sites went on saying
		// "already on The Vicinity" over a table map that had never heard of them.
		try {
			await oncePerVersion("sitePins", async () => {
				await reconcileSitePins(getStonetopSteadingActor()?.typedActor ?? null);
			});
		}
		catch (err) { console.error("Stonetop | site map-pin reconcile failed", err); }
		// Put the named places back on the poster maps, whose printing carries no labels at all,
		// and bring pins already down up to the current design. Every load, and
		// silent when they already agree: the only other thing that writes a poster-map Scene is
		// an offer this world answered long ago, so a pass that ran once could never change
		// anything it had already made (see markPosterMapScenes).
		try { await markPosterMapScenes(); }
		catch (err) { console.error("Stonetop | poster map marker placement failed", err); }
	}
	await runStartupMigrations();
	// If the renamed system has been installed alongside this one, offer to move this
	// world onto it. No-ops entirely until that system is present. See module/migration/.
	// Deliberately NOT awaited: the probe is an uncacheable request that 404s on every
	// load for every GM who has not installed the target yet, and nothing below reads its
	// result — the assistant is a modal the GM acts on whenever it arrives.
	maybeOfferMigration().catch(err => console.error("Stonetop | system-id migration offer failed", err));
	// Phase 3 of a system-id rename: the once-per-world sweep that rewrites asset paths,
	// compendiumSource stamps and sheet-class ids onto the active id. No-ops in a world
	// that has nothing stale. Awaited, because the sheet defaults it repairs are read at
	// init and everything below renders sheets.
	//
	// Phase 1, run late, comes FIRST: a world re-pointed at this system by hand, which is the
	// only way to do it on a hosted Foundry, arrives with its campaign still filed under the
	// old id and every sheet blank apart from its defaults. The sweep below is what corrects
	// the asset paths inside the bag it copies. See module/migration/rescue.js.
	try { await maybeRescueStrandedWorld(); }
	catch (err) { console.error("Stonetop | system-id rescue failed", err); }
	try { await finishSystemIdMigration(); }
	catch (err) { console.error("Stonetop | system-id migration finish failed", err); }
	await ensureStonetopSingleton();

	// The sheet-partial preload was kicked off in the init hook (core doesn't await init
	// hooks, so awaiting it there orders nothing). Await it here — before the auto-opening
	// sheet / walkthrough renders below — so every partial is registered first, closing the
	// "partial could not be found" race. Guarded: a single bad partial path must not abort
	// the rest of onReady (API wiring, dialogs, gazetteer) — a missing partial is at worst
	// a cosmetic "could not be found" later, not a dead ready flow.
	try { await game.stonetop?.templatesReady; }
	catch (err) { console.error("Stonetop | sheet partial preload failed", err); }

	game.stonetop ??= {};
	game.stonetop.openEndOfSession  = () => new EndOfSessionDialog().render(true);
	game.stonetop.openIntroductions = () => IntroductionsDialog.open();
	// Cursor onChange dispatcher (registered on the introCursor world setting): opens/
	// focuses/closes the Introductions dialog on the active player's client as the GM
	// drives the round-robin. See dialogs/IntroductionsDialog.js.
	game.stonetop.onIntroCursor     = cursor => IntroductionsDialog.handleIntroCursor(cursor);
	game.stonetop.openSpringBurst   = () => SpringBurstDialog.open();
	// Run the steading's Seasons Change homefront move from the hotbar: launch the
	// season-picker → roll flow (the same one the sheet's Seasons Change move uses)
	// WITHOUT opening the steading sheet — the dialog carries a "Stonetop" header
	// button to jump to the sheet if wanted. Warns if there's no steading yet.
	game.stonetop.openSeasonsChange = () => {
		getStonetopSteadingActorOrWarn()?.sheet._onSeasonsChange();
	};
	// Compile the recorded Introductions + Spring Burst answers into the shared
	// "Chronicle" journal and open it (GM-only). Callable from the Introductions
	// dialog's "Let spring break forth!" finish, the Expedition dialog, a macro, or
	// the console.
	game.stonetop.saveChronicle     = () => writeChronicle().then(j => j?.sheet?.render(true));
	game.stonetop.openExpedition    = () => ExpeditionDialog.open();
	game.stonetop.openWeather       = () => WeatherDialog.open();
	// Put the canvas weather back in step with the weather-effect settings. Registered here
	// because settings.js reaches this way rather than importing the seasons module, which reads
	// settings.js itself; its onChange handlers call this whenever one of those switches moves.
	game.stonetop.refreshWeatherFx  = () => refreshWeatherFx();
	game.stonetop.openWelcome       = () => WelcomeDialog.open();
	game.stonetop.openFoundryBasics = () => FoundryBasicsDialog.open();
	// Preview/test the player-facing creation intro for any character on demand
	// (it normally only auto-pops on the owning player's client). Pass an actor, or
	// it falls back to the current user's assigned character:
	//   game.stonetop.openCharacterCreation()
	game.stonetop.openCharacterCreation = (actor = game.user.character) =>
		actor ? CharacterCreationDialog.open(actor)
		      : ui.notifications.warn("No character to start creation for.");
	// Cut every picture this world could have out of the book art already on disk — the detail
	// portraits, the square faces the small round pictures use, and the square a creature's token
	// stands on — then point NPCs and creatures already in play at them. GM-only (it writes files).
	//
	// The same work the one-time chat card offers, reachable on demand because that card latches
	// the moment it is posted: scrolled past, deleted, or landed on the other GM and it is gone
	// for good. Safe to run any number of times — every stage re-plans from what is on disk.
	game.stonetop.rebuildPortraits = async () => {
		if (!game.user.isGM) return ui.notifications.warn("Only a GM can rebuild book art.");
		const { runBookArtRebuild, countBookArtRebuilds, describeRebuild } =
			await import("../book2-art/run-rebuild.js");
		const todo = await countBookArtRebuilds();
		if (!todo) return ui.notifications.info("Every picture this world can build is already on disk.");
		// The other two entry points are buttons, which count down in their own label. This one
		// has no button, and a toast that fades after five seconds while a 140-image job runs on
		// is the exact thing the notification bar exists for. No delay: the caller just asked.
		const bar = openProgressNotification(
			`Stonetop: rebuilding ${todo} picture${todo === 1 ? "" : "s"}`, { delayMs: 0 });
		let res;
		try {
			res = await runBookArtRebuild({
				onProgress: (done, total) => bar.update({ fraction: done / total, detail: `${done} of ${total}` }),
			});
		} catch (err) {
			bar.abandon();   // a died-part-way run must not sign off with a full bar
			throw err;
		}
		bar.close();
		ui.notifications[res.failed ? "warn" : "info"](describeRebuild(res));
		return res;
	};
	game.stonetop.rollDieOfFate     = rollDieOfFate;
	// Open the love-letter authoring dialog (GM-only; Book I p.568). Wired to the
	// "Write a Love Letter" hotbar macro and callable from the console.
	game.stonetop.openLoveLetter    = () => LoveLetterDialog.open();
	// Roll a learned move from its uuid — the entry point the move hotbar macros call
	// (drag a move off a character sheet onto the hotbar; see hooks/HotbarDrop.js).
	game.stonetop.rollMoveMacro     = rollMoveFromUuid;
	// Look THROUGH what the world holds, with a tab per list: every arcanum (the shipped
	// compendium plus any homebrew cards, filtered by what each one does and by how badly its
	// Consequences track punishes whoever carries it), every monster stat block, and every NPC.
	// GM prep: both compendia are GM-hidden, half the point of the arcana list is reading the
	// curses on cards the players haven't found, and an NPC's status and home are the GM's own
	// notes — so its macro is seeded inside the GM-only block below and there is no button for
	// it on a character sheet. Pass a source to land on a particular tab:
	//   game.stonetop.openBrowser("people")
	//
	// `ownedSlugs` only badges arcana rows as "Held". Read off the caller's assigned character
	// when they have one (a GM usually doesn't), so the badges are right without the browser
	// having to be opened from a sheet.
	game.stonetop.openBrowser = (source, actor = game.user.character) =>
		StonetopBrowserDialog.open({ source, ownedSlugs: actor ? resolvedFlags(actor).arcana?.owned ?? [] : [] });
	// The two windows "Browse Stonetop" replaced, kept as the tab they used to open. Console
	// and macro habits outlive a merge, and both are one line.
	game.stonetop.openArcanaBrowser   = (actor)  => game.stonetop.openBrowser("arcana", actor);
	game.stonetop.openBestiaryBrowser = (source) => game.stonetop.openBrowser(source ?? "monsters");
	// Create a blank homebrew arcanum world Item and open its editor. Minor by default;
	// pass { major: true } for a major. Callable from a macro/console/hotbar:
	//   game.stonetop.createArcanum({ name: "My Charm" })
	game.stonetop.createArcanum     = (opts = {}) => createArcanumItem(opts);
	// Open the Artifact Creation inspiration wizard; on finish it creates a standalone
	// homebrew arcanum world Item pre-filled with the rolled results and opens its editor.
	// Callable from a macro/console/hotbar:  game.stonetop.inspireArcanum()
	game.stonetop.inspireArcanum    = () => new StonetopArcanaInspireDialog({
		onCreate: ({ name, major, front }) => createArcanumItem({ name, major, front }),
	}).render(true);
	// Manually re-apply the durable Book II art to the compendium + world journals + world
	// actors, bypassing the once-per-version gate. The dev-loop entry point after
	// re-assigning art in the picker + regenerating the manifest (a world reload picks up
	// the new manifest.js; this then re-flows it without waiting for a version bump). Pass
	// { worldOnly: true } to only touch world journals. Returns the pass's stats.
	//   game.stonetop.reapplyBook2Art()
	//
	// Drops the directory-listing cache first (see book2-art/browse.js). This is the one entry
	// point whose whole purpose is "I have just changed what is on disk, go and look again" —
	// and it is reached by hand, from a console, typically right after dropping files in a way
	// nothing in the system can hook. A warm listing from earlier in the session would answer
	// with the state that prompted the call.
	game.stonetop.reapplyBook2Art   = (opts = {}) => { clearArtBrowseCache(); return reapplyBook2Art(opts); };
	// Launch the interactive bring-your-own-book "Import Book Art" extractor macro (NOT the
	// silent re-point pass above). The entry point the post-startup art-reminder chat button
	// and the Welcome guide's "Import Book Art" button both call. Callable from the console:
	//   game.stonetop.importBookArt()
	game.stonetop.importBookArt     = () => runImportBookArtMacro();

	_registerCharacterAutoOpen();
	_registerGmToolkitAdopt();
	// Close any half-finished creation whose character is deleted out from under it — the
	// GM minting a replacement is a delete first. Every client, since the player who loses
	// the character is rarely the one who pressed the button. See creation-flow.js.
	registerCreationFlowCleanup();

	// Both of these read `seedingComplete` to tell a fresh world from an established one, so
	// both MUST stay above runWorldSetup() (which is what sets it). See their own comments.
	if (game.user.isGM) await stampWorldLayoutBaseline();
	if (game.user.isGM) await _applyCoreSettingDefaultsForNewWorld();
	if (game.user.isGM) await _ensurePlayerActorCreationGrant();
	// The world HAVING a toolkit and this GM being pointed at one are two questions, and only the
	// second is answered once per user. _assignGmToolkitToGm returns on its latch before it reaches
	// the mint, so a world whose gamemasters have all been assigned already would never re-check —
	// which is how a world that reached zero (emptied before the delete guard shipped, or by a
	// macro passing noHook) would stay empty, and how a toolkit still wearing Foundry's mystery-man
	// would never pick up the portrait. Asking here, unlatched, is what makes both self-correcting.
	if (game.user.isGM) await _ensureGmToolkit();
	if (game.user.isGM) await _assignGmToolkitToGm();

	// Set this world up: the durable-art re-apply, the gazetteer seed, the bestiary and the
	// treasure library — narrated by the setup progress window when there is actually a wait
	// to explain (see hooks/WorldSetup.js). Everything runs in the BACKGROUND so it never
	// holds up the ready sequence or the Welcome guide.
	//
	// `runWorldSetup()` settles when the art re-apply and the whole journal chain are done.
	// An established world's chain is a handful of guarded no-ops that return in a tick, so
	// it is awaited inline as before, which is what keeps the Setting Overview / walkthrough
	// ordering below reading off journals that are already there. A FRESH world imports ~160
	// entries, so it isn't: we pop the Welcome guide right away and surface the seeded
	// orientation material once the import lands (see the `wasFreshWorld` handling below).
	//
	// One thing an established world no longer waits for: the every-load world-only art
	// self-heal, which used to be awaited right here and now runs in runWorldSetup's finishing
	// pass. It has to browse all six durable art directories before it can find out there is
	// nothing to do, and that round trip is exactly what should not sit in front of the first
	// window the GM sees. So the Setting Overview can open a beat before art lands on it —
	// which is fine, since a document update re-renders an open sheet — but nothing below may
	// assume the journals have their final artwork.
	const isGM = game.user.isGM;
	const wasFreshWorld = isGM && pendingSetupWork().journals;
	let seeding = Promise.resolve();
	if (isGM) {
		seeding = runWorldSetup();
		if (!wasFreshWorld) await seeding;

		await _retireIntroductionsMacro();
		// Both before the placement below, and in this order, so the slot the old "Browse the
		// Arcana" held is free for the "Browse Stonetop" that replaced it: deleting a macro
		// leaves its id sitting in `user.hotbar`, and the sweep is what takes it out. That sweep
		// is world-wide rather than scoped to those two — see its own comment for why it has to
		// be, and why it is its own call rather than a tail of the retirement.
		await _retireMergedBrowserMacros();
		await _clearDanglingHotbarSlots();
		// Place any missing system macros at their default slots (existing placements
		// are left alone, so a manual rearrangement sticks). Their fixed starting order
		// — 1 Welcome · 2 Seasons Change · 3 Run an Expedition · 4 Weather · 5 Write a
		// Love Letter · 6 Die of Fate · 7 Browse Stonetop · 9 The Chronicle · 10 End of
		// Session — is applied for the slots-1–6 set per layout version by _reorderSystemMacros, below;
		// Chronicle and End of Session are placed (but not reordered) by their own
		// _ensureHotbarMacro calls.
		for (const macro of _SYSTEM_MACROS) await _ensureHotbarMacro(macro);
		await _ensureHotbarMacro({
			name: _CHRONICLE_MACRO_NAME, img: _CHRONICLE_MACRO_IMG, command: _CHRONICLE_MACRO_SCRIPT, slot: _CHRONICLE_HOTBAR_SLOT,
			match: m => m.command === _CHRONICLE_MACRO_SCRIPT && m.name === _CHRONICLE_MACRO_NAME,
		});
		await _ensureHotbarMacro({
			name: _EOS_MACRO_NAME, img: _EOS_MACRO_IMG, command: _EOS_MACRO_SCRIPT, slot: _EOS_HOTBAR_SLOT,
			match: m => m.command === _EOS_MACRO_SCRIPT && m.name === _EOS_MACRO_NAME,
		});
		await _reorderSystemMacros();
		await _ensureTestPopulateMacro();
		await _ensureBook2ArtMacro();
	} else {
		// A player's share of the same pass: the Die of Fate belongs on everyone's bar.
		try { await ensurePlayerHotbarMacros(); }
		catch (err) { console.error("Stonetop | player hotbar macro placement failed", err); }
	}
	if (game.user.isGM) {
		await _postStartupWelcomeMessageOnce();
		await _postBook2ArtReminderOnce();
		// Background, like the seeds above. This one has to BROWSE the art folder before it
		// can tell there is nothing to offer, and it deliberately leaves its flag unset when
		// the plan is empty so a later import still gets the nudge — so for a GM who never
		// imports, an awaited call stalls the ready sequence on a server round-trip whose
		// answer is always "nothing", on every single load. Nothing below waits on it.
		_offerBookArtRebuildOnce()
			.catch(err => console.error("Stonetop | portrait rebuild offer failed:", err));
		// Backgrounded for the same reason, and it browses the very same folder. Ordered after
		// the rebuild offer so a world owed both is asked about the free one first: cutting
		// portraits from art already on disk costs the GM nothing, while this one asks them to
		// go and find their PDFs.
		_offerPartialArtImportOnce()
			.catch(err => console.error("Stonetop | partial art import offer failed:", err));
		// Backgrounded and folder-browsing like the two above, and ordered LAST of the three on
		// purpose: it is the only one that is not about a gap. The rebuild fixes pictures the GM
		// is owed for free, the partial import fixes ones that failed; this one offers to improve
		// art that is already there and already looks fine, so it yields to both.
		_offerGmPlaybookArtOnce()
			.catch(err => console.error("Stonetop | GM playbook art offer failed:", err));
		await remindDestinedOmenRoll();
	}

	// Established worlds have their journals already; open the orientation material now,
	// before the Welcome guide, so a resumed walkthrough can still land on top. Fresh
	// worlds defer this until the background seed finishes (below), since the Setting
	// Overview journal doesn't exist yet.
	if (!wasFreshWorld) await _openSettingOverview();

	// Reopen any GM walkthrough — session-zero (Introductions / Let Spring Burst Forth)
	// or Run an Expedition — that was open when this client last reloaded, at the page it
	// was on. Per-client, so it only fires for whoever actually had one open. See
	// walkthrough-resume.js.
	//
	// The GM Welcome guide auto-opens here too, but its getData awaits a pack index so
	// it renders a beat later and would bury a resumed walkthrough — so when it's
	// opening, reopen only once it's up (with a timeout fallback so a failed/absent
	// Welcome render can't strand the resume).
	let welcomeDialog = null;
	if (game.user.isGM && !getSetting("gmWelcomeShown") && !sessionZeroComplete()) {
		let resumed = false;
		const resume = () => { if (resumed) return; resumed = true; reopenOpenWalkthroughs(); };
		Hooks.once("renderWelcomeDialog", resume);
		setTimeout(resume, 2500);
		welcomeDialog = _openGmWelcomeGuide();
	} else {
		reopenOpenWalkthroughs();
	}

	// A player logging in / reloading mid-introductions: rejoin the running session by
	// opening the dialog whenever the GM has it open (following read-only until it's their
	// turn). The onChange handler covers live changes; this covers the no-event initial
	// load. No-op for the GM.
	IntroductionsDialog.openForActiveSession();

	// Fresh world: the gazetteer is still importing in the background. Once it lands, pop
	// the orientation Setting Overview and refresh the (already-open) Welcome guide so its
	// premise upgrades from the built-in fallback to the seeded journal's prose, bringing
	// the guide back above the Overview so it stays the GM's focus.
	if (wasFreshWorld) {
		seeding
			.then(() => _showOrientationAfterSeed(welcomeDialog))
			.catch(err => console.error("Stonetop | Deferred orientation after journal seed failed:", err));
	}
}

async function _applyCoreSettingDefaultsForNewWorld() {
	if (getSetting("coreSettingDefaultsApplied")) return;

	// These core defaults were added after some worlds already existed. If the
	// Stonetop journals have already been seeded, treat the world as established
	// and mark the migration complete without changing the GM's current preferences.
	if (getSetting("seedingComplete")) {
		await setSetting("coreSettingDefaultsApplied", true);
		return;
	}

	// Best-effort: a failure here must not strand the flag (which would re-run every
	// load). Logs and moves on, then we record that this world's defaults have been
	// applied. NOTE: the player actor-creation grant is deliberately NOT here — it
	// runs from its own gate (_ensurePlayerActorCreationGrant) so ESTABLISHED worlds,
	// which return early above, still get it. The actor-backed steading roster needs
	// players to be able to create the NPC actors it links.
	await _defaultDisableAutomaticTokenRotation();

	await setSetting("coreSettingDefaultsApplied", true);
}

// Grant players the ACTOR_CREATE permission once per world, independent of world age.
// The new-world defaults above short-circuit on established worlds (seedingComplete),
// which meant a world that predates the actor-backed steading roster never got this
// grant — so players hit "you don't have permission" when adding a Resident/Neighbor,
// which creates an NPC actor. This gate has its own world flag so it runs exactly once
// on ANY world (fresh or established) that hasn't been granted yet; a GM who later
// revokes the permission under Configure Permissions keeps it revoked (never re-runs).
async function _ensurePlayerActorCreationGrant() {
	if (getSetting("playerActorCreationGranted")) return;
	await _defaultAllowPlayerActorCreation();
	await setSetting("playerActorCreationGranted", true);
}

// The world's GM Toolkit: find it, or make it. ONE per world, like the steading, and enforced
// the same way — hooks/StonetopSingleton.js vetoes a second create and refuses to delete the
// last, so the primary GM mints it and every GM after that finds it.
//
// One is the right number because nothing on the sheet is per-GM: the Moves and Core Loop tabs
// are reference transcribed from the playbook, the Threats and Sites tabs read their storage off
// the STEADING, and the "I wonder..." list on `system.wonders` is the world's open questions
// rather than any one gamemaster's. What genuinely varies between
// gamemasters is which sheet their "C" key opens, and that is a per-user flag on the User
// document (see _assignGmToolkitToGm below), not a second Actor.
//
// Plain find-or-mint, with NO once-per-user latch, and the delete guard is what pays for that:
// with deletion refused, "no toolkit in this world" can only mean "never made one". There is no
// don't-resurrect-what-somebody-threw-away case left to remember, and no flag that could jam the
// gate shut by conflating "already minted" with "could not mint".
//
// The toolkit is stamped `ownership.default = NONE` by StonetopActor#_preCreate, so it never
// appears in a player's Actors sidebar. GM-only caller.
export async function _ensureGmToolkit() {
	const existing = theGmToolkit();
	if (existing) {
		await _adoptGmToolkitPortrait(existing);
		return existing;
	}

	// Minting is a shared-world write, so exactly ONE client may do it (utils/primary-gm.js).
	// The preCreateActor veto cannot cover this on its own: it counts the INITIATING client's
	// `game.actors`, so two GMs whose `ready` lands inside the same broadcast window both read
	// zero and both pass, and the world gets two toolkits with the "I wonder..." list split
	// across them. The steading has been gated this way all along (ensureStonetopSingleton); the
	// toolkit missed it only because its mint rides inside a per-user function that must run on
	// every GM client. A non-primary GM returns empty-handed and is handed the toolkit the moment
	// the primary's create broadcasts (_registerGmToolkitAdopt), or failing that, next load.
	if (!isPrimaryGM()) return null;

	// Silent: this runs before anyone has asked for anything, so a world whose launch predates
	// the subtype should say nothing and try again next load rather than greet the GM with a
	// warning about a sheet they have not gone looking for. Returns null on any failure, and the
	// next load simply asks again.
	return await createGmToolkit({ warn: false });
}

// Put the toolkit's own mark on a toolkit that predates it, and ONLY over a stock default.
//
// The portrait shipped after the subtype did, so worlds already hold toolkits wearing Foundry's
// mystery-man. That is not a portrait anybody chose — it is the absence of one, and on this sheet
// it actively misleads, since it reads as "a person nobody has found a picture for". So this is a
// self-heal rather than a migration, in the shape StonetopActor#_preCreate already uses for an
// art-less NPC: `isDefaultImg` gates it, so a GM who set their own picture keeps it for good.
//
// Deliberately narrower than the steading's equivalent (_ensureStartingValues, which re-asserts
// ownership on every load): once this has run the image is no longer a default, so it never runs
// again and cannot fight a later choice.
//
// Primary GM only. Every GM client reaches _ensureGmToolkit, and this is a shared-world write.
async function _adoptGmToolkitPortrait(toolkit) {
	if (!isPrimaryGM() || !isDefaultImg(toolkit.img)) return;
	try {
		await toolkit.update({
			img: GM_TOOLKIT_DEFAULT_IMG,
			"prototypeToken.texture.src": GM_TOOLKIT_DEFAULT_IMG,
		});
	} catch (err) {
		// Cosmetic, so a failure must never cost the GM their toolkit: the caller still returns it
		// and the next load simply tries again.
		console.warn("Stonetop | Could not set the GM Toolkit portrait.", err);
	}
}

// Give a GM who has no assigned character their GM Toolkit as their default character, once.
// Foundry's `User#character` only references an actor id (it needn't be a `character`-type
// actor), so the toolkit rides in the GM's player-list entry and their "toggle character
// sheet" hotkey (core binds C → game.toggleCharacterSheet, which opens game.user.character
// when no token is controlled) opens it in a click.
//
// It used to be the STEADING behind that key, from before the GM had a sheet of their own.
// The toolkit is the better answer now: it holds the GM moves and, since they moved off the
// steading, the Threats and Sites prep. A GM who is still on the steading from an earlier run
// is moved across — that assignment was ours to begin with, and the `gmSteadingAssigned` flag
// is how we know it was. A GM who chose something else is left alone.
//
// The once-gate is a per-USER WORLD flag on the GM's own User document — NOT a client
// setting. A client-scoped setting lives in the browser's localStorage keyed only by
// namespace.key, so it leaks across every world on this browser+server and a "fresh world"
// reads it already-set — which silently skipped this assignment (nothing became the GM's
// character, so C did nothing). A User flag resets per world (new world = new User docs) and
// is still per-user, so it gates correctly:
//   • a GM who already runs their own PC is left untouched — we record the flag and never
//     re-check; and
//   • a GM who later clears the assignment stays cleared — we never re-assign.
// If the toolkit could not be minted, we return WITHOUT setting the flag so the next load
// tries again. GM-only caller.
export async function _assignGmToolkitToGm() {
	if (game.user.getFlag(STONETOP_SCOPE, "gmToolkitAssigned")) return;

	const toolkit = await _ensureGmToolkit();
	const current = game.user.character;

	// Somebody else's choice: their own PC, or anything we did not put there. Respect it and
	// stop checking. The one assignment we WILL move is the steading we assigned ourselves in
	// an earlier version, which `gmSteadingAssigned` records.
	if (current) {
		const oursToMove = current.type === "stonetop"
			&& !!game.user.getFlag(STONETOP_SCOPE, "gmSteadingAssigned");
		if (!oursToMove) {
			await game.user.setFlag(STONETOP_SCOPE, "gmToolkitAssigned", true);
			return;
		}
	}

	if (!toolkit) return; // not minted yet — retry next load, flag left unset

	// The assignment and its latch in ONE write, rather than an update followed by a setFlag.
	// Two writes to the same User document is one round trip more than the job needs, and it is
	// the pairing that matters: if the second half fails, the next load re-assigns a character
	// that is already assigned. Together they land or neither does.
	try {
		await game.user.update({
			character: toolkit.id,
			flags: { [STONETOP_SCOPE]: { gmToolkitAssigned: true } },
		});
	} catch (err) {
		console.warn("Stonetop | Could not assign the GM Toolkit as the GM's character.", err);
		// Flag left unset so the next load tries again — which it now can, because
		// _ensureGmToolkit hands back the toolkit it already minted.
	}
}

// Let players create actors: their own characters from Foundry's "Create Actor"
// dialog, and the NPC actors the steading Residents/Neighbors roster links. Core ships
// the ACTOR_CREATE permission as Assistant-GM-and-up only, so without this a player
// hits "you don't have permission" adding a resident (and never sees the sidebar's
// "Create Actor" button). Its caller (_ensurePlayerActorCreationGrant) adds the Player
// and Trusted Player roles exactly once per world, so the GM keeps full control
// afterward: revoking it under Configure Permissions sticks, because this never runs
// again. ACTOR_CREATE isn't per-type, so this also lets players create other actor
// types — the steading singleton and monster-builder preCreateActor hooks
// (StonetopSingleton.js) already guard those paths.
async function _defaultAllowPlayerActorCreation() {
	try {
		const R = CONST.USER_ROLES;
		const permissions = foundry.utils.deepClone(game.settings.get("core", "permissions") ?? {});
		// A missing key means core's computed default applies (every role at or above
		// the permission's defaultRole); mirror that so we EXTEND the real default
		// rather than clobber the other roles. See PermissionConfig#preparePermissions.
		const current = permissions.ACTOR_CREATE
			?? Array.fromRange(R.GAMEMASTER + 1).slice(CONST.USER_PERMISSIONS.ACTOR_CREATE.defaultRole);
		permissions.ACTOR_CREATE = Array.from(new Set([...current, R.PLAYER, R.TRUSTED])).sort((a, b) => a - b);
		await game.settings.set("core", "permissions", permissions);
	} catch (err) {
		console.warn("Stonetop | Could not grant players actor-creation permission for this new world.", err);
	}
}

async function _defaultDisableAutomaticTokenRotation() {
	const settingKey = _findAutomaticTokenRotationSettingKey();
	if (!settingKey) {
		console.warn("Stonetop | Could not find Foundry's Automatic Token Rotation setting; leaving it unchanged.");
		return;
	}

	try {
		if (game.settings.get("core", settingKey) !== false) {
			await game.settings.set("core", settingKey, false);
		}
	} catch (err) {
		console.warn("Stonetop | Could not disable Automatic Token Rotation for this new world.", err);
	}
}

function _findAutomaticTokenRotationSettingKey() {
	const registry = game.settings?.settings;
	if (!registry) return null;

	const candidates = [];
	for (const [id, config] of registry.entries()) {
		const namespace = config.namespace ?? id.split(".")[0];
		if (namespace !== "core") continue;

		const key = config.key ?? (id.startsWith("core.") ? id.slice("core.".length) : id);
		if (!key) continue;

		const name = _localizedSettingText(config.name);
		const hint = _localizedSettingText(config.hint);
		const haystack = `${key} ${config.name ?? ""} ${name} ${hint}`.toLowerCase();

		if (haystack.includes("automatic token rotation")) return key;
		if (haystack.includes("token") && haystack.includes("rotation") && haystack.includes("automatic")) candidates.push(key);
	}

	return candidates.length === 1 ? candidates[0] : null;
}

function _localizedSettingText(value) {
	if (!value) return "";
	const text = String(value);
	return String(game.i18n?.localize?.(text) ?? text);
}

// Auto-open a freshly-minted character on its owner's screen. The GM stamps the
// new actor with an `autoOpenFor` flag (see WelcomeDialog._onCreateCharacter);
// the owning client opens the sheet and clears the flag so it only ever pops
// once. This is race-free either way: a character created while the owner is
// online fires `createActor` on their client, and one created while they're
// offline is caught by the ready-time sweep when they next log in.
function _registerCharacterAutoOpen() {
	Hooks.on("createActor", actor => _maybeOpenCharacterCreation(actor));
	for (const actor of game.actors) _maybeOpenCharacterCreation(actor);
}

// Hand a co-GM the toolkit the moment it appears, rather than making them reload.
//
// Only the primary GM mints one (_ensureGmToolkit), so a second GM whose `ready` ran first has
// nothing to be assigned and leaves `gmToolkitAssigned` unset to retry next load. That retry is
// the correctness story; this is the part that makes it invisible. `_assignGmToolkitToGm` is
// already idempotent — the flag is its first line — so firing it again costs a flag read.
//
// Ignores creates THIS client initiated: `createActor` fires from inside the create's response
// handling, before `Actor.create` resolves, so our own mint would re-enter
// _assignGmToolkitToGm while the outer call is still mid-flight and both halves would write the
// same User update.
export function _registerGmToolkitAdopt() {
	Hooks.on("createActor", (actor, _options, userId) => {
		if (!game.user?.isGM || userId === game.user.id) return;
		if (!isGmToolkitData(actor)) return;
		// Returned rather than dropped only so a test can await it — Foundry ignores whatever a
		// `createActor` handler hands back. The catch is what makes that safe: an assignment that
		// throws here has no caller to report to, and the next load retries anyway.
		return _assignGmToolkitToGm()
			.catch(err => console.warn("Stonetop | Could not adopt the GM Toolkit.", err));
	});
}

// Is this character one of MINE, for the purposes of the creation prompt below?
//
// Not `game.user.character` on its own. That field holds ONE id, and a player may run more than
// one character (see actors/character/create-character.js): a second one is added without taking
// the assignment, so an assignment test would never re-prompt it — reload mid-creation on your
// second sheet and the resume never fires, leaving you on a blank sheet with an hour of answers
// sitting in localStorage.
//
// Not `actor.isOwner` on its own either. That is also true of a sheet the whole table can edit
// through `ownership.default`, and a world set up that way would ask every player to go and
// finish somebody else's half-built character. The test is the ownership entry made out to me BY
// NAME — the same one charactersOwnedBy reads and the mint stamps, so "do you already have
// characters?" and "is this one of mine?" can never disagree.
//
// Finally, a character somebody ELSE has assigned is theirs, whoever else can edit it. That
// leaves two co-owners of an UNassigned character both being prompted, which is the right answer
// for a PC being built jointly, and is guarded per client by creationFlowOpen() regardless.
//
// GMs are excluded outright: a GM owns every actor in the world.
function _isMyCharacter(actor) {
	if (game.user.isGM || !actor?.id) return false;
	const mine = game.user.character?.id === actor.id
		|| (actor.ownership?.[game.user.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
	if (!mine) return false;
	const users = game.users?.contents ?? game.users ?? [];
	return ![...users].some(u => u.id !== game.user.id && u.character?.id === actor.id);
}

// Greet a player with character creation, or resume an interrupted one:
//   • a freshly GM-minted character (the `autoOpenFor` flag names its owner) gets
//     the creation intro, once; and
//   • the player's OWN character that still has no playbook is re-prompted every load
//     until they actually pick one: with saved progress it resumes straight back into
//     onboarding at that page (a reload mid-creation drops them back in); with none it
//     re-pops the creation intro. Either way a player who reloaded before choosing a
//     playbook lands back in creation rather than on a blank sheet they'd have to start
//     onboarding from themselves.
// A character that already has a playbook is finished (or was explicitly saved):
// only a brand-new mint pops its sheet; a reload leaves a finished character alone.
function _maybeOpenCharacterCreation(actor) {
	if (actor?.type !== "character") return;
	const mintedForMe = actor.getFlag?.(STONETOP_SCOPE, "autoOpenFor") === game.user.id;
	if (!mintedForMe && !_isMyCharacter(actor)) return;

	// Someone on this screen is already mid-creation — the intro, the playbook picker or
	// the onboarding walkthrough is up, for this character or another. Re-entering now
	// would bury the flow they are in and, if they clicked through, restart them at the
	// picker with their answers stranded behind it. Bail BEFORE clearing autoOpenFor: the
	// mint's one-shot greeting is preserved rather than burnt on a prompt nobody saw, so
	// it arrives on the next load instead.
	if (creationFlowOpen()) return;

	// Owner-only flag; drop it now so the mint greeting only ever fires once.
	if (mintedForMe) actor.unsetFlag(STONETOP_SCOPE, "autoOpenFor").catch(() => {});

	if (playbookSlug(actor)) {
		// Finished — never re-enter creation. Clear any progress flag / resume
		// snapshot a mid-creation "Save & close" (or an edit pass) left behind, so the
		// GM roster reads "Finished" rather than a stale "exited"/page note.
		//
		// Only when there IS one: unsetFlag issues its update unconditionally, and this
		// runs once per character of mine on every load. With a player able to run several,
		// an unguarded call is a document write and a broadcast per finished sheet per
		// login, all of them deleting a key that is already gone.
		if (actor.getFlag?.(STONETOP_SCOPE, "onboardingProgress")) {
			actor.unsetFlag?.(STONETOP_SCOPE, "onboardingProgress").catch(() => {});
		}
		clearOnboardingResume(actor);
		if (mintedForMe) actor.sheet.render(true);
		return;
	}

	// No playbook yet. When there's a saved snapshot (picked playbook + selections,
	// autosaved client-side by _launchOnboarding), resume straight into onboarding at
	// that page; otherwise greet them with the creation intro — its "Create Character"
	// button walks them through the picker / onboarding and then opens their finished
	// sheet (see CharacterCreationDialog / _onNewCharacter's `openSheetWhenDone`). This
	// fires for both a fresh mint and the player's own assigned-but-unstarted character,
	// so reloading before picking a playbook re-prompts rather than stranding them.
	const snap = readOnboardingResume(actor);
	if (snap?.playbookUuid && snap?.selections) {
		actor.sheet._onNewCharacter({ openSheetWhenDone: true, resume: true });
	} else if (!mintedForMe && progressFor(actor).status === "exited") {
		// They have already been offered this and deliberately backed out, with nothing saved
		// to resume. Re-modalling them on every load is nagging, and the modal is the thing
		// they closed. Open the sheet instead: it carries its own "Create Character" button
		// and the amber incomplete banner, so the way back in is right there whenever they
		// want it — nobody is stranded, and nobody is pestered. A fresh mint always greets.
		actor.sheet.render(true);
	} else {
		// Fire-and-forget from a sync hook callback, so catch here: open() awaits a stale
		// dialog's close, and an unhandled rejection would surface as a bare console error
		// with no hint that a player simply never got greeted.
		CharacterCreationDialog.open(actor)
			.catch(err => console.error("Stonetop | failed to open character creation", err));
	}
}

// Pop the first-session Welcome guide for the GM until either they tick "Don't show
// this automatically" (which sets gmWelcomeShown) or they finish both session-zero
// walkthroughs — the guided Introductions and Let Spring Burst Forth (sessionZeroComplete).
// Until one of those, the guide keeps greeting the GM across the first few loads.
function _openGmWelcomeGuide() {
	if (getSetting("gmWelcomeShown") || sessionZeroComplete()) return null;
	return WelcomeDialog.open();
}

// After a fresh world's background journal seed finishes, surface the orientation
// material the seed just created: pop the Setting Overview journal, then refresh the
// open Welcome guide so its premise (read from that journal) upgrades from the fallback
// and its cross-links resolve — and bring the guide back to the front so it sits above
// the Overview. If the seed somehow beat the guide's first render, wait for that render
// before refreshing. No-op if the GM already closed the guide.
async function _showOrientationAfterSeed(welcomeDialog) {
	await _openSettingOverview();
	if (!welcomeDialog) return;
	if (!welcomeDialog.rendered) {
		await new Promise(resolve => Hooks.once("renderWelcomeDialog", resolve));
	}
	if (welcomeDialog.rendered) {
		await welcomeDialog.render(false);
		welcomeDialog.bringToTop();
	}
}

// Pop the Setting Overview journal open so a fresh-start user lands on the
// world's orientation material. Two cases:
//   • everyone (GM included) sees it once per client the first time they connect,
//     guarded by the client-scoped `settingOverviewShown` flag so it never
//     re-interrupts later sessions; and
//   • a player with no character assigned yet sees it every load regardless of
//     that flag — until the GM mints them a character, the Overview is the thing
//     for them to read, so we keep surfacing it (a player with an assigned
//     character instead gets character creation via _maybeOpenCharacterCreation).
// The GM seeds the journal; SeedCompendiums grants players read access.
async function _openSettingOverview() {
	const overview = findVisibleJournal(SETTING_OVERVIEW_JOURNAL);
	if (!overview) return; // not seeded yet (or not visible to this user) — try again next load

	const needsOrientation = !game.user.isGM && !game.user.character;
	if (!needsOrientation && getSettingOverviewShown()) return;

	overview.sheet.render(true);
	if (!getSettingOverviewShown()) await markSettingOverviewShown();
}

// Is a hotbar slot empty? The hotbar is a sparse map of slot → macro id, so an
// absent key means free. (`in` stringifies the slot, matching the string keys.)
function _isHotbarSlotFree(slot) {
	return !(slot in game.user.hotbar);
}

// The first empty hotbar slot at or after `from` (1–50, across all five pages), or
// null if the hotbar is somehow full. Lets us place a macro without evicting one
// the GM put in our default slot.
function _firstFreeHotbarSlot(from = 1) {
	for (let s = from; s <= 50; s++) if (_isHotbarSlotFree(s)) return s;
	return null;
}

// Find-or-create a global script macro and place it on the hotbar. Idempotent:
// refreshes the icon if it drifted, and only places the macro when it isn't already
// on the user's hotbar — so once it's placed, a manual rearrangement sticks. It
// takes its default `slot` only if that slot is free; otherwise it falls back to the
// first empty slot, so we never bump a macro the GM put there. The fixed system
// order is applied per layout version by _reorderSystemMacros. `match` overrides the
// default name-based lookup (the End of Session macro also keys on its command to
// avoid clashing with any user macro of the same name). Run these serially — each
// assignHotbarMacro writes the same user.hotbar document, so concurrent calls would
// clobber each other.
//
// GM-only (every call site sits inside a game.user.isGM block), which is what lets it
// set ownership: a Macro is created at ownership.default NONE, and only a GM may change
// that. A `shared` macro is raised to OBSERVER — on creation AND on an existing macro in
// a world that predates the flag, so the fix reaches tables already playing.
async function _ensureHotbarMacro({ name, img, command, slot, match, shared }) {
	const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
	let macro = game.macros.find(match ?? (m => m.name === name));
	if (!macro) {
		macro = await Macro.create({
			name, type: "script", img, command, scope: "global",
			...(shared ? { ownership: { default: OBSERVER } } : {}),
		});
	} else {
		const update = {};
		if (macro.img !== img) update.img = img;
		// Dotted, so a per-user grant the GM added by hand survives.
		if (shared && (macro.ownership?.default ?? 0) < OBSERVER) update["ownership.default"] = OBSERVER;
		if (Object.keys(update).length) await macro.update(update);
	}

	const alreadySlotted = Object.values(game.user.hotbar).includes(macro.id);
	if (alreadySlotted) return;

	const target = _isHotbarSlotFree(slot) ? slot : _firstFreeHotbarSlot();
	if (target) await game.user.assignHotbarMacro(macro, target);
}

// Place the shared system macros (currently just the Die of Fate) on a PLAYER's hotbar.
// The player never creates the Macro — a player-created copy would be a second document
// owned by them alone, one per player — so this only slots the world macro the GM's pass
// already made, and only once it is actually theirs to run: a world whose GM has not
// loaded since this shipped still has the macro at ownership NONE, and skipping it there
// keeps a dead icon off the bar. Both cases fix themselves on the player's next reload.
//
// Same non-destructive placement as the GM's: never evicts whatever is in the target slot,
// and never moves a macro that is already on the bar, so a player's own arrangement sticks.
//
// Exported for its test — onReady is the only caller.
export async function ensurePlayerHotbarMacros() {
	for (const { name, command, playerSlot } of _SYSTEM_MACROS.filter(m => m.shared)) {
		const macro = game.macros.find(m => m.name === name && m.command === command);
		if (!macro?.canExecute) continue;
		if (Object.values(game.user.hotbar).includes(macro.id)) continue;

		const target = _isHotbarSlotFree(playerSlot) ? playerSlot : _firstFreeHotbarSlot();
		if (target) await game.user.assignHotbarMacro(macro, target);
	}
}

// Snap the system macros into their canonical order (1 Welcome · 2 Seasons Change ·
// 3 Run an Expedition · 4 Weather · 5 Write a Love Letter · 6 Die of Fate), then leave the arrangement alone
// so the GM is free to rearrange the hotbar. Guarded by a per-client layout version
// (the hotbar is per-user): it runs once per layout, so bumping _HOTBAR_LAYOUT_VERSION
// re-snaps everyone once (e.g. when Seasons Change was inserted) but later manual moves
// at the same version are left alone.
//
// Non-destructive: it never evicts a macro the GM placed in one of our slots. We
// first lift our own macros off the bar (freeing their slots), then re-place each at
// its canonical slot if free, else the first empty slot. So a personal macro sitting
// in slot 2 keeps its spot and ours flows around it.
async function _reorderSystemMacros() {
	if (getSetting("systemHotbarLayoutVersion") >= _HOTBAR_LAYOUT_VERSION) return;

	const macros = _SYSTEM_MACROS
		.map(o => ({ macro: game.macros.find(m => m.name === o.name && m.command === o.command), slot: o.slot }))
		.filter(o => o.macro);

	// Lift our macros off the hotbar so their canonical slots open up (a user macro
	// in one of those slots stays put). assignHotbarMacro(null, slot) clears a slot.
	for (const { macro } of macros) {
		const slot = Object.entries(game.user.hotbar).find(([, id]) => id === macro.id)?.[0];
		if (slot) await game.user.assignHotbarMacro(null, Number(slot));
	}

	// Re-place each at its canonical slot if free, else the first open slot.
	for (const { macro, slot } of macros) {
		const target = _isHotbarSlotFree(slot) ? slot : _firstFreeHotbarSlot();
		if (target) await game.user.assignHotbarMacro(macro, target);
	}

	await setSetting("systemHotbarLayoutVersion", _HOTBAR_LAYOUT_VERSION);
}

// Add the "(TEST ONLY) Populate World" script macro to the world's Macro Directory,
// inside a "For Testing Purposes" folder — but never to the hotbar (creating a Macro
// document doesn't slot it; only assignHotbarMacro does, which we deliberately skip).
// Its body is the create-test-characters dev script, fetched at runtime so that one file
// stays the single source of truth: a missing file (a build that omits scripts/) skips
// silently, leaving those worlds untouched. It ships in the release zip, so released
// worlds seed it as well. Seeded once — a GM who deletes it keeps it gone — but while it
// exists its command is re-synced so edits to the script propagate.
//
// GM-only twice over: the call site sits inside a game.user.isGM block, and the macro is
// created with default ownership NONE so it stays out of a player's Macro Directory even
// though Foundry lets players hold macros. Both matter now that it reaches real tables —
// running it seeds (and, on a re-run, DELETES) a roster of [TEST] fixtures.
async function _ensureTestPopulateMacro() {
	let command;
	try {
		const res = await fetch(_TEST_MACRO_SRC);
		if (!res.ok) return;
		command = await res.text();
	} catch { return; }
	if (!command?.trim()) return;

	// Find-or-create the "For Testing Purposes" Macro folder the macro lives in.
	let folder = game.folders.find(f => f.type === "Macro" && f.name === _TEST_MACRO_FOLDER);
	if (!folder) folder = await Folder.create({ name: _TEST_MACRO_FOLDER, type: "Macro" });

	const existing = game.macros.find(m => m.name === _TEST_MACRO_NAME);
	if (existing) {
		const update = {};
		if (existing.command !== command) update.command = command;
		if (existing.img !== _TEST_MACRO_IMG) update.img = _TEST_MACRO_IMG;
		if (folder && existing.folder?.id !== folder.id) update.folder = folder.id;
		if (Object.keys(update).length) await existing.update(update);
		return;
	}
	if (getSetting("testPopulateMacroSeeded")) return; // deleted on purpose — leave it gone

	await Macro.create({
		name: _TEST_MACRO_NAME, type: "script", img: _TEST_MACRO_IMG, command,
		scope: "global", folder: folder?.id ?? null,
		ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
	});
	await setSetting("testPopulateMacroSeeded", true);
}

// Add the "Import Book Art" macro to the world's Macro Directory — but never
// the hotbar. The shipped compendium doc is the single source of truth: its
// command/img are copied on first seed and re-synced while the world copy exists,
// so a system update refreshes it. Seeded once — a GM who deletes it keeps it
// gone. GM-only (called from the isGM block in onReady).
async function _ensureBook2ArtMacro() {
	const src = await loadBook2ArtMacroSource();
	if (!src?.command) return;

	const existing = findBook2ArtWorldMacro();
	if (existing) {
		const update = {};
		if (existing.name !== BOOK2_ART_MACRO_NAME) update.name = BOOK2_ART_MACRO_NAME;
		if (existing.command !== src.command) update.command = src.command;
		if (existing.img !== src.img) update.img = src.img;
		if (Object.keys(update).length) await existing.update(update);
		return;
	}
	if (getSetting("book2ArtMacroSeeded")) return; // deleted on purpose — leave it gone

	await Macro.create({ name: BOOK2_ART_MACRO_NAME, type: "script", img: src.img, command: src.command, scope: "global" });
	await setSetting("book2ArtMacroSeeded", true);
}

// Retire the standalone "Character Introductions" hotbar macro: its walkthrough
// now launches from the Welcome guide, so delete the system-created macro (which
// also clears its hotbar slot). No-op once done, so it's safe to run every load.
// (The Welcome macro re-homes itself: _ensureHotbarMacro now relocates any system
// macro that's pinned at the wrong slot.)
async function _retireIntroductionsMacro() {
	const intro = game.macros.find(m => m.name === _INTRO_MACRO_NAME && m.command === _INTRO_MACRO_SCRIPT);
	if (intro) await intro.delete();
}

// Delete the two catalogue browsers that "Browse Stonetop" replaced. Runs before
// _ensureHotbarMacro, and only ever touches macros this system created (name AND command must
// both match). GM-only: the call site sits inside a game.user.isGM block, and only a GM may
// delete a world Macro.
//
// Deleting them is only half of freeing their slots — see _clearDanglingHotbarSlots, which the
// ready sequence calls straight after this and which is what the placement below depends on.
async function _retireMergedBrowserMacros() {
	const ids = _RETIRED_BROWSER_MACROS
		.map(({ name, command }) => game.macros.find(m => m.name === name && m.command === command)?.id)
		.filter(Boolean);
	// One request for the pair rather than one apiece: this runs inside the awaited `ready`
	// chain, where every round trip is a beat before the world is usable.
	if (ids.length) await Macro.deleteDocuments(ids);
}

// Clear every hotbar slot pointing at a Macro that no longer exists.
//
// Its own call in the ready sequence rather than a tail call inside the browser retirement above,
// because it is not that migration's business and it is not scoped to it: this sweeps the WHOLE
// hotbar, including a slot orphaned months ago by a module the GM uninstalled. Hidden under a
// name about two specific macros, that breadth read as an accident.
//
// It is nonetheless what makes the placement below work. Deleting a Macro leaves its id sitting
// in `user.hotbar`, where _isHotbarSlotFree still counts the slot as taken — so without this the
// new "Browse Stonetop" would flow past slot 7 into the first genuinely empty slot and land
// somewhere arbitrary. And `user.hotbar` is PER-USER, so the delete only frees the slots on the
// hotbar of the GM who happened to load first; a second GM arrives to find the macros already
// gone and two tiles that draw nothing but still count as occupied. Which is exactly why it
// cannot be narrowed to the ids retired above: by then there is no macro left to read them off.
//
// Nothing visible is lost. A slot pointing at a deleted macro already draws a blank tile that
// opens nothing, and slots are fixed positions, so clearing one moves nothing else.
//
// GM-only, which is what makes the "no longer exists" test safe: a player is never sent macros
// they can't observe, so for them a live macro can look missing — for a GM, missing is missing.
//
// One write for the lot, the same shape core's own assignHotbarMacro uses. Slot by slot, this was
// a User-document round trip apiece on the blocking ready path, for a bar that can hold fifty.
async function _clearDanglingHotbarSlots() {
	// Off toObject(), like core's own assignHotbarMacro, so what we hand back is a plain source
	// object rather than the live one being mutated under the document.
	const hotbar = game.user.toObject?.().hotbar ?? foundry.utils.deepClone(game.user.hotbar ?? {});
	let dropped = false;
	for (const [slot, id] of Object.entries(hotbar)) {
		if (game.macros.get(id)) continue;
		delete hotbar[slot];
		dropped = true;
	}
	// `recursive: false` is what makes a REMOVED key a removal rather than a no-op: a merge would
	// only ever add slots back.
	if (dropped) await game.user.update({ hotbar }, { diff: false, recursive: false, noHook: true });
}

// Bring the actors already in the world up to the "name shows on hover to anyone" token default
// that new ones now get at creation (StonetopActor#_preCreate). Every type, not just NPCs: see
// there for why the rule stopped being per-type, and for the spoiler note on creature names.
//
// Only touches what is still at the untouched core default (displayName NONE), so a GM who
// deliberately set a different mode (hidden, always-on, owner-only) keeps it. NONE is also how a
// GM would deliberately hide a name, and there is no way to tell those two apart — core's own
// default IS NONE — so this reads it as "never decided", which is what it is on all but a handful
// of tokens in any world.
//
// AND the tokens already standing on scenes, which the prototype does not reach: a TokenDocument
// carries its own `displayName`, copied when it was placed, so a sweep that stopped at the
// prototype would fix only the NEXT token dragged out and leave every villager already on the map
// nameless. That is precisely the token somebody is hovering.
//
// One batched write per collection rather than a round trip each: this now matches most of the
// actor list rather than a handful of NPCs, and each separate update is its own socket round trip,
// document diff and sidebar repaint, all of it on the blocking startup path.
//
// Idempotent: once bumped, nothing matches, so re-running every load is a cheap no-op needing no
// version flag. Primary-GM only (the caller gates it) so two connected GMs can't both write the
// same documents.
async function _migrateTokenNameplates() {
	const NONE = CONST.TOKEN_DISPLAY_MODES.NONE;
	const HOVER = CONST.TOKEN_DISPLAY_MODES.HOVER;
	const unnamed = (mode) => (mode ?? NONE) === NONE;

	const stale = game.actors?.filter(a => unnamed(a.prototypeToken?.displayName)) ?? [];
	if (stale.length) {
		await Actor.updateDocuments(stale.map(a => ({ _id: a.id, "prototypeToken.displayName": HOVER })));
	}

	// One request per affected scene, and none at all for a scene with nothing to bump — which
	// after the first load is every scene. See utils/placed-tokens.js, shared with the two other
	// sweeps that have to reach past the prototype.
	await updatePlacedTokens(t => unnamed(t.displayName), () => ({ displayName: HOVER }), { what: "name" });
}

// Give the NPCs already in the world the people silhouette new ones now get at creation
// (StonetopActor#_preCreate), so a neighbor with no portrait stops showing Foundry's
// mystery-man in the sidebar, on a drag preview and in chat — the steading roster was
// already drawing the placeholder, but only there. Only touches actors still wearing a
// stock Foundry default (or the placeholder under a pre-rename system id), so a portrait
// anyone chose is never overwritten. Idempotent: once stamped, the actor no longer matches,
// so re-running every load is a cheap no-op needing no version flag. Primary-GM only (the
// caller gates it) so two connected GMs can't both write the same actors.
// One batched write rather than a round trip each, for the reason its neighbours state: on the
// load where this fires it fires for every art-less NPC in the world at once, and a world seeded
// with a full steading roster has a lot of those.
async function _migrateNpcPlaceholderPortraits() {
	const stale = game.actors?.filter(
		a => a.type === "npc" && a.img !== PERSON_DEFAULT_IMG && isDefaultImg(a.img)
	) ?? [];
	if (stale.length) {
		await Actor.updateDocuments(stale.map(a => ({ _id: a.id, img: PERSON_DEFAULT_IMG })));
	}
}

// Point a stock prototype token at the portrait its actor is already wearing, so somebody who
// gave a person a face BEFORE the token started following the portrait
// (StonetopActor#_syncPrototypeTokenImage) does not have to go and re-pick it to stop the
// mystery-man coming back the moment they drag that person onto a scene.
//
// Only a token still on a stock placeholder — Foundry's default or this system's people
// silhouette — and only where the actor has real art to offer it, so a token anyone chose (or
// Tokenizer cut) is never touched. The steading is skipped: its portrait is a picture of a place.
// Idempotent: once pointed, the actor no longer matches, so re-running every load is a cheap
// no-op needing no version flag. Primary-GM only (the caller gates it) so two connected GMs
// can't both write the same actors.
// One batched write rather than a round-trip each: unlike its two neighbours above, this matches
// every character, NPC and monster with art and a stock token, which in an established world is
// most of the actor list — and each separate update is its own socket round-trip, document diff
// and sheet/directory repaint, all of it on the blocking startup path.
async function _migrateTokenImagesToPortraits() {
	const stale = game.actors?.filter(a =>
		a.type !== "stonetop" && a.system?.customType !== "stonetop"
		&& !isDefaultImg(a.img)
		&& a.prototypeToken?.texture?.src !== undefined
		&& isDefaultImg(a.prototypeToken.texture.src)
	) ?? [];
	const updates = stale.map(a => ({ _id: a.id, "prototypeToken.texture.src": a.img }));
	if (updates.length) await Actor.updateDocuments(updates);
}

// Lift an initiate of Danu off the marker's old file. The shoot an art-less initiate wears
// moved from followers/sprout.svg to followers/new-shoot.svg, and the old file is gone, so an
// actor stamped before the move points at nothing and draws a broken image. The old path is
// matched under every id this package has shipped under (LEGACY_SHOOT_MARKERS), since an
// actor stamped before a rename still names the old one.
//
// Both the portrait and the prototype token, because followerNpcActorData sets the two
// together and a token left behind would put the break back on the next drag to a scene.
// Only exact matches on a path we ourselves wrote, so art anyone chose is never touched.
// Idempotent: once lifted, the actor stops matching, so re-running every load is a cheap
// no-op needing no version flag. Primary-GM only (the caller gates it).
//
// AND the tokens already standing on scenes, which its two neighbours above have no need to
// touch and this one does. They repoint paths that still resolve — a mystery-man silhouette is
// ugly, not broken — while the file this one is lifting off is GONE from the package. A
// TokenDocument carries its own `texture.src`, copied from the prototype when it was placed, so
// an initiate already on a map would draw a broken image on every load forever; `prototypeToken`
// only governs the NEXT one dragged out.
async function _migrateShootMarker() {
	const wasOurs = p => LEGACY_SHOOT_MARKERS.includes(String(p ?? "").replace(/^\//, ""));
	const updates = [];
	for (const actor of game.actors ?? []) {
		const update = { _id: actor.id };
		if (wasOurs(actor.img)) update.img = NEW_SHOOT_MARKER;
		if (wasOurs(actor.prototypeToken?.texture?.src)) {
			update["prototypeToken.texture.src"] = NEW_SHOOT_MARKER;
		}
		if (Object.keys(update).length > 1) updates.push(update);
	}
	if (updates.length) await Actor.updateDocuments(updates);

	// One request per affected scene, and none at all for a scene with nothing to lift — which
	// after the first load is every scene. See utils/placed-tokens.js.
	await updatePlacedTokens(
		t => wasOurs(t.texture?.src),
		() => ({ "texture.src": NEW_SHOOT_MARKER }),
		{ what: "lift" },
	);
}

// Put every People-of-Stonetop portrait onto the WHOLE illustration, with the hand-chosen square
// as a frame over it and as the token's own file. See module/book2-art/repoint-portraits.js for
// the three writes and why they are one move.
//
// ON LOAD, unlike the rebuild it also runs inside. The rebuild is behind a chat card that
// offer-once.js latches the moment it is POSTED, so a world whose GM scrolled past that card can
// never be asked again — and every one of those worlds is currently showing a small square face to
// any module that reads `actor.img`, which is the bug this fixes. Nothing here CUTS a file (the
// resolver only ever names squares the world has already extracted), so unlike the rebuild there
// is nothing to ask permission for: it rearranges three fields into the layout a bestiary creature
// has always had, and leaves every surface drawing the same pixels it drew before.
//
// Idempotent by construction, so re-running every load is a cheap no-op needing no version flag:
// the target values are computed from the art index rather than from the actor, so a portrait
// already in this layout produces an empty update and drops out of the plan. Primary-GM only (the
// caller gates it) so two connected GMs can't both write the same actors.
async function _migratePeoplePortraitsToWhole() {
	const { flipPeoplePortraitsToWhole } = await import("../book2-art/repoint-portraits.js");
	const result = await flipPeoplePortraitsToWhole();
	if (result.changes) {
		const placed = result.placed ? ` ${result.placed} placed token(s) followed.` : "";
		console.log(`Stonetop | People portraits: ${result.changes} field(s) moved onto the whole illustration across ${result.updated} actor(s).${placed}`);
	}
}

// One batched actor write, falling back to one write per actor.
//
// `build(actor)` returns the update body for that actor, WITHOUT `_id`, and is called once per
// actor per attempt — deliberately, never once for the whole batch. On v14 a deletion body carries
// a `ForcedDeletion` INSTANCE rather than a magic key (utils/foundry-compat.js), and core deletes
// only where the value `instanceof ForcedDeletion`; the contract there is a fresh instance per key,
// so building one and spreading it across every document in the request is trusting an operator
// object to be reusable when nothing says it is.
//
// THE FALLBACK IS WHAT MAKES A PARTIAL SWEEP HONEST. `Actor.updateDocuments` is all-or-nothing, so
// one locked or unwritable actor rejects the batch and every clean actor behind it stays stale —
// on a sweep that only ever fires on the one load where it has work to do. Walking them
// individually saves everything that can be saved, exactly as flipPeoplePortraitsToWhole does; all
// of these are idempotent, so whatever still fails is simply picked up next load.
//
// `what` names the job in the two warnings.
async function _updateActorsBatched(actors, build, what) {
	if (!actors.length) return 0;
	try {
		await Actor.updateDocuments(actors.map(a => ({ _id: a.id, ...build(a) })));
		return actors.length;
	} catch (err) {
		console.warn(`Stonetop | bulk ${what} failed; retrying one actor at a time:`, err);
	}
	let updated = 0;
	for (const actor of actors) {
		try {
			await actor.update(build(actor));
			updated++;
		} catch (err) {
			console.warn(`Stonetop | could not ${what} on "${actor?.name}":`, err);
		}
	}
	return updated;
}

// Drop the pre-rename `system.attributes.armour` key from characters that still carry it.
//
// PRIMARY-GM ONLY, like every other sweep in onReady. A player has no right to update actors
// they don't own, so running this on their client threw `User lacks permission to update Actor`
// once per stale character — and because the call site was a bare `await`, that rejection tore
// down the rest of onReady for them: no hotbar macros, no game.stonetop, no window restore. It
// went unnoticed because the early return below makes it a silent no-op in an already-clean
// world, which is every world the developers were testing against.
export async function _migrateArmourToArmor() {
	if (!game.user?.isGM || !isPrimaryGM()) return;
	const staleActors = game.actors.filter(
		a => a.type === "character" && a.system?.attributes?.armour !== undefined
	);
	if (!staleActors.length) return;
	// ONE batched request, like every other actor sweep here. Per-actor updates cost a socket
	// round trip, a world-wide `updateActor` broadcast and an Actors-sidebar repaint EACH, all on
	// the blocking startup path — and on the one load where this fires it fires for every stale
	// character at once. Built per actor rather than once for the batch, and with a per-actor
	// retry behind it: see _updateActorsBatched for both reasons.
	await _updateActorsBatched(
		staleActors,
		() => Object.fromEntries([deletionEntry("system.attributes.armour")]),
		"armour key drop",
	);
}

// Per-actor flags in OUR scope that no code reads any more, because the control that wrote them
// is gone from the sheet. Nothing breaks if one is left behind — a stale flag is inert — but a
// world's actor data should say what the system actually uses, and a retired key left lying
// around is the kind of thing that gets mistaken for live state later.
//
// Add a key here only once its last READER is gone, not merely its writer: a flag still consulted
// somewhere would be silently reset to its default by this sweep.
const _RETIRED_ACTOR_FLAGS = [
	// The Invocations tab's "Known first / A–Z" sort dropdown, dropped when the tab settled on the
	// single order (known first, then alphabetically). Only a Lightbearer whose player opened that
	// dropdown ever carried it.
	"invocationsSort",
	// NOT `rollMode`, though 1.5.3 did remove its last reader. The sheet's Advantage/Disadvantage
	// picker is coming back as the "sticky advantage" alternative to the pre-roll prompt, and
	// `StonetopCharacter#rollMode` reads that flag again — so sweeping it would reset a live
	// preference on every load, which is exactly what the rule above this list forbids. Retire it
	// only if that control is dropped for good.
];

// Sweep those keys off every actor that still has one.
//
// PRIMARY-GM ONLY, like every other write in onReady. A player has no right to update actors they
// don't own, and the rejection would tear down the rest of the hook for them — the lesson
// _migrateArmourToArmor above learned the hard way.
//
// Needs no version flag: it is idempotent by construction, since after a run there is no key left
// to match and the walk below makes it a silent no-op. One batched request rather than one per
// actor, because unlike the armour sweep this walks EVERY actor in the world, not just characters
// — with the same per-actor retry behind it, so one unwritable actor can't hold the rest stale.
export async function _dropRetiredActorFlags() {
	if (!game.user?.isGM || !isPrimaryGM()) return 0;
	const staleKeys = new Map();
	for (const actor of game.actors ?? []) {
		const flags = actor.flags?.[STONETOP_SCOPE];
		if (!flags) continue;
		const stale = _RETIRED_ACTOR_FLAGS.filter(key => flags[key] !== undefined);
		if (stale.length) staleKeys.set(actor, stale);
	}
	if (!staleKeys.size) return 0;
	await _updateActorsBatched(
		[...staleKeys.keys()],
		// Through deletionEntry so v14 gets a ForcedDeletion instance rather than a deprecated
		// `-=` key, while v13 gets the `-=` prefix, which is the only form that works there.
		actor => Object.fromEntries(
			staleKeys.get(actor).map(key => deletionEntry(`flags.${STONETOP_SCOPE}.${key}`))),
		"retired flag sweep",
	);
	return staleKeys.size;
}

// Give a slug to any arcanum card in the world that has none.
//
// Every arcanum needs one: it is the identity key for each holder's marks, unlock counts and
// owned/identified/flipped lists, so a card without one silently keys all of that off "". New
// cards can no longer arrive that way -- StonetopItem#_preCreate stamps the gap before the
// document is written -- but a world may already hold one built by macro or console before that
// existed. Repairing it used to be the editor's `getData`, which only reached cards somebody
// happened to open in edit mode.
//
// Idempotent by construction and so needs no version flag: after a run there is nothing left to
// match. WORLD items only -- a card embedded on an actor is not an arcanum (arcana are referenced
// by slug from a pack or the world, never owned as embedded documents).
//
// PRIMARY-GM ONLY, like every other write in onReady: a player has no right to update world
// items, and the rejection would tear down the rest of the hook for them.
export async function _stampMissingArcanumSlugs() {
	if (!game.user?.isGM || !isPrimaryGM()) return 0;
	const slugless = (game.items ?? []).filter(
		item => isArcanumData(item) && !String(item.flags?.[ITEM_FLAG_SCOPE]?.slug ?? "").trim()
	);
	if (!slugless.length) return 0;
	// ONE batched request, like every other sweep here: per-item updates each cost a socket round
	// trip and an Items-sidebar repaint, on the blocking startup path.
	try {
		await Item.updateDocuments(slugless.map(item => ({
			_id: item.id,
			[`flags.${ITEM_FLAG_SCOPE}.slug`]: newArcanumSlug(),
		})));
	} catch (err) {
		// Never cost the GM their load: the cards still open, and the next load tries again.
		console.warn("Stonetop | Could not stamp slugs on slug-less arcana.", err);
		return 0;
	}
	console.log(`Stonetop | Gave a slug to ${slugless.length} arcanum card(s) that had none.`);
	return slugless.length;
}

const _TOKEN_LINK_SWEEP = "characterTokenLinks";

/**
 * Run the player-token link repair, and decide whether the sweep is finished.
 *
 * The silent half — stamping prototypes, linking tokens whose private copy is empty — always
 * completes. The other half is a question, and a question is only answered once: a GM who
 * dismisses the window, or who parks a character on "leave it unlinked" for now, has not
 * finished the sweep, so the version stamp is taken back off and the next load asks again.
 *
 * `forgetSweep` runs AFTER `oncePerVersion` returns rather than inside its work function,
 * because the stamp is written on the way out — forgetting from inside would be overwritten by
 * the very stamp it is trying to remove.
 */
async function _repairCharacterTokenLinks() {
	let unfinished = false;
	await oncePerVersion(_TOKEN_LINK_SWEEP, async () => {
		const drifted = await repairCharacterTokenLinks();
		if (!drifted.length) return;
		const { applied, choices } = await CharacterTokenLinkDialog.ask(drifted);
		if (!applied) { unfinished = true; return; }
		const { linked, left, failed } = await applyLinkChoices(drifted, choices);
		if (linked) console.log(`Stonetop | Relinked ${linked} player token(s) to their characters.`);
		if (left)   console.log(`Stonetop | Left ${left} player token(s) unlinked, as asked.`);
		// Only a FAILED write reopens the sweep. A token the GM deliberately left unlinked is an
		// answer, and asking again every load would be this system overruling them.
		if (failed) unfinished = true;
	});
	if (unfinished) await forgetSweep(_TOKEN_LINK_SWEEP);
}

// The GM-prep page families (threats / hazards) used to store one JournalEntry per item in
// a per-steading "<Steading> Threats" / "<Steading> Hazards" Folder; they now store all of
// a family's items as pages of ONE such JournalEntry. See _consolidateGmPrepFamily.
const _GM_PREP_FAMILIES = [
	{ folderFlagId: "threatsFolderId", pageType: "threat", ensureEntry: ensureThreatsEntry },
	{ folderFlagId: "hazardsFolderId", pageType: "hazard", ensureEntry: ensureHazardsEntry },
];

// Fold each steading's old folder-of-single-page-entries into the new single journal.
// Runs on the primary GM only, so two connected GMs can't both copy the same entries;
// every load, but a cheap no-op once the old folder flag is gone, so it needs no version
// setting. Robust to a partial run: each new page is stamped with its source entry id and
// the old entry is tagged once its page exists, so a retry never duplicates pages and
// never deletes un-copied content.
async function _migrateGmPrepPagesToSingleJournal() {
	if (!game.user?.isGM || !isPrimaryGM()) return;
	const steadings = game.actors?.filter(a => a.type === "stonetop") ?? [];
	for (const steading of steadings) {
		for (const family of _GM_PREP_FAMILIES) {
			try {
				await _consolidateGmPrepFamily(steading, family);
			} catch (err) {
				console.error(`Stonetop | Could not consolidate ${family.pageType}s for "${steading.name}" into a single journal.`, err);
			}
		}
	}
}

async function _consolidateGmPrepFamily(steading, { folderFlagId, pageType, ensureEntry }) {
	const oldFolderId = (resolvedFlagProperty(steading, "steading") ?? {})[folderFlagId];
	if (!oldFolderId) return; // already migrated (or this steading never had any) — nothing to do
	const folder = game.folders?.get(oldFolderId) ?? null;

	const oldEntries = folder
		? folder.contents
			.filter(e => e.getFlag?.(STONETOP_SCOPE, pageType))
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
		: [];

	if (oldEntries.length) {
		const entry = await ensureEntry(steading); // mints the "<Steading> <Suffix>" journal + sets its flag
		if (!entry) return;

		// Copy each old single-page's content into the new entry as a fresh page, remembering
		// old -> new ids so placed scene pins can be re-linked. An entry already consumed by a
		// prior (interrupted) run carries the id of the page it became, so we reuse that.
		const remap = [];
		let sort = entry.pages.reduce((m, p) => Math.max(m, p.sort ?? 0), 0);
		for (const old of oldEntries) {
			const oldPage = old.pages.find(p => p.type === pageType);
			if (!oldPage) continue;
			let newPageId = old.getFlag(STONETOP_SCOPE, "consolidatedInto");
			if (!newPageId) {
				// If a prior run created the page but died before tagging its source entry,
				// the page still carries `migratedFrom`, so reuse it rather than copy twice.
				const existing = entry.pages.find(p => p.getFlag?.(STONETOP_SCOPE, "migratedFrom") === old.id);
				if (existing) {
					newPageId = existing.id;
				} else {
					sort += 100000;
					const [newPage] = await entry.createEmbeddedDocuments("JournalEntryPage", [{
						type: pageType,
						name: oldPage.name,
						sort,
						system: foundry.utils.deepClone(oldPage.system ?? {}),
						flags: { [STONETOP_SCOPE]: { migratedFrom: old.id } },
					}]);
					if (!newPage) continue;
					newPageId = newPage.id;
				}
				await old.setFlag(STONETOP_SCOPE, "consolidatedInto", newPageId);
			}
			remap.push({ oldEntryId: old.id, oldPageId: oldPage.id, newPageId });
		}

		// Re-point any scene Note pins from the old (entryId, pageId) to the new page.
		if (game.scenes) {
			for (const scene of game.scenes) {
				const updates = [];
				for (const n of scene.notes) {
					const hit = remap.find(r => r.oldEntryId === n.entryId && r.oldPageId === n.pageId);
					if (hit) updates.push({ _id: n.id, entryId: entry.id, pageId: hit.newPageId });
				}
				if (updates.length) await scene.updateEmbeddedDocuments("Note", updates).catch(() => {});
			}
		}

		// Content + pins have moved: drop the old single-page entries.
		for (const old of oldEntries) await old.delete().catch(() => {});
	}

	// Remove the now-empty folder and clear the stale folder flag so this won't run again.
	if (folder) await folder.delete().catch(() => {});
	const [key, val] = deletionEntry(`flags.${STONETOP_SCOPE}.steading.${folderFlagId}`);
	await steading.update({ [key]: val });
}

// Nudge a GM who is past the first-session Welcome guide but has never imported the book
// art: whisper the "you can import your images" card once, with a button that launches the
// Import Book Art macro. Gated so it never interrupts a fresh world — while the guide still
// auto-opens, its own "Import the book art" step is where this belongs — and never nags a GM
// who already imported: art lives OUTSIDE the world, so a GM who imported in another world
// already has it here (reapply re-points it) and skips straight to marking this resolved.
// Resolves exactly once, then the flag stops it re-checking.
async function _postBook2ArtReminderOnce() {
	if (getSetting("book2ArtReminderShown")) return;
	// Hold off until the Welcome guide has stopped auto-opening — the GM finished session
	// zero or ticked "Don't show this again". Mirrors _openGmWelcomeGuide's gate. Not flagged
	// here: a fresh world legitimately reaches this state later, so keep checking until it does.
	if (!getSetting("gmWelcomeShown") && !sessionZeroComplete()) return;

	// Past the guide, and nothing imported yet: whisper the one-time nudge to the GMs.
	if (!(await hasImportedBook2Art())) {
		if (!globalThis.ChatMessage?.create) return; // retry next load if chat isn't ready
		await ChatMessage.create({
			content: _buildBook2ArtReminderContent(),
			whisper:  ChatMessage.getWhisperRecipients("GM").map(u => u.id),
			speaker: { alias: "Stonetop" },
		});
	}
	await setSetting("book2ArtReminderShown", true);
}

function _buildBook2ArtReminderContent() {
	return stonetopChatCard(
		"Import Your Book Art",
		`<div class="stonetop-roll-card-description">
			<p>Own the Stonetop PDFs? You can rebuild the monster and location illustrations right here in your world: portraits, tokens, treasure and journal art, all filled in from your own books. Nothing is uploaded anywhere; the pictures are reconstructed locally on your machine.</p>
			<p>It's best to run this <strong>before your players join</strong>, and to <strong>close any journal you're editing</strong> first. You can re-run it any time from the <strong>Import Book Art</strong> macro in your Macro Directory.</p>
		</div>
		<div class="row stonetop-art-reminder__actions">
			<button type="button" class="stonetop-import-art-open">
				<i class="fas fa-images"></i> Import Book Art
			</button>
		</div>`,
		"stonetop-art-reminder-card");
}

// -- REBUILD CUT PICTURES FROM ART ALREADY IMPORTED --------
// Three kinds of picture arrived after releases that had already shipped whole illustrations: the
// detail portraits (crops of a multi-figure drawing), the square faces the small round surfaces
// use, and the square a creature's prototype token stands on. Each leaves a GM who already
// imported holding every SOURCE on disk and none of the results. All three can be cut from those
// sources locally — no PDF, no re-import — so offer it once rather than making them hunt for
// their books again. See book2-art/rebuild-crops.js.
//
// The once-per-world rules — including "found nothing, so do not latch, and ask again next
// load" — belong to offerDurableArtOnce; what is local here is what counts as rebuildable and
// how the offer is presented.
function _offerBookArtRebuildOnce() {
	return offerDurableArtOnce({
		// A NEW KEY, not `peopleArtRebuildOffered`. Every world that answered the squares offer has
		// that one set, so reusing it would latch all of them shut against creature tokens — which
		// did not exist when they answered. This is the second time that trap has come up here (the
		// squares offer could not reuse the crops key either), and it fails SILENTLY: the offer is
		// simply never made. When this offer next grows to cover new work, mint another key.
		setting: "bookArtRebuildOffered",
		findWork: async () => {
			// Every kind of cuttable art at once: the detail portraits, the square faces the small
			// surfaces use, and the creature token squares. One offer covers all of them — they are
			// the same work from the GM's side (cut from pictures already on disk) and asking three
			// times would just be nagging. Counted through run-rebuild.js, the same façade the
			// three run paths use.
			const { countBookArtRebuilds } = await import("../book2-art/run-rebuild.js");
			return await countBookArtRebuilds() || null;
		},
		card: _buildBookArtRebuildContent,
	});
}

function _buildBookArtRebuildContent(count) {
	return stonetopChatCard(
		"Rebuild Book Art",
		`<div class="stonetop-roll-card-description">
			<p>Some of the book art is now cut finer than the whole-page illustrations you imported. The
			<strong>People of Stonetop</strong> gallery offers individual portraits carved out of the group
			illustrations, one face per person, instead of a whole crowd scene, plus a square
			close-up of each face for the small round portraits on the character and steading sheets; and every
			creature with art can carry a square framed for its <strong>token</strong>, so what stands on the
			battle map is the beast rather than a blind slice through the middle of the page.
			You already have the source pictures, so <strong>${count}</strong> of these can be made right here
			from the art you imported before.
			<strong>You do not need your PDFs, and you do not need to re-import.</strong></p>
			<p>They are cut from pictures already on your disk, so they come out a little smaller than a fresh
			import would give. If you would rather have them at full size, re-run the
			<strong>Import Book Art</strong> macro instead: either way, nothing already on disk is deleted.</p>
		</div>
		<div class="row stonetop-art-reminder__actions">
			<button type="button" class="stonetop-rebuild-crops-run">
				<i class="fas fa-crop-simple"></i> Rebuild ${count} pictures
			</button>
		</div>`,
		"stonetop-art-reminder-card");
}

// -- FINISH AN IMPORT THAT FELL SHORT --------------------------
// An import that fails on some illustrations still reports success. The failures scroll past in
// the console during a run that takes a couple of minutes, and what the GM is left with is a
// handful of entries that never got a picture and nothing connecting the two. The 2nd printing of
// both books is one way to arrive here (it re-saved nine illustrations at a resolution the
// importer could not match until the shape-and-place fallback landed), but a page that timed out,
// a PDF that stopped reading part way, or a run closed early all end in the same state.
//
// Unlike the rebuild above this CANNOT be done from disk: the missing pictures were never
// extracted, and the system keeps no copy of the books. So the honest offer is to re-run the
// import, which skips everything already present and processes only the gap.
//
// The once-per-world rules — including "found nothing, so do not latch, and ask again next load"
// — belong to offerDurableArtOnce; what is local here is what counts as a shortfall (see
// countMissingDurableArt, which stays quiet when a whole book is simply absent) and how the offer
// is presented.
function _offerPartialArtImportOnce() {
	return offerDurableArtOnce({
		setting: "partialArtImportOffered",
		findWork: async () => {
			const { countMissingDurableArt } = await import("../book2-art/reapply.js");
			return await countMissingDurableArt();
		},
		card: ({ missing, total }) => _buildPartialArtImportContent(missing, total),
	});
}

function _buildPartialArtImportContent(missing, total) {
	const pictures = missing === 1 ? "picture" : "pictures";
	return stonetopChatCard(
		"Finish Your Art Import",
		`<div class="stonetop-roll-card-description">
			<p>Your book art is imported, but <strong>${missing}</strong> of ${total} ${pictures} never made it
			onto your disk, so a few bestiary entries, locations or portraits are sitting without their
			illustration. An import reports those failures only in the console, which is easy to miss.</p>
			<p>Running <strong>Import Book Art</strong> again picks up just the ${pictures} that are missing:
			everything already on disk is skipped, so it is a short run rather than another full one.
			<strong>You will need your PDFs again</strong>: missing art has to come out of the books,
			and nothing already imported is touched or deleted.</p>
		</div>
		<div class="row stonetop-art-reminder__actions">
			<button type="button" class="stonetop-import-art-open">
				<i class="fas fa-images"></i> Import the missing ${missing}
			</button>
		</div>`,
		"stonetop-art-reminder-card");
}

// -- THE GM PLAYBOOK, ADDED AS A THIRD SOURCE --------------
// A world that imported before this release has no way to learn the importer reads a third PDF
// now. Nothing looks broken to them: their map pages carry a map, and the two diagrams live on a
// tab whose placeholder they may never scroll to. So this is the one nudge that has to arrive on
// its own, rather than being discovered.
//
// Worth interrupting for because the PDF is FREE — it is the publisher's own handout, not a book
// to buy — and because the books really are the poorer source here: Book I embeds the village map
// at 478x272 and Book II the other two at ~700px, against a true 300 dpi in the playbook.
//
// The once-per-world rules — including "found nothing, so do not latch, and ask again next load"
// — belong to offerDurableArtOnce, and which worlds have anything to gain belongs to
// countGmPlaybookGains (which stays quiet for a world that never imported, since the plain
// reminder owns that GM and the playbook is a field on the very dialog its button opens). What is
// local here is only how the offer is put.
function _offerGmPlaybookArtOnce() {
	return offerDurableArtOnce({
		setting: "gmPlaybookArtOffered",
		findWork: async () => {
			const { countGmPlaybookGains } = await import("../book2-art/reapply.js");
			return await countGmPlaybookGains();
		},
		card: _buildGmPlaybookArtContent,
	});
}

// Written against what this world would actually gain, not against everything the playbook holds:
// a GM who already has the diagrams and only stands to sharpen a map should not be told about a
// tab they have been using, and the reverse.
function _buildGmPlaybookArtContent({ maps, diagrams }) {
	const gains = [];
	if (maps) {
		gains.push(`<li><strong>Sharper regional maps.</strong> ${maps === 1 ? "One" : maps} of your Setting
			Overview map pages ${maps === 1 ? "is" : "are"} showing a coarser copy than the playbook prints.
			The rulebooks embed those maps small (Book I stores the village map at 478&times;272),
			where the playbook prints all three at a full 300 dpi.</li>`);
	}
	if (diagrams) {
		gains.push(`<li><strong>The core loop and the flow of play.</strong> The playbook's two flowcharts, which
			are in no other PDF. They fill the <strong>Core Loop</strong> tab on your GM Toolkit sheet.</li>`);
	}
	return stonetopChatCard(
		"Add The GM Playbook",
		`<div class="stonetop-roll-card-description">
			<p><strong>Import Book Art</strong> reads a third PDF as of this update: the <strong>GM
			playbook</strong>. It's the free 12-page handout from the publisher, not a book you buy,
			and for a few pictures it is a better source than either rulebook.</p>
			<ul>${gains.join("")}</ul>
			<p>Everything you have already imported is skipped, so this is a short run rather than another full
			one, and nothing already on disk is touched or deleted.</p>
		</div>
		<div class="row stonetop-art-reminder__actions">
			<button type="button" class="stonetop-import-art-open">
				<i class="fas fa-images"></i> Add the GM playbook
			</button>
		</div>`,
		"stonetop-art-reminder-card");
}

async function _postStartupWelcomeMessageOnce() {
	if (getSetting("startupWelcomeShown")) return;
	if (!globalThis.ChatMessage?.create) return;
	await ChatMessage.create({
		content: _buildStartupWelcomeContent(),
		speaker: { alias: "Stonetop" },
	});
	await setSetting("startupWelcomeShown", true);
}

// Where the books come from. This system ships the sheets and the bookkeeping and none of the
// prose, so the one thing a brand-new world cannot supply is the rules themselves; the greeting
// card says so and points at the publisher's own store rather than a reseller.
const STONETOP_STORE_URL   = "https://plusoneexp.com/collections/stonetop";
const STONETOP_STORE_LABEL = "plusoneexp.com/collections/stonetop";

function _buildStartupWelcomeContent() {
	return `<section class="pbta-chat-card stonetop-roll-card stonetop-startup-card">
		<div class="cell cell--chat">
			<div class="chat-title row flexrow">
				<h2 class="cell__title">Welcome to <span class="stonetop-startup-card__title-logo">Stonetop</span></h2>
				<div class="cell__subtitle">Fresh-start helper</div>
			</div>
			<div class="stonetop-roll-card-description">
				<p>This is an unofficial Foundry VTT system for <strong>Stonetop</strong>, by Jeremy Strandberg, illustrated by Lucie Arnoux, with layout, editing, and co-design by Jason Lutes.</p>
				<p>It carries none of the rules text, so you will want the books themselves. They come from the publisher, Plus One Exp: <a href="${STONETOP_STORE_URL}">${STONETOP_STORE_LABEL}</a>.</p>
			</div>
			<div class="card-content stonetop-startup-card__content">
				<div class="row stonetop-startup-card__section">
					<h3 class="cell__subtitle">For Players</h3>
					<ul>
						<li>Guided, resumable character creation, and a step-by-step level-up wizard.</li>
						<li>Move rolls with modifiers, advantage or disadvantage, and hit tiers worked out for you, including Clash and Let Fly resolved from the chat card.</li>
						<li>Armor, load, followers, and the Seeker's arcana tracked on the sheet.</li>
					</ul>
				</div>
				<div class="row stonetop-startup-card__section">
					<h3 class="cell__subtitle">For Game Masters</h3>
					<ul>
						<li>A first-session Welcome guide and a Let Spring Burst Forth walkthrough.</li>
						<li>A steading sheet with seasonal automation, improvements, and disasters.</li>
						<li>A GM Toolkit with your moves, and Threats and Sites tabs you can pin to a scene.</li>
					</ul>
				</div>
				<div class="row stonetop-startup-card__section">
					<h3 class="cell__subtitle">Bundled Content</h3>
					<ul>
						<li>The full Book I and II bestiary, around 180 creatures, hidden from players until you reveal it.</li>
						<li>A cross-linked Locations and Lore journal covering the wider world.</li>
						<li>The complete deck of major and minor arcana.</li>
					</ul>
				</div>
			</div>
			<div class="row stonetop-startup-card__actions">
				<button type="button" class="stonetop-startup-open-welcome">
					<i class="fas fa-feather"></i> Open the First-Session Guide
				</button>
			</div>
			<div class="row row--border stonetop-startup-card__footer">
				Open <strong>Configure Settings</strong> and filter for <strong>Stonetop</strong> for the sheet font and size, the hover info, and the rest.
				<a href="https://foundryvtt.com/packages/dice-so-nice">Dice So Nice!</a> is worth installing for 3D dice.
			</div>
		</div>
	</section>`;
}
