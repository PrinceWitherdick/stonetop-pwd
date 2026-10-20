// A settlement's Plans (Make a Plan, Book I p.530): Stonetop's own Plans section on the Notes tab
// (templates/actor/partials/steading-plans.hbs), kept in the settlement's `system.plans`
// (data-models/SettlementModel.js) rather than in Stonetop's flags. Read, ticked, written and removed by
// the steading's code (actors/steading/steading-plans.js, SteadingPlanDialog.js) through the store below.

import { editSettlementList } from "./settlement-residents.js";

/**
 * The settlement as Stonetop's Plans code addresses a steading: its plans read off `system.plans` as
 * `_flags.plans`, and each write queued with the settlement's other list writes. editSettlementList hands
 * over deep copies, so a tick written inside a plan's own requirement rows never touches the stored data.
 */
export function settlementPlanStore(actor) {
	return {
		get _flags() { return { plans: actor.system?.plans ?? [] }; },
		editList: (list, edit) => editSettlementList(actor, list, edit),
	};
}
