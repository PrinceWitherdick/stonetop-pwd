import { sign } from "../../utils/roll-engine.js";
import { escHtml } from "../../utils/strings.js";
import { meetWithDisaster } from "./steading-debilities.js";
import { STEADING_STAT_MAX } from "./StonetopSteading.js";

// ── What a steading move's roll card can still do to the steading ───────────────
// The buttons a homefront move's card carries for a cost or a give-back that lands after the dice,
// and the writes behind them. stonetop.js wires each through its shared once-per-card latch
// (_wireSteadingCardButtons); everything that decides WHAT the write is lives here, so it can be
// tested without a chat log.
//
// EVERY "reduce Fortunes by 1" goes through payFortunesCost, and so through Meet with Disaster:
// "When Fortunes would drop below -1 for any reason (not just calamity or panic), then the GM picks
// 1 instead" (Book I p.532). A cost written as `Math.max(fortunes - 1, -1)` paid nothing at -1.

/** The message flag that latches a Requisition card's 6- cost, from its button or a window's Take. */
export const REQUISITION_MISS_COST_FLAG = "requisitionMissCostApplied";

/**
 * Pay a move's "reduce Fortunes by 1". At -1 the steading Meets with Disaster instead and the GM's
 * pick opens (and is owed, on the header, until it is made). The write names its move.
 * @returns {Promise<{fortunes: number, disaster: boolean, notice: string}>}
 */
export async function payFortunesCost(steading, { stonetopMove, cause = "", onApplied } = {}) {
	const out = await meetWithDisaster(steading, { stonetopMove, cause: cause || stonetopMove, onApplied });
	return {
		...out,
		notice: out.disaster
			? `Fortunes is already at −1, so ${stonetopMove}'s cost Meets with Disaster: the GM picks what it costs.`
			: `Fortunes reduced to ${sign(out.fortunes)}.`,
	};
}

/**
 * Give back the 1 Fortunes a move took (Muster's "Everyone's willing to pitch in; don't reduce
 * Fortunes after all"), never past +3.
 * @returns {Promise<{given: number, fortunes: number, notice: string}>}
 */
export async function giveBackFortunes(steading, { stonetopMove } = {}) {
	const live = steading.getStatValue("fortunes");
	const next = Math.min(live + 1, STEADING_STAT_MAX);
	if (next !== live) await steading.applyChanges({ system: { "stats.fortunes.value": next } }, { stonetopMove });
	return {
		given: next - live,
		fortunes: next,
		notice: next === live
			? `Fortunes is already ${sign(live)}, the most it can be.`
			: `Everyone pitches in: Fortunes back to ${sign(next)}.`,
	};
}

/** Who a card's Take names on the steading's Assets list: the pressing user's character, or the user. */
function takenByUser(user = globalThis.game?.user) {
	const own = user?.character;
	return own?.type === "character" ? { name: own.name, id: own.id } : { name: user?.name ?? "Someone" };
}

/** The `data-asset-*` pair a Requisition button carries, for an asset row the steading still lists. */
function assetAttrs({ index = null, name = "" } = {}) {
	return Number.isInteger(index) && name
		? ` data-asset-index="${index}" data-asset-name="${escHtml(name)}"`
		: "";
}

/** The asset a Requisition button names, read back off it, or null for one naming none. */
export function assetFromButton(btn) {
	const raw = btn?.dataset?.assetIndex;
	const index = raw === undefined || raw === "" ? NaN : Number(raw);
	return Number.isInteger(index) ? { index, name: btn.dataset.assetName ?? "" } : null;
}

/**
 * Requisition's 6- (p.308): "you can take the asset with you, but if you do, reduce Fortunes by 1".
 * When the card names an asset row, pressing it also marks that asset out.
 */
export function requisitionMissCostAction(asset = {}) {
	return `<button type="button" class="stonetop-requisition-miss-cost" data-action="requisition-miss-cost"${assetAttrs(asset)}>
		<i class="fas fa-arrow-down"></i> Take it on a miss: reduce Fortunes by 1
	</button>`;
}

/** Requisition's 10+ and 7-9, from the steading's own window: mark the borrowed asset out. */
export function requisitionTakeAction(asset = {}) {
	if (!assetAttrs(asset)) return "";
	return `<button type="button" class="stonetop-requisition-take-asset" data-action="requisition-take-asset"${assetAttrs(asset)}>
		<i class="fas fa-hand-holding"></i> Take it: mark ${escHtml(asset.name)} out
	</button>`;
}

/** Muster's cost, left to the card: the roller could not write the steading, or Fortunes was at -1. */
export const MUSTER_PAY_COST_ACTION = `<button type="button" class="stonetop-muster-pay-cost" data-action="muster-pay-cost">
		<i class="fas fa-arrow-down"></i> Pay the Muster's 1 Fortunes
	</button>`;

/** Muster's "Everyone's willing to pitch in; don't reduce Fortunes after all", for a cost already paid. */
export const MUSTER_PITCH_IN_ACTION = `<button type="button" class="stonetop-muster-pitch-in" data-action="muster-pitch-in">
		<i class="fas fa-people-group"></i> Everyone pitches in: give back the Fortunes
	</button>`;

/** Pull Together's 7-9 "It gets done, but other work doesn't; reduce Fortunes by 1". */
export const PULL_TOGETHER_COST_ACTION = `<button type="button" class="stonetop-pull-together-cost" data-action="pull-together-cost">
		<i class="fas fa-arrow-down"></i> Other work doesn't get done: reduce Fortunes by 1
	</button>`;

/**
 * `tierActions` (a roll card's buttons by tier, or null) with `add`'s HTML merged in, tier by tier:
 * after what each tier already offers, or in front of it with `prepend`. A new object; the one passed
 * in is left alone.
 * @param {Object<string, string>|null} tierActions
 * @param {Object<string, string>} add  HTML by tier ("success", "partial", "failure")
 */
export function addTierActions(tierActions, add, { prepend = false } = {}) {
	const out = { ...(tierActions ?? {}) };
	for (const [tier, html] of Object.entries(add)) out[tier] = prepend ? `${html}${out[tier] ?? ""}` : `${out[tier] ?? ""}${html}`;
	return out;
}

/**
 * Muster's card actions for how its cost went before the roll: `"paid"` puts the pitch-in give-back
 * on the 7+ tiers; `"owed"` puts the cost itself on every tier (a 7+ that picks "pitch in" leaves
 * it unpressed). Merged in front of what each tier already offers.
 */
export function withMusterCostActions(tierActions, musterCost) {
	const add = musterCost === "paid" ? { success: MUSTER_PITCH_IN_ACTION, partial: MUSTER_PITCH_IN_ACTION }
		: musterCost === "owed" ? { success: MUSTER_PAY_COST_ACTION, partial: MUSTER_PAY_COST_ACTION, failure: MUSTER_PAY_COST_ACTION }
		: null;
	if (!add) return tierActions ?? null;
	return addTierActions(tierActions, add, { prepend: true });
}

/**
 * Wire a steading card's row of buttons that each ask a question and then write once: Trade & Barter's
 * hand-over and a steading miss's XP. One question at a time across the row. `choose(btn)` answers
 * what the press is about, or nothing to do nothing; `write(choice)` does it, with the row disabled,
 * and answers whether it happened. A write that did not happen, or failed, gives the row back.
 *
 * @param {HTMLButtonElement[]} buttons
 * @param {{choose: (btn: HTMLButtonElement) => Promise<*>, write: (choice: *) => Promise<boolean>, what: string}} opts
 *   `what` is the error log's words for a failure ("Could not ...")
 */
export function wireChooseThenWrite(buttons, { choose, write, what }) {
	let busy = false;
	for (const btn of buttons) {
		btn.addEventListener("click", async ev => {
			ev?.preventDefault?.();
			if (busy) return;
			busy = true;
			try {
				const choice = await choose(btn);
				if (!choice) return;
				for (const b of buttons) b.disabled = true;
				if (!(await write(choice))) for (const b of buttons) b.disabled = false;
			} catch (err) {
				console.error(`Stonetop | ${what}:`, err);
				for (const b of buttons) b.disabled = false;
			} finally {
				busy = false;
			}
		});
	}
}

/**
 * The Fortunes buttons stonetop.js wires, one latch each. `run` gets the StonetopSteading.
 * The Requisition ones are wired on their own, since they also mark an asset out.
 */
export const STEADING_FORTUNES_CARD_ACTIONS = Object.freeze([
	{
		selector: ".stonetop-muster-pay-cost", flag: "musterCostPaid", settled: "Muster's cost paid",
		warn: "You need permission to update the steading's Fortunes.",
		run: steading => payFortunesCost(steading, { stonetopMove: "Muster", cause: "the Muster's cost" }),
	},
	{
		selector: ".stonetop-muster-pitch-in", flag: "musterPitchedIn", settled: "Fortunes given back",
		warn: "You need permission to update the steading's Fortunes.",
		run: steading => giveBackFortunes(steading, { stonetopMove: "Muster" }),
	},
	{
		selector: ".stonetop-pull-together-cost", flag: "pullTogetherCostPaid", settled: "Fortunes reduced",
		warn: "You need permission to update the steading's Fortunes.",
		run: steading => payFortunesCost(steading, { stonetopMove: "Pull Together", cause: "work left undone" }),
	},
]);

/**
 * Requisition's 6- cost (p.308), "if you do, reduce Fortunes by 1": the card's button and the Requisition
 * window's Take both pay it here.
 * @returns {Promise<{fortunes: number, disaster: boolean, notice: string}>}
 */
export function payRequisitionMissCost(steading) {
	return payFortunesCost(steading, { stonetopMove: "Requisition", cause: "a Requisition taken on a miss" });
}

/**
 * Requisition taken on a miss: the cost, and the named asset marked out (when the card names one).
 * @returns {Promise<{notice: string, marked: boolean}>}
 */
export async function settleRequisitionMiss(steading, { asset = null, takenBy = takenByUser() } = {}) {
	const out = await payRequisitionMissCost(steading);
	const marked = asset ? await steading.setAssetTaken(asset.index, takenBy, { name: asset.name }) : false;
	const missed = asset && !marked ? ` ${asset.name} was not on hand to mark out.` : "";
	return { ...out, marked, notice: `${out.notice}${missed}` };
}

/**
 * Requisition's 10+ or 7-9 from the steading's window: mark the asset out.
 * @returns {Promise<{notice: string, abort?: boolean}>}
 */
export async function takeRequisitionedAsset(steading, { asset, takenBy = takenByUser() } = {}) {
	if (!asset) return { abort: true, notice: "" };
	const marked = await steading.setAssetTaken(asset.index, takenBy, { name: asset.name });
	if (!marked) {
		globalThis.ui?.notifications?.warn?.(`${asset.name} is no longer on hand to take.`);
		return { abort: true, notice: "" };
	}
	return { notice: `${asset.name} marked out to ${takenBy.name}.` };
}
