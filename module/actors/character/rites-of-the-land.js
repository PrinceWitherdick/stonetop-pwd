import { escHtml } from "../../utils/strings.js";
import { seasonLabel } from "../../seasons/seasons-change-reminders.js";
import { RITES_OF_THE_LAND } from "./stock-cost.js";
import { DEBILITIES, clearDebility, markedDebilities, openDebilityPicker } from "../steading/steading-debilities.js";

// ── Rites of the Land (The Blessed) ──────────────────────────────────────────────
// "Once per season, when you oversee the sacred rites, hold 1 Boon. If you also sacrifice
//  1 Surplus, hold 4 Boon instead. Spend Boon in lieu of Stock, 1-for-1.
//  When you publicly sacrifice something or someone much-loved, either clear a steading
//  debility or gain advantage when the steading next rolls +Fortunes."
//
// TWO triggers in one move, and they are not the same act: the seasonal rites are upkeep, and
// the public sacrifice is a thing you do once, for a reason, at a cost the table will feel. So
// the walkthrough offers them as two, and each writes on its own button.
//
// THE WRITES LAND IN THREE PLACES, which is the whole reason this is a walkthrough and not a
// line of prose on the sheet: the Boon on the CHARACTER's own track, Surplus and any cleared
// debility on the STEADING, and the promised advantage on a Fortunes roll that has not happened
// yet (see StonetopSteading#holdFortunesAdvantage). A player asked to do that by hand has to
// find three screens and remember the fourth thing next season.

// The SAME string as stock-cost.js's RITES_OF_THE_LAND, aliased rather than retyped: it is a
// move NAME used both to find the item and as a flag key, so a rename that touched one half
// would read the Boon from one key and write it to another.
export const RITES_MOVE = RITES_OF_THE_LAND;
/** Which season's rites have been overseen — one per season, per the move's first line. */
export const RITES_SEASON_STEP = "ritesOfTheLand";

/** Boon held for overseeing the rites, and for doing so having given up a Surplus. */
export const BOON_PLAIN = 1;
export const BOON_WITH_SURPLUS = 4;

/**
 * What the window can offer, given what the character and steading actually have.
 *
 * Pure, and separated from the markup so the awkward parts — a rite already overseen this
 * season, a steading too poor to give up a Surplus, a Blessed who would LOSE Boon by
 * overseeing again — are testable without a world.
 *
 * @param {object} state
 * @param {number} state.boonHeld      Boon currently held (the track counts HELD; see stock-cost.js)
 * @param {number} state.boonMax       the move's track capacity
 * @param {number} state.surplus       the steading's Surplus
 * @param {boolean} state.ritesDone    have the rites already been overseen this season
 * @param {string[]} state.debilities  ids of the steading's marked debilities
 */
export function ritesOptions({ boonHeld = 0, boonMax = BOON_WITH_SURPLUS, surplus = 0, ritesDone = false, debilities = [] } = {}) {
	const cap = n => Math.min(n, Math.max(0, boonMax));
	const canSacrificeSurplus = surplus >= 1;
	return {
		ritesDone,
		canSacrificeSurplus,
		boonHeld,
		// What overseeing would leave them holding. The move says "hold N", not "gain N", so it
		// SETS the track — and that is why a Blessed already sitting on 4 is warned rather than
		// quietly knocked down to 1 for skipping the Surplus.
		plainBoon: cap(BOON_PLAIN),
		surplusBoon: cap(BOON_WITH_SURPLUS),
		wouldLoseBoon: boonHeld > cap(BOON_PLAIN),
		marked: DEBILITIES.filter(d => debilities.includes(d.id)),
	};
}

const DIALOG_OPTIONS = { classes: ["dialog", "stonetop", "stonetop-rites-dialog"] };

/**
 * Open the Rites of the Land walkthrough.
 *
 * @param {object} deps
 * @param {object} deps.character  StonetopCharacter — holds the Boon track.
 * @param {object} deps.steading   StonetopSteading, or null when the world has none yet.
 * @param {number} deps.year       campaign year, for the once-per-season marker
 * @param {string} deps.seasonId   current season id, likewise
 * @param {Function} [deps.onApplied]
 */
export function openRitesOfTheLand({ character, steading, year = 1, seasonId = "", onApplied } = {}) {
	if (!character) return;
	const boonMax = Number(character.ritesBoonMax?.() ?? BOON_WITH_SURPLUS) || BOON_WITH_SURPLUS;
	const state = ritesOptions({
		boonHeld: character.ritesBoonHeld?.() ?? 0,
		boonMax,
		surplus: steading?.getStatValue("surplus") ?? 0,
		ritesDone: !!(steading && seasonId && steading.seasonStepApplied(RITES_SEASON_STEP, year, seasonId)),
		debilities: markedDebilities(steading).map(d => d.id),
	});

	// seasonLabel is the canonical id→name map; no escaping needed, it returns one of four literals.
	const seasonLine = seasonId ? `${seasonLabel(seasonId)}, year ${year}` : "this season";

	// ── The rites ────────────────────────────────────────────────────────────────
	const ritesBody = state.ritesDone
		? `<p class="stonetop-rites-done"><i class="fas fa-check"></i> Already overseen in ${seasonLine}. The rites are once per season.</p>`
		: `<p>Hold <strong>${state.plainBoon} Boon</strong>${state.canSacrificeSurplus
			? `, or <strong>${state.surplusBoon}</strong> if the steading also sacrifices <strong>1 Surplus</strong>.`
			: `. <em>The steading has no Surplus to sacrifice.</em>`}</p>
			${state.wouldLoseBoon
				? `<p class="stonetop-rites-warn">You already hold <strong>${state.boonHeld} Boon</strong>. The move says <em>hold</em>, not gain, so overseeing without the Surplus would set it to ${state.plainBoon}.</p>`
				: ""}`;

	const ritesButtons = state.ritesDone ? [] : [
		{ key: "plain",   label: `Oversee the rites (hold ${state.plainBoon})`, surplus: false },
		...(state.canSacrificeSurplus
			? [{ key: "surplus", label: `Sacrifice 1 Surplus (hold ${state.surplusBoon})`, surplus: true }]
			: []),
	];

	// ── The public sacrifice ─────────────────────────────────────────────────────
	//
	// The choices, in the shape openDebilityPicker offers: `id` is what _applySacrifice reads
	// back, `label` is the plain text the footer button prints, `labelHtml` the emphasis this
	// window authored. The last row is not a debility at all — the move's other branch — which
	// the picker does not mind: it offers what it is given.
	const sacrificeChoices = [
		...state.marked.map(d => ({
			id: `clear:${d.id}`,
			label: `Clear ${d.label}`,
			labelHtml: `Clear <strong>${escHtml(d.label)}</strong>`,
			detail: d.detail,
		})),
		{
			id: "fortunes",
			label: "Hold the Fortunes advantage",
			labelHtml: "Advantage on the steading's next <strong>+Fortunes</strong> roll",
			detail: "Held on the steading until that roll is made, then spent.",
		},
	];

	// THROUGH THE SHARED PICKER (steading-debilities.js), which the Inn's gathering and Return
	// Triumphant already put the same question in. This window used to hand-build the same
	// pick-one-then-commit shell — the rows, the is-picked toggle, the footer button relabelling
	// itself, the `dialog.element?.jquery` dance — and the copy silently did without the picker's
	// `role="radio"` / tabindex / Enter-Space handling and its autofocus on the first row, which
	// that helper's docblock calls load-bearing for reaching the choices by keyboard at all.
	//
	// The rites half rides in `introHtml`, and its two buttons are wired in `onRender` — the hook
	// that exists for exactly this (winter's debt window uses it for its own control).
	openDebilityPicker({
		title: RITES_MOVE,
		introHtml: `<section class="stonetop-rites-section">
			<h3>Oversee the sacred rites</h3>
			<p class="stonetop-rites-trigger"><em>Once per season (${seasonLine}).</em></p>
			${ritesBody}
			${ritesButtons.length ? `<div class="stonetop-rites-actions">${ritesButtons
				.map(b => `<button type="button" class="stonetop-season-btn" data-rites="${b.key}">${escHtml(b.label)}</button>`)
				.join("")}</div>` : ""}
		</section>
		<hr class="stonetop-season-divider">
		<section class="stonetop-rites-section">
			<h3>Publicly sacrifice something or someone much-loved</h3>
			<p class="stonetop-rites-trigger"><em>Pick one. This is a separate act from the rites above.</em></p>
			${state.marked.length ? "" : `<p class="stonetop-rites-note">No debilities are marked, so the sacrifice can only buy the Fortunes advantage.</p>`}
		</section>`,
		marked: sacrificeChoices,
		applyLabel: "Apply the sacrifice",
		applyLabelFor: c => c.label,
		choicesLabel: "Sacrifice to make",
		bodyClass: "stonetop-rites-dialog-body",
		buttons: { cancel: { label: "Close" } },
		dialogOptions: DIALOG_OPTIONS,
		onRender: (root, dialog) => {
			root.querySelectorAll("[data-rites]").forEach(el => {
				el.addEventListener("click", async () => {
					if (el.disabled) return;
					el.disabled = true;
					await _overseeRites({
						character, steading, year, seasonId, state,
						withSurplus: el.dataset.rites === "surplus",
					});
					onApplied?.();
					dialog.close();
				});
			});
		},
		onApply: async choice => {
			await _applySacrifice({ steading, picked: choice.id });
			onApplied?.();
		},
	});
}

/** Hold the Boon, spend the Surplus if that is the bargain, and mark the season done. */
async function _overseeRites({ character, steading, year, seasonId, withSurplus, state }) {
	// THE SURPLUS FIRST, and the Boon set to what was actually paid for.
	//
	// The sacrifice and the season marker ride ONE write, through the same reader the Inn's
	// gathering and the watch's upkeep go through: spendSurplus owns the LIVE re-read (this
	// window stays open beside an interactive sheet, so the steading may have spent elsewhere
	// since it was built) and answers null rather than writing back a stale count minus one.
	// A bare setSystemValue did neither, and carded the Surplus and the marker separately.
	//
	// That live answer is why the order matters. The old clamp could not fail, so holding the 4
	// Boon first was safe; a spend that CAN be refused would otherwise leave a Blessed holding
	// the sacrifice's Boon for a Surplus nobody paid. Refused, the rites still happen — they
	// just happen as the plain ones, which is the bargain the book offers when there is nothing
	// to give up.
	let paid = withSurplus;
	if (withSurplus && steading) {
		paid = await steading.spendSurplus(1, { stonetopMove: RITES_MOVE, step: RITES_SEASON_STEP, year, seasonId }) !== null;
		if (!paid) globalThis.ui?.notifications?.warn?.("No Surplus left to sacrifice. The rites are overseen without it.");
	}
	if (!paid && steading && seasonId) await steading.setSeasonStepApplied(RITES_SEASON_STEP, year, seasonId);

	const held = paid ? state.surplusBoon : state.plainBoon;
	await character.setRitesBoon(held);
	globalThis.ui?.notifications?.info?.(
		`${RITES_MOVE}: holding ${held} Boon${paid ? " (1 Surplus sacrificed)" : ""}.`);
}

/** Clear the chosen debility, or hold the advantage over the next +Fortunes roll. */
async function _applySacrifice({ steading, picked }) {
	if (!steading) return void globalThis.ui?.notifications?.warn?.("No steading to sacrifice for.");
	if (picked === "fortunes") {
		await steading.holdFortunesAdvantage(`Sacrifice (${RITES_MOVE})`);
		globalThis.ui?.notifications?.info?.("Advantage held for the steading's next +Fortunes roll.");
		return;
	}
	const id = picked.replace(/^clear:/, "");
	const debility = DEBILITIES.find(d => d.id === id);
	if (!debility) return;
	await clearDebility(steading, id, RITES_MOVE);
	globalThis.ui?.notifications?.info?.(`${debility.label} cleared.`);
}

