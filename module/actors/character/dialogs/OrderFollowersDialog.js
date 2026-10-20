import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { orderFollowersBonus, orderFollowersModeSources, ORDER_FOLLOWER_MOVES } from "../../../data/follower-build.js";
import { sign } from "../../../utils/roll-engine.js";
import { commandHeld } from "../../../fight/hero-moves.js";

// ── OrderFollowersDialog ─────────────────────────────────────────────────────
// Direct a follower to make a move (Book I, NPCs & Followers p.462: "Order
// Followers"). A follower doesn't roll +STAT — it rolls 2d6 plus a bonus the
// player resolves from the follower's tags and moves: +1 if any apply, +2 if it's
// also exceptional, +0 if none; with disadvantage if a tag would get in the way.
//
// Since "which tags apply / get in the way" is a table judgment call, this modal
// lists them as chips and computes the bonus live (orderFollowersBonus). Tags are
// tri-state (helps / in the way / neither); moves are two-state, because the book
// counts a move toward the bonus ("at least one appropriate tag or move") but only
// lets a *tag* impose disadvantage.
//
// Advantage and disadvantage also get their own pair of toggles, for the sources
// that don't come from the follower: Stentorian or an Aid on the one side,
// Interfere ("disadvantage on their next roll — even if that roll is unrelated",
// p.329) or a GM move on the other. They cancel rather than override, per the
// ADVANTAGE/DISADVANTAGE special move (p.230).
//
// A GROUP can be ordered whole or one member at a time. It usually acts as one
// ("the player rolls once, applying bonuses (and/or disadvantage) based on the tags
// shared by the group", p.470), but "when a PC directs an individual member of a
// group, they can trigger moves as if they were a follower themselves. The group's
// tags and moves apply, plus any unique tags or moves they have as an individual"
// (p.471). So when the caller hands over the group's `members`, a Who row picks
// between them: the whole group on its shared tags, or one member on the group's
// tags plus their own, under their own name. That is how Glaw Lets Fly while the
// rest of the crew Clashes: two orders, two rolls.
//
// SHIELD WALL (the Marshal): "When you have your crew form a shield wall, they Defend with advantage
// and on a 7+ they hold +2 Readiness (instead of the usual +1 for shields)." Whether they HAVE formed
// one is the fiction's, so a crew ordered to Defend by a Marshal with the move gets its own box, ticked,
// naming the move; unticked, it is an ordinary Defend. Its own box rather than the Advantage toggle, so
// the card and the readout can say where the advantage came from.
//
// STENTORIAN (the Marshal, Book I p.127): "Spend 1 Command to shout an order or warning and pick 1: ...
// You have advantage to Order Followers or Deploy." A Marshal holding Command gets a box of its own,
// UNTICKED (spending is their choice), that is advantage and names the move; the Command comes off once the
// dice land (StonetopCharacter#onOrderFollowersRoll, `command`).
//
// Hands { bonus, rollMode, moveName, moveKey, followerName, member, shieldWall, command } back to the
// caller (which calls StonetopCharacter.onOrderFollowersRoll). `member` is the
// picked member's key, or null for the whole group or a follower who is one person.

// THEY BALK (p.466-467). Followers "might resist orders if ... the order goes against the follower's
// instinct, tags, cost, or other traits", or freeze when scared; the GM says so, and the player can
// "spend 1 Loyalty" (p.464) to have them do it anyway, or Persuade them. So the window shows their
// instinct, cost and Loyalty beside the chips, and a box that spends the Loyalty with the order:
// `loyalty` is what they hold (null for a follower with no track), `spendLoyalty` comes back ticked.
//
// FRONT LINE LEADER (the Marshal, p.126): "Spend Presence in lieu of your crew's Loyalty". For the crew,
// `presence` is what the Marshal holds (actors/character/front-line-presence.js#presenceFor, 0 for anyone
// else): the balk is offered on it alone at 0 Loyalty, and beside Loyalty as a "pay with Presence instead"
// box, and `payWithPresence` comes back with `spendLoyalty` when it is the purse.

// The basic moves a follower can be ordered to trigger (data/follower-build.js). "Custom" reveals a
// free-text header for anything else.
const _ORDER_MOVES = ORDER_FOLLOWER_MOVES;

export class OrderFollowersDialog extends StonetopDialog {
	/**
	 * @param {Actor}    actor
	 * @param {object}   follower  - { name, tags: string[], moves: string[], exceptional: bool,
	 *   members?: Array<{key, name, tags: string[]}>, hinderingTags?: string[], instinct?: string,
	 *   cost?: string, loyalty?: ?number }: `members` only for a group ordered as a whole, each with
	 *   their OWN tags (utils/crew.js#groupFollowerMembers); `hinderingTags` start marked in the way;
	 *   `loyalty` is what they hold, or null with no track
	 * @param {Function} onRoll    - async ({ bonus, rollMode, moveName, moveKey, followerName, member }) => void
	 */
	constructor(actor, follower, onRoll, options = {}) {
		super(options);
		this._actor     = actor;
		this._follower  = follower ?? {};
		this._onRoll    = onRoll;
		// Who is being ordered: "" for the whole group (or a follower who is one person), else
		// the key of one of `members`.
		this._who       = "";

		// Optionally start on a specific move (a group's Clash / Let Fly buttons),
		// else the rulebook's default of Defy Danger.
		this._moveKey    = _ORDER_MOVES.some(m => m.key === this._follower.moveKey)
			? this._follower.moveKey
			: "defy-danger";
		this._customMove = "";
		// Per-tag state: "help" | "hinder" | "" (neither). Keyed by tag string. A tag the caller
		// names in `hinderingTags` (an animal companion's "injured") starts in the way; a click
		// still cycles it, the call being the table's.
		this._tagState   = {};
		for (const tag of this._follower.hinderingTags ?? []) if (tag) this._tagState[tag] = "hinder";
		// Per-move state: "help" | "" only — a move can earn the bonus but can't
		// impose disadvantage (p.462 says "if any of their *tags* would get in the
		// way"). Kept in its own map so a move whose text happens to match a tag
		// doesn't share that tag's state.
		this._moveState   = {};
		this._advantage    = false;
		this._disadvantage = false;
		// Formed up in a shield wall: only asked when `follower.shieldWall` offers it and they Defend.
		this._inWall       = true;
		// Spending 1 Command on Stentorian's advantage: only asked while the Marshal holds some.
		this._command      = false;
		// They balked and 1 Loyalty is spent so they do it anyway (p.464, p.466): only while they hold some.
		this._spendLoyalty = false;
		// Paying that balk with Front Line Leader's Presence instead: only while the crew's Marshal holds some.
		this._payWithPresence = false;
	}

	/** The Presence that may pay a balk in Loyalty's place: the crew's Marshal's, else none. */
	_presence() {
		return Math.max(0, Math.trunc(Number(this._follower.presence) || 0));
	}

	/** Whether a balk can be paid at all: Loyalty held, or Presence to pay in its place. */
	_canBalk() {
		return (this._loyalty() ?? 0) > 0 || this._presence() > 0;
	}

	/** Whether a ticked balk is paid with Presence: asked for, or the only purse holding any. */
	_balkPaidWithPresence() {
		if (this._presence() <= 0) return false;
		return this._payWithPresence || (this._loyalty() ?? 0) <= 0;
	}

	/** The Loyalty they hold, or null for a follower with no track (livestock never get here). */
	_loyalty() {
		const held = this._follower.loyalty;
		return held == null ? null : Math.max(0, Math.trunc(Number(held) || 0));
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-order-followers",
			title:     "Order Followers",
			template:  "systems/stonetop-pwd/templates/dialogs/order-followers.hbs",
			width:     460,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-order-followers-dialog"],
		});
	}

	get _autoHeight() { return true; }

	/** The group's members on offer, or none for a follower who is one person. */
	_members() {
		return Array.isArray(this._follower.members) ? this._follower.members : [];
	}

	/** The member being ordered, or null when it is the whole group (or a follower who is one person). */
	_member() {
		return this._who ? (this._members().find(m => m.key === this._who) ?? null) : null;
	}

	/** Whose name the order goes out under: the member picked, else the follower's own. */
	_name() {
		return this._member()?.name || this._follower.name || "";
	}

	/** A picked member's own tags: theirs and not the group's, since a tag both have is the group's. */
	_ownTags() {
		const shared = this._follower.tags ?? [];
		return (this._member()?.tags ?? []).filter(tag => !shared.includes(tag));
	}

	/** The tags on offer: the follower's, and a picked member's own after them (p.471), each shown once. */
	_tags() {
		return [...(this._follower.tags ?? []), ...this._ownTags()];
	}

	/**
	 * The states of the tags ON SCREEN. A member's own tag keeps whatever the table said about it,
	 * so switching back to them brings it back — but it must stop counting while someone else is
	 * picked, or the whole group would roll on a tag only one of them has.
	 */
	_shownTagStates() {
		return this._tags().map(tag => this._tagState[tag] ?? "");
	}

	/** Whether this order is a Defend by a crew whose Marshal has Shield Wall, i.e. the box is shown. */
	_offersWall() {
		return !!this._follower.shieldWall && this._moveKey === "defend";
	}

	/** Whether Shield Wall's advantage is on this roll: offered, and still ticked. */
	_wallAdvantage() {
		return this._offersWall() && this._inWall;
	}

	/** How much Command the Marshal holds on Stentorian's track (0 without the move learned). */
	_commandHeld() {
		return commandHeld(this._actor);
	}

	/** Whether Stentorian's advantage is on this roll: Command held, and its box ticked. */
	_commandAdvantage() {
		return this._command && this._commandHeld() > 0;
	}

	/** Advantage from any source: the player's toggle, Shield Wall, or Command spent. */
	_hasAdvantage() {
		return this._advantage || this._wallAdvantage() || this._commandAdvantage();
	}

	// Live tallies the player's chip picks into the Order Followers result. Moves
	// count toward `helps` alongside tags; only tags can feed `hinders`.
	_result() {
		const tagStates = this._shownTagStates();
		const helps   = tagStates.filter(s => s === "help").length
			+ Object.values(this._moveState).filter(s => s === "help").length;
		const hinders = tagStates.filter(s => s === "hinder").length;
		const inputs = {
			helps, hinders,
			exceptional:  !!this._follower.exceptional,
			advantage:    this._hasAdvantage(),
			disadvantage: this._disadvantage,
		};
		// The sides that spoke ride along with the mode they net to, so the roll can lay one more on them.
		return { ...orderFollowersBonus(inputs), modeSources: orderFollowersModeSources(inputs) };
	}

	// Whether a tag the player marked "in the way" is imposing disadvantage on its
	// own — the dialog says so, rather than silently ticking the toggle for them.
	_tagsHinder() {
		return this._shownTagStates().some(s => s === "hinder");
	}

	_moveLabel() {
		if (this._moveKey === "custom") return this._customMove.trim() || "act";
		return _ORDER_MOVES.find(m => m.key === this._moveKey)?.label ?? "act";
	}

	getData() {
		const { bonus, rollMode } = this._result();
		const signedBonus = sign(bonus);
		const readoutNote = rollMode === "dis" ? ", with disadvantage"
			: rollMode === "adv" ? ", with advantage" : "";
		const dice = rollMode === "dis" ? "3d6 (keep lowest 2)"
			: rollMode === "adv" ? "3d6 (keep highest 2)" : "2d6";
		// One line under the toggles explaining why the readout says what it says —
		// the cancellation especially, which otherwise looks like the ticked boxes
		// were ignored.
		const tagsHinder = this._tagsHinder();
		const modeNote = (this._hasAdvantage()) && (tagsHinder || this._disadvantage)
			? "Advantage and disadvantage cancel out: rolling straight (p.230)."
			: tagsHinder ? "A tag in the way is already imposing disadvantage."
			: "";
		// The Who row, for a group: the whole of it first (how a group usually acts, p.470), then
		// each member still standing, with their own tags beside their name to pick them by.
		const members = this._members();
		const group = this._follower.name || "the group";
		const who = members.length ? [
			{ key: "", label: `All of ${group}, acting as one`, selected: !this._who },
			...members.map(m => ({
				key:      m.key,
				label:    m.tags?.length ? `${m.name} (${m.tags.join(", ")})` : m.name,
				selected: m.key === this._who,
			})),
		] : null;
		// Said in words under the chips, since a chip that appears when a name is picked
		// otherwise gives no sign of whose it is.
		const member = this._member();
		const ownTags = this._ownTags();
		const ownNote = member && ownTags.length
			? `${member.name}'s own: ${ownTags.join(", ")}. The rest are ${group}'s.`
			: "";
		return {
			followerName: this._name() || "your follower",
			who,
			ownNote,
			exceptional:  !!this._follower.exceptional,
			// The crew's Heroes to the Last "inured to terror & horror", noted by the balk (the caller's words).
			inuredNote:   String(this._follower.inuredNote ?? "").trim(),
			moves:        _ORDER_MOVES.map(m => ({ ...m, selected: m.key === this._moveKey })),
			isCustom:     this._moveKey === "custom",
			customMove:   this._customMove,
			tags: this._tags().map(tag => ({
				tag,
				help:    this._tagState[tag] === "help",
				hinder:  this._tagState[tag] === "hinder",
				neither: !this._tagState[tag],
			})),
			// The follower's own moves, which count toward the +1/+2 just like a tag
			// ("at least one appropriate tag or move", p.462).
			followerMoves: (this._follower.moves ?? []).map(move => ({
				move,
				help: this._moveState[move] === "help",
			})),
			advantage:    this._advantage,
			disadvantage: this._disadvantage,
			shieldWall:   this._offersWall(),
			inWall:       this._inWall,
			commandHeld:  this._commandHeld(),
			spendCommand: this._command,
			instinct:     String(this._follower.instinct ?? "").trim(),
			cost:         String(this._follower.cost ?? "").trim(),
			loyalty:      this._loyalty(),
			hasLoyalty:   this._loyalty() != null,
			canBalk:      this._canBalk(),
			spendLoyalty: this._spendLoyalty && this._canBalk(),
			presence:     this._presence(),
			// At 0 Loyalty the balk is paid in Presence outright; beside Loyalty, it is a box of its own.
			balkOnPresence: this._presence() > 0 && (this._loyalty() ?? 0) <= 0,
			presenceChoice: this._presence() > 0 && (this._loyalty() ?? 0) > 0,
			payWithPresence: this._payWithPresence,
			modeNote,
			readout:      `Roll ${dice} ${signedBonus}${readoutNote}`,
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		html.find(".stonetop-of-who").on("change", ev => {
			this._who = ev.currentTarget.value;
			this.render(false);
		});
		html.find(".stonetop-of-move").on("change", ev => {
			this._moveKey = ev.currentTarget.value;
			this.render(false);
		});
		html.find(".stonetop-of-custom").on("change", ev => { this._customMove = ev.currentTarget.value; });

		// Tri-state tag chip: cycles neither → helps → hinders → neither.
		//
		// Matched on the ATTRIBUTE this reads, not on the class alone: a move chip wears
		// `stonetop-of-tag` too (it takes the same styling) and carries `data-move` instead, so the
		// bare class selector ran this handler on it as well. Both handlers fired on one click,
		// cycling a phantom `_tagState[undefined]` — two clicks on move chips put it on "hinder",
		// and the roll went out with disadvantage and a note claiming a tag was in the way while no
		// tag chip was marked at all.
		html.find(".stonetop-of-tag[data-tag]").on("click", ev => {
			const tag = ev.currentTarget.dataset.tag;
			const cur = this._tagState[tag] ?? "";
			this._tagState[tag] = cur === "" ? "help" : cur === "help" ? "hinder" : "";
			this.render(false);
		});

		// Two-state move chip: a move can apply, but can't get in the way.
		html.find(".stonetop-of-move-chip").on("click", ev => {
			const move = ev.currentTarget.dataset.move;
			this._moveState[move] = this._moveState[move] === "help" ? "" : "help";
			this.render(false);
		});

		html.find(".stonetop-of-adv").on("change", ev => { this._advantage    = ev.currentTarget.checked; this.render(false); });
		html.find(".stonetop-of-wall").on("change", ev => { this._inWall      = ev.currentTarget.checked; this.render(false); });
		html.find(".stonetop-of-command").on("change", ev => { this._command  = ev.currentTarget.checked; this.render(false); });
		html.find(".stonetop-of-dis").on("change", ev => { this._disadvantage = ev.currentTarget.checked; this.render(false); });
		html.find(".stonetop-of-balk").on("change", ev => { this._spendLoyalty = ev.currentTarget.checked; });
		html.find(".stonetop-of-balk-presence").on("change", ev => { this._payWithPresence = ev.currentTarget.checked; });

		html.find(".stonetop-of-roll").on("click", () => this._finish());
		html.find(".stonetop-of-cancel").on("click", () => this.close());
	}

	async _finish() {
		// Capture an un-blurred custom-move field.
		const root = this.element?.[0];
		const customEl = root?.querySelector(".stonetop-of-custom");
		if (customEl) this._customMove = customEl.value;

		const { bonus, rollMode, modeSources } = this._result();
		// A member ordered on their own rolls under their own name: "Glaw: Let Fly".
		const name = this._name();
		const moveName = `${name || "Follower"}: ${this._moveLabel()}`;
		// Also hand back the chosen move key and follower name structurally, so callers
		// (e.g. the Defend → hold-Readiness reaction) don't have to re-parse them out of
		// the flattened moveName string.
		await this._onRoll?.({
			bonus, rollMode, modeSources, moveName, moveKey: this._moveKey, followerName: name,
			member: this._member()?.key ?? null,
			shieldWall: this._wallAdvantage(),
			...(this._commandAdvantage() ? { command: true } : {}),
			...(this._spendLoyalty && this._canBalk() ? { spendLoyalty: true, ...(this._balkPaidWithPresence() ? { payWithPresence: true } : {}) } : {}),
		});
		this.close();
	}
}
