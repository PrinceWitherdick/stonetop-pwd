import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { THREAT_PROXIMITIES, THREAT_TYPES, DEFAULT_PROXIMITY, DEFAULT_THREAT_TYPE } from "../threats/threat-types.js";
import { instinctOf, isPc, makeThreatOf } from "./become-threat.js";

/**
 * A PC or a follower becomes a threat (Book I p.584, p.481): the GM names the threat, picks its type and
 * tracker, and says whether a monster stat block comes with it and, for a PC, whether they leave play now.
 * The fuller write-up happens in the threat editor that opens after.
 */
export class BecomeThreatDialog extends StonetopDialog {
	constructor(actor, deps = {}, options = {}) {
		super(StonetopDialog.perDocumentOptions("stonetop-become-threat", actor?.id, options));
		this._actor = actor;
		this._deps = deps;
		const pc = isPc(actor);
		this._state = {
			name:      actor?.name ?? "",
			type:      DEFAULT_THREAT_TYPE,
			proximity: DEFAULT_PROXIMITY,
			instinct:  instinctOf(actor),
			// "Write them up as both a threat and a monster" is the PC rule (p.584); a follower's page asks
			// only for a threat (p.481), so the box starts unticked for one.
			monster:   pc,
			outOfPlay: pc,
		};
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-become-threat",
			title:     "Becomes a Threat",
			template:  "systems/stonetop-pwd/templates/dialogs/become-threat.hbs",
			classes:   ["stonetop", "stonetop-become-threat-dialog"],
			width:     500,
			height:    "auto",
			resizable: true,
		});
	}

	get title() { return `${this._actor?.name ?? "Someone"} Becomes a Threat`; }

	getData() {
		const s = this._state;
		return {
			name:      this._actor?.name ?? "",
			isPc:      isPc(this._actor),
			state:     s,
			types:     THREAT_TYPES.map(t => ({ id: t.id, label: t.label, selected: t.id === s.type })),
			proximities: THREAT_PROXIMITIES.map(p => ({ id: p.id, label: p.label, selected: p.id === s.proximity })),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		const bind = (sel, key, read = el => el.value) => root.querySelectorAll(sel).forEach(el =>
			el.addEventListener(el.type === "text" ? "input" : "change", () => { this._state[key] = read(el); }));
		bind(".bt-name", "name");
		bind(".bt-type", "type");
		bind(".bt-proximity", "proximity");
		bind(".bt-instinct", "instinct");
		bind(".bt-monster", "monster", el => el.checked);
		bind(".bt-out-of-play", "outOfPlay", el => el.checked);
		root.querySelector(".bt-apply")?.addEventListener("click", ev => this._guardBusy(ev, () => this._apply()));
		root.querySelector(".bt-cancel")?.addEventListener("click", () => this.close());
	}

	async _apply() {
		const make = this._deps.make ?? makeThreatOf;
		const result = await make(this._actor, { ...this._state });
		if (!result) {
			globalThis.ui?.notifications?.warn?.("The threat could not be written. Is there a Stonetop steading in this world?");
			this.render(false);
			return;
		}
		return this._resolveWith(result);
	}
}
