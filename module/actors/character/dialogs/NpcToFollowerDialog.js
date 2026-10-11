import { ConvertToFollowerDialog } from "./ConvertToFollowerDialog.js";
import {
	FOLLOWER_COST_EXAMPLES,
	normalizeTags, parseFollowerArmor, followerFromNpc,
} from "../../../data/follower-build.js";

// ── NpcToFollowerDialog ──────────────────────────────────────────────────────
// Dropping an "npc" Actor onto a character sheet offers to make that NPC a
// follower (Book I, NPCs & Followers, p.475: a follower "is first an NPC"). The
// NPC's identity carries over (name, pronouns, instinct, tags, GM moves) and it
// gains the follower-only stats: HP / armor / damage (seeded from the NPC's game
// stats if it has any, else the able-bodied baseline — editable here), a Loyalty
// track, and a chosen cost. On finish the built follower's sourceUuid points back
// at the NPC actor, so the two stay linked (see followerFromNpc).
//
// Mirrors MonsterToFollowerDialog's compact-modal shape (shared tag/cost/pronoun/group
// controls live in ConvertToFollowerDialog); the difference is that stats are editable
// (an NPC may have no combat stats to keep as-is).

export class NpcToFollowerDialog extends ConvertToFollowerDialog {
	constructor(actor, npc, onApply, options = {}) {
		super(options);
		this._actor     = actor;
		this._npc       = npc;
		this._onApply   = onApply;
		const sys       = npc?.system ?? {};
		const attrs     = sys.attributes ?? {};
		const hasStats  = !!sys.hasStats;
		this._addedTags = [];
		this._cost      = "";
		this._pronoun   = String(sys.pronouns ?? "").trim();
		// Seed the follower's stats from the NPC's own when it has them, else the
		// book's able-bodied follower defaults (6 HP, 0 armor; blank damage). Editable.
		this._hp     = hasStats ? (Number(attrs.hp?.max ?? attrs.hp?.value) || 6) : 6;
		this._armor  = hasStats ? parseFollowerArmor(attrs.armor?.value) : 0;
		this._damage = hasStats ? String(attrs.damage?.value ?? attrs.damage?.rollFormula ?? "").trim() : "";
		this._isGroup   = false;
		this._groupSize = 2;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-npc-to-follower",
			title:     "Make a Follower",
			template:  "systems/stonetop-pwd/templates/dialogs/npc-to-follower.hbs",
			width:     520,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-npc-follower-dialog"],
		});
	}

	get _sel() { return "nf"; }
	_keptTags() { return normalizeTags(this._npc?.system?.hasStats ? this._npc?.system?.tags : ""); }

	// The NPC's GM-move (npcMove) names, carried onto the follower.
	_npcMoves() {
		return (this._npc?.items ?? [])
			.filter(i => i.type === "npcMove")
			.map(i => i.name);
	}

	getData() {
		const sys      = this._npc?.system ?? {};
		const hasStats = !!sys.hasStats;
		return {
			npcName:     this._npc?.name ?? "NPC",
			actorName:   this._actor?.name ?? "this character",
			instinct:    String(sys.instinct ?? "").trim(),
			keptTags:    hasStats ? normalizeTags(sys.tags) : [],
			addedTags:   this._addedTags,
			moves:       this._npcMoves(),
			hp:          this._hp,
			armor:       this._armor,
			damage:      this._damage,
			pronoun:     this._pronoun,
			isGroup:     this._isGroup,
			groupSize:   this._groupSize,
			costOptions: FOLLOWER_COST_EXAMPLES.map(c => ({ value: c, selected: this._cost === c })),
			cost:        this._cost,
		};
	}

	// The NPC adds editable HP / armor / damage on top of the shared follower controls.
	activateListeners(html) {
		super.activateListeners(html);
		// Stats persist to the instance on change (no re-render, so focus survives typing).
		html.find(".stonetop-nf-hp").on("change", ev => { this._hp = Math.max(0, Math.trunc(Number(ev.currentTarget.value) || 0)); });
		html.find(".stonetop-nf-armor").on("change", ev => { this._armor = Math.max(0, Math.trunc(Number(ev.currentTarget.value) || 0)); });
		html.find(".stonetop-nf-damage").on("change", ev => { this._damage = ev.currentTarget.value.trim(); });
	}

	async _finish() {
		// Capture NPC-specific focused-but-unblurred stat fields, then the shared cost/pronoun/size.
		const root = this.element?.[0];
		if (root) {
			const hpEl = root.querySelector(".stonetop-nf-hp");
			if (hpEl) this._hp = Math.max(0, Math.trunc(Number(hpEl.value) || 0));
			const arEl = root.querySelector(".stonetop-nf-armor");
			if (arEl) this._armor = Math.max(0, Math.trunc(Number(arEl.value) || 0));
			const dmEl = root.querySelector(".stonetop-nf-damage");
			if (dmEl) this._damage = dmEl.value.trim();
		}
		this._captureCommonFields(root);
		const data = followerFromNpc(
			// `flags` carries the portrait's frame (documentPortraitFrame reads it there).
			{ name: this._npc?.name, system: this._npc?.system, uuid: this._npc?.uuid, img: this._npc?.img, flags: this._npc?.flags },
			{
				tags: this._addedTags, cost: this._cost, pronoun: this._pronoun,
				moves: this._npcMoves(),
				hp: this._hp, armor: this._armor, damage: this._damage,
				isGroup: this._isGroup, size: this._buildGroupSize(),
			},
		);
		await this._onApply?.(data);
		ui.notifications?.info?.(`${data.name || "NPC"} is now ${this._actor?.name ?? "the character"}'s follower.`);
		this.close();
	}
}
