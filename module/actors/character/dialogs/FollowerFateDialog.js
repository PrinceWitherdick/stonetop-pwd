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
// `ctx.isGroupMember` the same for a custom group's roster (and its shared Loyalty). For the crew, `sir.presence`
// (Front Line Leader's Presence) adds the same spare paid with Presence instead ("sparePresence").
//
// AFTER A DEATH'S DOOR 6- (`ctx.door`): the follower "would die", so the same Dead and the same spare are
// offered from the card's "Mark dead" (follower-deaths-door.js), and nothing else: Death's Door and Dying
// are behind them. `ctx.onDismiss` is called when the window closes with nothing chosen, so the card can
// give its button back.
//
// WHICH WINDOW is one `ctx.variant` (VARIANTS below); a caller still passing the older flags (`gmPick`,
// `gmDead`, `door`, `isAnimalCompanion`) gets the variant they add up to (fateVariant).

const FATE = "stonetop.character.followers.fate";
const DOOR = "stonetop.character.followers.door";

/**
 * Each window's wording and what it offers. `full`: Death's Door and Dying beside Dead; `sir`: the Marshal's
 * spare and let-go box may be offered; `note` is joined from its keys; `closeDies`: closing it is the Dead it
 * answers (the GM's Dead, whose only way out was the player's).
 */
export const VARIANTS = Object.freeze({
	// The player's own pick, with no GM connected (or a GM picking on their own client).
	pick:   { sub: `${FATE}.pickSub`, note: [`${FATE}.notLethalNote`], close: `${FATE}.notLethalClose`, full: true, sir: true, deathsDoor: `${FATE}.deathsDoorDesc` },
	// THE GM'S PICK (follower-fate-pick.js): Death's Door, Dying or Dead and nothing of the player's.
	gmPick: { sub: `${FATE}.gmPickSub`, note: [`${FATE}.gmPickNote`, `${FATE}.notLethalNote`], close: `${FATE}.notLethalClose`, full: true, sir: false, deathsDoor: `${FATE}.gmDeathsDoorDesc` },
	// A Death's Door 6-: Dead and the spare only, worded for the roll behind them.
	door:   { sub: `${DOOR}.fateSub`, note: [`${DOOR}.fateNote`], close: `${DOOR}.fateLater`, full: false, sir: true },
	// The GM picked Dead: the player's Sir, Permission to Die, Sir, and closing lets them die.
	gmDead: { sub: `${FATE}.gmDeadSub`, note: [`${FATE}.gmDeadNote`], close: `${FATE}.gmDeadClose`, full: false, sir: true, closeDies: true },
	// The Ranger's companion: Loyal to the End replaces the choice (p.143).
	loyal:  { sub: `${FATE}.loyalSub`, note: [`${FATE}.notLethalNote`], close: `${FATE}.notLethalClose`, full: false, sir: true, roll: true },
});

/**
 * The window a fate dialog's `ctx` asks for: its `variant` when it names one, else the one the older flags add
 * up to, the GM's pick first and the companion's move before either door. PURE.
 */
export function fateVariant(ctx = {}) {
	if (Object.hasOwn(VARIANTS, ctx?.variant ?? "")) return ctx.variant;
	if (ctx?.gmPick) return "gmPick";
	if (ctx?.isAnimalCompanion) return "loyal";
	if (ctx?.gmDead) return "gmDead";
	return ctx?.door ? "door" : "pick";
}

export class FollowerFateDialog extends StonetopDialog {
	/**
	 * @param {Actor}    actor
	 * @param {object}   ctx      - { variant, name, loyalty, isCrewMember, isGroupMember, sir, onDismiss }, or the
	 *   older { gmPick, gmDead, door, isAnimalCompanion } in place of `variant`
	 * @param {Function} onChoose - (actionKey, { letGo }) => void
	 */
	constructor(actor, ctx, onChoose, options = {}) {
		super(options);
		this._actor       = actor;
		this._ctx         = ctx ?? {};
		this._variant     = fateVariant(this._ctx);
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
		const variant = this._variant;
		const v = VARIANTS[variant];
		const loyalty = Math.max(0, Number(this._ctx.loyalty) || 0);
		const loyalToTheEnd = !!v.roll;
		// A custom GROUP's member: struck off that group's roster, spending the group's Loyalty.
		const roster = this._ctx.isCrewMember ? "crew" : this._ctx.isGroupMember ? "group" : "";
		const sir = v.sir ? (this._ctx.sir ?? {}) : {};
		const presence = Math.max(0, Number(sir.presence) || 0);
		const i18n = game.i18n;
		return {
			variant,
			followerName: this._ctx.name || "Your follower",
			sub:          i18n.localize(v.sub),
			note:         v.note.map(key => i18n.localize(key)).join(" "),
			closeLabel:   i18n.localize(v.close),
			loyalToTheEnd,
			// The roll is +0 but gets advantage while the companion still holds Loyalty.
			hasLoyalty:   loyalToTheEnd && loyalty > 0,
			loyalty,
			// Death's Door and Dying beside Dead; after a Death's Door 6- or the GM's Dead only Dead is left.
			full:         v.full,
			deathsDoorDesc: v.deathsDoor ? i18n.localize(v.deathsDoor) : "",
			deadDesc:     roster ? i18n.localize(`${FATE}.${roster}DeadDesc`) : "Dead, immediately.",
			// SIR, PERMISSION TO DIE, SIR: the spend needs Loyalty to spend; the XP box needs only the move.
			canSpare:     !!sir.canSpare && loyalty > 0,
			spareLabel:   i18n.localize(`${FATE}.spareLabel`),
			spareDesc:    i18n.format(`${FATE}.${roster === "crew" ? "spareCrewDesc" : roster === "group" ? "spareGroupDesc" : "spareDesc"}`, { loyalty }),
			// Front Line Leader: the same spare paid with the Marshal's Presence, for the crew (follower-fate.js).
			canSparePresence: presence > 0,
			sparePresenceLabel: i18n.localize(`${FATE}.sparePresenceLabel`),
			sparePresenceDesc:  i18n.format(`${FATE}.sparePresenceDesc`, { presence }),
			// Only Dead reads the box, and Loyal to the End's set has no Dead to choose.
			letGo:        !!sir.letGo && !loyalToTheEnd,
			letGoLabel:   i18n.localize(`${FATE}.letGo`),
		};
	}

	/**
	 * Closed with nothing chosen: say so (ctx.onDismiss), once. Except after the GM's Dead (`gmDead`): the death
	 * was the GM's call and only the Marshal's way out of it was the player's, so closing lets them die, with the
	 * let-go box as it stands. Only a close someone meant for THIS window does that: Escape closes every open window
	 * at once (core passes `closeKey`), so it leaves this one standing rather than writing a death nobody chose here.
	 */
	async close(options = {}) {
		if (!this._chosen && !this._dismissed && options?.closeKey && VARIANTS[this._variant].closeDies) return;
		if (!this._chosen && !this._dismissed) {
			this._dismissed = true;
			if (VARIANTS[this._variant].closeDies) {
				const letGo = !!this.element?.find?.(".stonetop-ff-let-go")?.prop?.("checked");
				this._chosen = true;
				this._onChoose?.("dead", { letGo });
			} else {
				this._ctx.onDismiss?.();
			}
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
