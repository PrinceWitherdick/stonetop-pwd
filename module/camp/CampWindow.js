import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { partyCharacters } from "../utils/playbook-actors.js";
import { escHtml } from "../utils/strings.js";
import { registerRestorableWindow } from "../utils/window-restore.js";
import {
	CAMP_BENEFIT, CAMP_FOLLOWERS_MAX, CAMP_STATE, HAD_ALL_ALONG, campLedger, count, coverTheRest, offerStep,
} from "./camp-rules.js";
import { campWindowView, closedCampNotice, departedCampNotice, settleRefusalText } from "./camp-view.js";
import {
	breakCamp, campActors, campMembers, campRecordOf, canCamp, haveWhatYouNeedAtCamp, isCampWriter, joinCamp,
	playsCharacter, sendAwayFromCamp, setCampChoices, settleCamp, stateOfCamp, takenFromCamp, touchesCamp,
} from "./camp-store.js";
import { askWithButtons, confirmLeavingOwnCamp } from "./camp-ask.js";

const TEMPLATE  = "systems/stonetop-pwd/templates/dialogs/make-camp.hbs";
const ID_PREFIX = "stonetop-camp";
/** The column that scrolls: the shared spring-dialog skin gives it `overflow-y: auto`, and the nav stays pinned below it. */
const SCROLLER  = ".stonetop-guide-main";
/** The kind a camp window is saved under by utils/window-restore.js, at the head of its key. */
const RESTORE_KIND = "camp";
/** The GM's roster list: who is not at the fire and who is, one list under Bring them and Send them away. */
const ROSTER = 'select[name="campRosterActor"]';

/**
 * How long a burst of document updates is collapsed before the window redraws. A settle lands one
 * update per character within a second, and several players pressing steppers at once is the
 * whole point of the window; either would otherwise redraw it once per write.
 */
const RENDER_DEBOUNCE_MS = 80;

/** The window id for a camp: one window per camp, on each client. */
export function campWindowId(campId) {
	return StonetopDialog.perDocumentOptions(ID_PREFIX, campId).id;
}

/** Open a camp's window, or bring the one already open to the front. */
export function openCampWindow(campId, hostId) {
	return openOrFocus(campWindowId(campId), () => {
		const app = new CampWindow({ campId, hostId });
		app.render(true);
		return app;
	});
}

/**
 * Whether this client should have a camp's window up at all: a GM always, and a player while a
 * character they own is still sitting at it. The one rule both for closing an open window and for
 * whether a reload brings one back.
 */
function keepsCampWindow(campId) {
	return !!game.user?.isGM || campActors(campId).some(actor => actor.isOwner);
}

/** Whether a camp window should come up at all on this client: the camp is still open, and this client keeps it. */
function campWindowWanted({ campId, hostId }) {
	return stateOfCamp({ campId, hostId }) === CAMP_STATE.OPEN && keepsCampWindow(campId);
}

/**
 * MAKE CAMP, SHARED (Book I p.334): one window per camp, open on every client that joined it, and
 * redrawn from the documents whenever anyone at the fire changes anything.
 *
 * The window keeps no state of its own. Every control writes its choice straight to the character
 * it belongs to, and the updateActor that write causes, here and on every other client, is what
 * redraws it. So two players looking at the same camp cannot be looking at two versions of it,
 * and a player who reloads mid-camp gets the same camp back, in the same place on the screen
 * (registerCampWindowRestore, below).
 */
export class CampWindow extends StonetopDialog {
	constructor({ campId, hostId } = {}, options = {}) {
		// Per camp: two camps open at once (a split party) must not share one frame.
		super(StonetopDialog.perDocumentOptions(ID_PREFIX, campId, options));
		this._camp        = { campId, hostId };
		this._hooks       = null;
		this._renderTimer = null;
		this._writes      = Promise.resolve();
		// Who sat at the fire at the last draw, and the names of any of them somebody else's client has
		// since taken away, for the notice if that closes the window.
		this._seated      = new Set();
		this._taken       = new Set();
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			title:     "Make Camp",
			template:  TEMPLATE,
			width:     900,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-camp-window"],
		});
	}

	get _autoHeight() { return true; }

	/** The column a redraw keeps the reader's place in (StonetopDialog#_keptScrollSelector). */
	get _keptScrollSelector() { return SCROLLER; }

	/** Every control a player works through carries a `data-camp-focus` key, so the keyboard finds it again after a redraw. */
	get _focusKeyAttribute() { return "data-camp-focus"; }

	/** What utils/window-restore.js saves this window under, and reopens it from after a reload. */
	get restoreKey() {
		return `${RESTORE_KIND}:${this._camp.campId}:${this._camp.hostId}`;
	}

	getData() {
		const { campId, hostId } = this._camp;
		const user    = game.user;
		const host    = game.actors?.get(hostId);
		const members = campMembers(campId, hostId);
		const actorOf = id => game.actors?.get(id);
		const seated  = new Set(members.map(m => m.actorId));
		this._seated  = seated;
		return campWindowView({
			state:    stateOfCamp(this._camp),
			hostName: host?.name ?? "",
			ledger:   campLedger(members),
			manages:  !!(user?.isGM || host?.isOwner),
			// One driver a row: the client that will pay that character's share. A player drives
			// their own row, and a GM (who owns every character) gets controls only for the ones
			// whose players are not there, rather than a second set of everybody's.
			editable: members.filter(m => isCampWriter(actorOf(m.actorId))).map(m => m.actorId),
			mine:     members.filter(m => playsCharacter(actorOf(m.actorId))).map(m => m.actorId),
			// A sheet opens for anyone with at least Limited on the character, which is what core asks.
			viewable: members.filter(m => actorOf(m.actorId)?.testUserPermission?.(user, "LIMITED")).map(m => m.actorId),
			addable:  user?.isGM
				? partyCharacters().filter(a => canCamp(a) && !seated.has(a.id)).map(a => ({ id: a.id, name: a.name }))
				: [],
			// The undo for Bring someone, so it is in the same hands.
			sendsAway: !!user?.isGM,
		});
	}

	/**
	 * Redraw, and put the reader back where they were: the scroll and the keyboard, which
	 * StonetopDialog keeps from the two declarations above, and the GM's pick in the roster list
	 * (_keepRosterPick), which is this window's own.
	 *
	 * Every control writes to a character, and every write redraws the whole window, which replaces
	 * the scrolling column with a fresh one sitting at its top. Ticking a box halfway down a camp of
	 * four threw the reader back to the banner, and so did anyone else at the fire pressing anything.
	 *
	 * ⚠ AND A FIRST DRAW OVER A CAMP THIS CLIENT NO LONGER BELONGS AT DRAWS NOTHING. A reload mints this
	 * window from its saved key and draws it up to a few seconds later (utils/window-restore.js staggers
	 * the windows it reopens), and the watch that closes a window over a camp that is over is only wired
	 * by a draw. A camp settled or broken up in between came up finished, and stayed up until somebody
	 * closed it by hand. Every other way in opens a camp that is open at that moment.
	 */
	async _render(force, options) {
		if (!this.rendered && !campWindowWanted(this._camp)) return;
		// Null where there was no roster list to pick from.
		const roster = this.element?.[0]?.querySelector?.(ROSTER);
		const picked = roster ? roster.selectedOptions?.[0]?.value ?? "" : null;
		await super._render(force, options);
		if (picked !== null) this._keepRosterPick(this.element?.[0]?.querySelector?.(ROSTER), picked);
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._watch();
		const root = html?.[0] ?? html;
		root?.addEventListener?.("click", ev => this._onClick(ev));
		root?.addEventListener?.("change", ev => this._onChange(ev));
	}

	async close(options = {}) {
		this._unwatch();
		return super.close(options);
	}

	/** Everyone at the fire, read fresh, plus the one row a control belongs to. */
	_seat(actorId) {
		const members = campMembers(this._camp.campId, this._camp.hostId);
		return { members, member: members.find(m => m.actorId === actorId) ?? null };
	}

	/**
	 * Run one write after the last, so each one reads the camp as the one before it left it.
	 *
	 * A stepper gets pressed three times in a second. Each press reads the current offer and
	 * writes one more; three presses racing each other would all read the same offer and all write
	 * the same "one more". Chained, the second press reads what the first wrote.
	 */
	_queue(noun, task) {
		const run = this._writes.then(task);
		this._writes = run.catch(err => this.reportWriteFailure(noun, err));
		return this._writes;
	}

	_onClick(ev) {
		const portrait = ev.target?.closest?.("[data-camp-sheet]");
		if (portrait) {
			ev.preventDefault();
			return this._openSheet(portrait.dataset.campSheet);
		}
		const control = ev.target?.closest?.("[data-camp-action]");
		if (!control || control.disabled) return;
		ev.preventDefault();
		const { campAction: action, actorId, slug } = control.dataset;
		const actor = actorId ? game.actors?.get(actorId) : null;
		switch (action) {
			case "offer-add":
			case "offer-take":
				return this._queue("offer", async () => {
					const { member } = this._seat(actorId);
					if (!member || !actor) return;
					await setCampChoices(actor, { [`offer.${slug}`]: offerStep(member, slug, action === "offer-add" ? 1 : -1) });
				});
			case "cover":
				return this._queue("offer", async () => {
					const { members, member } = this._seat(actorId);
					if (!member || !actor) return;
					await setCampChoices(actor, { offer: coverTheRest(campLedger(members), member) });
				});
			// Have What You Need: supplies had all along go straight onto the table, as far as the meal
			// is still short, the way Cover would share them.
			case "had-supplies":
				return this._queue("supplies", async () => {
					if (!actor || !(await haveWhatYouNeedAtCamp(actor, HAD_ALL_ALONG.SUPPLIES)).ok) return;
					const { members, member } = this._seat(actorId);
					if (member) await setCampChoices(actor, { offer: coverTheRest(campLedger(members), member) });
				});
			case "had-mess-kit":
				return actor ? this._queue("mess kit", () => haveWhatYouNeedAtCamp(actor, HAD_ALL_ALONG.MESS_KIT)) : undefined;
			case "followers-add":
			case "followers-take":
				return this._queue("head count", async () => {
					const { member } = this._seat(actorId);
					if (!member || !actor) return;
					const step = action === "followers-add" ? 1 : -1;
					await setCampChoices(actor, { followers: count(member.record.followers + step, CAMP_FOLLOWERS_MAX) });
				});
			// Going without keeps the character at the fire: what they share still feeds everyone else,
			// and their card stays in every reader's window, marked, with this same button to take it back.
			case "go-without":
			case "eat":
				return actor ? this._queue("camp choice", () => setCampChoices(actor, { eats: action === "eat" })) : undefined;
			case "add":
				return this._bringSomeone();
			case "send-away":
				return this._sendSomeoneAway();
			case "settle":
				return this._settle(control);
			case "break":
				return this._breakUp(control);
			default:
				return undefined;
		}
	}

	_onChange(ev) {
		const roster = ev.target?.closest?.(ROSTER);
		if (roster) return this._syncRoster(roster);
		const field = ev.target?.closest?.("[data-camp-field]");
		if (!field) return undefined;
		const { campField: key, actorId } = field.dataset;
		const actor = game.actors?.get(actorId);
		if (!actor) return undefined;
		// Choosing which debility is choosing to clear one: nobody picks from that list meaning HP.
		const patch = key === "benefit" ? { benefit: field.value }
			: key === "debility" ? { debility: field.value, benefit: CAMP_BENEFIT.DEBILITY }
			: { [key]: !!field.checked };
		return this._queue("camp choice", () => setCampChoices(actor, patch));
	}

	/**
	 * A face at the fire opens that character's sheet, or brings it forward when it is already open.
	 * Core's own `render(true)` does both: a forced render focuses, which restores a minimized sheet and
	 * raises it.
	 */
	_openSheet(actorId) {
		return game.actors?.get(actorId)?.sheet?.render(true);
	}

	/**
	 * The character picked in the GM's roster list, when they sit in the half of it `action` works on:
	 * Bring them takes someone not at the fire, Send them away someone at it. Null otherwise.
	 */
	_rosterPick(action) {
		const option = this.element?.[0]?.querySelector?.(ROSTER)?.selectedOptions?.[0];
		return option?.dataset?.campRoster === action ? game.actors?.get(option.value) ?? null : null;
	}

	/**
	 * Put the GM's pick in the roster list back after a redraw, or pick nobody once that character has
	 * left the list.
	 *
	 * A redrawn list opens on its first name, and both buttons act on whoever the list shows, so a player
	 * ticking a box anywhere at the fire swapped the GM's pick for somebody they never chose, with Bring
	 * them still pressable. A pick that has crossed to the other half (somebody else brought them) stays
	 * picked, and the button the GM was reaching for switches off rather than acting on someone else.
	 */
	_keepRosterPick(select, actorId) {
		if (!select) return;
		select.selectedIndex = [...(select.options ?? [])].findIndex(option => option.value === actorId);
		this._syncRoster(select);
	}

	/**
	 * One list, two buttons: only the button that fits the pick can be pressed, and the other says on
	 * hover which half of the list it wants. Done in place, not by a redraw, so the list keeps its pick.
	 */
	_syncRoster(select) {
		const fits = select.selectedOptions?.[0]?.dataset?.campRoster;
		for (const button of select.parentElement?.querySelectorAll?.("[data-camp-action]") ?? []) {
			const off = button.dataset.campAction !== fits;
			button.disabled = off;
			if (off) button.dataset.tooltip = button.dataset.campBlocked;
			else delete button.dataset.tooltip;
		}
		return undefined;
	}

	async _bringSomeone() {
		const actor = this._rosterPick("add");
		if (!actor) return;
		// The list can hold somebody hosting another fire, who would take that camp with them. Asked
		// before the write queue, so nobody's steppers wait on the GM reading the question.
		if (!(await confirmLeavingOwnCamp(actor, this._camp.campId))) return;
		await this._queue("arrival", () => joinCamp(actor, this._camp));
	}

	/** Bring someone's undo. Not asked first: Bring them puts the character straight back. */
	_sendSomeoneAway() {
		const actor = this._rosterPick("send-away");
		if (!actor) return undefined;
		return this._queue("departure", () => sendAwayFromCamp(actor, this._camp));
	}

	_settle(control) {
		control.disabled = true;
		return this._queue("camp", async () => {
			const result = await settleCamp(this._camp);
			if (result.ok) return;
			control.disabled = false;
			ui.notifications?.warn?.(settleRefusalText(result.reason));
			this.renderIfOpen();
		});
	}

	async _breakUp(control) {
		const host = game.actors?.get(this._camp.hostId);
		if (!host) return;
		const breakUp = await askWithButtons({
			title:   "Break up the camp?",
			content: `<p>Nobody at ${escHtml(host.name)}'s camp eats or rests, and nothing anyone shared is spent. To make camp after all, someone will have to open a new one.</p>`,
			buttons: [
				{ key: "break", icon: "fa-person-walking", label: "Break up the camp", value: true },
				{ key: "keep", label: "Keep the camp", value: false },
			],
			defaultKey: "keep",
		});
		if (!breakUp) return;
		control.disabled = true;
		await this._queue("camp", () => breakCamp(host));
	}

	/**
	 * Watch the documents the camp is made of, while the window is open.
	 *
	 * Any character's camp flag (someone sitting down or getting up), and anything at all about a
	 * character already seated: their pack, their HP and their debilities all show in their row.
	 * Who is online matters too, because it moves who pays for whom.
	 */
	_watch() {
		if (this._hooks) return;
		const onActor = (actor, changes, options, userId) => {
			if (actor?.type !== "character") return;
			const moved = touchesCamp(changes);
			if (!moved && campRecordOf(actor)?.id !== this._camp.campId) return;
			if (moved && this._seated.has(actor.id) && takenFromCamp(actor, this._camp.campId, userId)) this._taken.add(actor.name);
			this._scheduleRender();
		};
		this._hooks = [
			["updateActor",   Hooks.on("updateActor", onActor)],
			["userConnected", Hooks.on("userConnected", () => this._scheduleRender())],
		];
	}

	_unwatch() {
		for (const [hook, id] of this._hooks ?? []) Hooks.off(hook, id);
		this._hooks = null;
		clearTimeout(this._renderTimer);
		this._renderTimer = null;
		this._taken.clear();
	}

	/** Redraw soon, or close: the camp is over, or nobody this client plays is still at it. */
	_scheduleRender() {
		clearTimeout(this._renderTimer);
		this._renderTimer = setTimeout(() => {
			this._renderTimer = null;
			if (!this.rendered) return;
			const state    = stateOfCamp(this._camp);
			const hostName = game.actors?.get(this._camp.hostId)?.name;
			if (state !== CAMP_STATE.OPEN) {
				const notice = closedCampNotice(state, hostName);
				if (notice) ui.notifications?.info?.(notice);
				this.close();
				return;
			}
			if (!keepsCampWindow(this._camp.campId)) {
				// The one way this window closes on a player without them pressing anything, so it says why.
				if (this._taken.size) ui.notifications?.info?.(departedCampNotice([...this._taken], hostName));
				this.close();
				return;
			}
			this._taken.clear();
			this.render(false);
		}, RENDER_DEBOUNCE_MS);
	}
}

/**
 * The camp window a reload brings back, from the key it was saved under (CampWindow#restoreKey), or
 * null when it should stay shut: the camp is over, or nobody this player owns is still at the fire.
 *
 * Handed back unrendered, since utils/window-restore.js draws it where it was left. Minted through
 * openOrFocus all the same, so a Join or Open the camp pressed in the moment before the restore draws
 * it finds this window instead of minting a second frame on the same id. The same question is asked
 * again when that draw comes (CampWindow#_render), since the camp can end in between.
 */
export function reopenCampWindow(key) {
	const [kind, campId, hostId] = String(key ?? "").split(":");
	if (kind !== RESTORE_KIND || !campId || !hostId) return null;
	if (!campWindowWanted({ campId, hostId })) return null;
	return openOrFocus(campWindowId(campId), () => new CampWindow({ campId, hostId }));
}

/** Registered once, at module scope in stonetop.js, alongside the camp's own hooks. */
export function registerCampWindowRestore() {
	registerRestorableWindow(CampWindow, RESTORE_KIND, reopenCampWindow);
}
