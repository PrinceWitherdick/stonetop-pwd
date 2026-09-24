import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { orderFollowersBonus } from "../../../data/follower-build.js";
import { sign } from "../../../utils/roll-engine.js";

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
// Hands { bonus, rollMode, moveName, moveKey, followerName, member, shieldWall } back to the
// caller (which calls StonetopCharacter.onOrderFollowersRoll). `member` is the
// picked member's key, or null for the whole group or a follower who is one person.

// The basic moves a follower can be ordered to trigger (the rollable ones from
// packs/src/stonetop-items/basic-moves/). "Custom" reveals a free-text header for
// anything else (a playbook move's effect, an improvised action, etc.).
const _ORDER_MOVES = [
	{ key: "defy-danger",   label: "Defy Danger" },
	{ key: "clash",         label: "Clash" },
	{ key: "let-fly",       label: "Let Fly" },
	{ key: "defend",        label: "Defend" },
	{ key: "aid",           label: "Aid" },
	{ key: "interfere",     label: "Interfere" },
	{ key: "seek-insight",  label: "Seek Insight" },
	{ key: "know-things",   label: "Know Things" },
	{ key: "persuade-npcs", label: "Persuade (vs. NPCs)" },
	{ key: "custom",        label: "Custom / other…" },
];

export class OrderFollowersDialog extends StonetopDialog {
	/**
	 * @param {Actor}    actor
	 * @param {object}   follower  - { name, tags: string[], moves: string[], exceptional: bool,
	 *   members?: Array<{key, name, tags: string[]}> } — `members` only for a group ordered as a
	 *   whole, each with their OWN tags (utils/crew.js#groupFollowerMembers)
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
		// Per-tag state: "help" | "hinder" | "" (neither). Keyed by tag string.
		this._tagState   = {};
		// Per-move state: "help" | "" only — a move can earn the bonus but can't
		// impose disadvantage (p.462 says "if any of their *tags* would get in the
		// way"). Kept in its own map so a move whose text happens to match a tag
		// doesn't share that tag's state.
		this._moveState   = {};
		this._advantage    = false;
		this._disadvantage = false;
		// Formed up in a shield wall: only asked when `follower.shieldWall` offers it and they Defend.
		this._inWall       = true;
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

	/** Advantage from either source: the player's toggle, or Shield Wall. */
	_hasAdvantage() {
		return this._advantage || this._wallAdvantage();
	}

	// Live tallies the player's chip picks into the Order Followers result. Moves
	// count toward `helps` alongside tags; only tags can feed `hinders`.
	_result() {
		const tagStates = this._shownTagStates();
		const helps   = tagStates.filter(s => s === "help").length
			+ Object.values(this._moveState).filter(s => s === "help").length;
		const hinders = tagStates.filter(s => s === "hinder").length;
		return orderFollowersBonus({
			helps, hinders,
			exceptional:  !!this._follower.exceptional,
			advantage:    this._hasAdvantage(),
			disadvantage: this._disadvantage,
		});
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
		html.find(".stonetop-of-dis").on("change", ev => { this._disadvantage = ev.currentTarget.checked; this.render(false); });

		html.find(".stonetop-of-roll").on("click", () => this._finish());
		html.find(".stonetop-of-cancel").on("click", () => this.close());
	}

	async _finish() {
		// Capture an un-blurred custom-move field.
		const root = this.element?.[0];
		const customEl = root?.querySelector(".stonetop-of-custom");
		if (customEl) this._customMove = customEl.value;

		const { bonus, rollMode } = this._result();
		// A member ordered on their own rolls under their own name: "Glaw: Let Fly".
		const name = this._name();
		const moveName = `${name || "Follower"}: ${this._moveLabel()}`;
		// Also hand back the chosen move key and follower name structurally, so callers
		// (e.g. the Defend → hold-Readiness reaction) don't have to re-parse them out of
		// the flattened moveName string.
		await this._onRoll?.({
			bonus, rollMode, moveName, moveKey: this._moveKey, followerName: name,
			member: this._member()?.key ?? null,
			shieldWall: this._wallAdvantage(),
		});
		this.close();
	}
}
