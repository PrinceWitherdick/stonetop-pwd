import { ConvertToFollowerDialog } from "./ConvertToFollowerDialog.js";
import { creatureTypeFaIcon } from "../../../bestiary/creature-types.js";
import {
	FOLLOWER_COST_EXAMPLES,
	monsterFollowerTags, followerFromMonster, monsterGroupDefaults,
} from "../../../data/follower-build.js";

// ── MonsterToFollowerDialog ──────────────────────────────────────────────────
// Dropping a monster onto a character sheet offers to convert it to a follower
// (Book I, NPCs & Followers, p.475): "use its stats as-is", but add any tags you
// see fit, choose a cost, and add a Loyalty track. This compact modal shows the
// monster's stats, lets the player add tags + pick a cost + set a pronoun, then
// hands the built follower back to the sheet to store (see _applyCustomFollower).
// The tag/cost/pronoun/group controls + finish-capture live in ConvertToFollowerDialog.

export class MonsterToFollowerDialog extends ConvertToFollowerDialog {
	constructor(actor, monster, onApply, options = {}) {
		super(options);
		this._actor     = actor;
		this._monster   = monster;
		this._onApply   = onApply;
		this._addedTags = [];
		this._cost      = "";
		this._pronoun   = "";
		// A group- or horde-organization monster defaults to a group follower.
		const gd        = monsterGroupDefaults(monster?.system ?? {});
		this._isGroup   = gd.isGroup;
		this._groupSize = gd.size || 3;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-monster-to-follower",
			title:     "Convert to Follower",
			template:  "systems/stonetop-pwd/templates/dialogs/monster-to-follower.hbs",
			width:     520,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-monster-follower-dialog"],
		});
	}

	get _sel() { return "mf"; }
	_keptTags() { return monsterFollowerTags(this._monster?.system ?? {}); }

	// Monster move names (the monsterMove items), carried onto the follower.
	_monsterMoves() {
		return (this._monster?.items ?? [])
			.filter(i => i.type === "monsterMove")
			.map(i => i.name);
	}

	getData() {
		const m      = this._monster;
		const system = m?.system ?? {};
		const attrs  = system.attributes ?? {};
		return {
			monsterName: m?.name ?? "Monster",
			actorName:   this._actor?.name ?? "this character",
			bannerIcon:  creatureTypeFaIcon(system.creatureType),
			keptTags:    monsterFollowerTags(system),
			addedTags:   this._addedTags,
			hp:          attrs.hp?.max ?? attrs.hp?.value ?? 0,
			armor:       attrs.armor?.value ?? 0,
			damage:      String(attrs.damage?.value ?? attrs.damage?.rollFormula ?? "").trim() || "—",
			instinct:    String(attrs.instinct?.value ?? "").trim(),
			moves:       this._monsterMoves(),
			pronoun:     this._pronoun,
			isGroup:     this._isGroup,
			groupSize:   this._groupSize,
			costOptions: FOLLOWER_COST_EXAMPLES.map(c => ({ value: c, selected: this._cost === c })),
			cost:        this._cost,
		};
	}

	async _finish() {
		this._captureCommonFields(this.element?.[0]);
		const data = followerFromMonster(
			// `flags` carries the portrait's frame (documentPortraitFrame reads it there).
			{ name: this._monster?.name, system: this._monster?.system, moves: this._monsterMoves(), uuid: this._monster?.uuid, img: this._monster?.img, flags: this._monster?.flags },
			{
				tags: this._addedTags, cost: this._cost, pronoun: this._pronoun,
				isGroup: this._isGroup, size: this._buildGroupSize(),
			},
		);
		await this._onApply?.(data);
		ui.notifications?.info?.(`${data.name || "Monster"} converted to a follower.`);
		this.close();
	}
}
