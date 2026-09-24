import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { partyCharacters } from "../utils/playbook-actors.js";
import { actorPastDeathKind } from "../actors/character/deaths-door-actor.js";
import { ownsLearnedMoveNamed } from "../actors/character/owns-move.js";
import { STRUGGLE_MOVES } from "./struggle-rules.js";
import { followerKey, newSetupDraft, setupHelpers, setupRows, setupView } from "./struggle-setup.js";
import { clearAsk, liveStruggle, startStruggle } from "./struggle-store.js";

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/struggle-setup.hbs";
const WINDOW_ID = "stonetop-struggle-setup";
const SCROLLER = ".stonetop-guide-main";

/** A selector that finds this control again in a fresh draw, or null for one that has no key. */
function controlSelector(el) {
	const field = el?.dataset?.field;
	if (!field) return null;
	const owner = el.dataset.pc ? `[data-pc="${CSS.escape(el.dataset.pc)}"]` : el.dataset.follower ? `[data-follower="${CSS.escape(el.dataset.follower)}"]` : "";
	// A stat chip or a half-miss tick is one of several boxes on the one field, told apart by its
	// value. A select's or a text box's value is what the GM is changing, so it is never the key.
	const box = el.type === "checkbox" || el.type === "radio";
	const which = box && el.getAttribute?.("value") != null ? `[value="${CSS.escape(el.value)}"]` : "";
	return `${owner}[data-field="${CSS.escape(field)}"]${which}`;
}

/** What a refused call says. */
const START_REFUSALS = {
	"not-gm":  "Only a GM can call a Struggle as One.",
	"no-host": "There's no GM Toolkit in this world to keep the struggle on. Reload as a GM to make one.",
	"live":    "A Struggle as One is already under way. End it before calling another.",
	"empty":   "Tick at least one character to call for rolls.",
};

/**
 * One character as the setup reads them: the struggle moves they know, their load, and the followers
 * who could roll alongside them. The load and the followers need the character's own model, so a
 * sheet that fails to build still lets the GM call on them, without either.
 */
async function rosterEntry(actor) {
	const owns = STRUGGLE_MOVES.filter(name => ownsLearnedMoveNamed(actor, name));
	let load = "";
	let overloaded = false;
	try {
		const snap = await actor.typedActor?.buildSnapshot?.();
		const l = snap?.inventory?.outfit?.load ?? snap?.inventory?.load ?? null;
		load = l?.selected ?? "";
		overloaded = !!l?.loadLevelOverloaded;
	} catch (err) {
		console.warn(`Stonetop | Struggle as One: could not read ${actor.name}'s load`, err);
	}
	let followers = [];
	try {
		followers = (await actor.sheet?.orderableFollowers?.()) ?? [];
	} catch (err) {
		console.warn(`Stonetop | Struggle as One: could not read ${actor.name}'s followers`, err);
	}
	return {
		actorId: actor.id,
		name: actor.name,
		img: actor.img ?? "",
		owns,
		load,
		overloaded,
		followers: followers.map(f => ({ ...f, fkey: followerKey(actor.id, f.ftype, f.slug) })),
	};
}

/** The characters a GM can call on: the party, less the dead. */
function callable() {
	return partyCharacters().filter(a => actorPastDeathKind(a) !== "dead");
}

/**
 * Open the GM's setup, or bring it forward. `ask` pre-fills it from a player's request; `journey`
 * starts it with "part of a journey" ticked; `onClosed` runs once it has closed, however it closed.
 *
 * ONE SETUP AT A TIME. An ask that arrives while it is already open, on another ask or on none, is not
 * dropped: it stays on its character, the GM is told it is there, and `onClosed` is how it gets its turn.
 */
export function openStruggleSetup({ ask = null, askActor = null, only = null, journey = false, onClosed = null } = {}) {
	const app = openOrFocus(WINDOW_ID, () => {
		const fresh = new StruggleSetupDialog({ ask, askActor, only, journey, onClosed });
		fresh.render(true);
		return fresh;
	});
	if (askActor && app?._askActor?.id !== askActor.id) {
		ui.notifications?.info?.(`${askActor.name}'s player is asking for a Struggle as One too. Their ask opens once this setup closes.`);
	}
	return app;
}

/**
 * CALL FOR STRUGGLE AS ONE: the GM's side of starting one. Nothing it holds is written anywhere until
 * the GM calls for rolls; then startStruggle writes the struggle onto the toolkit, and every client in
 * it opens the shared window from that update.
 */
export class StruggleSetupDialog extends StonetopDialog {
	constructor({ ask = null, askActor = null, only = null, journey = false, onClosed = null } = {}, options = {}) {
		super(options);
		this._ask = ask;
		this._askActor = askActor;
		this._onClosed = onClosed;
		// Set once the struggle this setup was for is called: startStruggle has answered its ask.
		this._started = false;
		this._only = only;
		this._journey = !!journey;
		this._roster = null;
		this._draft = null;
		this._calling = false;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        WINDOW_ID,
			title:     "Struggle as One",
			template:  TEMPLATE,
			width:     860,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-camp-window", "stonetop-struggle-window"],
		});
	}

	get _autoHeight() { return true; }

	/**
	 * Closed without calling it, by Dismiss, the X or Escape alike: not calling it is the GM's answer to
	 * an ask, so the ask comes down and its player hears so. Left up, it stayed on the character, and its
	 * player was told "You've already asked" for good.
	 */
	async close(options = {}) {
		const asker = this._started ? null : this._askActor;
		const onClosed = this._onClosed;
		this._askActor = null;
		this._onClosed = null;
		try {
			return await super.close(options);
		} finally {
			if (asker) await clearAsk(asker).catch(err => console.error("Stonetop | taking down a Struggle as One ask failed", err));
			onClosed?.();
		}
	}

	async getData() {
		if (!this._roster) this._roster = await Promise.all(callable().map(rosterEntry));
		if (!this._draft) {
			this._draft = newSetupDraft(this._roster, {
				danger: this._ask?.danger ?? "",
				approach: this._ask?.approach ?? "",
				journey: this._journey,
				only: this._only,
			});
		}
		return setupView(this._roster, this._draft, { askerName: this._askActor?.name ?? "", live: !!liveStruggle() });
	}

	/**
	 * The GM's place, kept through a redraw (StonetopDialog#_keptScrollSelector). A redraw replaces the
	 * scrolling column, so ticking somebody out, or picking who Aids them, halfway down a party threw
	 * the form back to the banner and dropped the keyboard.
	 */
	get _keptScrollSelector() { return SCROLLER; }

	/** The fields here are named by who they belong to and what they hold, not by one focus key. */
	_focusSelector(el) { return controlSelector(el); }

	activateListeners(html) {
		super.activateListeners(html);
		const root = html?.[0] ?? html;
		root?.addEventListener?.("click", ev => this._onClick(ev));
		root?.addEventListener?.("change", ev => this._onChange(ev));
	}

	/** Read every field back into the draft, so a redraw (a character ticked in or out) keeps what was typed. */
	_capture() {
		const root = this.element?.[0];
		if (!root || !this._draft) return;
		const draft = this._draft;
		draft.danger = root.querySelector('[name="danger"]')?.value ?? draft.danger;
		draft.approach = root.querySelector('[name="approach"]')?.value ?? draft.approach;
		const journey = root.querySelector('[name="journey"]');
		if (journey) draft.journey = journey.checked;
		for (const [actorId, choice] of Object.entries(draft.pcs)) {
			const field = name => root.querySelectorAll(`[data-pc="${actorId}"][data-field="${name}"]`);
			const one = name => field(name)[0] ?? null;
			if (one("include")) choice.include = one("include").checked;
			if (!choice.include) continue;
			choice.stats = [...field("stat")].filter(i => i.checked).map(i => i.value);
			choice.mode = one("mode")?.value ?? choice.mode;
			choice.aidBy = one("aidBy")?.value ?? choice.aidBy;
			if (one("aidAdv")) choice.aidAdv = one("aidAdv").checked;
			choice.ticks = [...field("tick")].filter(i => i.checked).map(i => i.value);
		}
		for (const [fkey, choice] of Object.entries(draft.followers)) {
			const one = name => root.querySelector(`[data-follower="${CSS.escape(fkey)}"][data-field="${name}"]`);
			if (one("include")) choice.include = one("include").checked;
			if (!choice.include) continue;
			if (one("bonus")) choice.bonus = Number(one("bonus").value) || 0;
			if (one("mode")) choice.mode = one("mode").value;
		}
	}

	_onChange(ev) {
		// Ticking somebody in or out changes what their card holds; everything else just waits for Call.
		if (ev.target?.dataset?.field !== "include") return;
		this._capture();
		this.render(false);
	}

	async _onClick(ev) {
		const control = ev.target?.closest?.("[data-setup-action]");
		if (!control || control.disabled) return;
		ev.preventDefault();
		if (control.dataset.setupAction === "dismiss") {
			// Its ask comes down in close(), which every way out of the setup goes through.
			await this.close();
			return;
		}
		if (this._calling) return;
		this._calling = true;
		control.disabled = true;
		try {
			this._capture();
			const result = await startStruggle({
				danger: this._draft.danger,
				approach: this._draft.approach,
				journey: this._draft.journey,
				rows: setupRows(this._roster, this._draft),
				helpers: setupHelpers(this._roster, this._draft),
				askId: this._ask?.id ?? "",
				askActorId: this._askActor?.id ?? "",
			});
			if (!result.ok) {
				ui.notifications?.warn?.(START_REFUSALS[result.reason] ?? "The struggle could not be called.");
				control.disabled = false;
				return;
			}
			this._started = true;
			await this.close();
		} catch (err) {
			this.reportWriteFailure("struggle", err);
		} finally {
			this._calling = false;
		}
	}
}
