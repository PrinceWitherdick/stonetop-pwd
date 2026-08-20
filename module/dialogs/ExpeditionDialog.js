import { StepperDialog } from "./StepperDialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { crewExists } from "../utils/crew.js";
import { sign, rollSeasonsCard } from "../utils/roll-engine.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { getSetting, setWorldSetting } from "../settings.js";
import { escHtml } from "../utils/strings.js";
import { warn } from "../utils/logger.js";
import { CHART_GROUPS, HOME_GROUP } from "./expedition-data.js";
import { FATE_TABLES, fateTableList, fateInlinePhrase } from "../data/fate-tables.js";
import { saveChronicleFromButton } from "../utils/chronicle.js";
import {
	normalizeLog,
	currentExpedition,
	ensureCurrent,
	addExpedition,
	selectExpedition,
	deleteExpedition,
} from "../utils/expedition-log-core.js";
import { getPlayerCharacters } from "../utils/playbook-actors.js";
import { deriveLoadLevel, LOAD_LEVEL_LIMITS } from "../utils/load.js";
import { SYSTEM_ID, JOURNAL_PACK } from "../system-id.js";
import { renderTemplate } from "../utils/foundry-compat.js";
import { EXPLORATION_GM_MOVES } from "../gm-toolkit/gm-moves.js";
import {
	TRAVEL_MAPS, TRAVEL_PLACES, BEYOND_TIER,
	travelPlace, travelMap, placesOnMap, placesBeyond, exitsOnMap, spotPercent,
} from "../data/travel-times.js";
import {
	solveTravel, normalizeJourney, journeyRoute, formatTravelTime, atLeastPhrase, routeLine,
	stopsAlongTheWay, fillChartBlank, chartBlankValue,
} from "../utils/travel-route.js";
import { resolveTravelMap, travelMapFile, browseTravelMapArt } from "../book2-art/travel-map-art.js";
import { openTravelMap } from "./TravelMapWindow.js";
import { bindJourneyControls, journeyPick } from "./journey-controls.js";

const ANSWERS_SETTING = "expeditionAnswers";

// The route step's pin layer, rendered into BOTH the walkthrough's own map and the "See the whole
// map" window's overlay. Named here because the dialog renders it directly (not only through a
// `{{> }}` in its template), so the partial-registration sweep in stonetop.js cannot be the only
// place the path is written down.
const JOURNEY_PINS_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-pins.hbs";

/**
 * The seven exploration moves, as the "Exploration moves" step prints them.
 *
 * Rendered from the ONE table in gm-toolkit/gm-moves.js, which the GM Toolkit's Moves tab also
 * prints. Restating them here meant seven names and seven glosses maintained in two files, held
 * together only by a test that scraped this file's source text for `<li><strong>…</strong>`, so
 * reformatting the list at all broke the guard, and a wording fix in one place left the
 * walkthrough and the toolkit teaching the same move in different words on two screens the same
 * GM meets in one session.
 */
const EXPLORATION_MOVE_LIST = EXPLORATION_GM_MOVES
	.map(m => `<li><strong>${escHtml(m.name)}.</strong> ${escHtml(m.gloss)}</li>`)
	.join("\n\t\t\t\t\t");
// This dialog's key in the client-scoped reload-resume record (see walkthrough-resume.js).
const RESUME_KEY = "expedition";

// ── ExpeditionDialog ─────────────────────────────────────────────────────────
// A GM walkthrough of Book I's Expeditions chapter (p.301–343). It follows the
// chapter's own five steps — Preparations, Running the journey, Player moves,
// Going home, What to prep — as a linear stepper, mirroring SpringBurstDialog
// (and reusing its `.stonetop-spring-*` / shared `.stonetop-guide-*` styles).
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
	success: { label: "10+",   line: "Go ahead, but you're expected to <strong>bring it back safely</strong>." },
	partial: { label: "7&ndash;9", line: "Someone objects. You can borrow it, but you'll need to <strong>do some convincing</strong> first (likely a Persuade)." },
	failure: { label: "6-",    line: "Folks ain't having it. <strong>Don't mark XP.</strong> Take it anyway if you must, but <strong>reduce Fortunes by 1</strong>." },
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

// The Chart a Course requirements/challenges (Book I p.302–303) and arriving-home
// questions (p.338) live in expedition-data.js so the Chronicle compiler can resolve
// a ticked key back to its text. See CHART_GROUPS / HOME_GROUP imports above.

// Linear walkthrough. `body` is HTML. `fate` names the Die of Fate table this step
// reaches for (a key in data/fate-tables.js) and adds the button that rolls it. `roll`
// names an inline roll ("requisition"). `tiers` shows the matching outcome list.
// `qa` is a single note, per-PC notes, or a checklist (see _qaContext).
const _STEPS = [
	{
		key:   "intro",
		title: "An expedition begins",
		icon:  "fa-map-location-dot",
		body:  `<p>The characters are leaving town, to face a threat, seize an opportunity, or chase a plan of their own. This guide walks the journey's arc: <strong>Preparations</strong>, <strong>running the journey</strong>, the <strong>player moves</strong> they'll lean on, <strong>going home</strong>, and what to <strong>prep</strong> between sessions.</p>
				<p>Travel is dangerous and hard, and that's the point: it makes home feel precious. <strong>Don't gloss it over.</strong> Give it the screen time it deserves.</p>`,
	},
	{
		key:   "journey",
		title: "The route",
		icon:  "fa-signs-post",
		body:  `<p>Before the players trigger <strong>Chart a Course</strong>, work out the answer. Say where they're setting out from and where they're bound: the maps are the region as the books draw it, and the times are the book's own travel table.</p>
				<p>Composing legs is the book's arithmetic too, not a shortcut. Stonetop to <strong>Lygos</strong> is ten days to Marshedge and thirty more beyond it, which is why Book II calls the round trip &ldquo;an entire season of travel.&rdquo; What you pick here fills in the requirements on the next step.</p>`,
		// A per-step flag, like `fate` and `weather` above, so getData switches on the schema
		// rather than on a key spelled out in two places.
		journey: true,
	},
	{
		key:   "chart",
		title: "Chart a Course",
		icon:  "fa-route",
		body:  `<p>When the players start talking about leaving, point them at <strong>Chart a Course</strong>. Pin down their <strong>destination</strong> and roughly how they mean to get there (&ldquo;we follow the tracks&rdquo; is enough).</p>
				<p>Then tell them as many of the following as make sense, based on the season, terrain, how well they know the area, and the threats that lurk there. Link them with <strong>&ldquo;and&rdquo;</strong>, or offer a merciful <strong>&ldquo;or.&rdquo;</strong> Tick the ones you present: this becomes your narrative to-do list once they set out.</p>`,
		qa:    {
			kind:  "checklist",
			key:   "chart",
			// This checklist's requirements carry literal blanks ("at least ___ days"). A flag on
			// the schema, like `journey` above, rather than `_qaContext` recognising the step by
			// name — rename or split the step and a name written in two places stops matching in
			// silence, with the range check still passing.
			routeBlanks: true,
			intro: { field: "route", prompt: "Destination &amp; route", placeholder: "Where are they headed, and how do they intend to get there?" },
			groups: CHART_GROUPS,
			notes: { field: "notes", prompt: "Other notes (custom requirements, nested legs, what you negotiated)", placeholder: "Anything else you told them…" },
		},
	},
	{
		key:   "outfit",
		title: "Outfit",
		icon:  "fa-sack",
		body:  `<p>Each PC marks gear on their Inventory insert: up to <strong>3 for a light load</strong> (quick, quiet), <strong>4&ndash;6 normal</strong>, or <strong>7&ndash;9 heavy</strong> (noisy, slow, quick to tire). They also mark <strong>4 + Prosperity</strong> small items (these don't count toward load).</p>
				<p>They can leave marks <strong>&ldquo;undefined&rdquo;</strong> and define them later with <em>Have What You Need</em>. Remind them of anything they need to bring (warm clothes, sleds, a guide). <strong>Followers Outfit too.</strong> Ask where their gear came from. Bring it home.</p>`,
		qa:    {
			kind:        "single",
			key:         "outfit",
			prompt:      "Who's carrying what, and what loads?",
			placeholder: "Notable gear, loads, and anything you flagged as required…",
		},
	},
	{
		key:      "requisition",
		title:    "Requisition (if needed)",
		icon:     "fa-horse",
		body:     `<p>If they want the steading's communal assets, the horses, a cart, the plows, the big wagon, they <strong>Requisition</strong>: roll <strong>+Fortunes</strong>. Establish the fiction first: who are they asking, and who has the right to say yes?</p>
				<p>They don't need this for the steading's <em>Surplus</em> (unless taking it would be wasteful or risky), and only roll once for a related set of assets.</p>`,
		roll:     "requisition",
		showTiers: true,
		qa:       {
			kind:        "single",
			key:         "requisition",
			prompt:      "What did they borrow, and from whom?",
			placeholder: "The asset(s), who they convinced, any strings attached…",
		},
	},
	{
		key:   "prep",
		title: "Other preparations",
		icon:  "fa-people-carry-box",
		body:  `<p>Around Outfitting and Requisitioning, the rest of prep happens. Zoom in and out as it suits:</p>
				<ul>
					<li><strong>Trade &amp; Barter</strong> for special items (bendis root, a bronze weapon): this takes time.</li>
					<li><strong>Gather information</strong>: Know Things, Seek Insight, interview NPCs, Call the Spirits. Reward research, but mind the clock.</li>
					<li><strong>Bring NPCs &amp; followers</strong>: the Marshal's crew, a hound, a willing villager. Write joiners up as followers; have them Outfit too.</li>
					<li><strong>Put others to work</strong>: Muster, Pull Together, or set someone a task: roll the slow ones <em>when they return</em>.</li>
				</ul>
				<p>Make a note of any projects so you don't forget them later.</p>`,
		qa:    {
			kind:        "single",
			key:         "prep",
			prompt:      "Standing projects, joiners, and threads to remember",
			placeholder: "Who's coming, what's been set in motion, what to resolve on return…",
		},
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
				<p>On a <strong>perilous</strong> leg, or whenever you&rsquo;re unsure how hard to come down, you can let the Die of Fate set the danger:</p>
				${fateTableList(FATE_TABLES.perilous)}`,
		fate:  "perilous",
		qa:    {
			kind:        "single",
			key:         "running",
			prompt:      "Points of interest &amp; legs of travel",
			placeholder: "Your route: landmarks, planned scenes, rough travel times…",
		},
	},
	{
		key:   "explore",
		title: "Exploration moves",
		icon:  "fa-compass",
		body:  `<p>Add these to your arsenal once the PCs leave town:</p>
				<ul>
					${EXPLORATION_MOVE_LIST}
				</ul>
				<p>And keep using your standard GM moves too: ask provocative questions, use up their resources, separate them, show downsides.</p>`,
	},
	{
		key:   "weather",
		title: "Weather & the Die of Fate",
		icon:  "fa-cloud-sun-rain",
		body:  `<p>Weather colors the whole trip and can be a challenge by itself. You decide when it rains and shines: weave it into your descriptions and your moves (bar the way with a blizzard; separate them in the fog).</p>
				<p>Or let fate decide. Either ask what weather they're <strong>hoping for</strong> and roll the <strong>Die of Fate</strong> (${fateInlinePhrase(FATE_TABLES.weather)}), or roll the <strong>seasonal weather table</strong> (Book I p.325), informed by the latest <em>Seasons Change</em>.</p>`,
		fate:    "weather",
		weather: true,
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
				<p>When they <strong>Make Camp</strong> and you're unsure if the night stays quiet, roll the Die of Fate:</p>
				${fateTableList(FATE_TABLES.camp)}`,
		fate:  "camp",
	},
	{
		key:   "home",
		title: "Going home",
		icon:  "fa-house-chimney",
		body:  `<p>Usually, <strong>gloss the trip home</strong>: they already faced these challenges. Use it to ruminate: ask what they keep thinking about, suggest they <strong>Keep Company</strong>. But if they're hauling something awkward, lost or hurt, racing a clock, or taking a new route, <strong>Chart a Course back</strong> and play it out.</p>
				<p>Then, before they walk back in, think through:</p>`,
		qa:    {
			kind:   "checklist",
			key:    "home",
			groups: HOME_GROUP,
			notes:  { field: "notes", prompt: "Return Triumphant?", placeholder: "If their return is a true triumph, clear a steading debility (or +1 Fortunes). What does it look like?" },
		},
	},
	{
		key:     "prepAfter",
		title:   "What to prep",
		icon:    "fa-feather",
		isFinal: true,
		body:    `<p>If you know an expedition is coming, prep pays off:</p>
				<ul>
					<li><strong>Chart the course</strong> in advance and write the choices down with tick boxes.</li>
					<li><strong>Draw a map</strong> of the route, marking your points of interest.</li>
					<li><strong>Identify points of interest &amp; legs</strong>; note how long each leg takes.</li>
					<li>For each, jot a one-sentence description, <strong>2&ndash;3 impressions</strong> (non-visual senses), questions to ask, and which challenges land there.</li>
					<li>Prepare up to <strong>7 encounters</strong>, dangers, discoveries, events, tied into a larger story.</li>
					<li>Consider Die of Fate tables for weather, camp events, or perilous stretches.</li>
					<li>Build any <strong>sites, dangers, discoveries, NPCs, and followers</strong> they're likely to meet.</li>
				</ul>
				<p>Lean on <strong>Book II</strong> for the regions they'll cross: copy details or just bookmark the page.</p>`,
	},
];

export class ExpeditionDialog extends StepperDialog {
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

	// Same contract as the session-zero walkthroughs, and the same implementation — see the
	// reload-resume block in StepperDialog. The trip itself already persists (world-scoped
	// `expeditionAnswers`); only the reader's place in the eleven steps is per-client, so it
	// rides in the client-scoped resume record and this is the whole opt-in.
	get _resumeKey() { return RESUME_KEY; }

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-expedition",
			title:     "Run an Expedition",
			template:  "systems/stonetop-pwd/templates/dialogs/expedition.hbs",
			// Wider than the other steppers to seat the jump-to-step TOC rail, and wide
			// enough for a load row (avatar · name · nine ◇ · band pill · count) to sit on
			// one line.
			width:     700,
			// Fixed, like the other left-rail guides (Welcome 660×580, Make a Monster
			// 760×620) — NOT "auto". These twelve steps run from two paragraphs (intro) to a
			// twelve-box checklist (Chart a Course) to a per-PC load table (Outfit) to a
			// regional map (The route), and an auto-height window re-measures its content on
			// EVERY render: measured against a 1000px viewport it opened anywhere from 597px to
			// 951px, and from 734px to 951px at a larger UI font — up to 95% of the screen, a
			// different height on each Next / Back / rail click. (Core clamps an auto height
			// only to the viewport, and the shared .stonetop-spring-dialog cap is itself
			// viewport-sized, so neither bounded it.) The step column scrolls instead — see
			// .stonetop-guide-main. A fixed height also means a manual resize sticks; core
			// discards one on an auto-height window.
			//
			// 620 used to be the exact height at which all ELEVEN rail entries were visible at
			// the default UI font. "The route" made it twelve, so this is 620 plus one rail
			// entry's worth (6px padding twice, ~18px of line, a 1px border and the 2px gap) —
			// the rail also scrolls and is in `scrollY` below, so overshooting costs nothing but
			// falling short would quietly hide the last step behind a scroll.
			height:    664,
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
		html.find(".stonetop-exp-fate-btn").on("click", () => {
			game.stonetop?.rollDieOfFate?.(FATE_TABLES[this._stepNav().step.fate]);
		});
		html.find(".stonetop-exp-weather-btn").on("click", () => game.stonetop?.openWeather?.());
		html.find(".stonetop-spring-done").on("click", () => this.close());
		// Expedition-log bar: rename the current trip, switch trips, start a fresh one.
		html.find(".stonetop-exp-title").on("change", ev => this._saveTitle(ev.currentTarget.value));
		html.find(".stonetop-exp-switch").on("change", ev => this._switchExpedition(ev.currentTarget.value));
		html.find(".stonetop-exp-delete").on("click", () => this._deleteCurrentExpedition());
		html.find(".stonetop-exp-new").on("click", () => this._startNewExpedition());
		// Outfit step: toggle a PC in/out of this trip's party (a chip showing "out" is
		// being turned back on).
		html.find(".stonetop-exp-load-chip").on("click", ev => this._togglePartyMember(
			ev.currentTarget.dataset.actorId,
			ev.currentTarget.classList.contains("is-out"),
		));
		// Route step: pick a place off the map or the list, or change which map is showing. The
		// same binder the popout uses, because it is the same partial (dialogs/journey-controls.js).
		const journeyHandlers = {
			pick: (field, slug) => this._setJourneyPlace(field, slug),
			showTier: tier => this._showMapTier(tier),
		};
		bindJourneyControls(html[0], { ...journeyHandlers, zoom: key => this._openMapWindow(key) });
		// DELEGATED, not bound per hotspot: pins, edge arrows and list rows all wear this class and
		// there are around thirty-five of them on a drawn map, re-created on every render.
		html.on("click", ".stonetop-journey-pick", ev => journeyPick(ev.currentTarget.dataset, journeyHandlers));
		html.find(".stonetop-exp-chronicle").on("click", ev => this._saveChronicle(ev.currentTarget));
		// Save on change so fields keep focus while typing.
		html.find(".stonetop-exp-field").on("change", ev => {
			const el = ev.currentTarget;
			this._saveField(el.dataset.answerPath, el.value);
		});
		html.find(".stonetop-exp-checkbox").on("change", ev => {
			const el = ev.currentTarget;
			this._saveField(el.dataset.answerPath, el.checked);
		});
	}

	async getData() {
		const nav  = this._stepNav();
		const step = nav.step;
		const roll = step.roll ? this._rolls[step.key] ?? null : null;
		const { currentId, list } = this._log();
		const data = {
			...nav,
			isGM:       game.user?.isGM ?? false,
			// The expedition-log bar atop the walkthrough: the current trip's name, a
			// switcher (only with more than one), a delete (once any exist), and New.
			expedition: {
				title:       list.find(e => e.id === currentId)?.title ?? "",
				hasAny:      list.length > 0,
				hasMultiple: list.length > 1,
				options:     list.map((e, i) => ({
					id:        e.id,
					label:     e.title?.trim() ? e.title : `Expedition ${i + 1}`,
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
			showFate:    !!step.fate,
			showWeather: !!step.weather,
			qa:        this._qaContext(step.qa),
		};
		// The Outfit step gains a live party-load readout — GM-only, since it reads
		// every PC's inventory. Built only on this step so the others stay cheap.
		if (step.key === "outfit" && game.user?.isGM) {
			data.loadReadout = await this._buildLoadReadout();
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

	// Rename the current trip (refreshes the switcher label).
	async _saveTitle(value) {
		const { log, entry } = ensureCurrent(this._log(), () => this._newExpedition());
		entry.title = value;
		await this._persistLog(log);
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
		await this._persistLog(deleteExpedition(this._log(), current.id));
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
			// Once the route step has plotted a journey, a blank-carrying checklist's blanks have
			// answers — so fill them here, through the same helper the Chronicle uses, or the tick
			// box a GM reads and the journal that records it would say different things.
			const route = qa.routeBlanks ? this._journeyRoute() : null;
			return {
				kind:   "checklist",
				intro:  qa.intro ? field(qa.intro) : null,
				groups: qa.groups.map(g => ({
					label: g.label,
					items: g.items.map(it => ({
						text:    fillChartBlank(it.text, it.key, route),
						path:    `${qa.key}.checks.${it.key}`,
						checked: !!read(`${qa.key}.checks.${it.key}`),
					})),
				})),
				notes:  qa.notes ? field(qa.notes) : null,
			};
		}

		return { kind: "single", key: qa.key, prompt: qa.prompt, placeholder: qa.placeholder, path: qa.key, answer: read(qa.key) ?? "" };
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

	/** The trip's saved pick, defaulted to setting out from home. */
	_journeyPick() {
		return normalizeJourney(this._currentExpedition()?.journey);
	}

	/** The solved route to the chosen destination, or null when nothing is chosen yet. */
	_journeyRoute() {
		return journeyRoute(this._currentExpedition()?.journey);
	}

	/** Is `place` somewhere `tier` can draw — its own spot, or the edge arrow that points at it? */
	_drawnOn(tier, place) {
		if (!place) return false;
		return !!travelPlace(place)?.spots?.[tier] || exitsOnMap(tier).some(e => e.node === place);
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
	 */
	_activeTier(origin, destination) {
		const slugs = TRAVEL_MAPS.map(m => m.slug);
		if (slugs.includes(this._journeyTier)) return this._journeyTier;
		// Nothing to travel to yet, so the origin is the whole of the journey — and it still has
		// to be drawable. Returning the innermost map flat meant setting out from Marshedge, the
		// Steplands or Tor's Fist opened a Vicinity with no "setting out" pin anywhere on it.
		if (!destination) return slugs.find(slug => this._drawnOn(slug, origin)) ?? slugs[0];
		// Innermost first: TRAVEL_MAPS is ordered outermost LAST, and the closer map is the one
		// drawn at the scale the journey actually happens on.
		const both = slugs.find(slug => this._drawnOn(slug, origin) && this._drawnOn(slug, destination));
		if (both) return both;
		// No single map holds both ends, so show the destination's own outermost — and for a place
		// past every edge, the outermost map there is, whose arrow points at it.
		return slugs.filter(slug => this._drawnOn(slug, destination)).at(-1) ?? slugs.at(-1);
	}

	/** A destination's travel time, for a pin label or a list row. */
	_timeLabel(routes, slug) {
		const route = routes.get(slug);
		return route?.legs?.length ? formatTravelTime(route.total) : null;
	}

	/**
	 * The route drawn as a run of points on ONE map, or null when it cannot be.
	 *
	 * Two things make this more than "join the pins". A stop can be missing from the map being
	 * shown — the Foothills are drawn on the Vicinity but not on the World's End, so Stonetop to
	 * Tor's Fist has a stop with nowhere to put it — and the line BRIDGES those rather than
	 * breaking, which is honest for a schematic: it says "the way runs from here to there", never
	 * that it follows this road. And a stop past the map's edge is drawn at the arrow that points
	 * to it, which is what lets the line to Lygos run off the corner of the World's End instead of
	 * stopping at Marshedge with nothing to say.
	 *
	 * Percentages, like every other position here, so the polyline rides a `0 0 100 100` viewBox
	 * and rescales with the picture without measuring anything.
	 */
	_routePath(route, tier, frame, aspect) {
		if (!route?.legs?.length) return null;
		const arrows = new Map(exitsOnMap(tier).filter(e => e.node).map(e => [e.node, e]));
		const at = slug => {
			const spot = travelPlace(slug)?.spots?.[tier] ?? arrows.get(slug) ?? null;
			return spot ? spotPercent(spot, frame) : null;
		};
		const stops = [route.legs[0].from, ...route.legs.map(leg => leg.to)];
		const placed = stops.map(at);
		// THE ENDS ARE NOT BRIDGEABLE. Dropping a missing stop from the MIDDLE is the honest
		// schematic described above; dropping a missing one from either END silently shortens the
		// journey to somewhere it merely passes through. Tor's Fist drawn on the Vicinity tab is
		// the case: its own spot is on the other map, so the line stopped at the Foothills and
		// planted the destination arrowhead on an unlabelled dot the party is only walking past.
		// A journey with an end this map cannot show has no honest line, so it gets none.
		if (!placed[0] || !placed.at(-1)) return null;
		const points = placed.filter(Boolean);
		// One point is a dot, not a path, and drawing it would just double the pin already there.
		if (points.length < 2) return null;
		return {
			points: points.map(p => `${p.left.toFixed(2)},${p.top.toFixed(2)}`).join(" "),
			arrow:  this._routeArrow(points.at(-2), points.at(-1), aspect),
		};
	}

	/**
	 * The arrowhead that says which end of the line is the destination.
	 *
	 * ITS ANGLE IS NOT THE ANGLE BETWEEN THE TWO POINTS. Both coordinates are percentages of a box
	 * that is wider than it is tall, so a step of 1% across is a different number of pixels from a
	 * step of 1% down, and the direction a reader SEES is not the direction the numbers describe.
	 * Dividing the vertical component by the box's aspect converts into the pixel space the eye is
	 * actually in. (This is the same distortion that rules out an SVG `orient="auto"` marker here:
	 * it would take its angle from the unstretched user space and point visibly wide on a diagonal.)
	 *
	 * The head is then backed off along the segment so it points AT the destination pin instead of
	 * sitting under it, and that back-off is undistorted the same way. It is capped at a share of
	 * the final leg so a short last hop cannot push the arrow back past the stop before it.
	 */
	_routeArrow(from, to, aspect) {
		const ratio = Number(aspect) > 0 ? Number(aspect) : 1;
		// Into pixel-proportional space: x stays as-is, y shrinks by the box's width-to-height.
		const dx = to.left - from.left;
		const dy = (to.top - from.top) / ratio;
		const len = Math.hypot(dx, dy);
		if (!len) return null;
		const back = Math.min(3, len * 0.4);
		return {
			left:  Number((to.left - (dx / len) * back).toFixed(2)),
			// ...and back out of it, so the result is a percentage again like everything else here.
			top:   Number((to.top - (dy / len) * back * ratio).toFixed(2)),
			angle: Number((Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2)),
		};
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
	 */
	_mapLayer(tier, art, { routes, route, origin, destination }) {
		if (!art) return null;
		// Both anchors read the same way: a label near an edge hangs INWARD, so it cannot spill
		// out of the picture and give whatever is showing it a horizontal scrollbar.
		const anchors = (left, top) => ({
			anchorH: left > 78 ? "right" : left < 22 ? "left" : "centre",
			anchorV: top > 84 ? "above" : "below",
		});
		return {
			...art,
			tier,
			alt: `${travelMap(tier)?.name ?? "The region"}, from the Stonetop rulebooks`,
			path: this._routePath(route, tier, art.frame, art.aspect),
			spots: placesOnMap(tier).map(place => {
				const { left, top } = spotPercent(place.spots[tier], art.frame);
				const time = this._timeLabel(routes, place.slug);
				const isOrigin = place.slug === origin;
				const isChosen = place.slug === destination;
				return {
					slug: place.slug, name: place.name, left, top, time, isOrigin, isChosen,
					// Labels only where they carry the answer, so eleven of them cannot collide.
					showLabel: isOrigin || isChosen,
					tooltip: isOrigin ? `${place.name}, setting out` : time ? `${place.name}, ${time}` : place.name,
					...anchors(left, top),
				};
			}),
			exits: exitsOnMap(tier).map(exit => {
				const { left, top } = spotPercent(exit, art.frame);
				const time = exit.node ? this._timeLabel(routes, exit.node) : null;
				return {
					...exit, left, top, time,
					isChosen: !!exit.node && exit.node === destination,
					tooltip: exit.node
						? `${exit.label}${time ? `, ${time}` : ""}`
						: `Zoom out to ${travelMap(exit.to)?.name ?? "the wider map"}`,
					...anchors(left, top),
				};
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
		const { origin, destination } = this._journeyPick();
		const routes = solveTravel(origin);
		const route  = destination ? routes.get(destination) ?? null : null;
		const tier   = forTier ?? this._activeTier(origin, destination);

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
		const map = this._mapLayer(tier, art, { routes, route, origin, destination });

		const row = place => ({
			slug: place.slug, name: place.name,
			time: this._timeLabel(routes, place.slug),
			isOrigin: place.slug === origin,
			isChosen: place.slug === destination,
			uuid: this._journalUuid(place),
		});

		const routeStops = route?.legs?.length ? stopsAlongTheWay(route) : [];

		return {
			origin: travelPlace(origin),
			originOptions: TRAVEL_PLACES.map(place => ({
				slug: place.slug, name: place.name, selected: place.slug === origin,
			})),
			destination: travelPlace(destination),
			hasDestination: !!destination,
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
			groups: this._destinationGroups(row, destination, tier),
			route: route?.legs?.length ? {
				legs:     route.legs,
				atLeast:  atLeastPhrase(route.total),
				stops:    routeStops,
				hasStops: routeStops.length > 0,
				// Through the SAME predicate the carry-forward ticks the box with, so the readout
				// cannot promise a blank that `chartBlankValue` refuses to fill. Five of the
				// eighteen destinations from Stonetop are measured only in hours, and the readout
				// used to tell the GM the days were filled in on every one of them.
				hasDays:  chartBlankValue("days", route) !== null,
			} : null,
		};
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
	 * The highlighted group is the one holding the DESTINATION, not the one matching the picture.
	 * Those are the same group for every place a map draws, and differ for exactly the ones that
	 * make the distinction worth having: a destination past the maps' edge (Lygos, the Manmarch,
	 * the Steplands) is shown ON the outermost map, so keying the highlight to the picture meant
	 * "Beyond the maps" could never take it — `_activeTier` cannot return BEYOND_TIER — and the
	 * gold heading sat on a group that did not contain the chosen place. With nothing chosen it
	 * falls back to the picture, which is the only thing there is to follow.
	 */
	_destinationGroups(row, destination, tier) {
		const seen = new Set();
		const groups = TRAVEL_MAPS.map(m => {
			const places = placesOnMap(m.slug).filter(p => !seen.has(p.slug));
			for (const p of places) seen.add(p.slug);
			return { label: m.name, slug: m.slug, places: places.map(row) };
		});
		groups.push({ label: "Beyond the maps", slug: BEYOND_TIER, places: placesBeyond().map(row) });

		const holding = destination
			? groups.find(g => g.places.some(p => p.slug === destination))?.slug
			: null;
		const active = holding ?? tier;
		return groups.map(g => ({ ...g, isActive: g.slug === active }));
	}

	/**
	 * Record a pick and carry it forward onto Chart a Course.
	 *
	 * One write for the lot: `_saveField` persists the whole log per call, and this changes up to
	 * four things at once.
	 */
	async _setJourneyPlace(field, slug, from = null) {
		const { log, entry } = ensureCurrent(this._log(), () => this._newExpedition());
		// The route as it stood BEFORE the pick, so the carry-forward below can tell its own last
		// answer from a GM's own words. Read off the entry being mutated, NOT off _journeyPick():
		// ensureCurrent hands back a deep copy, so the draft still holds the previous values until
		// _persistLog swaps it in, and asking the draft would answer for the wrong trip.
		const before = journeyRoute(entry.journey);
		foundry.utils.setProperty(entry, `journey.${field}`, travelPlace(slug)?.slug ?? "");
		// Let the map follow the new pick rather than stranding the GM on the old tier. BOTH ends
		// matter, not just the destination: `_activeTier` promises "the closest map that can draw
		// the whole journey", and a pinned tab outranks it, so a GM who had opened the World's End
		// and then set out from the Red Grove got a Vicinity place on a continental map — no green
		// pin anywhere, and `_routePath` returning null because that end has no spot to draw.
		this._journeyTier = null;
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
	 * Carry a change of route onto the Chart a Course checklist — in BOTH directions.
	 *
	 * The two requirements the route can answer are set from the route every time, never only
	 * ticked. A one-way carry-forward looks harmless until the GM changes their mind: nothing ever
	 * cleared `chart.checks`, so re-picking left `firstTravel` ticked with a blank nobody could
	 * fill, and clearing the destination outright left a checklist describing a journey the trip no
	 * longer had. The emptiness guard on the route field ended up protecting the system's own stale
	 * output rather than a GM's words.
	 *
	 * A box is ticked only when `chartBlankValue` can actually fill the blank underneath it — the
	 * same predicate the text goes through — because five of the eighteen destinations from
	 * Stonetop are measured in hours and have no day count at all.
	 *
	 * The free-text route field is only ever written while it still holds what we last put there
	 * (or nothing). The moment a GM types their own account of how they mean to get there, it is
	 * theirs, and no later pick touches it again.
	 *
	 * EVERY field here goes through that same test, boxes included. "Set from the route every time"
	 * was right about the stale tick and wrong about whose tick it was: a GM who ticks "they must
	 * first travel to ___" by hand — for a stop the graph does not model, on a single-leg trip the
	 * route can never answer for — had it silently cleared by the next pick they made, along with
	 * its line in the Chronicle. So a box is rewritten only while it still says what the BEFORE
	 * route would have made it say. The moment it disagrees, the GM has been at it, and it is
	 * theirs. The stale tick this replaced cannot come back, because a box we ticked ourselves
	 * still matches and is still ours to clear.
	 */
	_carryToChart(entry, before, after) {
		if (!before && !after) return;
		for (const key of ["days", "firstTravel"]) {
			const path = `chart.checks.${key}`;
			const stored = foundry.utils.getProperty(entry, path);
			// Absent is nobody's answer yet, so it is ours to write. Only a box that EXISTS and
			// disagrees with what the before-route would have made it say has been touched by hand.
			if (stored !== undefined && !!stored !== (chartBlankValue(key, before) !== null)) continue;
			foundry.utils.setProperty(entry, path, chartBlankValue(key, after) !== null);
		}

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
			// `from` is the window that made the pick, so the sweep below can skip re-reading the
			// one that is about to re-read itself.
			pick:  (field, slug, from = null) => this._setJourneyPlace(field, slug, from),
			// A window navigated to another map is no longer the window for the map it was opened
			// on, and the bookkeeping here is keyed by exactly that.
			moved: (fromTier, toTier, app) => this._movedMapWindow(fromTier, toTier, app),
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
	async _buildLoadReadout() {
		const out = this._currentExpedition()?.partyOut ?? {};
		const pcs = getPlayerCharacters();
		if (!pcs.length) return { chips: [], hasRows: false, rows: [], summary: null };

		const chips = pcs.map(actor => ({ id: actor.id, name: actor.name, on: !out[actor.id] }));

		// Only on-trip PCs need a snapshot, and each is a full character build — run them
		// concurrently rather than awaiting one heavy build per PC in series (this re-runs
		// on every Outfit render, including each party-toggle click).
		const onTrip = pcs.filter(actor => !out[actor.id]);
		const snaps  = await Promise.all(onTrip.map(actor =>
			Promise.resolve(actor.typedActor?.buildSnapshot?.()).catch(() => null)));

		const rows = [];
		onTrip.forEach((actor, i) => {
			const snap   = snaps[i];
			const outfit = snap?.inventory?.outfit ?? {};
			const load   = outfit.load ?? snap?.inventory?.load ?? null;
			const limits = outfit.loadLimits ?? snap?.inventory?.loadLimits ?? LOAD_LEVEL_LIMITS;
			const tier   = load?.selected ?? null;
			const over   = !!load?.loadLevelOverloaded;

			rows.push(this._pcRow(actor, snap, tier, over, Number(load?.totalMarks) || 0, limits));
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
	// load-gated moves, and (when overloaded or Pack-Horse'd) a note.
	_pcRow(actor, snap, tier, over, marks, limits) {
		const band = tier || "light";           // the empty-load default, shared by both branches below
		const key = over ? "over" : band;
		const hasPackHorse = !!snap?.inventory?.outfit?.hasPackHorse;
		const wornArmor    = Number(snap?.vitals?.wornArmor) || 0;
		return this._loadRow(key, actor.name, marks, limits, {
			isFollower: false,
			sub:        actor.system?.playbook?.name || "",
			gated:      this._gatedMovesFor(snap, over ? "heavy" : band, wornArmor),
			packHorse:  hasPackHorse ? `caps ${limits.light}/${limits.normal}/${limits.heavy}` : null,
			note:       over ? "risks exhaustion, accident, injury" : null,
			noteDanger: over,
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
	// standard caps — followers don't get Pack Horse.
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
		return this._makeFollowerRow(crew.name || "The Crew", marks, "crew");
	}

	// A custom follower's load row (gear is a ✓ checklist).
	_followerRow(f) {
		const marks  = (Array.isArray(f?.gear) ? f.gear : []).filter(g => g?.checked).length;
		const folTag = f?.isGroup ? `×${Math.max(2, Number(f?.size) || 2)} group` : "follower";
		return this._makeFollowerRow(f?.name, marks, folTag);
	}

	// Shared builder for a follower load row from a name + ◇ mark count.
	_makeFollowerRow(name, marks, folTag) {
		const tier = deriveLoadLevel(marks, LOAD_LEVEL_LIMITS);
		const key  = tier === "overloaded" ? "over" : (tier || "light");
		return this._loadRow(key, name, marks, LOAD_LEVEL_LIMITS, { isFollower: true, folTag });
	}

	// Assemble one load row from a resolved band `key` (light/normal/heavy/over) and a ◇
	// mark count, plus the caller's per-row `extras`. Owns the pill / diamond-band / CSS
	// derivation so PC and follower rows share one shape and can't drift; `extras` supplies
	// (and overrides) the per-kind fields (playbook sub, gated moves, notes, folTag, …).
	_loadRow(key, name, marks, limits, extras = {}) {
		const pill = _LOAD_PILL[key];
		const { bands, overflow } = _pipBands(marks, limits);
		return {
			isFollower: false,
			initial:    (name || "?").charAt(0).toUpperCase(),
			name:       name || (extras.isFollower ? "Follower" : "Character"),
			sub:        "",
			folTag:     null,
			levelClass: `lvl-${key}`,
			pillClass:  key,
			levelLabel: pill.label,
			marks, cap: limits.heavy, bands, overflow,
			gated:      [],
			packHorse:  null,
			note:       null,
			noteDanger: false,
			...extras,
		};
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
