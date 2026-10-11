import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { rollStat, sign, messageOfRoll } from "../../../utils/roll-engine.js";
import { askWithButtons } from "../../../utils/ask-with-buttons.js";
import { cardCountedTier } from "../../../utils/counted-tier.js";
import { REQUISITION_MISS_COST_FLAG, payRequisitionMissCost, requisitionMissCostAction } from "../../steading/steading-card-actions.js";
import { StonetopSteading, HERD_ASSET_BEAST, HERD_ASSET_NAME, isHerdAsset } from "../../steading/StonetopSteading.js";
import { askHorsesFromHerd, herdHorsesLabel } from "../../steading/herd-requisition.js";
import { assetLabel, beastFollowerForAsset, followerInputFromBeast } from "../../../data/beasts.js";
import { buildCustomFollower, nextFollowerOrder } from "../../../data/follower-build.js";
import { bringDialogToFront } from "../../../utils/front-on-open.js";
import { escHtml, joinNames } from "../../../utils/strings.js";
import { CUSTOM_ASSET_VALUE, assetTakenLabel, wireCustomAssetSelect } from "../../../utils/requisition-asset.js";
import { SYSTEM_ID } from "../../../system-id.js";
import { withCardLatch } from "../../../utils/card-latch.js";
import { promptRoll } from "../../../dialogs/RollDialog.js";
import { STEADING_MOVE, improvementQuestions } from "../../steading/improvement-rolls.js";
import { settleSteadingRoll } from "../../steading/steading-roll.js";
import { askedAdvantageAnswers, herdCountAnswer } from "../../steading/improvement-rolls.js";
import { ownLogisticsNames } from "../logistics.js";

/**
 * The player-facing Requisition move. Lists the linked steading's on-hand assets
 * and lets the character roll +Fortunes and "take" one for an expedition. Taking
 * an asset adds it to the character's items list and marks it out (unchecked, with
 * a "taken by" note) on the steading's Assets list. Returning it is done from the
 * steading sheet by clicking the greyed-out asset.
 */
export class RequisitionDialog extends StonetopDialog {
	/**
	 * @param {object} stonetopCharacter - StonetopCharacter wrapper (for inventory writes)
	 * @param {Actor}  characterActor     - The character Actor document (for name/id)
	 * @param {Actor}  steadingActor      - The linked steading Actor document
	 * @param {Function} [onChange]       - Called after a successful take, to refresh sheets
	 */
	constructor(stonetopCharacter, characterActor, steadingActor, onChange, options = {}) {
		super(options);
		this._character = stonetopCharacter;
		this._characterActor = characterActor;
		this._steadingActor = steadingActor;
		this._steading = new StonetopSteading(steadingActor);
		this._onChange = onChange;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-requisition",
			title: "Requisition",
			template: "systems/stonetop-pwd/templates/dialogs/requisition-picker.hbs",
			width: 540,
			height: "auto",
			resizable: true,
			classes: ["stonetop", "stonetop-requisition"],
		});
	}

	getData() {
		const assets = this._steading._flags.assets ?? [];
		// Worded where the steading's own Requisition words them. Logistics is asked for THIS
		// character only, and ticked: this window knows who is Requisitioning.
		const herdBuilt = this._steading.improvementCompleted("herdOfHorses");
		const questions = improvementQuestions(STEADING_MOVE.REQUISITION, "fortunes", {
			rules: this._steading.improvementRules(),
			logistics: ownLogisticsNames(this._characterActor),
			herd: herdBuilt ? this._steading.getHerd() : null,
		});
		const herdAsk = questions.find(q => q.name === "herdCount");
		return {
			steadingName: this._steadingActor.name,
			fortunes: sign(this._steading.getStatValue("fortunes")),
			assets: this._steading.getAvailableAssets(),
			customAssetValue: CUSTOM_ASSET_VALUE,
			// The Herd of Horses question: how many horses, read against the herd for its "half the
			// herd or less" and offered again as the take's default.
			herdQuestion: herdAsk ? { label: herdAsk.label, max: herdAsk.max ?? 0 } : null,
			// The Marshal's Logistics: advantage when you Requisition.
			logistics: questions.find(q => q.name === "logistics")?.label ?? "",
			// An improvement's asked advantage on Requisition (a `rollAdvantage` grant with an `ask`),
			// unticked: the table says whether the fiction reached for it.
			advantageAsks: questions.filter(q => q.name.startsWith("advantage-")).map(({ name, label }) => ({ name, label })),
			// "Already out" reads through the shared wording, so an asset a GM sent out on an
			// expedition names the trip here rather than reporting "Taken by someone".
			takenAssets: assets
				.filter(asset => asset.name && asset.takenBy)
				.map(asset => ({ name: asset.name, where: assetTakenLabel(asset) })),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		const assetSelect = root.querySelector(".stonetop-requisition-asset-select");
		const customInput = root.querySelector(".stonetop-requisition-custom-input");
		const takeButton = root.querySelector(".stonetop-requisition-take");

		wireCustomAssetSelect({ select: assetSelect, customInput });

		// How this one is rolled is asked here, ahead of the roll — see RollDialog.js, which
		// decides for itself whether it has anything to ask. Cancelling rolls nothing. When it
		// does not ask for a mode the steading sheet's own sticky Roll Modifier flag answers
		// instead, which is what that control is still there for. Settled as every steading roll
		// is (actors/steading/steading-roll.js): a held +Fortunes advantage is spent here too, by
		// a player who can write the steading.
		root.querySelector(".stonetop-requisition-roll-btn")?.addEventListener("click", async ev => {
			const prompted = await promptRoll({ title: "Requisition", shiftKey: ev.shiftKey });
			if (!prompted) return;
			const terms = await settleSteadingRoll(this._steading, {
				moveName: STEADING_MOVE.REQUISITION, statKey: "fortunes",
				chosenMode: prompted.rollMode ?? this._steadingActor.getFlag(SYSTEM_ID, "rollMode"),
				answers: this._rollAnswers(root),
				canSpend: !!this._steadingActor.isOwner,
			});
			await terms.spend();
			const answers = this._rollAnswers(root);
			const roll = await rollStat("fortunes", this._steadingActor, {
				...(terms.missAsPartial ? { missCountsAsPartial: terms.missAsPartial } : {}),
				...(terms.conditionNotes.length ? { conditionNotes: terms.conditionNotes } : {}),
				moveName: "Requisition",
				statValue: this._steading.getStatValue("fortunes"),
				rollMode: terms.rollMode,
				// The steading rolls carry no forward/ongoing, so the prompt's one-off IS the
				// whole modifier here — the engine reads it back out as the Situational pill.
				modifier: prompted.situational,
				// "On a 6-, don't mark XP--you can take the asset with you, but if you do, reduce
				// Fortunes by 1" (p.308): the cost on the card, for whoever can write the steading.
				tierActions: { failure: requisitionMissCostAction() },
			});
			// What the Take below reads: the card (its tier read live, so a GM's Shift counts) and the
			// herd count the roll was made for.
			this._lastRoll = { message: messageOfRoll(roll), herdCount: answers.herdCount };
		});

		takeButton?.addEventListener("click", async () => {
			if (takeButton.disabled) return;
			const choice = this._getChosenAsset(root);
			if (!choice.name) {
				ui.notifications.warn("Choose or enter an asset to requisition.");
				return;
			}
			takeButton.disabled = true;

			// Taken on a 6-: asked first, paid only once something was actually taken. A horse count
			// closed, or an asset another window took meanwhile, costs nothing.
			let taken = false;
			try {
				taken = await this._payMissOnTake(choice.name, {
					// The herd is not lent out whole: so many horses leave it (askHorsesFromHerd).
					take: () => (choice.asset && isHerdAsset(choice.asset)) ? this._takeFromHerd(root) : this._takeAsset(choice),
				});
			} catch (err) {
				// The take or its 6- payment threw. A payment that throws takes the card's latch back,
				// so the card's own button can still charge it.
				console.warn("Stonetop | Could not finish the Requisition take:", err);
				ui.notifications.warn(`Could not finish taking ${choice.name}. If it was taken on a 6-, the GM can still pay the cost from the roll card's "Take it on a miss" button.`);
				this.render(false);
			}
			// A take re-renders the window; one that took nothing leaves this button to try again.
			if (!taken) takeButton.disabled = false;
		});

		root.querySelector(".stonetop-requisition-close")?.addEventListener("click", () => this.close());
	}

	/**
	 * Take one steading asset (or a typed custom one) into the character's items.
	 *
	 * Marked out on the steading FIRST: an asset another window took meanwhile (or a row deleted
	 * under this one's index) is refused there, and nothing is added. A write the player has no
	 * permission for still lets them take it, as before, with a warning. An item that then cannot
	 * be added hands the asset back, so the steading never says it is out with someone who lacks it.
	 * @returns {Promise<boolean>} whether it was taken
	 */
	async _takeAsset(choice) {
		let denied = false;
		let marked = false;
		if (Number.isInteger(choice.index)) {
			try {
				marked = await this._steading.setAssetTaken(choice.index, {
					name: this._characterActor.name,
					id: this._characterActor.id,
				}, { name: choice.name });
			} catch (err) {
				console.warn("Stonetop | Could not mark asset taken on steading:", err);
				denied = true;
			}
			if (!denied && marked === false) {
				ui.notifications.warn(`${choice.name} is no longer on hand at ${this._steadingActor.name}.`);
				this.render(false);
				return false;
			}
		}

		try {
			await this._character.addCustomInventoryItem(choice.name, 1);
		} catch (err) {
			console.warn("Stonetop | Could not add requisitioned asset to items:", err);
			ui.notifications.warn(`Could not add ${choice.name} to your items.`);
			if (marked) {
				try {
					await this._steading.returnAsset(choice.index);
				} catch (returnErr) {
					console.warn("Stonetop | Could not hand the asset back to the steading:", returnErr);
				}
				this.render(false);
			}
			return false;
		}
		this._maybeOfferAsFollower(choice.asset ?? choice.name);

		if (denied) {
			ui.notifications.warn(
				`${choice.name} added to your items, but you lack permission to update ${this._steadingActor.name}'s assets.`
			);
		} else if (Number.isInteger(choice.index)) {
			ui.notifications.info(`${choice.name} requisitioned from ${this._steadingActor.name}.`);
		} else {
			ui.notifications.info(`${choice.name} added to your items.`);
		}

		this._onChange?.();
		this.render(false);
		return true;
	}

	/** The window's questions, as settleSteadingRoll reads them. */
	_rollAnswers(root) {
		return {
			herdCount: herdCountAnswer(root),
			logistics: !!root.querySelector('[name="logistics"]')?.checked,
			...askedAdvantageAnswers(root),
		};
	}

	/**
	 * A Take after this window's roll came up 6- (read off its card, so a GM's Shift counts): "you
	 * can take the asset with you, but if you do, reduce Fortunes by 1" (p.308). Asked, then stamped
	 * on the card and paid through Meet with Disaster's floor, so its own button cannot charge it
	 * again. A player who cannot write the steading takes it all the same and is told the card's
	 * button is how the GM pays it. Nothing to ask with no roll, a hit, or a cost already paid.
	 *
	 * Asked BEFORE `take` runs, paid only AFTER it reports something taken: a horse count closed,
	 * or an asset another window took meanwhile, costs nothing.
	 * @param {string} name
	 * @param {{ask?: Function, take?: () => Promise<boolean>}} [opts]
	 * @returns {Promise<boolean>} whether anything was taken
	 */
	async _payMissOnTake(name, { ask = askWithButtons, take = async () => true } = {}) {
		const card = this._lastRoll?.message ?? null;
		if (!card) return take();
		if (cardCountedTier(card, card.rolls?.at?.(0)?.total, SYSTEM_ID) !== "failure") return take();
		if (card.getFlag?.(SYSTEM_ID, REQUISITION_MISS_COST_FLAG)) return take();
		const answer = await ask({
			title: "Taken on a miss",
			content: `<p>The Requisition was a 6-. You can take <strong>${escHtml(name)}</strong> with you, but if you do, reduce Fortunes by 1.</p>`,
			buttons: [
				{ key: "take", label: "Take it: reduce Fortunes by 1", icon: "fa-arrow-down", value: "take" },
				{ key: "leave", label: "Leave it", icon: "fa-xmark", value: null },
			],
		});
		if (answer !== "take") return false;
		if (!(await take())) return false;
		if (!this._steadingActor.isOwner) {
			ui.notifications.warn(`You can't update ${this._steadingActor.name}'s Fortunes: the GM pays it from the roll card's "Take it on a miss" button.`);
			return true;
		}
		// Latched on the card FIRST (card-latch.js#withCardLatch), so a window that could pay but not write
		// the card never leaves the card's button to charge it again; a payment that throws takes the latch
		// back. A card this user cannot write is left to its button, like a steading they cannot write.
		let paying = false;
		let notice = "";
		try {
			await withCardLatch(card, REQUISITION_MISS_COST_FLAG, true, [], async () => {
				paying = true;
				({ notice } = await payRequisitionMissCost(this._steading));
				return true;
			});
		} catch (err) {
			if (paying) throw err;
			console.warn("Stonetop | Could not latch the Requisition card's miss cost:", err);
			ui.notifications.warn(`You can't mark the Requisition card's miss cost paid: the GM pays it from the roll card's "Take it on a miss" button.`);
			return true;
		}
		ui.notifications.info(notice);
		return true;
	}

	/**
	 * Requisition from the Herd of Horses: ask how many, take them out of the tracked herd, and
	 * make each one a follower (ruling: "Ask, take from herd"). The herd's own row is never marked
	 * out: the herd stays home. Nothing is written when the answer is none.
	 *
	 * Never more than the count this window's roll was made for, when it was made for one: that
	 * count is what "half the herd or less, treat a 6- as a 7-9" was read against.
	 * @returns {Promise<boolean>} whether any horses were taken
	 */
	async _takeFromHerd(root) {
		const rolled = Math.trunc(Number(this._lastRoll?.herdCount) || 0);
		const grown = this._steading.herdRequisitionCap();
		const count = await askHorsesFromHerd({
			cap: rolled > 0 ? Math.min(grown, rolled) : grown,
			preset: herdCountAnswer(root),
			who: this._characterActor.name,
		});
		if (!count) return false;
		let taken;
		try {
			taken = await this._steading.requisitionFromHerd(count, { stonetopMove: "Requisition" });
		} catch (err) {
			console.warn("Stonetop | Could not take horses from the herd:", err);
			ui.notifications.warn(`You lack permission to update ${this._steadingActor.name}'s herd.`);
			return false;
		}
		if (!taken) return false;
		const label = herdHorsesLabel(taken);
		try {
			await this._character.addCustomInventoryItem(label, 1);
		} catch (err) {
			console.warn("Stonetop | Could not add requisitioned horses to items:", err);
		}
		const match = beastFollowerForAsset({ name: HERD_ASSET_NAME, beast: HERD_ASSET_BEAST });
		if (match) await this._addRequisitionedFollower({ ...match, count: taken }, "the herd of horses");
		ui.notifications.info(`${label} requisitioned from ${this._steadingActor.name}.`);
		this._onChange?.();
		this.render(false);
		return true;
	}

	_getChosenAsset(root) {
		const select = root.querySelector(".stonetop-requisition-asset-select");
		if (!select) return { name: "" };
		if (select.value === CUSTOM_ASSET_VALUE) {
			return {
				name: root.querySelector(".stonetop-requisition-custom-input")?.value?.trim() ?? "",
			};
		}
		const index = Number(select.value);
		// Resolve the name from the same source the <option> list was built from
		// (getAvailableAssets, which falls back to STEADING_DEFAULTS.assets), not raw
		// _flags.assets — otherwise a default on-hand asset on an un-edited steading has
		// no _flags.assets entry and resolves to "" (headline take path silently no-ops).
		const asset = this._steading.getAvailableAssets().find(a => a.index === index);
		return { index, name: asset?.name?.trim() ?? "", asset };
	}

	// If a just-requisitioned asset names a follower-capable animal, offer to add it
	// to the character's Followers tab with the handout's stats (Book I p.474). A pure
	// convenience; declining just leaves it as the plain inventory item already added.
	// Takes the steading's asset row (whose `beast` field, when it has one, says exactly what
	// it is) or a typed custom asset's name.
	_maybeOfferAsFollower(asset) {
		const match = beastFollowerForAsset(asset);
		const assetName = typeof asset === "object" && asset ? asset.name : asset;
		if (!match) return;
		const beast = match.beast;
		const count = match.count ?? 1;
		const what  = count > 1 ? `them to your <strong>Followers</strong> tab as ${count} followers` : `it to your <strong>Followers</strong> tab as a follower`;
		new Dialog({
			title:   count > 1 ? "Add as followers?" : "Add as a follower?",
			content: `<p>You requisitioned <strong>${escHtml(assetName)}</strong>. Also add ${what} (<em>${escHtml(beast.name)}</em> - HP ${beast.hp}${count > 1 ? " each" : ""}, Cost ${escHtml(beast.cost)})?</p>`,
			buttons: {
				yes: { icon: '<i class="fas fa-dog"></i>', label: count > 1 ? `Add ${count} followers` : "Add as follower",
					callback: () => this._addRequisitionedFollower(match, assetName) },
				no:  { label: "No, just the item" },
			},
			default: "yes",
			render:  bringDialogToFront,
			options: { classes: ["dialog", "stonetop"] },
		}).render(true);
	}

	async _addRequisitionedFollower(match, assetName) {
		const input = followerInputFromBeast(match.beast, { name: match.beast.name, chosenTraits: match.chosenTraits });
		if (!input) return;
		const existing = this._characterActor.getFlag(SYSTEM_ID, "customFollowers") ?? {};
		// Keep the beast's own note (a tag choice still open) beside where it came from.
		// Name the asset only: the seeded line trails a stat block after a dash ("A pair of
		// hardy draft horses - HP 10 each; ...") that the follower card already shows.
		const notes = [`Requisitioned from ${assetLabel(assetName)}.`, input.notes].filter(Boolean).join(" ");
		// One card per animal ("a pair" is two horses), numbered so they can be told apart,
		// all in one write and in order after the followers already on the tab.
		const count = match.count ?? 1;
		const order = nextFollowerOrder(existing);
		const names  = Array.from({ length: count }, (_, i) => count > 1 ? `${input.name} ${i + 1}` : input.name);
		const update = {};
		names.forEach((name, i) => {
			update[`flags.stonetop-pwd.customFollowers.${foundry.utils.randomID(16)}`] = {
				...buildCustomFollower({ ...input, name, notes }),
				order: order + i,
			};
		});
		await this._characterActor.update(update);
		ui.notifications?.info?.(`${joinNames(names)} added to your followers.`);
		this._onChange?.();
	}
}
