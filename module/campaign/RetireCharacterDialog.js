import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { steadingPeopleActors } from "../actors/steading/steading-people.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { LEFT_PLAY_HOW } from "./left-play.js";
import { RETIRE_CHOICES, RETIRE_NPC, retireCharacter } from "./retire-pc.js";

/**
 * RETIRE A PC (Book I p.584): how they go, their epilogue in the player's words, and for one who stays,
 * the NPC they become. Everything is the player's and the table's to say; the window only writes it down.
 * Nothing is written until the button at the foot, and the character stays in play if it is closed.
 */
export class RetireCharacterDialog extends StonetopDialog {
	/**
	 * @param {Actor} actor  the character
	 * @param {object} [deps]  injectable for tests: `people` (the steading's NPCs), `retire`
	 */
	constructor(actor, deps = {}, options = {}) {
		super(StonetopDialog.perDocumentOptions("stonetop-retire-character", actor?.id, options));
		this._actor = actor;
		this._deps = deps;
		this._how = LEFT_PLAY_HOW.RETIRED;
		this._npc = RETIRE_NPC.RESIDENT;
		this._epilogue = "";
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-retire-character",
			title:     "Retire a Character",
			template:  "systems/stonetop-pwd/templates/dialogs/retire-character.hbs",
			classes:   ["stonetop", "stonetop-retire-dialog"],
			width:     520,
			height:    "auto",
			resizable: true,
		});
	}

	get title() { return `Retire ${this._actor?.name ?? "a Character"}`; }

	get _focusKeyAttribute() { return "data-retire-focus"; }

	/** The steading's people a staying PC could be linked to instead of a new NPC. */
	_people() {
		const people = this._deps.people ?? steadingPeopleActors(getStonetopSteadingActor());
		return people.filter(a => a?.id && a.id !== this._actor?.id);
	}

	getData() {
		const staying = this._how === LEFT_PLAY_HOW.RETIRED;
		const choice = RETIRE_CHOICES.find(c => c.how === this._how) ?? RETIRE_CHOICES[0];
		const npcOption = (value, label) => ({ value, label, selected: this._npc === value });
		return {
			name:     this._actor?.name ?? "",
			choices:  RETIRE_CHOICES.map(c => ({ ...c, checked: c.how === this._how })),
			prompt:   choice.prompt,
			epilogue: this._epilogue,
			staying,
			npcOptions: [
				npcOption(RETIRE_NPC.RESIDENT, `A new Resident of Stonetop, named ${this._actor?.name ?? ""}`),
				npcOption(RETIRE_NPC.NEIGHBOR, "A new Neighbor (they live elsewhere in the region)"),
				...this._people().map(a => npcOption(a.id, `Already on the sheet as ${a.name}`)),
				npcOption(RETIRE_NPC.NONE, "No NPC"),
			],
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		const on = (sel, type, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener(type, fn));
		// Kept on every keystroke, so a redraw (a different ending picked) never loses the words.
		on(".retire-epilogue", "input", ev => { this._epilogue = ev.currentTarget.value; });
		on(".retire-how", "change", ev => { this._how = ev.currentTarget.value; this.render(false); });
		on(".retire-npc", "change", ev => { this._npc = ev.currentTarget.value; });
		on(".retire-apply", "click", ev => this._guardBusy(ev, () => this._apply()));
		on(".retire-cancel", "click", () => this.close());
	}

	async _apply() {
		const retire = this._deps.retire ?? retireCharacter;
		const result = await retire(this._actor, {
			how: this._how,
			epilogue: this._epilogue,
			npc: this._how === LEFT_PLAY_HOW.RETIRED ? this._npc : RETIRE_NPC.NONE,
		});
		if (!result) {
			globalThis.ui?.notifications?.warn?.(`${this._actor?.name ?? "This character"} could not be retired.`);
			this.render(false);
			return;
		}
		return this._resolveWith(result);
	}
}
