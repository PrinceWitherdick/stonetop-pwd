import { StepperDialog } from "./StepperDialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { crewExists } from "../utils/crew.js";
import { sign, rollSeasonsCard } from "../utils/roll-engine.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { getSetting, setWorldSetting } from "../settings.js";
import { escHtml } from "../utils/strings.js";
import { CHART_GROUPS, HOME_GROUP } from "./expedition-data.js";
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
import { SYSTEM_ID } from "../system-id.js";
import { EXPLORATION_GM_MOVES } from "../gm-toolkit/gm-moves.js";

const ANSWERS_SETTING = "expeditionAnswers";

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

// Linear walkthrough. `body` is HTML. `fate` adds a Die of Fate button. `roll`
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
		key:   "chart",
		title: "Chart a Course",
		icon:  "fa-route",
		body:  `<p>When the players start talking about leaving, point them at <strong>Chart a Course</strong>. Pin down their <strong>destination</strong> and roughly how they mean to get there (&ldquo;we follow the tracks&rdquo; is enough).</p>
				<p>Then tell them as many of the following as make sense, based on the season, terrain, how well they know the area, and the threats that lurk there. Link them with <strong>&ldquo;and&rdquo;</strong>, or offer a merciful <strong>&ldquo;or.&rdquo;</strong> Tick the ones you present: this becomes your narrative to-do list once they set out.</p>`,
		qa:    {
			kind:  "checklist",
			key:   "chart",
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
				<ul class="stonetop-exp-fatetable">
					<li><strong>1</strong>: A danger springs on them, unavoidable.</li>
					<li><strong>2&ndash;3</strong>: Introduce a danger, right in front of them.</li>
					<li><strong>4&ndash;5</strong>: Point to a looming danger.</li>
					<li><strong>6</strong>: Point to a looming danger, but also present a discovery.</li>
				</ul>`,
		fate:  true,
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
				<p>Or let fate decide. Either ask what weather they're <strong>hoping for</strong> and roll the <strong>Die of Fate</strong> (1&ndash;2 nope, 3&ndash;4 partway, 5&ndash;6 just what they wanted), or roll the <strong>seasonal weather table</strong> (Book I p.325), informed by the latest <em>Seasons Change</em>.</p>`,
		fate:    true,
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
				<ul class="stonetop-exp-fatetable">
					<li><strong>1</strong>: Something dangerous approaches, inclined to harm.</li>
					<li><strong>2</strong>: Something dangerous approaches, curious but not aggressive.</li>
					<li><strong>3</strong>: Something annoying happens (critters, rain, an argument).</li>
					<li><strong>4&ndash;5</strong>: The night passes uneventfully.</li>
					<li><strong>6</strong>: A small boon, or an uneventful night.</li>
				</ul>`,
		fate:  true,
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
			// 760×620) — NOT "auto". These eleven steps run from two paragraphs (intro) to a
			// twelve-box checklist (Chart a Course) to a per-PC load table (Outfit), and an
			// auto-height window re-measures its content on EVERY render: measured against a
			// 1000px viewport it opened anywhere from 597px to 951px, and from 734px to 951px
			// at a larger UI font — up to 95% of the screen, a different height on each Next /
			// Back / rail click. (Core clamps an auto height only to the viewport, and the
			// shared .stonetop-spring-dialog cap is itself viewport-sized, so neither bounded
			// it.) 620 is also the exact height at which all eleven rail entries are visible
			// at the default UI font. The step column scrolls instead — see
			// .stonetop-guide-main. A fixed height also means a manual resize sticks; core
			// discards one on an auto-height window.
			height:    620,
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
		html.find(".stonetop-exp-fate-btn").on("click", () => game.stonetop?.rollDieOfFate?.());
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
		this._step = 0;
		this.render(false);
	}

	// Switch which logged trip the dialog is editing.
	async _switchExpedition(id) {
		await this._persistLog(selectExpedition(this._log(), id));
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
			return {
				kind:   "checklist",
				intro:  qa.intro ? field(qa.intro) : null,
				groups: qa.groups.map(g => ({
					label: g.label,
					items: g.items.map(it => ({
						text:    it.text,
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
