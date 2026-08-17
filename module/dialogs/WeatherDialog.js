import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { getSetting, setSetting } from "../settings.js";
import { WEATHER_SEASONS, getWeatherSeason, rollWeatherResult, rowRange, defaultWeatherSeason, weatherSeasonForCampaignSeason } from "../utils/weather.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { readCurrentSeason, currentSeasonView } from "../seasons/current-season.js";
import { announceWeather } from "../seasons/current-weather.js";
import { spinHighlight } from "../utils/flash-highlight.js";

const SEASON_SETTING = "weatherSeason";

// The class the row now standing as the weather wears. Its own class rather than the walk's
// `stonetop-flash`, because that one is written to go out on a timer — "this is what just
// happened" — and this one IS a selection: it has to still be there when the GM comes back to
// the window a minute later to press Post.
const PICKED_CLASS = "is-picked";

// ── WeatherDialog ────────────────────────────────────────────────────────────
// A compact GM tool for the expedition weather roll (Book I, p.325): pick the
// season, roll 1d6 on its table, post a result card. The season tables and roll
// live in utils/weather.js; this is just the picker. Opened from the sun-cloud
// hotbar macro (see hooks/Ready.js).
//
// The roll LANDS in the window rather than going straight to chat. A light walks the season's
// rows and stops on the one the die gave (the GM Moves randomizer's walk, utils/flash-highlight.js),
// and the row stays lit until the GM either posts it, re-rolls, or clicks a different row. Two
// reasons the button no longer fires and closes:
//
//  • The rows already looked like options — six boxed lines you could click — and the window
//    was the only place in the system where that shape did nothing. It does now.
//  • The weather is the GM's call ("You decide when it rains", p.324) and the table is offered
//    as a prompt, not an oracle. A roll you can look at before the table sees it is the version
//    of that table the book actually describes; a roll that posts as it lands makes the die the
//    authority and puts every discarded re-roll in the log.
//
// The picker opens on the season the steading's clock is actually in — the book tells the
// GM to roll "informed by the latest Seasons Change", and the world already knows what that
// was, so making the GM re-answer it every time was asking for a summer roll in autumn. A
// deliberate pick still sticks for as long as that season lasts; see defaultWeatherSeason.

export class WeatherDialog extends StonetopDialog {
	constructor(options = {}) {
		super(options);
		// The steading's stamped season, read once at open. A world with no Seasons Change
		// recorded yet has no clock to follow (readCurrentSeason returns null rather than the
		// header's display default), and falls back to the remembered pick as before.
		this._clock  = readCurrentSeason(getStonetopSteadingActor());
		this._season = defaultWeatherSeason(this._clock?.season ?? null, getSetting(SEASON_SETTING));
		// The row standing as the weather: {index, row, roll}. `roll` is the evaluated d6 when
		// the die gave it and null when the GM picked the row themselves — which is the whole
		// difference the card prints. Null until either happens, and that null is what the
		// footer reads to decide whether it shows one button or two.
		this._picked = null;
		// The walk in flight, so a second Re-roll abandons the first where it stands. One per
		// dialog: there is one list and one light. Collides with nothing in Application.
		this._spin = null;
	}

	static open() {
		return openOrFocus("stonetop-weather", () => new WeatherDialog().render(true));
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-weather",
			title:     "Weather",
			template:  "systems/stonetop-pwd/templates/dialogs/weather.hbs",
			width:     420,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-weather-dialog"],
		});
	}

	activateListeners(html) {
		super.activateListeners(html);
		html.find(".stonetop-weather-season").on("click", ev => this._pickSeason(ev.currentTarget.dataset.season));
		html.find(".stonetop-weather-row").on("click", ev => this._pickRow(Number(ev.currentTarget.dataset.index)));
		// Both the opening "Roll the weather" and the "Re-roll" beside a landed result do the
		// same thing; they differ only in what they say and where they sit, so they share a
		// handler rather than a class — the class is what the stylesheet tells apart.
		html.find(".stonetop-weather-roll-btn, .stonetop-weather-reroll-btn").on("click", () => this._roll());
		html.find(".stonetop-weather-post-btn").on("click", () => this._post());
	}

	/** Cancel any walk still running, so nothing lands on a window that has gone. */
	async close(options = {}) {
		this._spin?.cancel();
		return super.close(options);
	}

	getData() {
		const season = getWeatherSeason(this._season);
		const clock  = this._clockLine();
		// The selected button goes red when the table showing is not the one the steading's clock
		// points at. Only ever a warning ON the selection, never on the other three: the sentence
		// above says which season the world is in, and colouring the unpicked buttons too would
		// leave the GM reading a row of reds to work out which one they were actually on.
		//
		// A world with no Seasons Change stamped has no clock to be off, so nothing goes red —
		// `_clockLine` returns null there and the whole line is absent.
		const offClock = !!clock && !clock.followed;
		return {
			seasons: WEATHER_SEASONS.map(s => ({
				key:        s.key,
				label:      s.label,
				isActive:   s.key === this._season,
				isOffClock: offClock && s.key === this._season,
			})),
			label:   season.label,
			clock,
			// `picked` rather than the row itself: the footer only needs to know whether there
			// is one, and the row that IS picked says so on its own line.
			picked:  !!this._picked,
			rows:    season.rows.map((r, i) => ({
				index:    i,
				range:    rowRange(r),
				text:     r.text,
				reroll:   !!r.reroll,
				isPicked: this._picked?.index === i,
			})),
		};
	}

	// The "your clock says…" line: which season the steading is in, and whether the table
	// showing is the one that season points at. Named so the GM can see the pick came from
	// the world rather than from wherever they left the dialog last — and so a straddle
	// table they chose themselves reads as a choice, not as the picker ignoring the clock.
	//
	// Spelled by `currentSeasonView`, the same function the steading header's clock reads,
	// rather than by calling `seasonLabel` and `yearLabel` here: this diff renamed a campaign
	// year ("First Year" → "Year One") and had to chase every surface that names one, so a
	// second hand-assembled clock is a second place to have to find. `stamped` is the view's
	// own "there is no clock" signal, which is exactly the question this line opens with.
	_clockLine() {
		const view = currentSeasonView(this._clock);
		if (!view.stamped) return null;
		return {
			label:     view.label,
			yearLabel: view.yearLabel,
			followed:  this._season === weatherSeasonForCampaignSeason(view.season),
		};
	}

	// Switch season and remember it for next time — paired with the season it was picked
	// under, so the clock takes back over once that season turns.
	//
	// The standing result goes with it. A row index means nothing across two tables of
	// different lengths, and even where it resolved it would be a summer result sat under an
	// autumn heading — the pick belongs to the table it was made on.
	async _pickSeason(key) {
		if (!getWeatherSeason(key) || key === this._season) return;
		this._spin?.cancel();
		this._season = key;
		this._picked = null;
		await setSetting(SEASON_SETTING, { key, for: this._clock?.season ?? null });
		this.render(false);
	}

	// Roll 1d6 on the current season's table and walk the light to the row it gave. Nothing is
	// posted: the landing IS the answer, and the footer's Post button is what sends it out.
	async _roll() {
		const result = await rollWeatherResult(this._season);
		if (!result?.row) return;

		const index = getWeatherSeason(this._season).rows.indexOf(result.row);
		// A later click superseded this walk — that click's result is the one to keep, and this
		// one drops out rather than overwriting it on arrival.
		if (!await this._spinTo(index)) return;

		this._picked = { index, row: result.row, roll: result.roll };
		this.render(false);
	}

	// The GM naming the weather themselves, which the book puts first ("You decide when it
	// rains", p.324). Same standing result as a roll, minus the die — so the card that goes out
	// carries no total, and the footer offers the same two buttons either way.
	_pickRow(index) {
		const row = getWeatherSeason(this._season)?.rows?.[index];
		if (!row || this._picked?.index === index) return;
		this._spin?.cancel();
		this._picked = { index, row, roll: null };
		this.render(false);
	}

	/**
	 * Run the light down the rows and leave it standing on `index`.
	 *
	 * The landing class goes on the row HERE, in the same task the walk ends, and the re-render
	 * that follows paints the same class back on the same row. Waiting for the render instead
	 * would leave a frame with nothing lit at the exact moment being watched.
	 *
	 * The previous result is unlit before the walk sets off, rather than left burning while a
	 * light travels towards its replacement. It is only taken off the DOM, not out of
	 * `this._picked`: the footer must not flip back to a single button mid-walk, and a walk that
	 * gets cancelled leaves the old answer to be repainted by the next render.
	 *
	 * @returns {Promise<boolean>}  false if a later click superseded this walk — the caller's
	 *          cue to keep its result to itself. True when there was no walk to make at all
	 *          (rows not on the page, motion turned off), since the result still stands.
	 */
	async _spinTo(index) {
		const root = this.element?.[0] ?? null;
		const rows = [...(root?.querySelectorAll(".stonetop-weather-row") ?? [])];
		for (const el of rows) el.classList.remove(PICKED_CLASS);
		if (!rows[index]) return true;

		this._spin?.cancel();
		const spin = spinHighlight(rows, index, { scope: root, from: this._picked?.index ?? -1 });
		this._spin = spin;

		if (!await spin.done) return false;
		rows[index].classList.add(PICKED_CLASS);
		return true;
	}

	// Send the standing result to the table and close.
	//
	// ONE call, because the card and the steading's glyph are one act: a card in the log saying
	// it is snowing over a header still showing a sun is worse than either. This used to be the
	// two calls in a row with a comment saying they must not be split, which held only while
	// this stayed the one caller — see `announceWeather` in seasons/current-weather.js, which
	// is where the pair now lives, along with the steading lookup it does for itself.
	async _post() {
		if (!this._picked) return;
		await announceWeather(this._season, this._picked);
		this.close();
	}
}
