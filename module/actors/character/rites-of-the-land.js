import { escHtml } from "../../utils/strings.js";
import { sign } from "../../utils/roll-engine.js";
import { DEBILITIES, clearDebility, markedDebilities } from "../steading/steading-debilities.js";

// ── Rites of the Land (The Blessed) ──────────────────────────────────────────────
// "Once per season, when you oversee the sacred rites, hold 1 Favor. If you also sacrifice
//  1 Surplus, hold 4 Favor instead. Spend Favor in lieu of Stock, 1-for-1.
//  When you publicly sacrifice something or someone much-loved, either clear a steading
//  debility or gain advantage when the steading next rolls +Fortunes."
//
// TWO triggers in one move, and they are not the same act: the seasonal rites are upkeep, and
// the public sacrifice is a thing you do once, for a reason, at a cost the table will feel. So
// the walkthrough offers them as two, and each writes on its own button.
//
// THE WRITES LAND IN THREE PLACES, which is the whole reason this is a walkthrough and not a
// line of prose on the sheet: Favor on the CHARACTER's own track, Surplus and any cleared
// debility on the STEADING, and the promised advantage on a Fortunes roll that has not happened
// yet (see StonetopSteading#holdFortunesAdvantage). A player asked to do that by hand has to
// find three screens and remember the fourth thing next season.

export const RITES_MOVE = "Rites of the Land";
/** Which season's rites have been overseen — one per season, per the move's first line. */
export const RITES_SEASON_STEP = "ritesOfTheLand";

/** Favor held for overseeing the rites, and for doing so having given up a Surplus. */
export const FAVOR_PLAIN = 1;
export const FAVOR_WITH_SURPLUS = 4;

/**
 * What the window can offer, given what the character and steading actually have.
 *
 * Pure, and separated from the markup so the awkward parts — a rite already overseen this
 * season, a steading too poor to give up a Surplus, a Blessed who would LOSE Favor by
 * overseeing again — are testable without a world.
 *
 * @param {object} state
 * @param {number} state.favorHeld     Favor currently held (the track counts HELD; see stock-cost.js)
 * @param {number} state.favorMax      the move's track capacity
 * @param {number} state.surplus       the steading's Surplus
 * @param {boolean} state.ritesDone    have the rites already been overseen this season
 * @param {string[]} state.debilities  ids of the steading's marked debilities
 */
export function ritesOptions({ favorHeld = 0, favorMax = FAVOR_WITH_SURPLUS, surplus = 0, ritesDone = false, debilities = [] } = {}) {
	const cap = n => Math.min(n, Math.max(0, favorMax));
	const canSacrificeSurplus = surplus >= 1;
	return {
		ritesDone,
		canSacrificeSurplus,
		favorHeld,
		// What overseeing would leave them holding. The move says "hold N", not "gain N", so it
		// SETS the track — and that is why a Blessed already sitting on 4 is warned rather than
		// quietly knocked down to 1 for skipping the Surplus.
		plainFavor: cap(FAVOR_PLAIN),
		surplusFavor: cap(FAVOR_WITH_SURPLUS),
		wouldLoseFavor: favorHeld > cap(FAVOR_PLAIN),
		marked: DEBILITIES.filter(d => debilities.includes(d.id)),
	};
}

const DIALOG_OPTIONS = { classes: ["dialog", "stonetop", "stonetop-rites-dialog"] };

/**
 * Open the Rites of the Land walkthrough.
 *
 * @param {object} deps
 * @param {object} deps.character  StonetopCharacter — holds the Favor track.
 * @param {object} deps.steading   StonetopSteading, or null when the world has none yet.
 * @param {number} deps.year       campaign year, for the once-per-season marker
 * @param {string} deps.seasonId   current season id, likewise
 * @param {Function} [deps.onApplied]
 */
export function openRitesOfTheLand({ character, steading, year = 1, seasonId = "", onApplied } = {}) {
	if (!character) return;
	const favorMax = Number(character.ritesFavorMax?.() ?? FAVOR_WITH_SURPLUS) || FAVOR_WITH_SURPLUS;
	const state = ritesOptions({
		favorHeld: character.ritesFavorHeld?.() ?? 0,
		favorMax,
		surplus: steading?.getStatValue("surplus") ?? 0,
		ritesDone: !!(steading && seasonId && steading.seasonStepApplied(RITES_SEASON_STEP, year, seasonId)),
		debilities: markedDebilities(steading).map(d => d.id),
	});

	const seasonLine = seasonId
		? `${escHtml(seasonId[0].toUpperCase() + seasonId.slice(1))}, year ${year}`
		: "this season";

	// ── The rites ────────────────────────────────────────────────────────────────
	const ritesBody = state.ritesDone
		? `<p class="stonetop-rites-done"><i class="fas fa-check"></i> Already overseen in ${seasonLine}. The rites are once per season.</p>`
		: `<p>Hold <strong>${state.plainFavor} Favor</strong>${state.canSacrificeSurplus
			? `, or <strong>${state.surplusFavor}</strong> if the steading also sacrifices <strong>1 Surplus</strong>.`
			: `. <em>The steading has no Surplus to sacrifice.</em>`}</p>
			${state.wouldLoseFavor
				? `<p class="stonetop-rites-warn">You already hold <strong>${state.favorHeld} Favor</strong>. The move says <em>hold</em>, not gain, so overseeing without the Surplus would set it to ${state.plainFavor}.</p>`
				: ""}`;

	const ritesButtons = state.ritesDone ? [] : [
		{ key: "plain",   label: `Oversee the rites (hold ${state.plainFavor})`, surplus: false },
		...(state.canSacrificeSurplus
			? [{ key: "surplus", label: `Sacrifice 1 Surplus (hold ${state.surplusFavor})`, surplus: true }]
			: []),
	];

	// ── The public sacrifice ─────────────────────────────────────────────────────
	const sacrificeChoices = [
		...state.marked.map(d => ({
			key: `clear:${d.id}`,
			label: `Clear <strong>${escHtml(d.label)}</strong>`,
			detail: d.detail,
		})),
		{
			key: "fortunes",
			label: "Advantage on the steading's next <strong>+Fortunes</strong> roll",
			detail: "Held on the steading until that roll is made, then spent.",
		},
	];
	const sacrificeList = sacrificeChoices.map(c => `
		<li class="stonetop-rites-choice" data-choice="${escHtml(c.key)}">
			<span class="stonetop-rites-choice-label">${c.label}</span>
			<span class="stonetop-rites-choice-detail">${escHtml(c.detail)}</span>
		</li>`).join("");

	const content = `<div class="stonetop-rites-dialog-body">
		<section class="stonetop-rites-section">
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
			<ol class="stonetop-rites-choices">${sacrificeList}</ol>
		</section>
	</div>`;

	const dialog = new Dialog({
		title: RITES_MOVE,
		content,
		// Picking and committing stay separate, as Return Triumphant's do: a click marks the
		// choice and the footer button writes it, so an irreversible steading edit is never one
		// mis-click away. Nothing starts picked, so the button starts disabled.
		buttons: {
			apply: { label: "Apply the sacrifice", callback: () => {} },
			cancel: { label: "Close" },
		},
		default: "cancel",
		render: html => {
			const root = html[0];
			const appEl = dialog.element?.jquery ? dialog.element[0] : dialog.element;
			const applyBtn = appEl?.querySelector("button[data-button='apply']");
			let picked = null;
			const refresh = () => {
				if (!applyBtn) return;
				applyBtn.disabled = !picked;
				const choice = sacrificeChoices.find(c => c.key === picked);
				applyBtn.textContent = choice
					? (picked === "fortunes" ? "Hold the Fortunes advantage" : `Clear ${choice.label.replace(/<[^>]+>/g, "").replace(/^Clear\s+/, "")}`)
					: "Apply the sacrifice";
			};
			refresh();

			root.querySelectorAll(".stonetop-rites-choice").forEach(el => {
				el.addEventListener("click", () => {
					picked = el.dataset.choice;
					root.querySelectorAll(".stonetop-rites-choice").forEach(o => o.classList.toggle("is-picked", o === el));
					refresh();
				});
			});

			root.querySelectorAll("[data-rites]").forEach(el => {
				el.addEventListener("click", async () => {
					if (el.disabled) return;
					el.disabled = true;
					const withSurplus = el.dataset.rites === "surplus";
					await _overseeRites({ character, steading, year, seasonId, withSurplus, state });
					onApplied?.();
					dialog.close();
				});
			});

			applyBtn?.addEventListener("click", async () => {
				if (!picked) return;
				await _applySacrifice({ steading, picked });
				onApplied?.();
			});
		},
	}, DIALOG_OPTIONS);
	dialog.render(true);
}

/** Hold the Favor, spend the Surplus if that is the bargain, and mark the season done. */
async function _overseeRites({ character, steading, year, seasonId, withSurplus, state }) {
	const held = withSurplus ? state.surplusFavor : state.plainFavor;
	await character.setRitesFavor(held);
	if (withSurplus && steading) {
		const surplus = steading.getStatValue("surplus");
		await steading.setSystemValue("attributes.surplus.value", Math.max(0, surplus - 1), { stonetopMove: RITES_MOVE });
	}
	if (steading && seasonId) await steading.setSeasonStepApplied(RITES_SEASON_STEP, year, seasonId);
	globalThis.ui?.notifications?.info?.(
		`${RITES_MOVE}: holding ${held} Favor${withSurplus ? " (1 Surplus sacrificed)" : ""}.`);
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

export { DEBILITIES as RITES_DEBILITIES, sign };
