import { StonetopDialog } from "../../../utils/stonetop-dialog.js";

// ── FollowerFateDialog ───────────────────────────────────────────────────────
// A follower has dropped to 0 HP. Two distinct cases:
//   • The Ranger's animal companion is the exception (Book I p.469 → Loyal to the
//     End, p.143): roll +0 — with advantage if it holds Loyalty — to learn its fate
//     (10+ fine once it heals; 7-9 takes the injured tag; 6- injured and dying unless
//     saved). This REPLACES the usual choice; it is the companion's move and no other
//     follower gets it.
//   • Every other follower (crew, initiates, beasts, custom — even loyal ones) uses
//     the standard p.469 fate, the GM's call: dead / Death's Door / dying (or just out
//     of the action if the blow wasn't lethal — close the dialog).
//
// Opened automatically when a follower's HP row (animal companion / initiate / beast /
// custom, or one member of the crew's or a custom group's roster) crosses from alive to 0 HP.
// `ctx.isAnimalCompanion` selects which set of options to show. Emits the chosen outcome
// key; the sheet applies the effect (loyalty spend / XP / chat note): see
// StonetopCharacterSheet._resolveFollowerFate.
//
// SIR, PERMISSION TO DIE, SIR (Marshal) rides on either set: `ctx.sir` (follower-fate.js
// #sirPermissionOffer) adds a "spend 1 Loyalty, they survive" option while it is learned
// and Loyalty is held, and a pre-ticked "you let them go, mark XP" box that the Dead
// outcome reads. `ctx.isCrewMember` words Dead as striking them off the roster, and
// `ctx.isGroupMember` the same for a custom group's roster (and its shared Loyalty).
//
// AFTER A DEATH'S DOOR 6- (`ctx.door`): the follower "would die", so the same Dead and the same spare are
// offered from the card's "Mark dead" (follower-deaths-door.js), and nothing else: Death's Door and Dying
// are behind them. `ctx.onDismiss` is called when the window closes with nothing chosen, so the card can
// give its button back.

export class FollowerFateDialog extends StonetopDialog {
	/**
	 * @param {Actor}    actor
	 * @param {object}   ctx      - { name, loyalty, isAnimalCompanion, isCrewMember, isGroupMember, sir }
	 * @param {Function} onChoose - (actionKey, { letGo }) => void
	 */
	constructor(actor, ctx, onChoose, options = {}) {
		super(options);
		this._actor       = actor;
		this._ctx         = ctx ?? {};
		this._onChoose    = onChoose;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-follower-fate",
			title:     "Follower Down",
			template:  "systems/stonetop-pwd/templates/dialogs/follower-fate.hbs",
			width:     460,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-follower-fate-dialog"],
		});
	}

	get _autoHeight() { return true; }

	getData() {
		const loyalty = Math.max(0, Number(this._ctx.loyalty) || 0);
		// Loyal to the End is the Ranger's animal-companion move and replaces the usual
		// fate choice for it; every other follower gets the standard p.469 options.
		const loyalToTheEnd = !!this._ctx.isAnimalCompanion;
		const isCrewMember  = !!this._ctx.isCrewMember;
		// A custom GROUP's member: struck off that group's roster, spending the group's Loyalty.
		const roster = isCrewMember ? "crew" : this._ctx.isGroupMember ? "group" : "";
		const sir = this._ctx.sir ?? {};
		const i18n = game.i18n;
		return {
			followerName: this._ctx.name || "Your follower",
			loyalToTheEnd,
			// The roll is +0 but gets advantage while the companion still holds Loyalty.
			hasLoyalty:   loyalToTheEnd && loyalty > 0,
			loyalty,
			deadDesc:     roster ? i18n.localize(`stonetop.character.followers.fate.${roster}DeadDesc`) : "Dead, immediately.",
			// SIR, PERMISSION TO DIE, SIR: the spend needs Loyalty to spend; the XP box needs only the move.
			canSpare:     !!sir.canSpare && loyalty > 0,
			spareLabel:   i18n.localize("stonetop.character.followers.fate.spareLabel"),
			spareDesc:    i18n.format(`stonetop.character.followers.fate.${roster === "crew" ? "spareCrewDesc" : roster === "group" ? "spareGroupDesc" : "spareDesc"}`, { loyalty }),
			// Only Dead reads the box, and Loyal to the End's set has no Dead to choose.
			letGo:        !!sir.letGo && !loyalToTheEnd,
			letGoLabel:   i18n.localize("stonetop.character.followers.fate.letGo"),
			// A Death's Door 6-: Dead and the spare only, worded for the roll behind them.
			door:         !!this._ctx.door && !loyalToTheEnd,
			doorSub:      i18n.localize("stonetop.character.followers.door.fateSub"),
			doorNote:     i18n.localize("stonetop.character.followers.door.fateNote"),
			doorLater:    i18n.localize("stonetop.character.followers.door.fateLater"),
		};
	}

	/** Closed with nothing chosen: say so (ctx.onDismiss), once. */
	async close(options) {
		if (!this._chosen && !this._dismissed) {
			this._dismissed = true;
			this._ctx.onDismiss?.();
		}
		return super.close(options);
	}

	activateListeners(html) {
		super.activateListeners(html);
		html.find(".stonetop-ff-option").on("click", ev => {
			const action = ev.currentTarget.dataset.action;
			// Read at the click: the box is the player's to untick before choosing Dead.
			const letGo = !!html.find(".stonetop-ff-let-go").prop("checked");
			this._chosen = true;
			this._onChoose?.(action, { letGo });
			this.close();
		});
		html.find(".stonetop-ff-cancel").on("click", () => this.close());
	}
}
