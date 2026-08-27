import { StepperDialog } from "./StepperDialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { TIER_LABELS } from "../utils/move-results.js";
// `openOrFocus` cannot serve `openOnTrip`: it brings an already-open window to the front without
// running the factory, and that window still has to be told which trip to switch to.
import { findOpenApp } from "../utils/open-windows.js";
import { crewExists } from "../utils/crew.js";
import { sign, rollSeasonsCard } from "../utils/roll-engine.js";
import { getStonetopSteadingActor, isSteadingActor } from "../utils/world.js";
import { getSetting, setWorldSetting } from "../settings.js";
import { capitalizeFirst, escHtml, decodeEntities, stripHtmlToText } from "../utils/strings.js";
import { portraitOrNone, documentPortraitFrame } from "../utils/portrait-frame.js";
import { wireAvatarPreview, removeAvatarPreview } from "../utils/avatar-preview.js";
import { warn } from "../utils/logger.js";
import { CHART_GROUPS, HOME_GROUP, chartPicked, chartEntryText, chartGroupOf } from "./expedition-data.js";
import { pickOrWriteOption } from "./content-picker.js";
import { FATE_TABLES, fateTableList } from "../data/fate-tables.js";
import { saveChronicleFromButton } from "../utils/chronicle.js";
import {
	normalizeLog,
	currentExpedition,
	ensureCurrent,
	addExpedition,
	selectExpedition,
	deleteExpedition,
	expeditionLabel,
	expeditionNames,
} from "../utils/expedition-log-core.js";
import { StonetopSteading } from "../actors/steading/StonetopSteading.js";
import { openReturnTriumphant } from "../actors/steading/return-triumphant.js";
import { assetTakenLabel } from "../utils/requisition-asset.js";
import { getPlayerCharacters } from "../utils/playbook-actors.js";
// Who on the roster is past the Door: the dead don't outfit, and the three who came back set
// out wearing the name of whatever brought them back.
import { actorPastDeathKind } from "../actors/character/deaths-door-actor.js";
import { deriveLoadLevel, LOAD_LEVEL_LIMITS } from "../utils/load.js";
import { SYSTEM_ID, JOURNAL_PACK } from "../system-id.js";
import { renderTemplate } from "../utils/foundry-compat.js";
import { EXPLORATION_GM_MOVES } from "../gm-toolkit/gm-moves.js";
import { GmMoveDrawer } from "../gm-toolkit/gm-move-drawer.js";
import { wireSidebarToggle } from "../utils/sidebar-toggle.js";
import { SpinTrack } from "../utils/flash-highlight.js";
import {
	TRAVEL_MAPS, BEYOND_TIER,
	travelPlace, travelMap, placesOnMap, placesBeyond, exitsOnMap, spotPercent, percentSpot,
} from "../data/travel-times.js";
import { liftSiteOffMap, placeSiteOnMap } from "../sites/place-site-on-map.js";
import { placedSiteSpot, sitesOnMap } from "../sites/site-map-spots.js";
import { SITE_ACCENT } from "../sites/site-view.js";
import { pickPointOnImage, watchPointsOnImage } from "../utils/pick-point-on-image.js";
import {
	solveFrom, normalizeJourney, journeyRoute, formatTravelTime, routePhrase, routeLine,
	stopsAlongTheWay, chartBlankValue,
} from "../utils/travel-route.js";
import {
	customStops, customTierFor, insideMap, markSpot, normalizeCustom, seedMarks, withMark,
} from "../utils/custom-route.js";
// Where the party sets out from: a place the books lettered, a point the GM put down on one of
// their maps, or nowhere at all until the next click says. Every map question below takes it
// through `startEnd`, and `hasStart` is what tells the third state from the first two. See
// utils/journey-start.js.
import { hasStart, startEnd, startMark, startName, startTier } from "../utils/journey-start.js";
import { resolveTravelMap, travelMapFile, browseTravelMapArt } from "../book2-art/travel-map-art.js";
import { openTravelMap } from "./TravelMapWindow.js";
import {
	JOURNEY_MARKS, JOURNEY_RIGHT_CLICK_MARKS,
	bindJourneyControls, bindJourneySiteRemoval, bindJourneyUndo, journeyPick,
} from "./journey-controls.js";
import { drawnOn, offMapNote, routePath, tierDraws, tierDrawing, tierDrawingEnds } from "../utils/route-path.js";
import { posterSceneFor } from "../book2-art/poster-map-catalog.js";
import { format, localize } from "../utils/i18n.js";
import {
	clearRouteOnScene, offMapNames, routeFlagTouched, sceneRouteCheck, sceneRouteRefusal,
	sceneJourney, sceneShowsJourney, showRouteOnScene,
} from "../utils/scene-route.js";

const ANSWERS_SETTING = "expeditionAnswers";

// The route step's pin layer, rendered into BOTH the walkthrough's own map and the "See the whole
// map" window's overlay. Named here because the dialog renders it directly (not only through a
// `{{> }}` in its template), so the partial-registration sweep in stonetop.js cannot be the only
// place the path is written down.
const JOURNEY_PINS_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-pins.hbs";

// The scene-route refusals that mean "the reader is standing on the wrong map" rather than
// "this cannot be drawn". Each of these is answered by going to the map the journey belongs to
// (see `_drawOnItsOwnMap`); the rest — a picture trimmed to the wrong shape, a scene with no
// dimensions, a trip with nowhere to go — are faults walking somewhere else would not mend, and
// keep their words. The strings are `sceneRouteCheck`'s own reasons, from utils/scene-route.js.
const SCENE_SWITCH_REFUSALS = new Set(["no-scene", "not-a-map", "wrong-map", "off-map"]);

// The Outfit step's party-load block, for the same reason: it is redrawn on its own whenever a
// sheet under it changes (see `_refreshLoadReadout`), not only through the `{{> }}` in the
// dialog's template.
const LOAD_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/expedition-load.hbs";

// How long the readout waits after a sheet write before rebuilding. Ticking one inventory box
// can land as several documents updating in a row (the item, the actor's pool flag, a follower's
// gear), and each rebuild snapshots every PC on the trip — so the burst is collapsed into one
// pass. Short enough that the number moves while the GM is still looking at the sheet they
// changed.
const LOAD_REFRESH_MS = 200;

/**
 * An authored checklist line as words, for an `aria-label`: tags dropped, entities read back.
 *
 * The item texts are trusted HTML with `<strong>`/`<em>` in them and `&hellip;` at the end of a
 * couple, and a label read out as "You'll need to bring &hellip;" is worse than no label.
 *
 * `stripHtmlToText` is the one strip-HTML helper and says so; `decodeEntities` runs after it for
 * the one entity it does not carry (`&hellip;`, which is exactly the case above). Going through
 * the shared stripper rather than a private regex also buys the block-end -> space substitution
 * it exists for, so a two-part prompt cannot read back as "...is watched.They cross...".
 */
function _plainText(html) {
	return decodeEntities(stripHtmlToText(html));
}

/**
 * Take a set of registered hooks back off, and answer what the field holding them becomes.
 *
 * `[["hookName", id], …]` is the shape both watches on this window register in, and dropping one
 * is "off every hook, then forget the list" — two statements that have to stay together, since a
 * list kept after the hooks are gone is a second teardown that silently un-registers somebody
 * else's ids. Returning the new value is what lets the caller write it as one assignment.
 */
function _offHooks(registered) {
	for (const [name, id] of registered ?? []) Hooks.off(name, id);
	return null;
}

/**
 * Whether a document that just changed is one the party-load readout is built from: a PC, or the
 * steading (whose flags hold the crew's gear). A world in play writes to actors constantly —
 * every token moved, every monster hurt in a fight — and none of that is load. Cheap enough to
 * ask on the hook itself, which is what keeps a busy scene from rebuilding a snapshot per PC
 * five times a second.
 */
function _carriesLoad(actor) {
	return actor?.type === "character" || isSteadingActor(actor);
}

/**
 * The tag a returned PC wears on their load row: `{ kind, label }`, or null for the living.
 *
 * A tint alone can't say WHICH of the three came back — the same reason the sheet earned its
 * Dead tag — and on a roster the GM is reading to plan a trip, "Ghost" is the word that changes
 * what they ask for. The label is the insert's own name off the snapshot, so a world that renamed
 * one in the pack sees its name here; the slug, capitalised, is the fallback for a row whose
 * snapshot didn't build (they still get the tag, since the flag is what says they are one).
 */
function _undeadTag(kind, snap) {
	if (!kind) return null;
	const name = snap?.postDeathInsert?.activeInsert?.name;
	return { kind, label: name || capitalizeFirst(kind) };
}

/**
 * The seven exploration moves, as the sidebar lists them.
 *
 * Read off the ONE table in gm-toolkit/gm-moves.js, which the GM Toolkit's Moves tab also
 * prints. Restating them here meant seven names and seven glosses maintained in two files, held
 * together only by a test that scraped this file's source text, so reformatting the list at all
 * broke the guard, and a wording fix in one place left the walkthrough and the toolkit teaching
 * the same move in different words on two screens the same GM meets in one session.
 *
 * A plain array of `{ name, gloss }` rather than a block of HTML, because the sidebar renders
 * them through the template — which escapes both fields for us, and lets a test read the list
 * back as data instead of matching source text again.
 */
const EXPLORATION_SIDEBAR_MOVES = EXPLORATION_GM_MOVES.map(m => ({ name: m.name, gloss: m.gloss }));
// This dialog's key in the client-scoped reload-resume record (see walkthrough-resume.js).
const RESUME_KEY = "expedition";

// ── ExpeditionDialog ─────────────────────────────────────────────────────────
// A GM walkthrough of Book I's Expeditions chapter (p.301–343). It follows the
// chapter's own arc — Preparations, Running the journey, Player moves, Going
// home — as a linear stepper, mirroring SpringBurstDialog (and reusing its
// `.stonetop-spring-*` / shared `.stonetop-guide-*` styles).
//
// The chapter's fifth part, "What to prep", is NOT a step: it is between-sessions
// homework, so a step of it sat at the END of the walkthrough, past Going home,
// where a GM prepping for next week had already clicked Done. It rides on the
// intro step instead, as a headed aside below the prose (`aside` on the step
// schema), which is where a GM opening this guide to prep actually is.
//
// The chapter's weather section is NOT a step either. It taught nothing this
// walkthrough has to walk you through, and every tool it pointed at is a click
// away without it: the seasonal table is the Weather picker's whole window (hotbar
// slot 4, and the glyph beside the steading's clock), and the hoped-for-weather
// oracle is a Die of Fate roll. A step per section of the chapter was making the
// rail long enough to read as a chore.
//
// The chapter's exploration moves are not a step either, for the opposite reason:
// they were needed on MORE than one. A step of them sat between Running the journey
// and Player moves, so the seven moves were on screen only while the GM was reading
// about them, and gone by the time they were running the leg those moves are FOR.
// They are a permanent right-hand rail now, on every step, modelled on the character
// sheet's Basic Moves sidebar down to its collapse handle. See EXPLORATION_SIDEBAR_MOVES.
//
// Interactive bits: a Chart a Course checklist (the requirements/challenges the
// book tells you to "write down with tick boxes"), an inline Requisition roll
// (2d6 +Fortunes, read off the steading), and "Roll the Die of Fate" buttons on
// the steps where the rules reach for the d6 oracle. Opened from the treasure-map
// hotbar macro (see hooks/Ready.js).
//
// Expeditions recur, so the notes form a growing log: `expeditionAnswers` holds
// { currentId, list: [{ id, title, createdAt, …step notes }] }. The dialog always
// edits the "current" trip (its title, switcher, and "Start a new expedition" live
// in the bar atop the walkthrough); each trip with content becomes its own
// "Expedition: …" page in the shared Chronicle (see utils/chronicle-core.js). Every
// field saves on change, so the plan survives Back/Next, switching, and reload.

// Requisition (Book I, p.308): roll +Fortunes for the steading's communal assets.
const _REQ_RESULT = {
	success: { label: TIER_LABELS.success, line: "Go ahead, but you're expected to <strong>bring it back safely</strong>." },
	partial: { label: TIER_LABELS.partial, line: "Someone objects. You can borrow it, but you'll need to <strong>do some convincing</strong> first (likely a Persuade)." },
	failure: { label: TIER_LABELS.failure, line: "Folks ain't having it. <strong>Don't mark XP.</strong> Take it anyway if you must, but <strong>reduce Fortunes by 1</strong>." },
};

const _REQ_TIERS = [
	{ key: "success", text: _REQ_RESULT.success.line },
	{ key: "partial", text: _REQ_RESULT.partial.line },
	{ key: "failure", text: _REQ_RESULT.failure.line },
];

// ── Load-gated moves ─────────────────────────────────────────────────────────
// A move whose fictional trigger needs a lighter load carries `maxLoad` (the heaviest
// tier it tolerates) and optionally `requiresUnarmored` in its own data (MoveModel), so
// the Outfit readout reads those off each PC's move snapshot and flags one the current
// load has switched off. Pack Horse isn't gated — it raises the caps (loadBonus), which
// each PC's snapshot already reflects. Uncanny Reflexes also needs the PC unarmored
// (worn-armor base 0), checked via the snapshot's wornArmor.

// The one-line "requirement" caption shown beside a gated move, derived from its data.
function _gatedReqLabel(maxLoad, requiresUnarmored) {
	const load = maxLoad === "light" ? "needs light" : `needs ≤ ${maxLoad}`;
	return requiresUnarmored ? `${load}, unarmored` : load;
}

// Load tiers lightest→heaviest, so a gated move is active when the current tier is at
// or below its cap. `null` (nothing carried) ranks as light. Only these three tiers are
// ever looked up: _gatedMovesFor receives an overloaded PC's tier already collapsed to
// "heavy", and a move's maxLoad is only ever light/normal/heavy.
const _LOAD_RANK = { light: 0, normal: 1, heavy: 2 };

// The display label for each tier bucket. The pill's CSS class is the bucket key itself
// (light/normal/heavy/over), so it needs no separate field.
const _LOAD_PILL = {
	light:  { label: "Light" },
	normal: { label: "Normal" },
	heavy:  { label: "Heavy" },
	over:   { label: "Overloaded" },
};

// Build the diamond track: pips grouped into the light / normal / heavy bands (the
// group sizes follow the given caps, so Pack Horse's 4/7/10 renders correctly), with
// any marks past the heavy cap reported as overflow.
function _pipBands(totalMarks, limits) {
	const bounds = [
		[0, limits.light],
		[limits.light, limits.normal],
		[limits.normal, limits.heavy],
	];
	const bands = bounds.map(([a, b]) => {
		const pips = [];
		for (let i = a; i < b; i++) pips.push({ on: i < totalMarks });
		return { pips };
	});
	return { bands, overflow: Math.max(0, totalMarks - limits.heavy) };
}

// The Chart a Course requirements/challenges (Book I p.302–303) live in expedition-data.js
// so the Chronicle compiler can resolve a ticked key back to its text; the arriving-home
// questions (p.338) sit beside them as plain prompts. See the imports above.

// Linear walkthrough. `body` is HTML, and `bodyAfterFate` the rest of it, printed BELOW
// the Die of Fate button so the button lands at the end of the passage that reaches for
// it rather than under everything on the page. `fate` names the Die of Fate table this
// step reaches for (a key in data/fate-tables.js) and adds the button that rolls it. `roll`
// names an inline roll ("requisition"). `tiers` shows the matching outcome list.
// `qa` is a single note, per-PC notes, a checklist, or a bare question list (see
// _qaContext). `returnTriumphant` adds the button that opens that move. `aside` is a
// headed block below the body — advice the step doesn't walk you through, set off from
// the prose but always shown.
const _STEPS = [
	{
		key:   "intro",
		title: "An expedition begins",
		icon:  "fa-map-location-dot",
		body:  `<p>The characters are leaving town, to face a threat, seize an opportunity, or chase a plan of their own. This guide walks the journey's arc: <strong>Preparations</strong>, <strong>running the journey</strong>, the <strong>player moves</strong> they'll lean on, and <strong>going home</strong>.</p>
				<p>Travel is dangerous and hard, and that's the point: it makes home feel precious. <strong>Don't gloss it over.</strong> Give it the screen time it deserves.</p>`,
		// The advice is Book I p.340-341; the worked example that follows it (p.342-343) is not
		// reproduced. Every page number in the copy is one of the book's own cross-references from
		// those two pages, so a GM can jump straight to the chapter a line points at.
		aside: {
			label: "What to prep",
			body:  `<p>If you know an expedition is in the PCs' future, there's plenty you can prepare in advance (p.340). None of it is required, but prep helps the journey go smoothly in play.</p>
				<ul>
					<li><strong>Chart the course</strong> first. Look at where they're going and their likely routes, make your <em>Chart a Course</em> choices, and write them down with tick boxes so you can tick them off as you present them.</li>
					<li><strong>Draw a map</strong> of the route you expect them to take. Grab the map of the vicinity around Stonetop or of the World's End region, highlight or add the points of interest this trip touches, and zoom in on anywhere the regional map leaves thin.</li>
					<li><strong>Identify points of interest:</strong> any landmark not yet seen in play (or changed since their last visit), anywhere you mean to frame a scene and make a GM move, and the journey's destination.</li>
					<li><strong>Identify the legs</strong> between them, and note how long each leg is likely to take.</li>
					<li>For each leg and point of interest, jot <strong>a description no longer than a sentence</strong>, <strong>2&ndash;3 impressions</strong> (ideally senses other than sight), <strong>questions to ask</strong> the players, which <em>Chart a Course</em> <strong>challenges</strong> you plan to introduce there, and any other dangers or discoveries you expect.</li>
					<li>Prepare up to <strong>7 encounters</strong>: dangers, discoveries, or events to drop in on a player move or just to break things up. Keep each to 1&ndash;3 sentences, tie it into a larger story, and give any creature a disposition or activity.</li>
					<li>Consider a <strong>Die of Fate table</strong> for the weather (p.324), for events while they <em>Make Camp</em> (p.334), or for encounters while travelling through a perilous area (p.323).</li>
					<li>Create each <strong>site</strong> (p.355), <strong>danger</strong> (p.379), <strong>discovery</strong> (p.421), and <strong>NPC</strong> (p.453) they're likely to encounter, in as much or as little detail as you find useful.</li>
					<li>Finally, write up any <strong>followers</strong> (p.474) or other NPCs you expect to join the party.</li>
				</ul>
				<p>For regions and locations described in <strong>Book II</strong>, copy the relevant details or just note the page and bookmark it. Add questions and details of your own devising.</p>`,
		},
	},
	{
		key:   "chart",
		title: "Chart a Course",
		icon:  "fa-route",
		body:  `<p>When the players start talking about leaving, point them at <strong>Chart a Course</strong>. Pin down their <strong>destination</strong> and roughly how they mean to get there (&ldquo;we follow the tracks&rdquo; is enough).</p>
				<p>Then tell them as many <strong>requirements</strong> and <strong>challenges</strong> as make sense, based on the season, terrain, how well they know the area, and the threats that lurk there. Link them with <strong>&ldquo;and&rdquo;</strong>, or offer a merciful <strong>&ldquo;or.&rdquo;</strong></p>
				<p>Add each one you present below, off the book's list or in your own words, and note what you actually told them. That becomes your narrative to-do list once they set out.</p>
				<p>Two of the book's requirements want travel times. Pick the trip on <strong>The route</strong>, the next step, and they add themselves with the figures already worked out.</p>`,
		qa:    {
			kind:  "checklist",
			key:   "chart",
			// This checklist's requirements carry literal blanks ("at least ___ days"). A flag on
			// the schema, like `journey` on the step below, rather than `_qaContext` recognising
			// the step by name: rename or split the step and a name written in two places stops
			// matching in silence, with the range check still passing.
			routeBlanks: true,
			intro: { field: "route", prompt: "Destination &amp; route", placeholder: "Where are they headed, and how do they intend to get there?" },
			groups: CHART_GROUPS,
			notes: { field: "notes", prompt: "Other notes (nested legs, what you negotiated, how they took it)", placeholder: "Anything else worth remembering…" },
		},
	},
	{
		key:   "journey",
		title: "The route",
		icon:  "fa-signs-post",
		body:  `<p>With the course charted, pin the journey down. Say where they're setting out from and where they're bound: the maps are the region as the books draw it, and the times are the book's own travel table.</p>
				<p>Composing legs is the book's arithmetic too, not a shortcut. Stonetop to <strong>Lygos</strong> is ten days to Marshedge and thirty more beyond it, which is why Book II calls the round trip &ldquo;an entire season of travel.&rdquo; What you pick here fills in the travel times back on <strong>Chart a Course</strong>.</p>`,
		// A per-step flag, like `fate` above, so getData switches on the schema rather than on
		// a key spelled out in two places.
		journey: true,
	},
	{
		key:   "outfit",
		title: "Outfit",
		icon:  "fa-sack",
		body:  `<p>Each PC marks gear on their Inventory insert: up to <strong>3 for a light load</strong> (quick, quiet), <strong>4&ndash;6 normal</strong>, or <strong>7&ndash;9 heavy</strong> (noisy, slow, quick to tire). They also mark <strong>4 + Prosperity</strong> small items (these don't count toward load).</p>
				<p>They can leave marks <strong>&ldquo;undefined&rdquo;</strong> and define them later with <em>Have What You Need</em>. Remind them of anything they need to bring (warm clothes, sleds, a guide). <strong>Followers Outfit too.</strong> Ask where their gear came from. Bring it home.</p>`,
		// No note field: "who's carrying what, and what loads" is what the live party-load readout
		// this step builds already answers, off the marks on the sheets themselves, and typing the
		// same answer underneath it only put a stale copy beside a live one. A trip that already
		// recorded one keeps it — the Chronicle still prints a stored `outfit` answer as
		// "Outfit & supplies" (utils/chronicle-core.js).
	},
	{
		key:      "requisition",
		title:    "Requisition (if needed)",
		icon:     "fa-horse",
		body:     `<p>If they want the steading's communal assets, the horses, a cart, the plows, the big wagon, they <strong>Requisition</strong>: roll <strong>+Fortunes</strong>. Establish the fiction first: who are they asking, and who has the right to say yes?</p>
				<p>They don't need this for the steading's <em>Surplus</em> (unless taking it would be wasteful or risky), and only roll once for a related set of assets.</p>`,
		roll:     "requisition",
		showTiers: true,
		// No note field: what they borrowed is what the steading's asset list on this step is
		// ticked with, and the Chronicle prints those names under "Requisitioned" whether or not
		// anybody typed a sentence. A trip that already recorded one keeps it — the Chronicle
		// still prints a stored `requisition` answer under that same heading
		// (utils/chronicle-core.js).
	},
	{
		key:   "running",
		title: "Running the journey",
		icon:  "fa-person-hiking",
		body:  `<p>Break the trip into <strong>points of interest</strong> (landmarks, planned scenes, the destination) and the <strong>legs of travel</strong> between them. Gloss trivial legs; play out the rest as loose play. Then run the core loop:</p>
				<ol>
					<li><strong>Establish the situation</strong>: describe the terrain, weather, up to 3 sensory impressions; ask questions.</li>
					<li><strong>Make a soft GM move</strong>: especially an exploration move; often one of the challenges you Charted.</li>
					<li>Ask <strong>&ldquo;What do you do?&rdquo;</strong></li>
					<li><strong>Resolve it</strong>: trigger player moves; on a 6- or an ignored threat, make a hard move.</li>
					<li><strong>Repeat</strong>, then transition to the next leg or point of interest.</li>
				</ol>
				<p>The <strong>exploration moves</strong> step two reaches for are listed down the side of this window, on every step. And keep using your standard GM moves too: ask provocative questions, use up their resources, separate them, show downsides.</p>
				<p>On a <strong>perilous</strong> leg, or whenever you&rsquo;re unsure how hard to come down, you can let the Die of Fate set the danger:</p>
				${fateTableList(FATE_TABLES.perilous)}`,
		fate:  "perilous",
		// No note field: the route is plotted on the step of its own before this one, and asking
		// for the points of interest and legs a second time here only split the same answer across
		// two pages. A trip that already recorded one keeps it — the Chronicle still prints a
		// stored `running` answer as "The journey" (utils/chronicle-core.js).
	},
	{
		key:   "playermoves",
		title: "Player moves on the road",
		icon:  "fa-compass-drafting",
		body:  `<p>These come up while traveling:</p>
				<ul>
					<li><strong>Have What You Need</strong>: turn undefined inventory into a specific item they could've had all along.</li>
					<li><strong>Recover</strong>: expend 1 supply, regain 4 + Prosperity HP (once until they take more damage).</li>
					<li><strong>Struggle as One</strong>: the whole party Defies Danger together; a 10+ can pull someone else out of a spot.</li>
					<li><strong>Keep Company</strong>: trade character questions on a quiet stretch; great on the way home.</li>
					<li><strong>Make Camp</strong>: rest in an unsafe area: answer your questions, consume supplies, then pick HP or clear a debility.</li>
					<li><strong>Forage</strong>: spend hours seeking food (+WIS; disadvantage in winter).</li>
				</ul>
				<p><strong>Make Camp</strong> says "answer the GM's questions about your campsite" and
				   leaves the questions to you. They are (p.334):</p>
				<ul>
					<li>If the route is perilous, if there's something to watch out for, or if they
					    risk drawing attention, ask how they address that.</li>
					<li>If it's cold, ask how they stay warm.</li>
					<li>If they start a fire, ask what they use for fuel, or how they start it.</li>
					<li>If it's wet, ask what they do (if anything) to stay dry.</li>
					<li>Ask what precautions they take to keep animals out of their food.</li>
					<li>Ask if they set a watch, and the order.</li>
				</ul>
				<p>Two things that go with it: you don't need the move every night while you're
				   glossing days of road travel (just use up their supplies and move on), and once
				   they've settled in, before you decide what the night holds, ask if anyone wants
				   to <strong>Keep Company</strong>.</p>
				<p>When they <strong>Make Camp</strong> and you're unsure if the night stays quiet, roll the Die of Fate.
				   Consider advantage or disadvantage on it, depending on how well prepared they are:</p>
				${fateTableList(FATE_TABLES.camp)}`,
		fate:  "camp",
		// Deprivation sits BELOW the die, not above it. The prose above the button is the camp
		// itself and the table the die reads against, so the button belongs at the end of that
		// thought rather than a screen further down past a paragraph on going hungry: a GM who
		// has just read "roll the Die of Fate" should not have to scroll past deprivation to
		// find it. Deprivation is what comes AFTER the night, so it reads after the roll.
		bodyAfterFate: `<p><strong>Deprivation</strong> (p.335). If they go without food, drink, or rest, the
				   first cost is just that they get no choice when they Make Camp. The longer it runs,
				   the worse it gets: ask them to <em>Defy Danger</em> against their own hunger, thirst
				   or exhaustion; then a debility; then more debilities; then increasingly aggressive
				   moves, using the GM moves for afflictions. Between sessions, write their
				   deprivation up as a threat.</p>`,
	},
	{
		key:     "home",
		title:   "Going home",
		icon:    "fa-house-chimney",
		// The last step, so this is where Done and "Save to the Chronicle" sit. The chapter's
		// own last part ("What to prep") folds into the intro instead — see the header comment.
		isFinal: true,
		body:  `<p>Usually, <strong>gloss over the trip home</strong>: they already faced these challenges. Use it to ruminate: ask what they keep thinking about, suggest they <strong>Keep Company</strong>. But if they're hauling something awkward, lost or hurt, racing a clock, or taking a new route, <strong>Chart a Course back</strong> and play it out.</p>
				<p>Then, before they walk back in, think through:</p>`,
		// Questions, not answers. These were tick boxes, and the ticks were read by nothing —
		// not the Chronicle, not the steading, not the next step — because the list is the GM's
		// own thinking-through before the PCs walk back in, not a record of what happened. So
		// they wear the question spiral the rest of this system's questions wear, and there is
		// nothing to leave half-ticked.
		qa:    {
			kind:   "questions",
			groups: HOME_GROUP,
		},
		// The last of those questions asks whether they are Returning Triumphant. This is the
		// move itself, on the step where it comes up: the same walkthrough the steading sheet's
		// move card opens (actors/steading/return-triumphant.js), so the debility is cleared here
		// rather than written down here and cleared on another sheet later.
		returnTriumphant: true,
		// The book's own test for whether it counts, printed where the call actually gets made.
		// It is the commentary under the move (Book I p.339) plus the "not a given either way"
		// branch from Aftermath (p.492), and it sits ABOVE the button rather than among the
		// questions on purpose: the sixth question asks WHETHER they are Returning Triumphant,
		// and this is the paragraph a GM answers it with. Nothing else on this step is a ruling
		// the GM has to make against a bar, so the bar goes next to the control that acts on it.
		// GM-only, since it rides inside the GM-only triumph block.
		triumphBody: `<p><strong>Is it a triumph?</strong> The return has to be something folks celebrate, or
					at least talk excitedly about (p.339). If crinwin stole an infant, triumph means saving
					the kid. It does not mean killing a few crinwin and coming home with the child's body.</p>
				<p>Feel it out against what was really at stake. Nobody expected them to save a stranger's
					butchered caravan, so triumph there is putting the raiders down; if it was the town's own
					logging camp, triumph is getting most of the workers back alive, whether or not a single
					raider fell. <strong>Priorities.</strong></p>
				<p>If it could go either way, don't rule on it: make it a scene (p.492). Tell them what it
					would take ("you'll all need to keep your stories straight"), or put them in a spot
					("folks are grumbling, on the verge of panic"), then ask what they do and see if they
					pull it off.</p>
				<p><strong>When in doubt, poll the table.</strong> If anyone, GM or player, thinks the
					return isn't triumphant, the move doesn't trigger.</p>`,
	},
];

/**
 * Where a pin hangs its label, given where the pin itself sits on the picture.
 *
 * Both anchors read the same way: a label near an edge hangs INWARD, so it cannot spill out of the
 * picture and give whatever is showing it a horizontal scrollbar.
 *
 * MODULE LEVEL because three families of mark now want it — the book's places, its edge arrows and
 * the GM's own sites — and the third is built outside `_mapLayer`, where the closure this used to
 * be could not be reached. A second copy of these four numbers would put a site's label on the
 * wrong side of the pin at exactly the edges where it matters.
 */
function pinAnchors(left, top) {
	return {
		anchorH: left > 78 ? "right" : left < 22 ? "left" : "centre",
		anchorV: top > 84 ? "above" : "below",
	};
}

export class ExpeditionDialog extends StepperDialog {
	// The rail's die: what it last drew (so the next draw avoids repeating it) and the walk
	// currently running down the rail, so a second click can abandon the first. The same drawer
	// the GM Toolkit's three lists hold one of (gm-move-drawer.js) — this rail is one section
	// where the toolkit has three, which is the only difference between them and is why the
	// don't-repeat memory is keyed either way. One list, so the rows are gathered from the rail
	// itself rather than from an inner group.
	//
	// Deliberately NOT persisted: it is one click's worth of memory, and a "don't repeat" that
	// survived a reload would be a stored preference nobody asked for. Reopening starts empty.
	// The names are checked against Application and StepperDialog's own members, because a
	// property collision with a base class is silent.
	//
	// BUILT ON FIRST USE rather than as a class field. A field initializer runs only in a
	// constructor, and this dialog is routinely stood up without one — every expedition suite
	// builds it with `Object.create(ExpeditionDialog.prototype)` to skip Application's — so a
	// field here would be undefined exactly where the behaviour is exercised.
	get _moveDrawer() {
		return (this._moveDrawerCache ??= new GmMoveDrawer({
			scope: ".stonetop-guide-moves-sidebar",
			row:   ".stonetop-guide-move",
		}));
	}

	constructor(options = {}) {
		super(options);
		this._rolls = {}; // keyed by step key, so each inline roll persists across nav
	}

	get _steps() { return _STEPS; }
	get _answersSetting() { return ANSWERS_SETTING; }

	static open() {
		return openOrFocus("stonetop-expedition", () => {
			const dialog = new ExpeditionDialog();
			dialog._restoreStep();   // reopen on the step left off at before a reload
			return dialog.render(true);
		});
	}

	/**
	 * Open the walkthrough on ONE trip, minting that trip if the log does not hold it.
	 *
	 * The join between this window and the GM Toolkit's Expeditions tab, where a trip is prepped
	 * in advance (actors/gmtoolkit/gm-expeditions-tab.js). The card there stores whatever id this
	 * hands back, so the SECOND press of Run reaches the same trip with everything already noted
	 * in it rather than starting the night over — and a card whose trip has since been deleted
	 * from the log simply gets a fresh one, which is why an unknown id is not an error here.
	 *
	 * IT WRITES THE SETTING BEFORE IT OPENS ANYTHING, so a window minted below reads the selection
	 * out of the setting the way it reads everything else, with no argument to thread through the
	 * constructor.
	 *
	 * AN ALREADY-OPEN WINDOW IS SWITCHED, not left where it was. `openOrFocus` brings the existing
	 * one to the front WITHOUT running the factory, so a GM with the walkthrough already up would
	 * otherwise press Run on one card and be handed whichever trip they last had open. Its
	 * in-memory draft has to be dropped first: `_log()` memoizes for the window's lifetime, so
	 * `_switchExpedition` would look for the trip just minted in a copy of the log taken before it
	 * existed and no-op.
	 *
	 * GM-ONLY IN PRACTICE, because `_persistLog` writes a world-scoped setting; the tab that calls
	 * this is on a sheet only GMs can open.
	 *
	 * @param {object} options
	 * @param {string} [options.tripId]  The trip to open. Ignored when the log has no such trip.
	 * @param {string} [options.title]   What to call a trip that has to be minted.
	 * @returns {Promise<string>} the id of the trip now being walked.
	 */
	static async openOnTrip({ tripId = "", title = "" } = {}) {
		const log = normalizeLog(getSetting(ANSWERS_SETTING));
		const known = tripId && log.list.some(e => e.id === tripId);
		const entry = known ? null : { id: foundry.utils.randomID(), title: String(title ?? "").trim(), createdAt: Date.now() };
		const id    = known ? tripId : entry.id;
		await setWorldSetting(ANSWERS_SETTING, known ? selectExpedition(log, id) : addExpedition(log, entry));

		const open = findOpenApp(w => w.id === "stonetop-expedition");
		if (open?.rendered) {
			open._logDraft = null;
			// A trip that did not exist a moment ago has nothing on any later step, so the reader
			// belongs at the top of it. Switching to one that DOES exist leaves them where they
			// were, which is the same courtesy the switcher in the log bar already extends.
			if (!known) open._step = 0;
			await open._switchExpedition(id);
			open.bringToTop();
			return id;
		}
		ExpeditionDialog.open();
		return id;
	}

	// Same contract as the session-zero walkthroughs, and the same implementation — see the
	// reload-resume block in StepperDialog. The trip itself already persists (world-scoped
	// `expeditionAnswers`); only the reader's place in the ten steps is per-client, so it
	// rides in the client-scoped resume record and this is the whole opt-in.
	get _resumeKey() { return RESUME_KEY; }

	// The exploration rail's collapse rides along in the same record: `movesRailCollapsed`, the
	// edge handle, which takes the whole column down to a 14px strip. A per-reader preference
	// about the window rather than anything about the trip, which is what the client-scoped
	// resume blob already holds; the alternative was a settings key of its own for one boolean.
	//
	// ONE key, where there were two. The heading used to carry the character sheet's group fold
	// as well (`movesListCollapsed`), and a record written while that existed still has the
	// field — it is read by nobody now and drops out of the record the first time this writes.
	//
	// `saveWalkthroughPosition` compares the WHOLE position object it is handed, extras
	// included, so adding a field here is all it takes for a change in it to be written; a
	// guard that compared only `step` would have dropped every one of these.
	//
	// Read back as `!!`, so a record written before it existed — and one from a reader who
	// never touched the handle — opens the rail, which is the state the moves are worth having.
	_resumeExtras() {
		return { movesRailCollapsed: this._movesRailCollapsed };
	}

	_applyResumeExtras(saved) {
		this._movesRailCollapsed = !!saved?.movesRailCollapsed;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-expedition",
			title:     "Run an Expedition",
			template:  "systems/stonetop-pwd/templates/dialogs/expedition.hbs",
			// Wider than the other steppers to seat TWO rails, the jump-to-step TOC on the
			// left and the exploration moves on the right, and wide enough for a load row
			// (avatar · name · nine ◇ · band pill · count) to sit on one line between them.
			//
			// 1000 = the 800 the step column was sized to, plus the 200 the moves rail takes.
			// The reading column is what 800 was chosen for, so the rail was added to the
			// window rather than taken out of the prose. Collapsing the rail (its handle, or
			// the record it remembers) hands those 200 back to the step.
			width:     1000,
			// Fixed, like the other left-rail guides (Welcome 660×580, Make a Monster
			// 760×620), NOT "auto". These ten steps run from two paragraphs (intro) to a
			// twelve-box checklist (Chart a Course) to a per-PC load table (Outfit) to a
			// regional map (The route), and an auto-height window re-measures its content on
			// EVERY render: measured against a 1000px viewport it opened anywhere from 597px to
			// 951px, and from 734px to 951px at a larger UI font, up to 95% of the screen, a
			// different height on each Next / Back / rail click. (Core clamps an auto height
			// only to the viewport, and the shared .stonetop-spring-dialog cap is itself
			// viewport-sized, so neither bounded it.) The step column scrolls instead: see
			// .stonetop-guide-main. A fixed height also means a manual resize sticks; core
			// discards one on an auto-height window.
			//
			// 900 is a chosen default rather than a computed rail fit: it clears the ten rail
			// entries with room to spare and gives the long steps (Chart a Course's checklist,
			// the route map) most of a screen before the column starts scrolling. Both the
			// rail and the step column are in `scrollY` below, so a shorter viewport clamps
			// this without hiding anything.
			height:    900,
			resizable: true,
			// Hold the reader's place through the re-renders a step does in place — naming
			// the trip, toggling who's on it, re-rolling Requisition — now that the column
			// scrolls. Changing step scrolls back to the top (see StepperDialog._render).
			scrollY:   [".stonetop-guide-main", ".stonetop-guide-toc"],
			// Reuse the spring dialog's window-content reset + body/qa/tier styling.
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-expedition-dialog"],
		});
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._bindStepNav(html);
		html.find(".stonetop-exp-roll-btn").on("click", () => this._rollRequisition());
		// Roll the table the step is showing, not the bare oracle: on these steps the rules ask a
		// specific question ("how perilous?", "does the night stay quiet?"), and a card reading
		// only "4 — neutral / mixed" leaves the GM to look the answer back up on the page behind it.
		html.find(".stonetop-exp-fate-btn").on("click", () => this._rollFate());
		// Collapse / expand the exploration moves rail. By class rather than by re-rendering,
		// for the reason the character sheet's own handle gives: the step reclaims the freed
		// width without a flicker, and a render here would rebuild the route step's map panel
		// (it browses the art folder and measures an image) to move one column. `_saveResume`
		// is called directly because nothing re-renders, and the render is what normally
		// writes the record.
		wireSidebarToggle(html, {
			expandLabel:   "Expand exploration moves",
			collapseLabel: "Collapse exploration moves",
			persist:       collapsed => {
				this._movesRailCollapsed = collapsed;
				this._saveResume();
			},
		});
		// There is NO second collapse on the heading, and that is deliberate — see the note in
		// expedition.hbs. The rail holds one group and nothing else, so folding it away leaves a
		// heading standing over an empty column, which is the handle above's job done worse.
		//
		// The rail's die. Scoped to the rail, because `.stonetop-section-randomize` is the shared
		// heading control and nothing should stop a later step growing one of its own.
		html.find(".stonetop-guide-moves-sidebar .stonetop-section-randomize")
			.on("click", ev => { ev.preventDefault(); this._drawExplorationMove(ev.currentTarget); });
		html.find(".stonetop-spring-done").on("click", () => this.close());
		// Expedition-log bar: rename the current trip, switch trips, start a fresh one.
		html.find(".stonetop-exp-title").on("change", ev => this._saveTitle(ev.currentTarget.value));
		html.find(".stonetop-exp-switch").on("change", ev => this._switchExpedition(ev.currentTarget.value));
		html.find(".stonetop-exp-delete").on("click", () => this._deleteCurrentExpedition());
		html.find(".stonetop-exp-new").on("click", () => this._startNewExpedition());
		// Outfit step: toggle a PC in/out of this trip's party (a chip showing "out" is
		// being turned back on). DELEGATED from the dialog root rather than bound to each
		// chip, because the readout redraws itself between renders (`_refreshLoadReadout`
		// swaps the whole block's markup) and a per-chip binding would be thrown away with
		// the chip that carried it.
		html.on("click", ".stonetop-exp-load-chip", ev => this._togglePartyMember(
			ev.currentTarget.dataset.actorId,
			ev.currentTarget.classList.contains("is-out"),
		));
		// Hover a party face for a full-size look at it, through the shared preview every other
		// small avatar in the system raises. Delegated on the root for the same reason as the
		// chips above, and because the helper pools its listeners per root anyway.
		//
		// ONLY WHERE THERE ARE FACES. The preview watches `mouseenter` in the CAPTURE phase, so
		// every element the pointer crosses anywhere in the window runs a `closest` against this
		// selector -- on the eight steps that draw no readout, for a thumbnail that is not there.
		// Asked of the DOM rather than of the step, so it cannot drift from the `{{#if loadReadout}}`
		// that decides whether the block is drawn at all.
		if (html[0]?.querySelector?.(".stonetop-exp-load")) {
			wireAvatarPreview(html[0], ".stonetop-exp-load-ava-img");
		}
		// "Live from sheets" is what the readout's heading promises, so it has to mean it: watch
		// the documents the party's load is read out of and redraw when one of them moves.
		this._wireLoadWatch();
		// Requisition step: tick an asset the party leaves with (or click one of ours to send it
		// home). The row carries what its own click means, decided when the row was built.
		html.find(".stonetop-exp-asset-btn").on("click", ev => this._toggleRequisitionedAsset(
			Number(ev.currentTarget.dataset.assetIndex),
			ev.currentTarget.dataset.take === "true",
		));
		// Arriving-home step: make the Return Triumphant move. Nothing of the trip is written —
		// the move's whole effect is on the steading — so there is no re-render here; the
		// walkthrough it opens repaints whatever steading sheet happens to be showing.
		html.find(".stonetop-exp-triumph-btn").on("click", () => this._returnTriumphant());
		// Route step: pick a place off the map or the list, or change which map is showing. The
		// same binder the popout uses, because it is the same partial (dialogs/journey-controls.js).
		const journeyHandlers = {
			showTier: tier => this._showMapTier(tier),
			// What a click on a lettered place means, which depends on whether a way is being
			// laid out by hand and on whether shift was held. Asked at click time; see
			// `_chooseJourneyPlace`.
			markPlace: (slug, ev) => this._chooseJourneyPlace(slug, ev),
			// And the same three readings for one of the GM's own sites, which is a place on the way
			// now rather than a link to a journal (user, 2026-08-24). See `_chooseJourneySite`.
			markSite: (uuid, ev) => this._chooseJourneySite(uuid, ev),
		};
		bindJourneyControls(html[0], {
			...journeyHandlers,
			zoom: key => this._openMapWindow(key),
			toScene: () => this._putRouteOnScene(),
			placeSite: () => this._placeSiteFromPanel(html[0]),
			clearDrawn: () => this._clearDrawnWay(),
		});
		// And the map itself, which is where the trip is actually planned: a click plants the start
		// or moves the far end of the way, a shift-click lays a leg, and a right-click takes the
		// whole thing back a step at a time.
		this._armPanelDrawing(html[0]);
		// Right-click a site pin to lift it back off. Delegated on the dialog root, which is fresh
		// on every render, so nothing accumulates.
		bindJourneySiteRemoval(html[0], uuid => this._takeSiteOffMap(uuid));
		// And the same ladder over the destination list, which is the whole screen in a world that
		// never imported the book art: without it a GM with no map on disk could set a trip and
		// never un-set it, since the picture is the only other place this gesture lives.
		bindJourneyUndo(html[0], () => this._undoJourneyMark());
		// This render replaces the map an armed placement was aimed at, so that gesture is over.
		// See `_armPanelPick`.
		this._disarmPanelPick();
		// The scene button's label turns on what THIS reader's canvas is showing, which can change
		// without anything in here happening. Re-wired on every render, released on close.
		this._wireCanvasWatch();
		// DELEGATED, not bound per hotspot: pins, edge arrows and list rows all wear this class and
		// there are around thirty-five of them on a drawn map, re-created on every render.
		// The event travels with the dataset: while the way is being drawn by hand, the shift key is
		// half of what a click on a place said (see `journeyPick`).
		html.on("click", ".stonetop-journey-pick", ev => journeyPick(ev.currentTarget.dataset, journeyHandlers, ev));
		html.find(".stonetop-exp-chronicle").on("click", ev => this._saveChronicle(ev.currentTarget));
		// Save on change so fields keep focus while typing.
		html.find(".stonetop-exp-field").on("change", ev => {
			const el = ev.currentTarget;
			this._saveField(el.dataset.answerPath, el.value);
		});
		// Chart a Course: add a requirement/challenge off the book's menu (or write one), take one
		// back off, and say what was told. The answer saves on blur like every field above it and
		// does not re-render; the two structural buttons do, because the list changed shape.
		html.find(".stonetop-exp-chart-add").on("click", ev =>
			this._addChartRow(ev.currentTarget.dataset.chartGroup));
		html.find(".stonetop-exp-chart-remove").on("click", ev =>
			this._removeChartRow(ev.currentTarget.closest("[data-chart-id]")?.dataset.chartId));
		html.find(".stonetop-exp-chart-answer").on("change", ev => {
			const el = ev.currentTarget;
			this._saveChartAnswer(el.closest("[data-chart-id]")?.dataset.chartId, el.value);
		});
	}

	/**
	 * Draw one exploration move at random, land the light on it, and whisper it to the GM.
	 *
	 * The rail lists the same seven moves off the same table as the GM Toolkit's Exploration
	 * group, so it presses the same drawer (gm-move-drawer.js) — the beat order, the
	 * don't-repeat memory and the one-landing-one-card rule are all its. The paper list is for
	 * reading down when there is time; this is for the other case, which is what an expedition
	 * mostly is: the party has just walked into something, the table is looking at the GM, and
	 * seven moves have gone to soup.
	 *
	 * WHISPERED, never public, for the reason written up in random-gm-move.js: naming the move
	 * announces the trick before it is played. The card carries the move's gloss, one of the
	 * book's examples and the page.
	 *
	 * The speaker is the USER's, not an actor's — a dialog speaks for whoever opened it, where
	 * the toolkit speaks as the toolkit actor.
	 */
	_drawExplorationMove(button) {
		return this._moveDrawer.draw(button, { speaker: ChatMessage.getSpeaker() });
	}

	async getData() {
		const nav  = this._stepNav();
		const step = nav.step;
		const roll = step.roll ? this._rolls[step.key] ?? null : null;
		const { currentId, list } = this._log();
		// The trip being walked, found once and then read for both the banner and the bar.
		//
		// Its name goes through the shared `expeditionLabel` (an unnamed one reads
		// "Expedition 2"), so the banner line, the switcher's own entry for the same trip and
		// the label copied onto whatever it takes out of the steading's stores cannot word one
		// expedition three ways. Null before any trip exists — there is nothing to name yet.
		const currentAt = list.findIndex(e => e.id === currentId);
		const current   = currentAt < 0 ? null : list[currentAt];
		const label     = current && expeditionLabel(current, currentAt);
		const data = {
			...nav,
			isGM:       game.user?.isGM ?? false,
			// The banner's second line. Past the opening page it carries the trip's name,
			// where a read-only nameplate under the log bar used to say it: kept short, as
			// "Expedition: <name>", in the heading that was already standing there, and one
			// line less between the banner and the step's prose. The opening page leaves it
			// off — the bar's own field is right below, holding that name and taking your
			// edits to it, and the heading would only be saying back what you are typing.
			bannerSub:  this._step === 0 || !label ? "Run an expedition" : `Expedition: ${label}`,
			// The expedition-log bar atop the walkthrough: the current trip's name, a
			// switcher (only with more than one), a delete (once any exist), and New.
			// Only the opening step carries the bar itself. Naming a trip, switching to
			// another, deleting one and starting a fresh one are all things you do BEFORE
			// walking the steps, and repeating a Delete on all eleven pages is eleven
			// chances to end the trip you are halfway through writing. Every later step
			// reads the name off the banner above instead, so you can still see at a
			// glance which trip you are filling in.
			expedition: {
				title:       current?.title ?? "",
				// The opening step, where the bar is editable. Off the step INDEX rather than
				// its key: the key would be a name spelled in two files, and this one already
				// means "the first page" everywhere else in the stepper.
				editable:    this._step === 0,
				hasAny:      list.length > 0,
				hasMultiple: list.length > 1,
				options:     list.map((e, i) => ({
					id:        e.id,
					// Through the shared helper: an unnamed trip is tagged onto whatever assets it
					// takes out of the steading, and the two names have to be the same one.
					label:     expeditionLabel(e, i),
					isCurrent: e.id === currentId,
				})),
			},
			showRoll:  step.roll === "requisition",
			roll,
			fortunesLabel: step.roll === "requisition" ? this._fortunesLabel() : null,
			showTiers: !!step.showTiers,
			tiers:     step.showTiers
				? _REQ_TIERS.map(t => ({ ...t, label: _REQ_RESULT[t.key].label, isActive: roll?.tier === t.key }))
				: null,
			showFate:  !!step.fate,
			// The headed aside below the body ("What to prep", on the intro step).
			aside:     step.aside ?? null,
			qa:        this._qaContext(step.qa),
			// The Return Triumphant button, on the arriving-home step. GM-only, like the asset
			// picker and for the same reason: the move writes to the steading sheet. It reports
			// whether there is a steading to write to, so a world without one says so on the
			// button instead of offering a control that can only fail. `body` is the book's test
			// for whether the return counts, printed above the button (see the step's own note).
			returnTriumphant: step.returnTriumphant && game.user?.isGM
				? { hasSteading: !!getStonetopSteadingActor(), body: step.triumphBody ?? "" }
				: null,
			// The exploration moves rail. On EVERY step, not only the ones that reach for a
			// GM move: it is furniture, and a column that came and went as the reader stepped
			// would shift the prose sideways under them twice a walkthrough. The list is the
			// same seven on every step, so it is handed over as the module constant rather
			// than rebuilt per render.
			explorationMoves:   EXPLORATION_SIDEBAR_MOVES,
			movesRailCollapsed: !!this._movesRailCollapsed,
			// The rail's die, and the section key it draws from. GM-only, and empty rather than
			// false so the template's `{{#if}}` and the partial's `data-section` are the one
			// value: the card the draw posts is a WHISPER to the GMs, so a player clicking it
			// would watch a light run down the list and then get nothing at all.
			movesRandomize:      game.user?.isGM ? "exploration" : "",
			// The GM Toolkit's own string, verbatim. Two wordings for one control on two screens
			// the same GM meets in one session is the thing EXPLORATION_SIDEBAR_MOVES exists to
			// prevent for the list; the button deserves the same.
			movesRandomizeTitle: localize("stonetop.gmToolkit.moves.randomize"),
		};
		// The Outfit step gains a live party-load readout — GM-only, since it reads
		// every PC's inventory. Built only on this step so the others stay cheap.
		if (step.key === "outfit" && game.user?.isGM) {
			data.loadReadout = await this._buildLoadReadout();
		}
		// The Requisition step gains the steading's asset list, with this trip's own takes
		// marked. GM-only for the same reason as the load readout, and because taking one
		// writes to the steading sheet.
		if (step.key === "requisition" && game.user?.isGM) {
			data.assetPicker = this._buildAssetPicker();
		}
		// The route step gains the maps and the travel times. Same shape as the readout above:
		// built only on its own step, because it browses the art folder and measures an image.
		if (step.journey) {
			data.journey = await this._buildJourney();
		}
		return data;
	}

	// The steading's current Fortunes, for the Requisition roll. Falls back to +0
	// if there's no steading sheet yet.
	_steadingFortunes() {
		const value = getStonetopSteadingActor()?.system?.stats?.fortunes?.value;
		return Number.isFinite(value) ? value : 0;
	}

	// Signed Fortunes for the roll button label ("+1", "+0", "-1").
	_fortunesLabel() {
		return sign(this._steadingFortunes());
	}

	// ── Expedition log ──────────────────────────────────────────────────────────
	// The log, normalized to { currentId, list } (list-shape logic lives in the pure,
	// unit-tested expedition-log-core). Held in an in-memory draft: world-settings
	// writes are async and don't round-trip before the next handler runs, so reading
	// getSetting right after a fire-and-forget field save returns stale state — which
	// would let a structural action (New / Switch / Delete) or the Chronicle save
	// overwrite or omit a just-typed note. Every write mutates the draft synchronously
	// (then flushes to the setting), so the next read sees it. Same pattern as
	// IntroductionsDialog. A stale currentId falls back to the most recent trip.
	_log() {
		return (this._logDraft ??= normalizeLog(getSetting(ANSWERS_SETTING)));
	}

	// Update the in-memory draft synchronously, then persist it to the world setting.
	//
	// Written through setWorldSetting: `expeditionAnswers` is WORLD-scoped, and only a GM may
	// write one. The dialog is GM prep (its hotbar macro is seeded inside a GM-only block), so
	// that only ever catches a stray call. The draft updates in memory first and unconditionally,
	// so a non-GM who somehow reached the window still sees their own typing until it closes.
	async _persistLog(log) {
		this._logDraft = log;
		await setWorldSetting(ANSWERS_SETTING, log);
	}

	// The trip currently being edited, or null before any exists.
	_currentExpedition() {
		return currentExpedition(this._log());
	}

	// Override: the active trip's notes (chart/outfit/home/… at its top level), so the
	// inherited qa-path logic ("chart.route", "outfit") resolves within the current
	// trip. Returns {} before the first trip exists — the fields render blank and the
	// first edit creates the trip (see ensureCurrent).
	_answers() {
		return this._currentExpedition() ?? {};
	}

	_newExpedition() {
		return { id: foundry.utils.randomID(), title: "", createdAt: Date.now() };
	}

	// Rename the current trip (refreshes the switcher label, and the label on anything it
	// is holding out of the steading's stores).
	async _saveTitle(value) {
		const { log, entry } = ensureCurrent(this._log(), () => this._newExpedition());
		entry.title = value;
		// Two documents, neither waiting on the other: the log is a world setting and the labels
		// are a flag on the steading, and the sync works off the log already renamed above.
		await Promise.all([this._persistLog(log), this._syncHeldAssets(log)]);
		this.render(false);
	}

	// Begin a fresh expedition and jump back to the top of the walkthrough; the prior
	// trip stays in the log (and its Chronicle page) untouched.
	async _startNewExpedition() {
		const log = addExpedition(this._log(), this._newExpedition());
		await this._persistLog(log);
		await this._closeMapWindows();
		this._step = 0;
		this.render(false);
	}

	// Switch which logged trip the dialog is editing. Any open map window is showing the trip being
	// switched AWAY from and has no way to notice — see _closeMapWindows.
	async _switchExpedition(id) {
		await this._persistLog(selectExpedition(this._log(), id));
		await this._closeMapWindows();
		this.render(false);
	}

	// Remove the current trip from the log (confirmed — it discards the trip's notes,
	// and its Chronicle page is pruned on the next save). Selection falls back to the
	// most recent remaining trip.
	async _deleteCurrentExpedition() {
		const current = this._currentExpedition();
		if (!current) return;
		const label = current.title?.trim() ? current.title : "this expedition";
		const ok = await Dialog.confirm({
			title:   "Delete Expedition",
			content: `<p>Delete <strong>${escHtml(label)}</strong> from the log? Its notes can't be recovered.</p>`,
		});
		if (!ok) return;
		const log = deleteExpedition(this._log(), current.id);
		// The trip is gone, so it is holding nothing, and every unnamed trip after it has just
		// been renumbered. Both are the steading's copies going stale; one pass answers both.
		await Promise.all([this._persistLog(log), this._syncHeldAssets(log)]);
		await this._closeMapWindows();
		this._step = 0;
		this.render(false);
	}

	// Compile the recorded answers into the shared "Chronicle" journal and open it
	// (GM-only). Flush the in-memory draft first so the compiler — which reads the
	// persisted setting — sees the latest field edits (the just-blurred field's write
	// may not have round-tripped yet).
	async _saveChronicle(button) {
		await saveChronicleFromButton(button, {
			context:    "Expedition",
			// Through _persistLog so the GM guard on the world write lives in one place.
			beforeSave: () => (this._logDraft ? this._persistLog(this._logDraft) : undefined),
		});
	}

	// Build the current step's note field(s) for the template. `single` is one
	// prompt + answer; `checklist` is an optional intro note, tickable groups, and
	// an optional trailing note. Every field/box carries an `answerPath` into the
	// current trip's notes. (No expedition step uses per-PC notes — that kind lives
	// only in SpringBurstDialog.)
	_qaContext(qa) {
		if (!qa) return null;

		// A bare list of questions to think through: no ticks, no fields, nothing saved. The
		// arriving-home list is the one of these — see the note on that step. Nothing writes
		// to it and the template only reads the prompts, so the authored groups are handed
		// over as the module constant rather than copied field-by-field per render.
		if (qa.kind === "questions") return { kind: "questions", groups: qa.groups };

		const all = this._answers();
		const read = path => foundry.utils.getProperty(all, path);

		if (qa.kind === "checklist") {
			const field = (f, label = "field") => ({
				path:        `${qa.key}.${f.field}`,
				prompt:      f.prompt,
				placeholder: f.placeholder,
				value:       read(`${qa.key}.${f.field}`) ?? "",
				_label:      label,
			});
			// Once the route step has plotted a journey it can answer two of the blanks for
			// itself, and those answers are offered as the box's placeholder rather than spliced
			// into the sentence: see `fillChartBlank` on why the GM's own words outrank the map's.
			const route  = qa.routeBlanks ? this._journeyRoute() : null;
			const picked = chartPicked(read(qa.key));
			return {
				kind:   "checklist",
				intro:  qa.intro ? field(qa.intro) : null,
				groups: qa.groups.map(g => ({
					key:      g.key,
					label:    g.label,
					addLabel: g.addLabel,
					empty:    g.empty,
					entries:  picked
						.filter(e => e.group === g.key)
						.map(e => this._chartRow(e, route)),
				})),
				notes:  qa.notes ? field(qa.notes) : null,
			};
		}

		return { kind: "single", key: qa.key, prompt: qa.prompt, placeholder: qa.placeholder, path: qa.key, answer: read(qa.key) ?? "" };
	}

	/**
	 * One requirement or challenge this trip presented, with somewhere to say what was told.
	 *
	 * THE STEP NO LONGER PRINTS THE BOOK'S TWELVE. It printed all of them with a tick beside
	 * each, and a tick was all a row was: it recorded that a requirement had been PRESENTED and
	 * lost what was actually said. Later each row grew a field, which answered that and left
	 * twelve rows of mostly-empty boxes on a step whose whole use is to be read back mid-journey
	 * as a to-do list. So the menu moved into the add button beside each heading (`_addChartRow`)
	 * and what stands on the page is what the GM actually chose to tell the table.
	 *
	 * A row is drawn as the GM Toolkit's open questions are — question spiral, the line itself,
	 * the answer under it — because it is the same thing: a prompt with an answer that arrives
	 * later, read down a column. Those rules are shared, not copied; the template says where.
	 *
	 * The answer box saves on blur without a re-render, so the row keeps focus while typing.
	 */
	_chartRow(entry, route) {
		const text = chartEntryText(entry);
		// What the plotted route would say, where it has anything to say about this line. Offered
		// as the answer box's placeholder, so a GM who leaves it alone still reads the map's
		// answer and a GM who types gets theirs. The Chronicle resolves the pair the same way.
		const derived = (route && entry.key) ? chartBlankValue(entry.key, route) : null;
		return {
			id:     entry.id,
			text,
			answer: entry.answer,
			hint:   derived ?? "What did you tell them?",
			// The line is trusted authored HTML, so a screen reader needs the plain words to say
			// which prompt this box belongs to.
			plain:  _plainText(text),
		};
	}

	/**
	 * Add a requirement or a challenge: the book's menu for that group, or the GM's own words.
	 *
	 * The menu leaves out what this trip has already presented — the list is what was said, and
	 * saying "you risk getting lost" twice is not a thing that happens. A group whose every
	 * authored line is already on the list still opens, on the write-your-own row: the book's
	 * twelve are examples, not the set.
	 */
	async _addChartRow(groupKey) {
		const group = CHART_GROUPS.find(g => g.key === groupKey);
		if (!group) return;
		const taken = new Set(chartPicked(this._answers()?.chart).map(e => e.key).filter(Boolean));
		const chosen = await pickOrWriteOption({
			title:   group.addLabel,
			options: (group.items ?? [])
				.filter(it => !taken.has(it.key))
				.map(it => ({ id: it.key, html: it.text })),
			writeLabel:       "Something else:",
			writePlaceholder: "Tell them in your own words…",
			buttonLabel:      "Add",
		});
		if (!chosen) return;
		await this._mutateChart(list => [...list, {
			id:     foundry.utils.randomID(),
			group:  groupKey,
			key:    chosen.key ?? null,
			text:   chosen.text ?? "",
			answer: "",
		}]);
		this.render(false);
	}

	/** Take one back off the list. Its answer goes with it — the row was the record. */
	async _removeChartRow(id) {
		await this._mutateChart(list => list.filter(e => e.id !== id));
		this.render(false);
	}

	/**
	 * What the GM told the table about one line. Saved on blur WITHOUT a re-render, like every
	 * other text field in this walkthrough: a render here would tear out the box being typed in.
	 */
	_saveChartAnswer(id, value) {
		return this._mutateChart(list => list.map(e => e.id === id ? { ...e, answer: value } : e));
	}

	/**
	 * Apply `transform` to this trip's charted list and save the result.
	 *
	 * `chartPicked` is read FIRST, which is what upgrades a trip logged under the old step: it
	 * derives the list out of the legacy `checks`/`fills` pair when there is no list yet, so the
	 * transform runs against everything that trip presented. Only then are the two legacy maps
	 * dropped — with the list written from them in the same breath, so nothing is lost, and
	 * without leaving a second copy behind for the Chronicle to print twice.
	 */
	async _mutateChart(transform) {
		const { log, entry } = ensureCurrent(this._log(), () => this._newExpedition());
		this._setChartPicked(entry, transform(chartPicked(entry.chart)));
		await this._persistLog(log);
	}

	/**
	 * Write the charted list onto a trip, and retire the legacy pair in the same breath.
	 *
	 * Every caller has already read the list through `chartPicked`, which derives it from the old
	 * `checks`/`fills` maps when a trip has no list yet — so by the time this runs, everything
	 * those two held is in `list`. Dropping them here is what keeps a trip from carrying two
	 * records of the same requirement, which the Chronicle would print twice.
	 */
	_setChartPicked(entry, list) {
		const chart = (entry.chart ??= {});
		chart.picked = list;
		delete chart.checks;
		delete chart.fills;
	}

	/**
	 * The step's Die of Fate: roll it, walk the light down the table the step prints, and only
	 * then whisper the card.
	 *
	 * The SAME beat the GM Moves randomizer keeps (gm-toolkit/gm-move-drawer.js), and for the same
	 * reason — the table is right there on the page, and a card that posted at the click would
	 * answer the question before the GM had any reason to look at the list. The answer is settled
	 * before the walk starts either way: the light is theatre over a rolled die, not the roll.
	 *
	 * A second press cancels the first walk, and the roll it belonged to posts nothing (spinTo
	 * resolves false), so one landing is one card.
	 */
	async _rollFate() {
		const table = FATE_TABLES[this._stepNav().step.fate];
		await game.stonetop?.rollDieOfFate?.(table, { beforePost: ({ index }) => this._spinFateTo(index) });
	}

	/**
	 * Run the light down the printed table and land it on row `index` (utils/flash-highlight.js).
	 *
	 * Scoped to the LIST rather than to the window: the exploration rail beside it runs the same
	 * light off its own die, and a scope that took in both would have each draw putting the
	 * other's answer out.
	 *
	 * Rows are found by `data-fate-row`, which fateTableList stamps on each <li> — see there on
	 * why not by the printed range. Returns true when there is no walk to make (the table not on
	 * the page, motion turned off): the card still goes out.
	 */
	async _spinFateTo(index) {
		const list = this.element?.[0]?.querySelector(".stonetop-exp-fatetable") ?? null;
		const rows = [...(list?.querySelectorAll("li[data-fate-row]") ?? [])];
		// The cancel/walk/land beat itself lives on SpinTrack, shared with the GM Toolkit's move
		// die; all this method owns is finding the rows. Its OWN track, separate from the rail's,
		// so the two dice on this screen do not cancel each other's walks.
		return (this._fateSpin ??= new SpinTrack()).landOn(rows, index, { scope: list });
	}

	// Persist one field/checkbox at its dotted path within the current trip, without
	// re-rendering (so the active field keeps focus). The first edit on an empty log
	// creates the trip.
	async _saveField(path, value) {
		if (!path) return;
		const { log, entry } = ensureCurrent(this._log(), () => this._newExpedition());
		foundry.utils.setProperty(entry, path, value);
		await this._persistLog(log);
	}

	// ── Requisition: the steading's assets, and what this trip takes ─────────────
	// The Requisition step lists what the village owns in common and lets the GM tick off
	// what the party leaves with. A ticked asset is marked out on the STEADING (struck
	// through there, tagged with this trip), which is what makes "where did the wagon go?"
	// answerable months later, and this trip also keeps its own list for the Chronicle.
	//
	// The live state is read off the steading rather than off the trip's list, because the
	// steading is where an asset actually is: returning a horse by clicking it on the
	// steading sheet has to show here as a horse back home, with no second write to keep in
	// step. The trip's `requisitioned` list is the RECORD of the take, for the journal.

	/** The steading actor plus its wrapper, or null when the world has no steading sheet yet. */
	_steadingWrapper() {
		const actor = getStonetopSteadingActor();
		if (!actor) return null;
		return { actor, steading: actor.typedActor ?? new StonetopSteading(actor) };
	}

	// One row per named steading asset: on hand, out with this trip, or out elsewhere
	// (with a character, or with another trip). The class and glyph are resolved here so
	// the template stays a list of rows, like the load readout above.
	_buildAssetPicker() {
		const found = this._steadingWrapper();
		if (!found) return { hasSteading: false, hasRows: false, rows: [], takenCount: 0 };
		const tripId = this._currentExpedition()?.id ?? null;
		// The steading is the record of where a communal asset actually IS, so which of them this
		// trip is holding is its question to answer rather than a predicate spelled again here.
		const ourIndexes = new Set(found.steading.getAssetsOnExpedition(tripId).map(a => a.index));

		const rows = found.steading.getNamedAssets().map(asset => {
			const ours      = ourIndexes.has(asset.index);
			const elsewhere = !!asset.takenBy && !ours;
			return {
				index:      asset.index,
				name:       asset.name,
				ours, elsewhere,
				// What a click on this row means, decided here: one of ours is sent home.
				take:       !ours,
				stateClass: ours ? "is-ours" : (elsewhere ? "is-elsewhere" : ""),
				glyph:      ours ? "✓" : (elsewhere ? "✕" : "+"),
				where:      elsewhere ? assetTakenLabel(asset) : "",
			};
		});

		return {
			hasSteading:  true,
			steadingName: found.actor.name,
			hasRows:      rows.length > 0,
			rows,
			takenCount:   rows.filter(r => r.ours).length,
		};
	}

	// Take an asset out on this trip, or send it back. `take` is what the clicked row was
	// offering, so a row already ours returns it.
	//
	// Two writes, and they don't fold into one: the steading holds where the thing IS (so its
	// sheet can strike it through and say where it went), the trip holds what it BORROWED (so
	// the Chronicle page can name it even after it comes home). The steading write is guarded,
	// because it is another document and a refusal there must not leave the trip claiming a
	// wagon the village still has.
	async _toggleRequisitionedAsset(index, take) {
		if (!Number.isInteger(index)) return;
		const found = this._steadingWrapper();
		if (!found) {
			ui.notifications?.warn?.("No steading sheet in this world to requisition from.");
			return;
		}
		const { log, entry } = ensureCurrent(this._log(), () => this._newExpedition());
		const name   = found.steading.getNamedAssets().find(a => a.index === index)?.name ?? "";
		const record = Array.isArray(entry.requisitioned) ? entry.requisitioned : [];

		// KEYED ON THE NAME, WHICH IS ALSO THE WHOLE OF WHAT THE RECORD IS FOR. An asset's index is
		// its POSITION in the steading's `assets` array, and the steading sheet's delete splices
		// that array — so an index stored over here, in the expedition log, silently came to name a
		// different asset the moment a row above it was removed. Nothing pointed at the drift: the
		// return filter stopped matching, so the trip kept claiming a rope it had brought back,
		// and the take dedupe then matched the orphan and swallowed the NEXT asset to land on that
		// index, leaving the Chronicle naming one thing the party never took and omitting the one
		// it did.
		//
		// The name is what `requisitionedList` prints and the only field it reads, so nothing is
		// lost by keying on it; two assets sharing a name are indistinguishable in that list
		// anyway. Records written before this still carry `name` beside their stale index, so they
		// keep matching with no migration.
		// Never matches on a blank: an index the steading no longer has resolves to "", and a
		// predicate that then matched every nameless record would clear the trip's whole list.
		const sameAsset = r => !!name && String(r?.name ?? "") === name;
		try {
			if (take) {
				const title = expeditionLabel(entry, log.list.findIndex(e => e.id === entry.id));
				const ok = await found.steading.setAssetTaken(index, { expedition: { id: entry.id, title } });
				if (!ok) return;
				// An asset returned from the steading sheet and then taken again here would
				// otherwise be recorded twice on the one trip.
				entry.requisitioned = record.some(sameAsset) ? record : [...record, { name }];
			} else {
				await found.steading.returnAsset(index);
				entry.requisitioned = record.filter(r => !sameAsset(r));
			}
		} catch (err) {
			warn("Could not update the steading's assets:", err);
			ui.notifications?.warn?.(`Could not update ${found.actor.name}'s assets.`);
			return;
		}

		await this._persistLog(log);
		this.render(false);
	}

	// ── Arriving home: Return Triumphant ─────────────────────────────────────────

	/**
	 * Make the Return Triumphant move (Book I p.339) from the last step of the walkthrough.
	 *
	 * Hands straight off to the shared walkthrough the steading sheet's move card opens
	 * (actors/steading/return-triumphant.js). Nothing of the expedition is recorded: the move's
	 * whole effect is a debility cleared, or a point of Fortunes, on the steading — and that is
	 * already written down where it belongs, on the sheet, in its ledger, attributed to the move.
	 */
	_returnTriumphant() {
		const found = this._steadingWrapper();
		if (!found) {
			ui.notifications?.warn?.("No steading sheet in this world to Return Triumphant to.");
			return;
		}
		openReturnTriumphant(found.steading);
	}

	/**
	 * Put the steading's copy of "who is holding what" back in step with the log.
	 *
	 * Called after ANY write that changes what a trip is called or whether it exists, which is
	 * both of the ones there are: a rename, and a delete. The whole log goes over rather than the
	 * one trip that changed, because deleting a trip renumbers every unnamed trip after it and
	 * the delete is also how an asset's trip stops existing. See reconcileHeldAssets.
	 *
	 * Guarded and quiet: the steading is another document, and a refusal there must not take the
	 * log write down with it.
	 */
	async _syncHeldAssets(log) {
		const found = this._steadingWrapper();
		if (!found) return;
		try {
			await found.steading.reconcileHeldAssets(expeditionNames(log));
		} catch (err) {
			warn("Could not bring the steading's requisitioned assets up to date:", err);
		}
	}

	// Roll 2d6 +Fortunes for Requisition, remember the tier (to highlight the
	// matching outcome), and post a result card. Re-rollable — the latest wins.
	async _rollRequisition() {
		if (!globalThis.Roll) return;
		const fortunes = this._steadingFortunes();
		this._rolls.requisition = await rollSeasonsCard({
			// sign() keeps a negative Fortunes value a valid formula ("2d6 -1", not "2d6 + -1").
			formula:     `2d6 ${sign(fortunes)}`,
			alias:       "Requisition",
			resultTable: _REQ_RESULT,
		});
		this.render(false);
	}

	// ── The route (journey step) ─────────────────────────────────────────────────
	// The book's travel table, made tappable. The graph and the solve are pure and live in
	// data/travel-times.js and utils/travel-route.js; everything here is presentation plus the
	// one impure question — which copy of the map, if any, this world has on disk.

	/**
	 * The trip's saved pick: an unwritten start defaults to home, one peeled off is nowhere.
	 *
	 * The default is applied inside `normalizeJourney` (utils/journey-start.js `storedStart`) and
	 * nowhere else, so `hasStart(pick.start)` is the same answer everywhere it is asked.
	 */
	_journeyPick() {
		return normalizeJourney(this._currentExpedition()?.journey);
	}

	/**
	 * The route this trip is about, or null when it is not about one yet.
	 *
	 * WHICHEVER KIND IT IS. `journeyRoute` answers with the table's solve or with the way the GM
	 * drew, depending on what the trip says, and everything on this screen reads it through here
	 * for that reason: the readout, the Chart a Course carry-forward and the scene button all mean
	 * "the way they are going", and none of them should have to ask which sort it is.
	 */
	_journeyRoute(routes = null) {
		return journeyRoute(this._currentExpedition()?.journey, { routes });
	}

	/** The trip's hand-drawn way, ticked on or not. */
	_customPath() {
		return normalizeCustom(this._currentExpedition()?.journey?.custom);
	}

	/**
	 * Which map to show: what the GM last opened, else the CLOSEST one that can draw the whole
	 * journey — both ends of it, not just the far one.
	 *
	 * "Wherever the destination is drawn, outermost first" is right for every place but one, and
	 * wrong for the one that matters: Stonetop is the only place drawn on both maps, so a walk to
	 * it from the Red Grove — four to six hours, entirely inside the Vicinity — was sent out to the
	 * map of the whole continent, where the Red Grove has no pin, no arrow names it, and the route
	 * line therefore cannot be drawn at all. Asking about the pair instead of the destination alone
	 * costs nothing anywhere else, because every other place is drawn on exactly one map.
	 *
	 * A HAND-DRAWN WAY OUTRANKS ALL OF THAT, and only a deliberate tab click outranks it: its marks
	 * are fractions of one picture, so that picture is the only one it can be drawn or added to. A
	 * tab click still wins, because looking at the other map to compare is a reasonable thing to
	 * want and the readout says plainly which map the way is on.
	 */
	_activeTier(start, destination, custom = null) {
		const slugs = TRAVEL_MAPS.map(m => m.slug);
		if (slugs.includes(this._journeyTier)) return this._journeyTier;
		if (custom?.on && custom.tier) return custom.tier;
		// A START PLACED BY HAND OUTRANKS THE DESTINATION, for the same reason a drawn way's marks
		// do and one line above: it is a fraction of one picture, so that picture is the only map
		// this journey can be drawn on at all. Sending the panel to the World's End because Lygos
		// is only lettered there would open the one map that cannot show where the party is
		// standing, and `routePath` would rightly refuse the whole line.
		const placed = startTier(start);
		if (placed) return placed;
		const from = startEnd(start);
		// Nothing to travel to yet, so the start is the whole of the journey — and it still has
		// to be drawable. Returning the innermost map flat meant setting out from Marshedge, the
		// Steplands or Tor's Fist opened a Vicinity with no "setting out" pin anywhere on it.
		if (!destination) return slugs.find(slug => drawnOn(slug, from)) ?? slugs[0];
		// FILTERED, because a trip with no start at all has a null end and `tierDrawingEnds` reads
		// one as undrawable rather than as nothing to draw (which is what `tierDraws` reads it as).
		// Left in, it would answer "no single map holds both" for every map on a trip whose start
		// has just been peeled off, and send a reader picking Marshedge out to the World's End.
		const both = tierDrawingEnds([from, destination].filter(Boolean));
		if (both) return both;
		// No single map holds both ends, so show the destination's own outermost — and for a place
		// past every edge, the outermost map there is, whose arrow points at it.
		return slugs.filter(slug => drawnOn(slug, destination)).at(-1) ?? slugs.at(-1);
	}

	/**
	 * A destination's travel time, for a pin label or a list row.
	 *
	 * TILDED WHERE ANY OF IT WAS MEASURED, which is the same mark the readout's own leg list wears
	 * and it means the same thing: a journey setting out from a point the GM put down joins the
	 * book's roads across a leg this system measured off the map (see `solveFrom`), so its total is
	 * the book's times plus a guess. Costs nothing on a trip leaving a lettered place, where no
	 * route is estimated and the tilde never appears.
	 */
	_timeLabel(routes, slug) {
		const route = routes.get(slug);
		if (!route?.legs?.length) return null;
		return `${route.estimated ? "~" : ""}${formatTravelTime(route.total)}`;
	}

	/** A place's gazetteer entry in the merged journal pack, when the books give it one. */
	_journalUuid(place) {
		return place?.journalId ? `Compendium.${JOURNAL_PACK}.JournalEntry.${place.journalId}` : null;
	}

	/**
	 * Everything drawn ON one map: its picture, the route line, and a hotspot per place.
	 *
	 * Built for a NAMED tier rather than for whichever one the panel is showing, because two
	 * surfaces draw it and they can be looking at different maps — the walkthrough's own panel
	 * follows the destination, while a "See the whole map" window keeps showing whatever map it
	 * was opened on until it is closed. One builder, so a pin means the same thing on both.
	 *
	 * Returns null when this world has no copy of that map, which is the ordinary state of a world
	 * that never imported the book art.
	 *
	 * `stops` is the hand-drawn way's own run of stops when there is one, which changes what some
	 * of the marks below MEAN rather than adding a fourth kind: a lettered place standing on the
	 * drawn way wears its name and its number, and the far end of that way is where the party is
	 * bound whether or not anything was ever picked from the list.
	 */
	_mapLayer(tier, art, { routes, route, start, origin, destination, stops = [] }) {
		if (!art) return null;
		const path = routePath(route, tier, art.frame, art.aspect);
		// Which lettered places stand on the drawn way. The origin is skipped: it is already drawn
		// as the origin, and calling it a stop as well would label it twice over.
		const onWay = new Set(stops.slice(1).map(stop => stop.slug).filter(Boolean));
		// The end of a drawn way is where they are bound, which is the thing the destination pill
		// has always said. Falls back to the picked destination, which is what it means with no
		// way drawn.
		const bound = stops.length > 1 ? stops.at(-1).slug : destination;
		return {
			...art,
			tier,
			alt: `${travelMap(tier)?.name ?? "The region"}, from the Stonetop rulebooks`,
			path,
			// Only ever set when there is no line: what the reader gets instead of one. The
			// sentence is finished HERE rather than in the partial, so the readout and the
			// refusal toast cannot come to word the same fact differently.
			offMap: path ? null : this._offMapReadout(offMapNote(tier, route)),
			// Where they set out from, when that is a point the GM put down rather than a place the
			// books lettered. Null the rest of the time: a lettered start is already drawn by its
			// own pin below, wearing the setting-out ring, and a second mark on top of it would be
			// the same fact twice.
			start: this._startPin(tier, art.frame, start),
			// The bare marks of a hand-drawn way, each wearing the number the readout calls it by.
			// Only the ones the GM put down: a stop that landed on a lettered place is drawn by
			// that place's own pin below, lit up, rather than by a second mark on top of it.
			marks: stops
				.map((stop, i) => ({ stop, at: i }))
				.filter(({ stop }) => stop.mark && stop.spot)
				.map(({ stop, at }) => {
					const { left, top } = spotPercent(stop.spot, art.frame);
					// NO ANCHOR, unlike every pin on this picture: those are for hanging a NAME
					// inward from an edge, and a numeral has no name to hang. It is centred on its
					// own spot and stays inside the frame by being 20px wide.
					return { mark: stop.mark, left, top, isEnd: at === stops.length - 1 };
				}),
			spots: placesOnMap(tier).map(place => {
				const { left, top } = spotPercent(place.spots[tier], art.frame);
				const time = this._timeLabel(routes, place.slug);
				const isOrigin = place.slug === origin;
				const isChosen = place.slug === bound;
				const isStop = onWay.has(place.slug);
				return {
					slug: place.slug, name: place.name, left, top, time, isOrigin, isChosen, isStop,
					// Labels only where they carry the answer, so eleven of them cannot collide —
					// and a stop on the drawn way carries one, because the reader put it there and
					// the leg list below names it.
					showLabel: isOrigin || isChosen || isStop,
					tooltip: isOrigin ? `${place.name}, setting out` : time ? `${place.name}, ${time}` : place.name,
					...pinAnchors(left, top),
				};
			}),
			exits: exitsOnMap(tier).map(exit => {
				const { left, top } = spotPercent(exit, art.frame);
				const time = exit.node ? this._timeLabel(routes, exit.node) : null;
				return {
					...exit, left, top, time,
					isChosen: !!exit.node && exit.node === bound,
					isStop: !!exit.node && onWay.has(exit.node),
					tooltip: exit.node
						? `${exit.label}${time ? `, ${time}` : ""}`
						: `Zoom out to ${travelMap(exit.to)?.name ?? "the wider map"}`,
					...pinAnchors(left, top),
				};
			}),
			// The GM's own prep, on the same picture and by the same arithmetic. Last of the three,
			// because it is the only one that is not the books'.
			sites: this._sitePins(tier, art.frame),
		};
	}

	/**
	 * The mark a hand-placed start stands at on one map, or null.
	 *
	 * ONLY ON ITS OWN MAP. The fraction it is stored as means one valley on the Vicinity and quite
	 * another on the World's End, so the other tab draws nothing and the readout says where the
	 * journey is instead (see `offMapNote`). `startSpot` makes the same judgement for the first leg
	 * of a drawn way, off the same start.
	 *
	 * NOT A BUTTON, and it takes no clicks at all — the same choice the drawn way's own numerals
	 * make, for the same reason. Every gesture over this picture is about the trip: a plain click
	 * moves the far end of the way, a shift-click adds a leg. A mark that swallowed those would be
	 * the one thing on the map that stops the map working, and it has nothing of its own to do with
	 * a click. Moving where they set out from is a right-click back past it and a click somewhere
	 * else — the same ladder everything else on this picture comes off by.
	 *
	 * IT WEARS "setting out" AND NOT ITS OWN NAME, because its name is "a point on The Vicinity" and
	 * that is a sentence about the map rather than a label to stand on it. The pill is the same
	 * wording the destination list puts beside a lettered start, so the two read as one idea.
	 */
	_startPin(tier, frame, start) {
		const mark = startMark(start);
		if (!mark || startTier(start) !== tier) return null;
		const { left, top } = spotPercent(mark, frame);
		return {
			left, top,
			label: localize("stonetop.expedition.start.pinLabel"),
			...pinAnchors(left, top),
		};
	}

	/**
	 * The sites the GM has dropped on one map, ready for the pin layer.
	 *
	 * GM-ONLY, and not merely hidden: a site is prep filed in a NONE-owned journal (see
	 * module/sites/site-store.js), so a player has nothing to resolve here in the first place and
	 * a pin they could see would name a write-up they could not open.
	 *
	 * The spot goes through the very same `spotPercent` the book's own places do, against the very
	 * same frame, because it was recorded as the same kind of number: a fraction of the printed
	 * crop, not of the file. That is what makes a site pin land in the same valley on the poster
	 * scan and on the 300 dpi render, and it is the whole reason `percentSpot` exists.
	 */
	_sitePins(tier, frame) {
		if (!game.user?.isGM) return [];
		const steading = getStonetopSteadingActor();
		if (!steading) return [];
		return sitesOnMap(steading, tier).map(({ page, spot }) => {
			const { left, top } = spotPercent(spot, frame);
			return {
				uuid: page.uuid,
				name: page.name,
				left, top,
				// The same weathered stone the site CARDS are accented in, handed to the markup the
				// same way they hand it: re-inking sites is then one edit, not one plus a stylesheet.
				accent: SITE_ACCENT,
				// The tooltip is where this map teaches what a mark does, as it already does for the
				// edge arrows. BOTH gestures, because they are about two different things and only
				// one of them is guessable: a tap lays the way through this site, and a right-click
				// takes the pin off the map (which is the only way back off, and does not touch the
				// write-up).
				tooltip: format("stonetop.expedition.sites.pinTip", { name: page.name }),
				...pinAnchors(left, top),
			};
		});
	}

	/**
	 * The state of the "put a site on the map" button, or null when there is no button to draw.
	 *
	 * Shaped like `_sceneRouteState` and gated the same way, for the same two reasons: it writes to
	 * a journal only a GM may touch, and a control that is visibly there and refuses on click is
	 * worse than one that never offered. The extra condition is the picture — a placement is a
	 * point ON a map, so with no map on screen there is nothing to point at.
	 */
	_placeSiteState(map) {
		if (!game.user?.isGM || !map) return null;
		return {
			label: localize("stonetop.expedition.sites.place"),
			tooltip: format("stonetop.expedition.sites.placeTip", {
				map: travelMap(map.tier)?.name ?? localize("stonetop.expedition.sites.thisMap"),
			}),
		};
	}

	/**
	 * The whole route planner, as the template wants it.
	 *
	 * `forTier` names a map to build for instead of the one the panel is showing — how the "See the
	 * whole map" window asks for its own map, which it keeps even after a destination has taken the
	 * panel out to the other one. Asking for a tier also renders the pin layer into `pins`, since
	 * that window has no template of its own to `{{> }}` it from.
	 */
	async _buildJourney(forTier = null) {
		const { start, origin, destination, custom } = this._journeyPick();
		// Through `solveFrom` rather than `solveTravel`, because the party may be setting out from a
		// point the GM put down: that answer joins the table across one measured leg and is the
		// book's own times from there. See utils/travel-route.js.
		const routes = solveFrom(start);
		// The way they are actually going, which is the drawn one whenever there are marks on the
		// map. Every number, line and sentence below is about THIS route, so the two kinds cannot
		// come apart on the way to the screen.
		const route  = this._journeyRoute(routes);
		const tier   = forTier ?? this._activeTier(start, destination, custom);
		// Only the way's OWN map gets the marks. On the other tab the readout says where the way is
		// drawn and offers the button back to it, which is a truer answer than marks at fractions
		// that mean somewhere else entirely.
		const stops  = custom.on && custom.tier === tier ? customStops(start, custom) : [];

		// One browse for both tiers (it is promise-cached per session anyway), so the tier tabs can
		// say which maps this world actually has before the GM clicks one. Only the tier being
		// DRAWN is then measured: that is a 300 dpi decode, and this runs on every render.
		const present = await browseTravelMapArt().catch(() => null);
		const files = new Map(present
			? await Promise.all(TRAVEL_MAPS.map(async m => [m.slug, await travelMapFile(m, present).catch(() => null)]))
			: TRAVEL_MAPS.map(m => [m.slug, null]));

		// Still gated on the cheap answer: with no file for this tier there is nothing to measure,
		// and where the browse failed outright that gate is also what keeps `resolveTravelMap` from
		// going back to the folder for a second look at a directory that just refused to be read.
		const art = files.get(tier)
			? await resolveTravelMap(travelMap(tier), present).catch(() => null)
			: null;
		const map = this._mapLayer(tier, art, { routes, route, start, origin, destination, stops });
		// The picture the PANEL is showing, remembered for the one control that needs to write onto
		// it: putting a site down is a click on a map, and the handler has only the DOM to go on
		// unless the tier and the file's registration are kept where it can reach them. Only for
		// the panel's own build — a window asking for its own tier has that pair in hand already
		// (see TravelMapWindow._placeSite), and stashing its answer here would leave the panel
		// placing sites against whichever map somebody last popped out.
		if (!forTier) this._panelMap = map;
		// WHICH MAP THE PANEL IS ON, which is not the same fact as `_journeyTier` and is the one a
		// pick has to answer to. `_journeyTier` is only ever set by a tab click, so a reader who
		// arrived at the World's End by picking Marshedge is standing on it with nothing recording
		// that they are. See `_setJourneyPlace`: what it has to know is where they were LOOKING,
		// not whether they clicked a tab to get there. Remembered even where this world has no copy
		// of the art, because the tier tabs and the destination list are on screen either way.
		if (!forTier) this._shownTier = tier;

		const row = place => ({
			slug: place.slug, name: place.name,
			time: this._timeLabel(routes, place.slug),
			isOrigin: place.slug === origin,
			isChosen: place.slug === destination,
			uuid: this._journalUuid(place),
		});

		const routeStops = route?.legs?.length ? stopsAlongTheWay(route) : [];
		// Where they are bound, which the far end of a drawn way answers for even when nothing was
		// ever picked off the list. A way ending on a bare mark has no name to give, and the pill
		// says so rather than falling back to a destination the line does not go to.
		const boundTo = stops.length > 1 ? travelPlace(stops.at(-1).slug) : travelPlace(destination);

		return {
			// WHERE THEY SET OUT FROM, named however it was chosen — or `set: false` when nobody has
			// said yet. A place the books lettered gives its own name; a point the GM put down gives
			// the map it stands on; a trip peeled back past its start has no name at all, and the
			// list heading is written from `set` rather than being handed a placeholder to print.
			// `slug` is null for both of the others — there is no place to be.
			start: {
				name: startName(start),
				slug: origin,
				set: hasStart(start),
			},
			// Where they are bound. Still a fact the map draws (the gold pin, the far end of the
			// line) and the list marks — only the row of controls that used to READ it back in
			// words, with an × to un-pick it, has gone: a right-click on the picture is what takes
			// a destination off now, on the rung above the start (see `_undoJourneyMark`).
			destination: boundTo,
			// IS THE NEXT CLICK GOING TO SAY WHERE THEY SET OUT FROM? The whole-screen version of
			// `custom.canSetStart`, which is the same question asked of one PICTURE and therefore
			// wants a map to be asked about. This one wants none: the destination list answers it
			// too, and in a world that never imported the book art that list is the whole screen —
			// which is exactly the case the old press-then-click button existed to cover, and the
			// one this must not lose. Both template roots wear a class off it, so the rows can say
			// what they are about to do.
			needsStart: (game.user?.isGM ?? false) && !hasStart(start),
			// The drawn way's own state, for the line of instructions under the map. Built for
			// everyone, because a player looking at the route step should see that the way on it
			// was laid out by hand; `canDraw` is what gates the CONTROLS, since drawing writes the
			// trip to a world setting only a GM can touch.
			// COUNTED OFF THE STORED MARKS, not off `stops`, which is empty on the map the way is
			// NOT drawn on: "start over" would go missing from the other tab, on a way that plainly
			// has something to start over from.
			custom: this._drawState(custom, tier, start, destination),
			tiers: TRAVEL_MAPS.map(m => ({
				slug: m.slug, name: m.name, scale: m.scale,
				isActive: m.slug === tier, hasMap: !!files.get(m.slug),
			})),
			activeTier: tier,
			map,
			// Only for a caller that named a tier: the panel draws the same partial inline with
			// `{{> }}`, and rendering it twice on every step change would be waste.
			pins: forTier && map ? await renderTemplate(JOURNEY_PINS_TEMPLATE, map) : "",
			// The list is the map's legend AND the whole screen when no map is on disk, which is
			// what makes that fallback free rather than a second implementation.
			hasAnyMap: [...files.values()].some(Boolean),
			groups: this._destinationGroups(row),
			route: route?.legs?.length ? {
				legs:     route.legs,
				// "At least" for the table's own times, "roughly" for a way measured off the map:
				// one is a floor the book printed and the other is a good guess, and the readout
				// has no business wording them the same. See `routePhrase`.
				atLeast:  routePhrase(route),
				drawn:    !!route.custom,
				estimated: !!route.estimated,
				estimateNote: route.estimated
					? format("stonetop.expedition.draw.estimate", {
						map: travelMap(route.tier)?.name ?? "",
					})
					: "",
				stops:    routeStops,
				hasStops: routeStops.length > 0,
				// Through the SAME predicate the carry-forward ticks the box with, so the readout
				// cannot promise a blank that `chartBlankValue` refuses to fill. Five of the
				// eighteen destinations from Stonetop are measured only in hours, and the readout
				// used to tell the GM the days were filled in on every one of them.
				hasDays:  chartBlankValue("days", route) !== null,
			} : null,
			scene: this._sceneRouteState(route),
			placeSite: this._placeSiteState(map),
		};
	}

	/**
	 * The state of the "draw it on the scene" button, or null when there is no button to draw.
	 *
	 * GM-ONLY, and not merely hidden from players: the button writes a Scene flag, which a player
	 * cannot do. A control that is visibly there and refuses on click is worse than one that never
	 * offered. Players still SEE the route once a GM puts one down, because the flag broadcasts
	 * and every client paints from it.
	 *
	 * `showing` is asked of the scene on THIS reader's canvas, so the label tells the truth about
	 * the map in front of them rather than about the one the GM who drew it was looking at. It is
	 * recomputed on `canvasReady` (see `_wireCanvasWatch`), which is what keeps it honest when the
	 * reader walks from one map to the other with the walkthrough open.
	 */
	_sceneRouteState(route) {
		// ONE test, and it is `_sceneRouteShowing`'s: asking the same question here first meant the
		// record it stamps was skipped on exactly the renders that answer "no button" — with no
		// destination picked, or for a player — leaving `_sceneShowing` undefined. The next
		// `canvasReady` then compared undefined against null, decided something had moved, and paid
		// for the full re-render the guard exists to avoid.
		const showing = this._sceneRouteShowing(route);
		if (showing === null) return null;
		return {
			showing,
			label: localize(`stonetop.expedition.route.${showing ? "take" : "draw"}`),
			icon: showing ? "fa-eraser" : "fa-map-location-dot",
			// THE DRAW TIP NAMES THE SCENE THE PRESS LANDS ON, because the one thing this button
			// does that surprises people is that it writes on the CANVAS, not on the picture in
			// this window. A GM reading the Vicinity here with the village scene open presses it
			// and the canvas moves under the table (`_drawOnItsOwnMap`), which is the right
			// outcome and still a startling one to meet unannounced. `tierDrawing` is the same
			// answer that switch is made on, so the tip before the press and the map that comes up
			// after it cannot come to name two different things. Null when no one map draws both
			// ends: there is nowhere to send them, and the fallback says what is wanted rather
			// than pretending to know its name.
			//
			// Only the draw side says it. Once the route IS showing, the reader is by definition on
			// the scene it went onto, and telling them to go there would be telling them nothing.
			tooltip: showing
				? localize("stonetop.expedition.route.takeTip")
				: format("stonetop.expedition.route.drawTip", {
					map: travelMap(tierDrawing(route))?.name
						?? localize("stonetop.expedition.route.drawTipMap"),
				}),
		};
	}

	/**
	 * The scene button's whole state as ONE tri-state: null when there is no button to draw at
	 * all, else whether the canvas in front of this reader is already showing this journey.
	 *
	 * ONE function, asked both by the thing that draws the button and by the hook that decides
	 * whether anything needs redrawing — a second copy of this condition is exactly how the
	 * record it keeps below would go stale and start skipping redraws that mattered.
	 *
	 * It STAMPS what it saw on the way past, so `_sceneChanged` can tell a canvas event that
	 * changed this panel from one that did not.
	 *
	 * NEITHER CALLER PAYS FOR A SOLVE IT DOES NOT NEED. `_buildJourney` has just solved the whole
	 * travel graph and passes what it got, where re-solving cost a second Dijkstra over every
	 * place plus `describeLegs` for every reachable one on every render of the journey step.
	 * `_sceneChanged` has nothing in hand, and the two cheap gates below are ordered so that the
	 * case it fires on most — the GM walking between two scenes with no destination picked at all
	 * — never reaches the solve.
	 */
	_sceneRouteShowing(route) {
		const pick = this._journeyPick();
		const scene = globalThis.canvas?.scene ?? null;
		if (!game.user?.isGM) {
			this._sceneShowing = null;
			return null;
		}
		// Is there anything to put on a scene at all — the cheap gate, before the solve. With the
		// way drawn by hand that is a mark on the map rather than a destination picked off the
		// list, and asking only about the destination hid the button on every hand-drawn way that
		// ended somewhere the books never named.
		const anyRoute = pick.custom.on || !!pick.destination;
		if (!anyRoute || !(route ?? this._journeyRoute())?.legs?.length) {
			// NOTHING TO DRAW IS NOT THE SAME AS NOTHING DRAWN. A line already on this scene
			// outlives the trip that put it there — start a new expedition, or right-click the
			// destination off, and the trip has no route while the scene still paints one on every
			// client, players included. Hiding the button there left the GM no control anywhere in
			// the system that could take it off. So: no route in hand, but a line on the scene,
			// still offers the way back off.
			this._sceneShowing = sceneJourney(scene) ? true : null;
			return this._sceneShowing;
		}
		const showing = sceneShowsJourney(scene, pick);
		this._sceneShowing = showing;
		return showing;
	}

	/**
	 * The off-map note with its prose already written, or null when the line drew fine.
	 *
	 * `offMapNote` answers in slugs and names; turning that into a sentence is this layer's job,
	 * and doing it here rather than in the partial is what lets the "Show <other map>" button be
	 * the only markup the template owns.
	 */
	_offMapReadout(note) {
		if (!note) return null;
		const places = offMapNames(note);
		return {
			...note,
			// A route pinned to the other tab is not a place gone missing, and saying so would send
			// the reader hunting for one. It is fractions of the map it belongs to; naming that
			// map, with the button back to it, is the whole of the answer.
			//
			// WHICH pinning, though, because there are two and they are different facts about the
			// trip: the GM drew this way on that map, or the party is standing on it. `drawn` is
			// what `pinnedOffMapNote` tells them apart with.
			sentence: note.elsewhere
				? format(
					note.drawn
						? "stonetop.expedition.route.panelDrawnOn"
						: "stonetop.expedition.route.panelStartOn",
					{ map: note.otherName ?? "" },
				)
				: places
					? format("stonetop.expedition.route.panelOffMap", { places })
					: localize("stonetop.expedition.route.panelNoMap"),
			showLabel: note.otherName
				? format("stonetop.expedition.route.panelShow", { map: note.otherName })
				: "",
		};
	}

	/**
	 * Put the route onto the scene on screen, or take it off again.
	 *
	 * IT DRAWS FOR THE SCENE THE READER IS ON, not for the map tab the panel happens to be showing.
	 * Those come apart constantly and harmlessly: the panel follows a destination out to the
	 * World's End while the table is still looking at the Vicinity, and most journeys are drawable
	 * on either map. Refusing because the two disagreed would be refusing something that works.
	 *
	 * AND WHERE THE SCENE THEY ARE ON CANNOT TAKE IT, it goes to the one that can rather than
	 * refusing: see `_drawOnItsOwnMap`. What is left of the refusals is the handful no amount of
	 * walking to another map would fix, and each of those still says which map WOULD take it,
	 * because that is the only part of a "no" the reader can act on. The check itself is in
	 * utils/scene-route.js, where it can be tested without a canvas.
	 */
	async _putRouteOnScene() {
		const scene = globalThis.canvas?.scene ?? null;
		const pick = this._journeyPick();

		// Already showing exactly this journey, so the button is the way back off.
		//
		// OR SHOWING A LINE THIS TRIP IS NO LONGER ABOUT, which is the same press and the same
		// answer: the flag outlives the trip that wrote it, so a GM who has since started another
		// expedition is looking at a line nothing in the panel can otherwise reach. Taking it off
		// is never destructive — the trip keeps its own journey, and drawing it again is one press.
		if (sceneShowsJourney(scene, pick) || (!this._journeyRoute()?.legs?.length && sceneJourney(scene))) {
			await clearRouteOnScene(scene);
			ui.notifications?.info(format("stonetop.expedition.route.cleared", { scene: scene.name }));
			return;
		}

		const route = this._journeyRoute();
		const check = sceneRouteCheck(scene, route);
		if (!check.ok) {
			// The wrong map under them is not a refusal any more, it is a scene switch.
			if (await this._drawOnItsOwnMap(check, route, pick)) return;
			const hasScene = !!posterSceneFor(check.wanted, game.scenes ?? []);
			ui.notifications?.warn(sceneRouteRefusal(check, { hasScene }));
			return;
		}

		// THE PAIR OF PLACES, and nothing else: the flag used to carry the expedition's id and
		// title too, which nothing ever read and which went stale the moment a trip was renamed.
		// A hand-drawn way that ends on a mark of the GM's own has no place name to report, so the
		// message names the map alone rather than inventing one.
		const where = await showRouteOnScene(scene, pick);
		ui.notifications?.info(where
			? format("stonetop.expedition.route.placed", { place: where, map: check.tierName })
			: format("stonetop.expedition.route.placedDrawn", { map: check.tierName }));
		// Nothing to redraw here: both writes above are Scene updates, and `_wireCanvasWatch` is
		// already listening for exactly those. Redrawing from this side as well would render the
		// panel twice for one press, and would still leave the case that matters uncovered — a
		// SECOND GM drawing the route from their own walkthrough, which this client only ever
		// hears about as the very same hook.
	}

	/**
	 * The refusal that is really "you are standing on the wrong map": go to the right one and draw
	 * the route there.
	 *
	 * WHY THE BUTTON MOVES THE TABLE RATHER THAN SENDING THE GM OFF TO DO IT. Three of the five
	 * refusals amount to the same fact — this journey belongs to the OTHER poster map — and the
	 * GM's answer to all three was always the same two gestures: open that scene, press the button
	 * again. The route already names the one map that can draw it (`tierDrawing`, the same answer
	 * the refusal was built from), and the world either has a scene for that map or it does not.
	 * Where it does, there is nothing left for the reader to decide.
	 *
	 * ONLY THE REFUSALS THAT ARE ABOUT THE SCENE UNDER THE READER. A picture trimmed to the wrong
	 * shape or a scene with no dimensions is a fault in the map they are already on and walking
	 * somewhere else neither fixes nor explains it, so those still get their words. So does a
	 * journey with nowhere to go.
	 *
	 * AND IT VERIFIES BEFORE IT MOVES. The other map is asked the whole question first, on its own
	 * document rather than on the canvas, so a world whose copy of that scene is itself unusable
	 * yanks nobody's canvas around on the way to the same "no" — the original refusal, naming the
	 * map that would have taken it, is still the honest answer.
	 *
	 * @returns {Promise<boolean>} whether the route went down somewhere else.
	 */
	async _drawOnItsOwnMap(check, route, pick) {
		if (!SCENE_SWITCH_REFUSALS.has(check.reason)) return false;
		// `no-scene` is the one branch that refuses before it has worked out which map is wanted
		// (there is no scene to name one against), so it is asked of the route directly.
		const wanted = check.wanted ?? tierDrawing(route);
		if (!wanted) return false;

		const target = posterSceneFor(wanted, game.scenes ?? []);
		if (!target || target.id === globalThis.canvas?.scene?.id) return false;
		const there = sceneRouteCheck(target, route);
		if (!there.ok) return false;

		// THE CANVAS FIRST, then the flag: the line appears on a map the table is already looking
		// at rather than landing on one that swings into view a moment later carrying it. Both
		// orders end in the same place — the overlay paints from the flag on every client, and
		// redraws on `canvasReady` as much as on the update — so this is only about what the room
		// sees. `view` is optional so a world running with the canvas switched off still writes.
		await target.view?.();
		const where = await showRouteOnScene(target, pick);
		// SAYING THE CANVAS MOVED, and not only where the line went. A scene switch is the loudest
		// thing this button can do and the one the GM did not ask for in so many words, so the
		// notification names the map it brought up rather than reading as though they had been on
		// it all along.
		ui.notifications?.info(where
			? format("stonetop.expedition.route.movedPlaced", { place: where, map: there.tierName })
			: format("stonetop.expedition.route.movedPlacedDrawn", { map: there.tierName }));
		return true;
	}

	// ── Sites on the map ────────────────────────────────────────────────────────
	// A GM's own written-up sites (Book I, "Sites"), marked on the books' own regional maps.
	//
	// The travel table charts eighteen places and the maps letter about as many, and none of them
	// is the barrow the GM invented last week. The Sites tab writes those up beautifully and then
	// leaves them in a list, so "where is it, roughly?" is a question the prep could not answer and
	// the map could not be asked. This is the pair of gestures that joins them: choose a site (or
	// write one), then click where it stands.
	//
	// THE PANEL OWNS THE WRITES, both surfaces offer the gesture. Same division as `pick` and
	// `toScene`: the popout supplies the picture to click on, because a 300 dpi map the reader can
	// wheel into is the good surface to aim on, and everything else happens here.

	/**
	 * Place a site from the walkthrough's own inline map.
	 *
	 * The map box IS the measure: it carries the picture's aspect ratio, the image fills it exactly,
	 * and every pin already positions itself in percentages of it. So the same percentages a click
	 * on it yields are the ones `spotPercent` would have produced for a place standing there.
	 *
	 * THE BOX IS FOUND WHEN THE AIM IS TAKEN, not when the button is pressed, and the tier is
	 * re-checked at the same moment. A chooser stands between the two, and a nine-step walkthrough
	 * can stand there for minutes: the panel behind it re-renders whenever another GM picks a
	 * destination or the canvas moves under the scene button, and it can be on a different map by
	 * the time it comes back. Aiming at the element from before would arm a picture that has left
	 * the document, and writing the tier from before would put the pin on the wrong map.
	 */
	async _placeSiteFromPanel(root) {
		const map = this._panelMap;
		if (!map || !root?.querySelector?.(".stonetop-journey-map")) return;
		return this._placeSite({
			tier: map.tier,
			frame: map.frame,
			pickPoint: () => {
				const now = this._panelMap;
				const box = this.element?.[0]?.querySelector?.(".stonetop-journey-map");
				if (!box || now?.tier !== map.tier) return Promise.resolve(null);
				// The wait is also tied to THIS render: the element goes with the next one, so the
				// caller must not be left awaiting a promise that can no longer settle, nor the
				// Escape listener left watching for a picture nobody can see. The popout does the
				// same through its own `close`; see ImageZoomWindow#pickPoint.
				return pickPointOnImage({ listenOn: box, signal: this._armPanelPick() });
			},
		});
	}

	/**
	 * Arm a fresh placement on the panel, cancelling any that was still waiting.
	 *
	 * Two of them at once would be two gestures over one map, both swallowing the same click and
	 * only one of them being awaited. Dropped on every render and on close, from `_disarmPanelPick`.
	 *
	 * The drawing watch needs no such handling: it stands ITSELF down while a placement is armed,
	 * off the class this gesture puts on the picture (see utils/pick-point-on-image.js). So a GM
	 * who presses "put a site on the map" mid-plan gets that one click for the site and their map
	 * back afterwards, rather than one click meaning two things.
	 */
	_armPanelPick() {
		this._disarmPanelPick();
		this._panelPicking = new AbortController();
		return this._panelPicking.signal;
	}

	/** Let go of a placement waiting on markup that is about to leave the screen. */
	_disarmPanelPick() {
		this._panelPicking?.abort();
		this._panelPicking = null;
	}

	/**
	 * Put a site on the map, then redraw whatever was showing pins.
	 *
	 * The gesture itself is `placeSiteOnMap`, in the sites module: a site's spot is a flag on the
	 * page and has nothing to do with a trip, so the walkthrough is a CALLER of it rather than its
	 * home. What is this dialog's own business is the second line — which of the surfaces it is
	 * coordinating have to be re-read.
	 *
	 * @param {object} surface  see `placeSiteOnMap`
	 * @param {object|null} from  the map window that asked, which re-reads itself
	 */
	async _placeSite(surface, from = null) {
		if (await placeSiteOnMap(surface)) await this._sitesChanged(from);
	}

	/** Lift a pin back off the map, then redraw. See `liftSiteOffMap`. */
	async _takeSiteOffMap(uuid, from = null) {
		if (await liftSiteOffMap(uuid)) await this._sitesChanged(from);
	}

	/**
	 * Redraw both surfaces after a pin moved.
	 *
	 * The same two steps a destination pick takes, and for the same reason: the pins live in the
	 * map layer, which both the panel and every open popout render from their own build. `except`
	 * is the window that asked, which re-reads itself the moment its call returns.
	 */
	async _sitesChanged(except = null) {
		if (this.rendered && this._stepNav().step?.journey) this.render(false);
		await this._refreshMapWindows(except)
			.catch(err => warn("couldn't refresh the travel map window", err));
	}

	// ── The trip, drawn on the picture ──────────────────────────────────────────
	// The table's shortest path is the right answer to "how do you get to Marshedge" and the wrong
	// one to "how are they going". A party avoids the Roads, swings by a barrow, cuts north across
	// the Flats — and Chart a Course asks the players exactly that, then leaves the map showing the
	// way the book would have gone. This is where that answer goes onto the picture.
	//
	// NO MODE TO TURN ON, AND NOW NO ROW OF CONTROLS EITHER. There was a "draw the way yourself"
	// checkbox here once, and above the map a row that carried "Setting out from Stonetop" (a
	// button that armed the next click), "bound for Marshedge", and an × to un-pick it. All of it
	// is gone. What is left is the picture and two gestures on it, and the marks themselves are the
	// state (utils/custom-route.js `normalizeCustom`, utils/journey-start.js): a way is being drawn
	// exactly while there are marks on the map, and the party sets out from somewhere exactly while
	// the trip says so.
	//
	// THE GESTURES, which are the whole vocabulary of this screen:
	//   click        with no start, say where the party sets out from
	//                with a start and no way drawn, say where they are bound
	//                with a way drawn, move its far end to here
	//   shift-click  add a leg — and, on a map with no way on it yet, START one
	//   right-click  take the trip back one step: the last mark, else the destination, else the
	//                start itself (see `_undoJourneyMark`, which is the whole ladder)
	// A click on a lettered place takes that place, name and all, so a way can wander off the road
	// and still come back through Marshedge by name. Everything else is a bare mark.
	//
	// WHICH MEANS THE PICTURE IS REVERSIBLE, and that is what let the row above it go: every state
	// this screen can be put into by clicking can be taken back off by right-clicking, in the order
	// it went on, with no control anywhere that is the only way to undo something.
	//
	// THE PANEL OWNS THE WRITES, both surfaces offer the gestures — the same division as `pick`,
	// `toScene` and `placeSite`, and for the same reason: the trip lives here.

	/**
	 * What the line under the map says, and whether this picture takes marks at all.
	 *
	 * `canDraw` gates the CONTROLS and not the display. Drawing writes the trip into a world
	 * setting, which only a GM may do, so a player gets the same readout, the same line on the map
	 * and no way to change it — rather than an invitation that does nothing when accepted.
	 *
	 * `canDrawHere` is the narrower question the two surfaces arm their pictures on, and it is
	 * asked per TIER because they can be looking at different maps. Once a way exists, only its own
	 * map can take a mark — its marks are fractions of that one picture. Before there is a way, any
	 * map that draws the ORIGIN can start one; a map that does not would begin the way at a stop
	 * with nowhere to stand, and `routePath` refuses a line like that outright rather than drawing
	 * a shortened one.
	 *
	 * `canSetStart` is the OTHER thing a click on this picture can be, and the two are exclusive by
	 * construction: a map can start a way only once there is a start to draw it from, so nothing
	 * can be true of both at once. Both surfaces arm off this pair, which is what keeps the
	 * crosshair, the sentence under the map and what the click actually does from ever disagreeing.
	 *
	 * `crosshair` and `canUndo` are here for that same reason and not derived again by each caller.
	 * They were, in three places across two files, and the right-click ladder is documented to
	 * grow: a fourth rung meant finding three boolean expressions, and a miss reads as a
	 * right-click that swallows the browser menu and does nothing.
	 */
	_drawState(custom, tier, start, destination = null) {
		const on = !!custom.on;
		const here = on && custom.tier === tier;
		const mapName = travelMap(custom.tier)?.name ?? "";
		const canDraw = game.user?.isGM ?? false;
		// NOBODY HAS SAID WHERE THEY ARE, which is now a state a GM can reach and get back out of:
		// right-clicking peels the marks off one at a time and then takes the start with them, and
		// the next click puts it back down wherever they mean. It comes FIRST of the three
		// sentences below because it is the only one whose gesture is not about the way at all.
		const unset = !hasStart(start);
		// Could a way START on this picture? Asked of the start alone: where they are bound is
		// wherever the way ends up, so the far end has nothing to say about it. A start the GM
		// placed by hand answers for its own map and no other, which falls out of `startEnd`, and
		// one that is nowhere answers for none — there is nothing yet to draw a first leg from.
		const startable = drawnOn(tier, startEnd(start));
		return {
			on,
			count: custom.points.length,
			canDraw,
			// WHETHER THE NEXT CLICK PLANTS THE START rather than laying a leg. Its own flag and not
			// folded into `canDrawHere`, because the two arm the picture for different gestures: a
			// plain click means "they set out from here" under this one and "move the far end of
			// the way" under that one, and a single flag would leave both surfaces guessing which.
			canSetStart: canDraw && unset && !!travelMap(tier),
			canDrawHere: canDraw && (on ? here : startable),
			// THE CROSSHAIR SAYS THE NEXT CLICK LANDS SOMETHING, and it is on for exactly the two
			// states where that is true: a way already drawn, whose far end a click moves, and a
			// trip with no start, whose start a click plants. In between — a start, no marks — a
			// plain click on open map still does nothing, so the picture goes on looking exactly as
			// it always did and the line beneath it is what says a shift-click would change that.
			crosshair: canDraw && (on || (unset && !!travelMap(tier))),
			// IS THERE ANYTHING LEFT TO RIGHT-CLICK OFF? The whole ladder in one flag: the last
			// mark, else the destination, else the start. It swallows the browser's own menu while
			// it is armed, so it stays OFF for a trip already peeled back to nothing rather than
			// being armed to do nothing. Read off the TRIP rather than off this map — the marks and
			// the picks belong to the journey, not to the picture showing here — so the popout
			// offers the same undo on the same trip. See `_undoJourneyMark`.
			canUndo: canDraw && (on || !!destination || hasStart(start)),
			// Which sentence depends on what this reader can do with THIS picture. Teaching a
			// gesture that quietly does nothing is worse than teaching none.
			hint: this._drawHint({ unset, on, here, startable, tier, start, mapName }),
			clearLabel: localize("stonetop.expedition.draw.clear"),
			clearTip: localize("stonetop.expedition.draw.clearTip"),
			// What a PLAYER gets instead of the gestures, which are no use to a reader who cannot
			// make them: the fact that the line on this map is somebody's own and the times beside
			// it were measured rather than printed.
			drawnNote: localize("stonetop.expedition.draw.drawnNote"),
		};
	}

	/**
	 * The line under the map: the one gesture this reader can make on THIS picture, in words.
	 *
	 * Four states, four lines. Written as guard clauses rather than nested in the object literal
	 * above, because the ladder is read in the order the states rule each other out — and there
	 * will be a fifth, which wants to be a new line here and not another level of nesting.
	 */
	_drawHint({ unset, on, here, startable, tier, start, mapName }) {
		if (unset) return localize("stonetop.expedition.draw.noStart");
		if (on) {
			return here
				? localize("stonetop.expedition.draw.hint")
				: format("stonetop.expedition.draw.hintElsewhere", { map: mapName });
		}
		if (startable) return localize("stonetop.expedition.draw.invite");
		return format("stonetop.expedition.draw.originOffMap", {
			map: travelMap(tier)?.name ?? "",
			place: startName(start),
		});
	}

	/**
	 * A click on a lettered place: where they are bound, or another stop on the drawn way.
	 *
	 * ONE ENTRY POINT FOR BOTH READINGS, asked at click time rather than at bind time, because the
	 * popout binds its hotspot handler once in its constructor and never again — so a decision made
	 * when that handler was created would still be the old one after the first mark went down.
	 *
	 * A PLAIN CLICK WITH NO WAY DRAWN IS A DESTINATION, which is what it has always been and what
	 * every row of the list below the map is for. Held with shift it starts a way through that
	 * place instead; once a way exists both gestures are about the way, because the far end of it
	 * IS where the party is bound.
	 *
	 * A place this map does not letter is refused by name. It is a real thing to try: the
	 * destination list runs to every place the table knows, grouped by the map that draws it, and
	 * clicking a World's End row while drawing on the Vicinity is an easy mistake to make and a
	 * baffling one to have silently ignored.
	 *
	 * `tier` is the map the click was made on, which only the surface knows — the popout keeps
	 * showing whatever map it was opened on long after the panel has followed a destination out to
	 * the other one. It matters only for a way that does not exist yet, since an existing one
	 * brings its own.
	 */
	async _chooseJourneyPlace(slug, ev = null, from = null, tier = null) {
		// WITH NO START, THE CLICK IS THE START. A trip peeled back past its last mark has nowhere
		// to set out from, and until it has one there is no journey for a destination or a leg to
		// be part of — so the first click says where the party is, whether it lands on a pin, an
		// edge arrow or a row of the list below the map. That last one is what lets a world with no
		// imported book art answer at all, since there the list is the whole screen.
		if (!hasStart(this._journeyPick().start)) return this._setJourneyStart(slug, from);
		const custom = this._customPath();
		const append = !!ev?.shiftKey;
		if (!custom.on && !append) return this._setJourneyPlace("destination", slug, from);
		const onTier = custom.on ? custom.tier : (tier ?? this._shownTier);
		if (!markSpot(onTier, slug)) {
			ui.notifications?.warn(format("stonetop.expedition.draw.notOnMap", {
				place: travelPlace(slug)?.name ?? slug,
				map: travelMap(onTier)?.name ?? "",
			}));
			return undefined;
		}
		return this._writeDrawnWay(
			points => withMark(points, { slug }, { append }), from, { begins: true, tier: onTier });
	}

	/**
	 * A click on one of the GM's OWN sites: a stop on the way there, exactly as a lettered place is.
	 *
	 * IT USED TO OPEN THE WRITE-UP (user, 2026-08-24), and that made a GM's own barrow the one mark
	 * on this map that could not be part of the journey drawn across it. On a screen whose whole
	 * purpose is saying how the party gets somewhere — and where the somewhere is very often that
	 * barrow — the pin for it was a link out to a journal. It is a route control now, like every
	 * other mark on the picture. The write-up is still one click away on the steading's Sites tab,
	 * which is where it is written and where its siblings are.
	 *
	 * THE SAME THREE READINGS AS A LETTERED PLACE, which is what "treating it like the other pins"
	 * has to mean or the map has two vocabularies: no start yet and the tap plants it; a plain tap
	 * puts the far end of the way there; SHIFT adds it as another stop. What it cannot be is the
	 * trip's `destination`, which is a slug out of the travel table and names one of eighteen
	 * printed places — so where a lettered pin would set that field, a site begins a hand-drawn way
	 * ending on itself. That is the same sentence by other means: the far end of a drawn way IS
	 * where the party is bound (see `_buildJourney`'s `boundTo`).
	 *
	 * THE SPOT IS THE SITE'S OWN, not the pointer's. A pin is a few pixels of standing stone with a
	 * name tag hanging off it, and a stop laid where the cursor happened to be would sit beside the
	 * place rather than on it — visibly so, once the line is drawn through it.
	 */
	async _chooseJourneySite(uuid, ev = null, from = null) {
		const steading = getStonetopSteadingActor();
		const placed = steading ? placedSiteSpot(steading, uuid) : null;
		// A pin whose site has been deleted from the Sites tab while this map was open. Silent: the
		// pin is about to go with the next redraw anyway, and there is nothing the reader can do.
		if (!placed) return undefined;
		const { page, spot } = placed;
		const mark = { fx: spot.fx, fy: spot.fy };
		const { start } = this._journeyPick();
		// With no start, the tap says where the party is — a site the GM has written up being a very
		// likely answer to that, since it is somewhere they have already decided matters.
		if (!hasStart(start)) return this._setJourneyStart({ tier: spot.tier, ...mark }, from);

		// A SITE'S FRACTION MEANS ONE PICTURE, so both refusals below are about the site's own map
		// and not the one the reader happens to be looking at. Said out loud and by name, exactly as
		// a lettered place the map does not draw is: a GM tapping a Vicinity barrow while a way is
		// laid out on the World's End has made a reasonable mistake, and a silent no teaches nothing.
		const custom = this._customPath();
		if (custom.on && custom.tier !== spot.tier) {
			ui.notifications?.warn(format("stonetop.expedition.draw.notOnMap", {
				place: page.name, map: travelMap(custom.tier)?.name ?? "",
			}));
			return undefined;
		}
		// And with no way yet, one would begin on the site's map — which has to be able to draw the
		// START as well, or the first leg begins at a stop with nowhere to stand and `routePath`
		// refuses the whole line rather than drawing a shortened one.
		if (!custom.on && !drawnOn(spot.tier, startEnd(start))) {
			ui.notifications?.warn(format("stonetop.expedition.draw.originOffMap", {
				map: travelMap(spot.tier)?.name ?? "", place: startName(start),
			}));
			return undefined;
		}
		return this._drawJourneyMark(
			mark, { append: !!ev?.shiftKey, tier: spot.tier, aimed: true }, from);
	}

	/**
	 * A click on open map: a mark of the GM's own, wherever they put it.
	 *
	 * The surface hands over a fraction of the PRINTED CROP rather than a percentage of whatever
	 * picture it happens to be showing, because it is the only one that knows which file that is
	 * and how it is registered. That is what makes a mark laid on the panel's small map land in the
	 * same valley on the poster Scene and on the 300 dpi render — the same conversion a site
	 * placement makes, through the same `percentSpot`.
	 *
	 * A PLAIN CLICK ON A BARE MAP DOES NOTHING, and that silence is the point: with no way drawn
	 * there is no far end for it to move, and the gesture that starts one is the shift-click the
	 * line under the map teaches. Reading a stray click as "begin a journey here" would put a way
	 * on the map every time a GM clicked the picture to bring the window forward.
	 *
	 * UNLESS THERE IS NO START, in which case the click IS one, and the silence would be the wrong
	 * answer: the reader has just right-clicked the start off this very picture and the line under
	 * it says the next click puts it back. That is the one state where a plain click on open map
	 * means something, and it is a state the GM asked for one gesture ago.
	 *
	 * `aimed` SAYS THE CLICK NAMED SOMETHING, and it is what a tap on one of the GM's own site pins
	 * comes through as (`_chooseJourneySite`). The silence above is about STRAY clicks — a press on
	 * open paper to bring the window forward — and a press on a pin is never one of those: the
	 * reader put that mark on the map themselves and has just aimed at it. So it begins a way where
	 * a click on the paper an inch away would do nothing, which is exactly what a tap on one of the
	 * book's own lettered pins already does.
	 */
	async _drawJourneyMark(mark, { append = false, tier = null, aimed = false } = {}, from = null) {
		const custom = this._customPath();
		const unset = !hasStart(this._journeyPick().start);
		if (!mark || (!unset && !custom.on && !append && !aimed)) return undefined;
		// Refused HERE rather than left to `normalizeCustom`, and said out loud, for the same reason
		// a place this map does not letter is refused by name above: the surface shows the whole
		// file, so the margin outside the printed crop is clickable and a click there is a real aim
		// (see `insideMap`). Written through and normalized away, it would take the previous mark
		// with it, which is a leg of the GM's way silently disappearing under their own cursor.
		// WORDED FOR WHAT THE CLICK WAS FOR, since the two refusals are about different things: one
		// says no mark was laid, the other that where they set out from is unchanged. Telling a GM
		// aiming at a starting point that their leg went missing would name a thing they were not
		// doing.
		if (!insideMap(mark)) {
			ui.notifications?.warn(format(
				unset ? "stonetop.expedition.start.offTheMap" : "stonetop.expedition.draw.offTheMap",
				{ map: travelMap(unset ? tier : (custom.tier ?? tier))?.name ?? "" },
			));
			return undefined;
		}
		// A mark belongs to the picture it was laid on, and a start laid by hand is a mark like any
		// other — so the tier has to come with it. The surfaces always send one for a click on open
		// map; without it there is no map for the fraction to be a fraction OF, and the write would
		// normalize straight back to nowhere.
		if (unset) return tier ? this._setJourneyStart({ tier, ...mark }, from) : undefined;
		return this._writeDrawnWay(
			points => withMark(points, mark, { append }), from, { begins: true, tier });
	}

	/**
	 * Right-click: take the trip back one step, whatever the last step was.
	 *
	 * A LADDER, AND IT PEELS THE JOURNEY OFF IN THE ORDER IT WAS PUT ON:
	 *   a mark on a hand-drawn way   the last of them
	 *   else a destination           where they were bound
	 *   else the start               where they were setting out from
	 *   else nothing                 an empty trip has nothing to take, and says nothing
	 *
	 * ONE GESTURE FOR THE LOT, which is what let the row of controls above the map go. There used
	 * to be a "Setting out from Stonetop" button that armed a click, a "bound for Marshedge"
	 * readout with an × beside it, and this right-click for the marks: three ways of taking a trip
	 * apart, in two places, one of them invisible until pressed. What is left is the picture and
	 * the two things you can do to it, and a reader who right-clicks twice can see the whole ladder
	 * happen in front of them rather than having to be told about it.
	 *
	 * AND THE DESTINATION IS ON THE LADDER because nothing else clears it any more. That × was the
	 * only way to un-pick a place, so leaving it off would have made a destination a thing a GM
	 * could set and never take back — and the rung is where it is because it is what a plain click
	 * put there, one gesture before the start.
	 *
	 * PAST THE LAST RUNG THE TRIP HAS NO START AT ALL, which is a real state and not an error:
	 * there is no pin, no line and no solved time, the line under the map says so, and the next
	 * click plants the start wherever the party actually is. See utils/journey-start.js.
	 */
	async _undoJourneyMark(from = null) {
		if (this._customPath().on) {
			return this._writeDrawnWay(points => withMark(points, null, { undo: true }), from);
		}
		const { start, destination } = this._journeyPick();
		if (destination) return this._setJourneyPlace("destination", "", from);
		if (!hasStart(start)) return undefined;
		return this._setJourneyStart(null, from);
	}

	/**
	 * Throw the marks away: the way is over, and the table's own answer is back.
	 *
	 * ITS OWN CONTROL rather than the × beside the destination, which still means what it always
	 * meant. Undoing thirty marks one right-click at a time is not a thing to ask of anybody, and a
	 * single button that did whichever depending on some other state is how a GM loses a route they
	 * had spent a minute laying out.
	 */
	async _clearDrawnWay(from = null) {
		return this._writeDrawnWay(() => [], from);
	}

	/**
	 * Write a new run of marks onto the trip, and carry the change onto Chart a Course.
	 *
	 * ONE WRITE FOR THE LOT, exactly as `_setJourneyPlace` makes one: `_saveField` persists the
	 * whole log per call, and a mark can move the ticked requirements and the route line together.
	 *
	 * `begins` says this gesture may BEGIN a way — the shift-clicks, and every gesture once one
	 * exists. On a trip with no marks yet that is what picks the map and seeds it: the way they were
	 * going is nearly always the way they are still going plus a detour, so the honest first state
	 * is the route the table had already worked out, in marks the GM can now move and take back
	 * (see `seedMarks`). Without it — an undo or a "start over" on a bare map — there is nothing to
	 * do, and doing nothing costs no world-setting write.
	 *
	 * `mutate` returns the SAME array when nothing would change (see `withMark` — an undo on an
	 * empty way does), and that is taken as "nothing happened": a right-click on a bare map should
	 * not cost a world-setting write, a re-render and a sweep of every open map window.
	 */
	async _writeDrawnWay(mutate, from = null, { begins = false, tier = null } = {}) {
		const { log, entry } = ensureCurrent(this._log(), () => this._newExpedition());
		const before = journeyRoute(entry.journey);
		const custom = normalizeCustom(entry.journey?.custom);
		const begun = custom.points.length ? custom : this._beginWay(entry, tier, begins);
		if (!begun) return undefined;
		const points = mutate(begun.points);
		if (points === begun.points && begun === custom) return undefined;

		foundry.utils.setProperty(entry, "journey.custom", { tier: begun.tier, points });
		this._carryToChart(entry, before, journeyRoute(entry.journey));

		await this._persistLog(log);
		this.render(false);
		return this._refreshMapWindows(from).catch(err =>
			warn("couldn't refresh the travel map window", err));
	}

	/**
	 * The map and the first marks of a way that does not exist yet, or null for a gesture that
	 * cannot begin one.
	 *
	 * THE MAP IS THE ONE CLICKED ON, because the mark that is about to be laid is a fraction of
	 * that very picture. A surface only offers the gesture on a map that can draw where the party
	 * sets out from (see `_drawState`'s `canDrawHere`), so `customTierFor` agrees with it — but it
	 * is asked anyway, and it is the answer that is stored: a way beginning at a stop with nowhere
	 * to stand is one `routePath` refuses to draw at all, and getting that wrong here would show as
	 * a map that quietly stopped drawing lines.
	 *
	 * `begins` is the caller's gesture, NOT the journey's start: an undo or a "start over" on a bare
	 * map cannot bring a way into being, and doing nothing there costs no world-setting write.
	 */
	_beginWay(entry, tier, begins) {
		if (!begins) return null;
		const { start, destination } = normalizeJourney(entry.journey);
		const on = customTierFor(start, tier ?? this._activeTier(start, destination));
		// A tab the GM clicked earlier outranks everything in `_activeTier`, which would strand the
		// panel on a map the marks do not belong to the moment those two disagree.
		if (on !== this._journeyTier) this._journeyTier = null;
		return { tier: on, points: seedMarks(journeyRoute({ ...entry.journey, custom: null }), on) };
	}

	/**
	 * Arm the panel's own map for drawing, or leave it alone.
	 *
	 * Bound on every render and dropped by the next one, which is what keeps it aimed at markup
	 * that exists: the walkthrough re-renders on every mark laid, so the map the last watch was
	 * listening on is gone by the time the new one goes up.
	 *
	 * ARMED WHENEVER A CLICK COULD MEAN SOMETHING, which since the checkbox and the controls row
	 * went is most of the time: every map that can draw where the party is setting out from, plus
	 * the one an existing way is drawn on and no other — and, on a trip with no start at all, every
	 * map there is, because that click plants the start. That is `canDrawHere` and `canSetStart`,
	 * asked of the same `_drawState` the line under the map is written from, so the crosshair and
	 * the sentence explaining it cannot come apart. What stops a stray click from starting a journey
	 * is not the arming but the gesture itself: a plain click on a bare map lays nothing, once there
	 * is a start (see `_drawJourneyMark`).
	 */
	_armPanelDrawing(root) {
		this._stopPanelDrawing();
		const map = this._panelMap;
		if (!map) return;
		const { start, destination } = this._journeyPick();
		const state = this._drawState(this._customPath(), map.tier, start, destination);
		if (!state.canDrawHere && !state.canSetStart) return;
		// Absent on every step but the route one, which is also what keeps a `_panelMap` left over
		// from the last visit to that step from arming a picture nobody is looking at.
		const box = root?.querySelector?.(".stonetop-journey-map");
		if (!box) return;
		// The same two selectors the popout arms with, from the same constants: which marks already
		// own a click is a fact about this markup, so neither surface spells it for itself.
		//
		// The crosshair and the right-click come off the SAME `_drawState` as the sentence under
		// the map, and the popout arms on those very fields (see `TravelMapWindow._armDrawing`),
		// so the two surfaces cannot answer differently about what a click here would do.
		this._panelDrawing = watchPointsOnImage({
			listenOn: box,
			onPoint: (at, ev) => this._drawJourneyMark(
				percentSpot(at, map.frame), { append: !!ev.shiftKey, tier: map.tier }),
			onUndo: state.canUndo ? () => this._undoJourneyMark() : null,
			crosshair: state.crosshair,
			ignore: JOURNEY_MARKS,
			undoIgnore: JOURNEY_RIGHT_CLICK_MARKS,
		});
	}

	/** Take the panel's drawing watch off, if there is one. */
	_stopPanelDrawing() {
		this._panelDrawing?.();
		this._panelDrawing = null;
	}


	/**
	 * Keep the scene button honest while the canvas moves under the walkthrough.
	 *
	 * Its label turns on what the canvas is showing, and the canvas changes for reasons that have
	 * nothing to do with this dialog: the GM clicks another scene in the nav bar, or another GM
	 * draws a route from their own walkthrough. Both arrive as hooks, and without them this panel's
	 * button goes on offering to draw a line that is already there, or to clear one that is not.
	 *
	 * Registered on render and dropped on close, the same shape IntroductionsDialog uses for its
	 * combat watch. Re-registering is safe because the previous pair is always released first: a
	 * walkthrough re-renders on every step change, and a hook left behind on each would end the
	 * session with dozens of them redrawing a closed window.
	 */
	_wireCanvasWatch() {
		this._dropCanvasWatch();
		this._canvasHooks = [
			["canvasReady", Hooks.on("canvasReady", () => this._sceneChanged())],
			["updateScene", Hooks.on("updateScene", (scene, changes) => {
				// Only our own flag, and only on the scene in front of this reader: a scene is
				// written to constantly, and a re-render of the whole walkthrough on each of those
				// would cost a browse and an image decode for nothing.
				if (scene?.id !== globalThis.canvas?.scene?.id) return;
				if (!routeFlagTouched(changes)) return;
				this._sceneChanged();
			})],
		];
	}

	/**
	 * Both surfaces re-read the canvas. The panel only when it is on the step that shows the
	 * button.
	 *
	 * AND ONLY WHEN SOMETHING ACTUALLY MOVED. `canvasReady` fires on every scene switch, and the
	 * only thing on either surface that turns on the canvas is the two-state button. Redrawing
	 * regardless cost a full `solveTravel`, three `placesOnMap` passes, a whole Handlebars render
	 * and a re-bind of every listener — and then, per open map window, a second `_buildJourney`
	 * and three more renders — to arrive at the same picture. Walking between two scenes that
	 * both show no route is the common case, and it is the one that changes nothing.
	 */
	_sceneChanged() {
		const before = this._sceneShowing;
		// Recomputes AND re-stamps, so the record can never drift from what is on screen.
		if (this._sceneRouteShowing() === before) return;
		if (this.rendered && this._stepNav().step?.journey) this.render(false);
		// The popout carries the same button whenever it is OPEN, which includes while the
		// walkthrough behind it has moved on to a step that does not draw the route at all.
		this._refreshMapWindows().catch(err => warn("couldn't redraw a travel map window", err));
	}

	/** Let the canvas watch go. Called before re-registering and again on close. */
	_dropCanvasWatch() {
		this._canvasHooks = _offHooks(this._canvasHooks);
	}

	/**
	 * Keep the Outfit step's party-load readout honest while the sheets under it change.
	 *
	 * The block calls itself "live from sheets" and until now it was live only in the sense that
	 * it read them fresh whenever the walkthrough happened to render — so a GM who ticked a
	 * torch onto a PC's sheet with this window open saw nothing move, and had to toggle someone
	 * out of the party and back in to force the render that re-read it. That is the one gesture
	 * a readout beside the sheets exists to save.
	 *
	 * Everything the readout is built from is an Actor or an Item on one: the ◇ pool and the
	 * checked inventory (Items, plus the actor flag holding the reserve), custom followers and
	 * the crew's gear (actor flags), and the owned moves the load gates (Items). Watching those
	 * four hooks covers all of it without a hook per PC — the party changes with the trip, and
	 * a per-actor registration would have to be torn down and rebuilt on every party toggle.
	 *
	 * Registered on render and dropped on close, the same shape as the canvas watch above; the
	 * drop-then-register keeps a re-render from stacking a second set.
	 */
	_wireLoadWatch() {
		this._dropLoadWatch();
		// The readout is GM-only and lives on one step. Off that step there is nothing on screen
		// to keep honest, and a player never builds it at all.
		if (!game.user?.isGM || this._stepNav().step?.key !== "outfit") return;
		const onActor = actor => { if (_carriesLoad(actor)) this._loadChanged(); };
		const onItem  = item  => { if (_carriesLoad(item?.parent)) this._loadChanged(); };
		this._loadHooks = [
			["updateActor", Hooks.on("updateActor", onActor)],
			["createItem",  Hooks.on("createItem",  onItem)],
			["updateItem",  Hooks.on("updateItem",  onItem)],
			["deleteItem",  Hooks.on("deleteItem",  onItem)],
		];
	}

	/** Let the sheet watch go. Called before re-registering and again on close. */
	_dropLoadWatch() {
		this._loadHooks = _offHooks(this._loadHooks);
		clearTimeout(this._loadTimer);
		this._loadTimer = null;
	}

	/** A watched document moved: collapse the burst, then redraw once. */
	_loadChanged() {
		clearTimeout(this._loadTimer);
		this._loadTimer = setTimeout(() => {
			this._loadTimer = null;
			this._refreshLoadReadout().catch(err => warn("couldn't refresh the party load readout", err));
		}, LOAD_REFRESH_MS);
	}

	/**
	 * Rebuild the party-load block in place.
	 *
	 * NOT `this.render(false)`. A render here would rebuild the whole walkthrough — including the
	 * route step's map panel, which browses the art folder and measures an image — and would take
	 * the caret out of whatever field the GM was mid-sentence in, on a trigger they did not make
	 * themselves. Swapping one block's markup costs the readout and nothing else; the chips and
	 * the hover previews inside it are delegated from the dialog root, so the new markup arrives
	 * already wired.
	 */
	async _refreshLoadReadout() {
		if (!this.rendered) return;
		const host = this.element?.[0]?.querySelector(".stonetop-exp-load");
		// Gone from under us — the step moved on, or the window is on its way out. The next
		// render builds it fresh anyway.
		if (!host) return;
		const loadReadout = await this._buildLoadReadout();
		// The build is async, so the window may have closed or moved on while it ran.
		if (!this.rendered || !host.isConnected) return;
		// A preview raised off a face this swap is about to remove would be left hanging: the
		// helper's own watchdog takes it down a frame later, but taking it down here means the
		// numbers never change underneath an open card.
		removeAvatarPreview();
		host.innerHTML = await renderTemplate(LOAD_TEMPLATE, { loadReadout });
	}

	/**
	 * The destination list, grouped by the map each place is drawn on.
	 *
	 * EACH PLACE APPEARS EXACTLY ONCE, which `placesOnMap` per tier does not give you: Stonetop is
	 * drawn on both maps, so calling it once per tier produced eighteen rows for seventeen mapped
	 * places — "Stonetop" under both headings, both wearing the green "setting out" pill, and both
	 * lighting up when it was the destination. A place goes under the CLOSEST map that draws it,
	 * which is also the map `_activeTier` would send a journey to it.
	 *
	 * NO GROUP IS SINGLED OUT. One of them used to be, following the group that held the
	 * destination, and its heading took the gold — a third mark for something the screen already
	 * says twice: the chosen place wears its own pill in the list, and the map tabs mark the one
	 * showing. On the one element whose job is "these places are on that map", it read as a claim
	 * about the fold rather than about the place inside it. The heads are furniture now, all three
	 * alike, and the gold belongs to the answer.
	 */
	_destinationGroups(row) {
		const seen = new Set();
		const groups = TRAVEL_MAPS.map(m => {
			const places = placesOnMap(m.slug).filter(p => !seen.has(p.slug));
			for (const p of places) seen.add(p.slug);
			return { label: m.name, slug: m.slug, places: places.map(row) };
		});
		groups.push({ label: "Beyond the maps", slug: BEYOND_TIER, places: placesBeyond().map(row) });
		return groups;
	}

	/**
	 * Record a pick and carry it forward onto Chart a Course.
	 *
	 * One write for the lot: `_saveField` persists the whole log per call, and this changes up to
	 * four things at once.
	 */
	async _setJourneyPlace(field, slug, from = null) {
		return this._writeJourneyPick(
			entry => foundry.utils.setProperty(entry, `journey.${field}`, travelPlace(slug)?.slug ?? ""),
			from,
		);
	}

	/**
	 * Record where the party sets out from, whichever kind of answer that is.
	 *
	 * ONE WRITER FOR A PLACE AND A POINT, because they are one fact. `where` is a slug when the GM
	 * clicked a pin or a row of the destination list, and a `{ tier, fx, fy }` mark when they
	 * clicked open map; `startEnd` is what reduces either to the single value the trip stores, and
	 * `normalizeStart` reads it straight back. Two writers would be two shapes on disk within a
	 * week, and this is the value everything from the readout to the Scene flag turns on.
	 *
	 * AND `null` IS A THIRD ANSWER, written by the last rung of the right-click ladder: the party
	 * sets out from nowhere until the next click says otherwise. It goes through the very same
	 * `startEnd`, which answers null for a start that is neither a place nor a mark — so the
	 * cleared state round-trips exactly as the two full ones do, and an explicit stored null is
	 * what `storedStart` tells apart from a trip that was simply never asked (that one still leaves
	 * the steading). See utils/journey-start.js.
	 *
	 * The whole of the rest — the map the panel keeps, the Chart a Course carry-forward, the sweep
	 * over open map windows — is the same as any other pick, and is shared below for that reason.
	 */
	async _setJourneyStart(where, from = null) {
		return this._writeJourneyPick(
			entry => foundry.utils.setProperty(entry, "journey.origin", startEnd(where)),
			from,
		);
	}

	/**
	 * Write one change to the trip's journey, and carry it forward onto Chart a Course.
	 *
	 * One write for the lot: `_persistLog` persists the whole log per call, and a pick changes up
	 * to four things at once.
	 */
	async _writeJourneyPick(mutate, from = null) {
		const { log, entry } = ensureCurrent(this._log(), () => this._newExpedition());
		// The route as it stood BEFORE the pick, so the carry-forward below can tell its own last
		// answer from a GM's own words. Read off the entry being mutated, NOT off _journeyPick():
		// ensureCurrent hands back a deep copy, so the draft still holds the previous values until
		// _persistLog swaps it in, and asking the draft would answer for the wrong trip.
		const before = journeyRoute(entry.journey);
		mutate(entry);
		// STAY ON THE MAP THEY ARE READING, as long as it can still show the trip.
		//
		// The map used to follow the pick outright, which reads as the panel taking the map away.
		// Every place the Vicinity letters is also drawn on the World's End, so a GM working on the
		// continental map and tapping the Red Grove, the Maw or the Foothills was answered by being
		// moved in to the Vicinity — a picture they had not asked for, at a scale that hides the
		// rest of the country they were planning across, and the two pins they were comparing now
		// on separate maps. "The closest map that can draw the journey" is the right way to CHOOSE
		// a map for a trip nobody is looking at yet. It is the wrong answer to a reader who is
		// plainly looking at one already.
		//
		// So the pinned tab now follows the picture rather than being thrown away: the map on
		// screen keeps the trip while it letters both ends, and only when it cannot does this fall
		// back to `_activeTier`. That fallback is what still moves a GM out to the World's End when
		// they pick Marshedge off the Vicinity, and what stops the old bug it replaces, a Vicinity
		// tab pinned over a journey setting out from somewhere the Vicinity has no pin for.
		//
		// The SHOWN tier, not the pinned one, because those differ in exactly the case worth
		// getting right: a reader taken to the World's End by an earlier pick never clicked a tab,
		// and has as much claim to the map in front of them as one who did.
		const now = normalizeJourney(entry.journey);
		this._journeyTier = tierDraws(this._shownTier, [startEnd(now.start), now.destination])
			? this._shownTier
			: null;
		this._carryToChart(entry, before, journeyRoute(entry.journey));

		await this._persistLog(log);
		this.render(false);
		// A map window open beside the walkthrough is showing the state that just changed. Awaited
		// and caught: it renders templates and re-reads the log, and an unhandled rejection here is
		// console-only on v13 — the popout would simply keep showing the previous trip's route.
		await this._refreshMapWindows(from).catch(err =>
			warn("couldn't refresh the travel map window", err));
	}

	/**
	 * Carry a change of route onto the Chart a Course list — in BOTH directions.
	 *
	 * Two of the book's requirements are ones the map can answer ("it'll take at least ___ days",
	 * "first travel to ___"), so plotting a route puts them on the trip's list, and un-plotting it
	 * takes them back off. A one-way carry-forward looks harmless until the GM changes their mind:
	 * nothing ever cleared the old tick, so re-picking left `firstTravel` presented with a blank
	 * nobody could fill, and clearing the destination outright left a list describing a journey the
	 * trip no longer had.
	 *
	 * A line is added only when `chartBlankValue` can actually fill its blank — the same predicate
	 * the text goes through — because five of the eighteen destinations from Stonetop are measured
	 * in hours and have no day count at all.
	 *
	 * ONLY ON THE TURN, and only over our own rows. Two guards, and both are about not touching
	 * the GM's list:
	 *
	 *  • Nothing happens unless the route's ANSWER to that line changed (it could not answer it
	 *    and now can, or the reverse). So a row the GM took off does not come back on the next
	 *    pick, and one they added by hand for a stop the graph does not model is never our
	 *    business at all.
	 *  • A row is only ever removed while it still carries `fromRoute` — we put it there. A row
	 *    the GM chose off the menu stays, whatever the map later works out.
	 *
	 * The free-text route field is written on the same terms it always was: only while it still
	 * holds what we last put there (or nothing). The moment a GM types their own account of how
	 * they mean to get there, it is theirs, and no later pick touches it again.
	 */
	_carryToChart(entry, before, after) {
		if (!before && !after) return;
		const list = chartPicked(entry.chart);
		let changed = false;
		for (const key of ["days", "firstTravel"]) {
			const could = chartBlankValue(key, before) !== null;
			const can   = chartBlankValue(key, after)  !== null;
			if (could === can) continue;
			const at = list.findIndex(e => e.key === key);
			if (can && at < 0) {
				list.push({
					id: foundry.utils.randomID(), group: chartGroupOf(key),
					key, text: "", answer: "", fromRoute: true,
				});
				changed = true;
			} else if (!can && at >= 0 && list[at].fromRoute) {
				list.splice(at, 1);
				changed = true;
			}
		}
		if (changed) this._setChartPicked(entry, list);

		const written = String(entry.chart?.route ?? "").trim();
		if (written && written !== routeLine(before)) return;
		foundry.utils.setProperty(entry, "chart.route", after ? routeLine(after) : "");
	}

	/**
	 * Everything the "See the whole map" window needs to be a peer of this panel, rather than a
	 * picture of it: how to build the planner for a given map, and how to write a choice.
	 *
	 * Both go through the very methods the panel's own controls use, so a destination set in the
	 * window and one set here are the same act — same trip, same Chart a Course boxes, same
	 * Chronicle line.
	 */
	_mapWindowSource() {
		return {
			build: tier => this._buildJourney(tier),
			// A window navigated to another map is no longer the window for the map it was opened
			// on, and the bookkeeping here is keyed by exactly that.
			moved: (fromTier, toTier, app) => this._movedMapWindow(fromTier, toTier, app),
			// Same act from either surface, and it goes through the panel for the same reason the
			// gestures below do: the trip lives here, and the notification has to name the trip's
			// own destination whichever window the GM pressed the button in.
			toScene: () => this._putRouteOnScene(),
			// Also the same act from either surface, with one thing the window has to supply: the
			// picture. `pickPoint` is the window's own zoomable map, so the reader aims at 300 dpi
			// and the answer still comes back as a fraction of the printed crop.
			placeSite: (surface, from = null) => this._placeSite(surface, from),
			takeSiteOffMap: (uuid, from = null) => this._takeSiteOffMap(uuid, from),
			// Planning the trip on the picture, which is the same act again and the surface a GM is
			// most likely to want it on: a 300 dpi map they can wheel into is where a mark can be
			// put exactly where they mean, rather than within a few miles of it. All three gestures
			// come through here, including the one that plants the start and the ladder that peels
			// the whole trip back — the window has the picture, the panel has the trip.
			// The tier is the window's own, which is the one thing it can tell the planner that the
			// planner cannot work out: it keeps showing the map it was opened on long after the
			// panel has followed a destination out to the other one.
			markPlace: (slug, ev, from = null, tier = null) =>
				this._chooseJourneyPlace(slug, ev, from, tier),
			// A site needs no tier from the window: it carries its own, because the spot the tap
			// lays a stop at is the site's own recorded fraction rather than the pointer's.
			markSite: (uuid, ev, from = null) => this._chooseJourneySite(uuid, ev, from),
			drawMark: (mark, opts, from = null) => this._drawJourneyMark(mark, opts, from),
			undoMark: (from = null) => this._undoJourneyMark(from),
			clearDrawn: (from = null) => this._clearDrawnWay(from),
		};
	}

	/**
	 * Open the map big, with the whole planner on it.
	 *
	 * Keyed by TIER, so the two maps open as two windows and a second click raises the one already
	 * showing that map. Remembered so a pick made in the PANEL can redraw the window's pins in
	 * place — and note the window keeps showing the map it was opened on even once the panel
	 * follows a destination out to the other one.
	 */
	async _openMapWindow(tier) {
		// Guarded against a second click landing while the first is still opening. `openTravelMap`
		// checks `ui.windows` for an already-RENDERED app, but AppV1 sets `_state = RENDERED` only
		// on the last line of `_render` — so for the whole of the build (a browse, a decode, a
		// template render) that check answers "no", and two clicks mint two Applications sharing
		// one DOM id. The second then steals the first's appId and paints into its frame, or the
		// first is orphaned on screen still writing picks that nothing redraws. Holding the PROMISE
		// makes the second click await the first instead.
		if (!this._opening.has(tier)) {
			const opening = openTravelMap({ tier, source: this._mapWindowSource() })
				.then(app => { if (app) this._mapWindows.set(tier, app); return app; })
				// Caught HERE and not left to the caller: the zoom button is bound as a plain
				// `() => zoom(key)` and drops the promise, so a throw anywhere in the open (a
				// template that will not compile, a decode past `resolveTravelMap`'s own catch)
				// surfaced only as an unhandled rejection in the console. What the GM saw was a
				// button that did nothing. The two sibling sweeps both warn; so does this.
				.catch(err => { warn("couldn't open the travel map window", err); return null; })
				.finally(() => this._opening.delete(tier));
			this._opening.set(tier, opening);
		}
		return this._opening.get(tier);
	}

	/**
	 * Re-key a window that has navigated to another map, and settle the tie if one was already there.
	 *
	 * `_mapWindows` is keyed by tier because the panel asks for a map by tier, and the window's own
	 * tabs can move it out from under that key. Without this, a window opened on the Vicinity and
	 * navigated to the World's End stayed filed under "vicinity" — so the panel's Vicinity zoom
	 * raised a window showing the other map, and its World's End zoom opened a second one.
	 */
	_movedMapWindow(fromTier, toTier, app) {
		if (this._mapWindows.get(fromTier) === app) this._mapWindows.delete(fromTier);
		const other = this._mapWindows.get(toTier);
		this._mapWindows.set(toTier, app);
		// Two windows cannot both BE the one showing a map: they would share the DOM id that
		// `openOrFocus` matches on, and the loser is unreachable from the panel from then on. The
		// window the GM just navigated wins, because it is the one they are working in.
		if (other && other !== app) {
			Promise.resolve(other.close?.())
				.catch(err => warn("couldn't close a travel map window", err));
		}
	}

	/** Every open map window, per tier. */
	get _mapWindows() {
		return (this.__mapWindows ??= new Map());
	}

	/** Map windows currently being opened, per tier. See `_openMapWindow`. */
	get _opening() {
		return (this.__opening ??= new Map());
	}

	/**
	 * Drop the windows for a trip that is no longer the one being edited.
	 *
	 * A map window is a view of ONE trip, and it has no way to know the trip changed underneath it:
	 * it would go on showing the old route line and the old `is-chosen` pin, and a click on one of
	 * those stale pins writes a destination — plus the Chart a Course boxes that follow it — onto
	 * whichever trip is current NOW. Closing them is the honest answer to "switch", "new" and
	 * "delete" alike; the GM reopens the map for the trip they are actually looking at.
	 *
	 * The tier tab goes with them for the same reason: `_journeyTier` outranks everything in
	 * `_activeTier`, so a tab clicked on one trip left the next one stranded on a map that cannot
	 * draw its journey.
	 */
	async _closeMapWindows() {
		this._journeyTier = null;
		// The opens still in flight are AWAITED before taking stock, never merely forgotten.
		// Forgetting one does not cancel it: `openTravelMap` is a browse, a decode and a template
		// render away from painting its window, and the promise went on to resolve after the
		// walkthrough was gone — rendering a map window nothing would ever close, and re-filling
		// the very map that had just been cleared. That orphan holds a `source` bound to a closed
		// dialog whose `_log()` is a draft memoized for its own lifetime, so one click on one of
		// its pins wrote that stale whole-log snapshot back over `expeditionAnswers`. Waiting is
		// what makes "a map window never outlives the walkthrough that opened it" true.
		//
		// Safe to await: these promises already carry their own `catch` in `_openMapWindow`, and
		// the `.then` that files the window in `_mapWindows` is chained ahead of them, so by the
		// time this resolves anything that opened is in the map below.
		const pending = [...this._opening.values()];
		this._opening.clear();
		await Promise.all(pending);

		const open = [...this._mapWindows.values()];
		this._mapWindows.clear();
		await Promise.all(open.map(app => app?.close?.()))
			.catch(err => warn("couldn't close a travel map window", err));
	}

	/**
	 * Re-read any open map window after a pick made in the PANEL.
	 *
	 * The window's own `sync` swaps its pins and its chrome in place rather than re-rendering, so
	 * the reader keeps the corner they had zoomed into. A window they have since closed is dropped
	 * rather than redrawn.
	 *
	 * `except` is the window that MADE the pick, which re-reads the planner itself the moment its
	 * `pick` returns. Every build is a graph solve, an art browse and a template render, so leaving
	 * it in meant one click on one pin solved the same journey three times over.
	 */
	async _refreshMapWindows(except = null) {
		const live = [];
		for (const [tier, app] of [...this._mapWindows]) {
			if (!app?.rendered) this._mapWindows.delete(tier);
			else if (app !== except) live.push(app);
		}
		// Together, not in turn: each window re-reads the planner on its own and none of them reads
		// another's markup, so the second tier has nothing to wait for. Same as `_closeMapWindows`.
		await Promise.all(live.map(app => app.sync()));
	}

	/**
	 * A map window never outlives the walkthrough that opened it.
	 *
	 * Left open, it keeps a `source` bound to THIS instance, and this instance's `_log()` is a
	 * draft memoized for its own lifetime with no `onChange` to invalidate it. So a pin clicked in
	 * an orphaned window ran the closed dialog's `_setJourneyPlace`, which wrote that dialog's
	 * snapshot of the whole log back over `expeditionAnswers` — silently discarding every note
	 * typed into the walkthrough since it was reopened. Reopening did not reconnect it either:
	 * `openOrFocus` returns the window it finds without running the factory, so the fresh source
	 * was built and thrown away while the map looked connected and its pins visibly updated.
	 *
	 * Closing the children with the parent removes the whole class of problem rather than patching
	 * the one path through it.
	 */
	async close(options = {}) {
		this._dropCanvasWatch();
		this._dropLoadWatch();
		// A face hovered as the window goes is portaled to <body>, so it outlives its row unless
		// it is taken down here.
		removeAvatarPreview();
		this._disarmPanelPick();
		this._stopPanelDrawing();
		await this._closeMapWindows();
		return super.close(options);
	}

	/** Switch which map the GM is looking at. Per-client view state, so it stays off the log. */
	_showMapTier(slug) {
		if (!TRAVEL_MAPS.some(m => m.slug === slug)) return;
		this._journeyTier = slug;
		this.render(false);
	}

	// ── Party-load readout (Outfit step) ─────────────────────────────────────────
	// One row per party member: PCs (their derived load band, plus any load-gated move
	// the current load switches off) and each PC's in-party custom followers (band from
	// their ✓ gear marks). The per-trip roster — who's been toggled out — lives on the
	// current expedition entry, so switching trips shows that trip's party.
	//
	// THE DEAD ARE NOT OFFERED. A character who stepped through the Last Door packs nothing
	// and carries nothing, so they are dropped from the chips as well as the rows rather than
	// shown as someone the GM could still tick onto the trip. Whoever CAME BACK is a different
	// answer: a Revenant, Ghost or Thrall walks out with the party and their load matters as
	// much as anyone's, so they stay — wearing the name of the insert, because what is setting
	// out is worth saying plainly on a list of who is setting out.
	// The party watch redraws this block on `updateActor`, so a death mid-window drops them
	// without the GM touching anything.
	async _buildLoadReadout() {
		const out = this._currentExpedition()?.partyOut ?? {};
		// The kind is read once per PC here and handed down: `_pcRow` would otherwise re-read
		// the same two flags off the same actor a moment later.
		const pcs = getPlayerCharacters()
			.map(actor => ({ actor, undeadKind: actorPastDeathKind(actor) }))
			.filter(({ undeadKind }) => undeadKind !== "dead");
		if (!pcs.length) return { chips: [], hasRows: false, rows: [], summary: null };

		const chips = pcs.map(({ actor, undeadKind }) =>
			({ id: actor.id, name: actor.name, on: !out[actor.id], undeadKind }));

		// Only on-trip PCs need a snapshot, and each is a full character build — run them
		// concurrently rather than awaiting one heavy build per PC in series (this re-runs
		// on every Outfit render, including each party-toggle click).
		const onTrip = pcs.filter(({ actor }) => !out[actor.id]);
		const snaps  = await Promise.all(onTrip.map(({ actor }) =>
			Promise.resolve(actor.typedActor?.buildSnapshot?.()).catch(() => null)));

		const rows = [];
		onTrip.forEach(({ actor, undeadKind }, i) => {
			const snap   = snaps[i];
			const outfit = snap?.inventory?.outfit ?? {};
			const load   = outfit.load ?? snap?.inventory?.load ?? null;
			const limits = outfit.loadLimits ?? snap?.inventory?.loadLimits ?? LOAD_LEVEL_LIMITS;
			const tier   = load?.selected ?? null;
			const over   = !!load?.loadLevelOverloaded;

			rows.push(this._pcRow(actor, snap, tier, over, Number(load?.totalMarks) || 0, limits, undeadKind));
			for (const fol of this._partyFollowersOf(actor)) rows.push(fol);
		});

		// Summary counts every laden member (PCs + followers): heavy and overloaded are
		// the bands the fiction cares about, and both read as "can't move quiet."
		const overloaded = rows.filter(r => r.levelClass === "lvl-over").length;
		const heavy      = rows.filter(r => r.levelClass === "lvl-heavy").length;
		const cantSneak  = overloaded + heavy;

		return {
			chips,
			hasRows: rows.length > 0,
			rows,
			summary: {
				overloaded, heavy, cantSneak,
				anyOver:  overloaded > 0,
				anyHeavy: heavy > 0,
				anySneak: cantSneak > 0,
			},
		};
	}

	// A PC row: avatar, name/playbook, the diamond track, band pill, ◇ count, any
	// load-gated moves, and (when overloaded, or carrying a load bonus) a note.
	// `undeadKind` is the insert they came back wearing, if any: it tints the row's chip and
	// names itself beside them, since a Ghost on the list is worth reading as a Ghost.
	_pcRow(actor, snap, tier, over, marks, limits, undeadKind = null) {
		const band = tier || "light";           // the empty-load default, shared by both branches below
		const key = over ? "over" : band;
		// Whatever raised this PC's caps, by name: Pack Horse for a Ranger, but a custom or
		// world-authored move carrying a loadBonus reads as itself rather than as the horse.
		const loadBonusFrom = snap?.inventory?.outfit?.loadBonusFrom ?? "";
		const wornArmor    = Number(snap?.vitals?.wornArmor) || 0;
		const portrait = portraitOrNone(actor.img, documentPortraitFrame(actor));
		return this._loadRow(key, actor.name, marks, limits, {
			isFollower: false,
			img:        portrait.src || "",
			imgStyle:   portrait.style,
			sub:        actor.system?.playbook?.name || "",
			gated:      this._gatedMovesFor(snap, over ? "heavy" : band, wornArmor),
			loadBonus:  loadBonusFrom
				? { from: loadBonusFrom, caps: `caps ${limits.light}/${limits.normal}/${limits.heavy}` }
				: null,
			note:       over ? "risks exhaustion, accident, injury" : null,
			noteDanger: over,
			undead:     _undeadTag(undeadKind, snap),
		});
	}

	// The PC's OWNED load-gated moves and whether the current state keeps each active.
	// The gate data (maxLoad, requiresUnarmored) rides on each move via its data model, so
	// we read it straight off the snapshot's owned moves — no per-move table here. Load is
	// the common gate; Uncanny Reflexes also needs the PC unarmored (worn-armor base 0),
	// checked via the snapshot's wornArmor.
	_gatedMovesFor(snap, tier, wornArmor = 0) {
		const cur = _LOAD_RANK[tier] ?? 0;
		return (snap?.moves ?? [])
			.flatMap(cat => cat.moves ?? [])
			.filter(m => m.owned && m.maxLoad)
			.map(m => {
				const loadOk = cur <= (_LOAD_RANK[m.maxLoad] ?? 0);
				const active = m.requiresUnarmored ? (loadOk && wornArmor === 0) : loadOk;
				return { name: m.name, active, req: _gatedReqLabel(m.maxLoad, m.requiresUnarmored) };
			});
	}

	// A PC's followers, each as a load row: the Marshal's crew (whose gear pips carry
	// weights) plus any custom followers marked "in the party" (the Followers-tab
	// toggle). A follower's load is its ✓ gear marks (Book I p.472), bucketed by the
	// standard caps: nothing raises a follower's.
	_partyFollowersOf(actor) {
		const rows = [];
		const crew = this._crewRow(actor);
		if (crew) rows.push(crew);
		const map = actor.getFlag?.(SYSTEM_ID, "customFollowers") ?? {};
		for (const f of Object.values(map)
			.filter(f => f?.party)
			.sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0))) {
			rows.push(this._followerRow(f));
		}
		return rows;
	}

	// The Marshal's crew, if this PC has one. Its ◇ load is the sum of filled gear pips
	// (stored at flags.stonetop-pwd.crew.gear as { slug: filledCount }); Supplies are a
	// separate track and don't count. Returns null for a PC with no crew.
	_crewRow(actor) {
		const crew = actor.getFlag?.(SYSTEM_ID, "crew");
		const exists = crewExists(crew);
		if (!exists) return null;
		const gear  = crew.gear ?? {};
		const marks = Object.values(gear).reduce((sum, v) => sum + (typeof v === "number" ? v : (v ? 1 : 0)), 0);
		// The crew keeps its face on its detail flag (flags.<system>.crew.details), where the
		// follower card's portrait picker writes it.
		return this._makeFollowerRow(crew.name || "The Crew", marks, "crew", crew.details);
	}

	// A custom follower's load row (gear is a ✓ checklist).
	_followerRow(f) {
		const marks  = (Array.isArray(f?.gear) ? f.gear : []).filter(g => g?.checked).length;
		const folTag = f?.isGroup ? `×${Math.max(2, Number(f?.size) || 2)} group` : "follower";
		// A custom follower stores its whole card, portrait included, in the one object.
		return this._makeFollowerRow(f?.name, marks, folTag, f);
	}

	// Shared builder for a follower load row from a name + ◇ mark count. `art` is whichever
	// stored object carries this follower's `img` / `portraitFrame` pair (the crew's details
	// flag, a custom follower's own object); art-less followers keep the initial disc.
	_makeFollowerRow(name, marks, folTag, art = null) {
		const tier = deriveLoadLevel(marks, LOAD_LEVEL_LIMITS);
		const key  = tier === "overloaded" ? "over" : (tier || "light");
		const portrait = portraitOrNone(art?.img, art?.portraitFrame);
		return this._loadRow(key, name, marks, LOAD_LEVEL_LIMITS, {
			isFollower: true,
			folTag,
			img:      portrait.src || "",
			imgStyle: portrait.style,
		});
	}

	// Assemble one load row from a resolved band `key` (light/normal/heavy/over) and a ◇
	// mark count, plus the caller's per-row `extras`. Owns the pill / diamond-band / CSS
	// derivation so PC and follower rows share one shape and can't drift; `extras` supplies
	// (and overrides) the per-kind fields (playbook sub, gated moves, notes, folTag, …).
	_loadRow(key, name, marks, limits, extras = {}) {
		const pill = _LOAD_PILL[key];
		const { bands, overflow } = _pipBands(marks, limits);
		const row = {
			isFollower: false,
			// The face, when there is one: the picture and the frame that crops it, resolved
			// through the same helper every other small avatar in the system uses so a portrait
			// framed by hand shows the same square here. `initial` stays on every row as the
			// fallback disc for anyone art-less.
			img:        "",
			imgStyle:   "",
			initial:    (name || "?").charAt(0).toUpperCase(),
			name:       name || (extras.isFollower ? "Follower" : "Character"),
			sub:        "",
			folTag:     null,
			levelClass: `lvl-${key}`,
			pillClass:  key,
			levelLabel: pill.label,
			marks, cap: limits.heavy, bands, overflow,
			gated:      [],
			loadBonus:  null,
			note:       null,
			noteDanger: false,
			// { kind, label } for a PC who came back wearing an insert; null for everyone else,
			// followers included — nothing brings a follower back.
			undead:     null,
			...extras,
		};
		// The quiet second line under the name on the enlarged-portrait card: a PC's playbook,
		// a follower's tag. Derived here rather than in the template so both kinds of row answer
		// with whichever one they carry, and neither has to know about the other's field.
		row.previewSub = row.sub || row.folTag || "";
		return row;
	}

	// Toggle a PC in/out of the current trip's party (stored on the trip entry, so it's
	// per-expedition). `include` = the chip was showing "out" and is being turned on.
	async _togglePartyMember(actorId, include) {
		if (!actorId) return;
		const { log, entry } = ensureCurrent(this._log(), () => this._newExpedition());
		const partyOut = entry.partyOut ?? (entry.partyOut = {});
		if (include) delete partyOut[actorId];
		else partyOut[actorId] = true;
		await this._persistLog(log);
		this.render(false);
	}
}
