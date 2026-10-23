import { StonetopDialog } from "../utils/stonetop-dialog.js";
import {
	campVitalsFor, crewSuppliesOf, isUnliving, mealSpendTarget, packResources, partyCrewMouths, partyFollowerMouths,
} from "../camp/camp-store.js";
import { count, purseSpendUpdate } from "../camp/camp-rules.js";
import { partyFollowersOf } from "../actors/character/follower-roster.js";
import { postMoveToChat } from "../utils/chat.js";
import { crewRoadText, ledgerAsPaid, roadLedger, roadSummaryRows, spendWords, usesWord } from "../utils/road-rations.js";

/** The ledger's name for the write, so the character's history says where the food went. */
const ON_THE_ROAD = "On the road";

/**
 * DAYS ON THE ROAD: the GM's "N days pass" from the Expedition walkthrough (Book I p.89, p.304).
 * The rules are utils/road-rations.js; this reads the packs, lets the GM move any figure, and
 * spends.
 *
 * The GM writes every pack at once, which a camp never does (camp-store.js writes each share from
 * its owner's client). That is the right call here and not there: a camp is the players deciding
 * at the fire who eats from whose pack, while glossed travel is the GM moving the clock on, and the
 * GM can write every character. Nothing is spent until the GM presses the button, and every figure
 * on the way is theirs to change.
 */
export class RoadRationsDialog extends StonetopDialog {
	/**
	 * @param {Actor[]} actors  the PCs on this trip
	 * @param {{days?: number, routeDays?: number|null}} [opts]  `routeDays`: what the charted route
	 *   says the trip takes, for the hint beside the field
	 */
	constructor(actors = [], { days = 1, routeDays = null } = {}, options = {}) {
		super(options);
		this._actors = actors.filter(Boolean);
		this._days = Math.max(1, count(days) || 1);
		this._routeDays = routeDays;
		// Both the GM's to say, so never assumed. A mess kit "requires water and fire" and counts only "if
		// someone has and uses" one (Book I p.304, p.89): carrying it is not cooking with it.
		this._messKit = false;
		this._packAnimal = false;
		this._paid = {};           // actorId -> the GM's own figure
		this._eats = {};           // actorId -> false for a mouth the GM sends without
		this._followers = {};      // actorId -> followers fed, as the GM set it
		this._members = null;      // read once, on the first render
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-road-rations",
			title:     "Days on the Road",
			template:  "systems/stonetop-pwd/templates/dialogs/road-rations.hbs",
			classes:   ["stonetop", "stonetop-road-rations-dialog"],
			width:     520,
			height:    "auto",
			resizable: true,
		});
	}

	get _focusKeyAttribute() { return "data-road-focus"; }

	/**
	 * Each PC as road-rations.js reads them, from their sheet. Who carries a mess kit and how many
	 * followers travel with them come from the same reads Make Camp makes (camp-store.js), so the
	 * two never count a party two ways; so do how many of those followers are the crew's and what the
	 * crew's own supplies hold, which pay the crew's mouths first (road-rations.js).
	 */
	async _readMembers() {
		return Promise.all(this._actors.map(async actor => {
			const [vitals, party] = await Promise.all([
				campVitalsFor(actor),
				partyFollowersOf(actor).catch(() => null),
			]);
			return {
				actorId:   actor.id,
				name:      actor.name,
				img:       actor.img ?? "",
				unliving:  isUnliving(actor),
				messKit:   !!vitals?.messKit,
				followers: partyFollowerMouths(actor, party),
				crewMouths: partyCrewMouths(actor, party),
				crew:      { held: crewSuppliesOf(actor).held },
				resources: packResources(actor),
			};
		}));
	}

	/** The members with the GM's changes laid over what their sheets said. */
	_seated() {
		return (this._members ?? []).map(m => ({
			...m,
			eats:      this._eats[m.actorId] ?? !m.unliving,
			followers: this._followers[m.actorId] ?? m.followers,
		}));
	}

	_ledger() {
		return roadLedger(this._seated(), {
			days: this._days, messKit: !!this._messKit, packAnimal: this._packAnimal, paid: this._paid,
		});
	}

	async getData() {
		this._members ??= await this._readMembers();
		// Who carries one is only named beside the box, which starts unticked (see the constructor).
		const cooks = this._members.filter(m => m.messKit).map(m => m.name);
		const ledger = this._ledger();
		return {
			days:       this._days,
			routeDays:  this._routeDays,
			messKit:    !!this._messKit,
			cooks:      cooks.join(", "),
			packAnimal: this._packAnimal,
			hasMembers: ledger.rows.length > 0,
			rows: ledger.rows.map(r => ({
				...r,
				changed: this._paid[r.actorId] !== undefined,
				spend:   r.pays ? spendWords(r.spend) : "",
				// The crew's own supplies pay the crew by themselves: a sentence, never a figure to set.
				crewText: crewRoadText(r),
			})),
			bill:      ledger.bill,
			billText:  ledger.packAnimal
				? "No meals to count: they re-Outfit from the stash."
				: `${ledger.mouths} ${ledger.mouths === 1 ? "mouth" : "mouths"}: ${usesWord(ledger.perDay)} a day, ${usesWord(ledger.bill)} in all.`,
			shortText: ledger.short ? `${usesWord(ledger.short)} short: someone goes without (deprivation, p.335).` : "",
			overText:  ledger.over ? `${usesWord(ledger.over)} more than the bill.` : "",
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		const on = (sel, type, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener(type, fn));
		on(".road-days", "change", ev => { this._days = Math.max(1, count(ev.currentTarget.value) || 1); this.render(false); });
		on(".road-mess-kit", "change", ev => { this._messKit = ev.currentTarget.checked; this.render(false); });
		on(".road-pack-animal", "change", ev => { this._packAnimal = ev.currentTarget.checked; this.render(false); });
		on(".road-eats", "change", ev => { this._eats[ev.currentTarget.dataset.actorId] = ev.currentTarget.checked; this.render(false); });
		on(".road-followers", "change", ev => { this._followers[ev.currentTarget.dataset.actorId] = count(ev.currentTarget.value); this.render(false); });
		on(".road-pays", "change", ev => { this._paid[ev.currentTarget.dataset.actorId] = count(ev.currentTarget.value); this.render(false); });
		on(".road-reset", "click", () => { this._paid = {}; this.render(false); });
		on(".road-apply", "click", ev => this._guardBusy(ev, () => this._apply()));
		on(".road-cancel", "click", () => this.close());
	}

	/**
	 * Spend what the ledger says, pack by pack and the crew's supplies with them, from what each holds
	 * NOW (camp-rules.js#purseSpendUpdate, through the same target Make Camp pays from,
	 * camp-store.js#mealSpendTarget), and tell the table. Days with a laden pack animal or cart cost
	 * nothing and write nothing, but the card still says the days went by.
	 */
	async _apply() {
		const byId = new Map(this._actors.map(a => [a.id, a]));
		// The packs were read when the window opened: each purse pays what it holds NOW (ledgerAsPaid), so the
		// card names only what was eaten, and what a pack no longer had is the party's shortfall.
		const targets = new Map(this._actors.filter(a => a?.typedActor).map(a => [a.id, mealSpendTarget(a)]));
		const ledger = ledgerAsPaid(this._ledger(), actorId => targets.get(actorId)?.resources ?? {});
		// Each pack is its own actor, so the writes go out together.
		await Promise.all(ledger.rows.map(row => {
			const actor = row.pays || row.crewPays ? byId.get(row.actorId) : null;
			const target = targets.get(row.actorId);
			if (!actor || !target) return null;
			const { update } = purseSpendUpdate([...row.crewSpend, ...row.spend], target);
			return Object.keys(update).length ? actor.update(update, { stonetopMove: ON_THE_ROAD }) : null;
		}));
		postMoveToChat(null, "Days on the road", roadSummaryRows(ledger));
		await this.close();
		return ledger;
	}
}
