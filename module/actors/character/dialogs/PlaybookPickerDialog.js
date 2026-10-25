import { findVisibleJournal, SETTING_OVERVIEW_JOURNAL } from "../../../utils/seeded-journals.js";
import { openJournalSheetAsChild } from "../../../utils/front-on-open.js";
import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { asArray, playbookIconPath } from "../../../utils/playbook-actors.js";
import { ITEMS_PACK, STONETOP_SCOPE } from "../StonetopFlags.js";
import { ensurePackIndex } from "../../../utils/pack-index.js";
import { isOutOfPlaySafe } from "../deaths-door-actor.js";
import { hasLeftPlay } from "../../../campaign/left-play.js";

/**
 * The player a character belongs to: whoever holds it as their assigned character, else the
 * first non-GM user with an explicit OWNER entry on it. null for an unassigned or GM-only prep
 * sheet, which is nobody's playbook yet.
 */
function _playerOf(actor, users) {
	const players = users.filter(u => u && !u.isGM);
	const assigned = players.find(u => u.character?.id === actor.id);
	if (assigned) return assigned;
	const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
	return players.find(u => (actor.ownership?.[u.id] ?? 0) >= owner) ?? null;
}

/**
 * Who already holds each playbook, for the picker's note on its card. "No doubling up; each
 * player should pick a different playbook" (Book I p.49): the picker FLAGS a taken playbook and
 * still lets it be picked, since the table may agree otherwise.
 *
 * Counted: every other player character with a committed playbook, PLUS one whose player is
 * still choosing (the playbook the creation flow stamps on `onboardingProgress`, by name). That
 * second half is the one that matters most, because at the first session nobody has committed
 * anything yet. Skipped: the character being built, and sheets no player owns (unassigned or
 * GM-only prep). The dead are listed as such and do not count as taken.
 *
 * @param {object} args
 * @param {Array}  args.actors          the world's actors
 * @param {Array}  args.users           the world's users
 * @param {string|null} args.excludeActorId  the character this picker is choosing for
 * @param {Array<{slug: string, name: string}>} args.playbooks  the picker's playbooks
 * @returns {Map<string, {taken: string[], dead: string[]}>}  holder labels, keyed by slug
 */
export function playbookHolders({ actors = [], users = [], excludeActorId = null, playbooks = [] } = {}) {
	const userList = asArray(users);
	const slugByName = new Map(playbooks.map(p => [p.name, p.slug]));
	const holders = new Map();
	for (const actor of asArray(actors)) {
		if (actor?.type !== "character" || !actor.id || actor.id === excludeActorId) continue;
		const player = _playerOf(actor, userList);
		if (!player) continue;
		const progress = actor.getFlag?.(STONETOP_SCOPE, "onboardingProgress");
		const slug = actor.system?.playbook?.slug || slugByName.get(progress?.playbook ?? "") || "";
		if (!slug) continue;
		const dead = isOutOfPlaySafe(actor);
		const entry = holders.get(slug) ?? { taken: [], dead: [] };
		if (dead) {
			entry.dead.push(game.i18n.format(hasLeftPlay(actor) ? "stonetop.newCharacter.pickerLeftHolder" : "stonetop.newCharacter.pickerDeadHolder", { name: actor.name }));
		} else {
			entry.taken.push(game.i18n.format("stonetop.newCharacter.pickerHolder", { character: actor.name, player: player.name }));
		}
		holders.set(slug, entry);
	}
	return holders;
}

const PLAYBOOK_DESCRIPTIONS = {
	"the-blessed":       { complexity: "Medium",       desc: "Nature priest. Speaks to spirits and beasts. Works subtle magics via sacred markings and materials." },
	"the-fox":           { complexity: "Low",          desc: "Clever, quick, and skillful. Not above bending the rules or fighting dirty. Can be quite the charmer, too." },
	"the-heavy":         { complexity: "Low / Medium", desc: "Not just a violent individual, our violent individual. A champion, yes, but a bit of a liability, too." },
	"the-judge":         { complexity: "Low",          desc: "Settler of disputes, chronicler, and divine bulwark against chaos. Insightful, tough, not necessarily persuasive." },
	"the-lightbearer":   { complexity: "High",         desc: "Invokes divine power via flame and candle. Beacon of hope, charity, and mercy. Fiery foe of the dark." },
	"the-marshal":       { complexity: "High",         desc: "Leads the town's militia, plus a crew of followers. Makes choices about who lives and who dies." },
	"the-ranger":        { complexity: "Low",          desc: "At home in the wild, the one you want with you when you travel. A resourceful guide and deadly hunter." },
	"the-seeker":        { complexity: "High",         desc: "Collector of lost lore and power, with potent artifacts that might well lead to their ruin." },
	"the-would-be-hero": { complexity: "Medium",       desc: "They're in over their head and full of fear and anger, but they just might outshine us all." },
};

export class PlaybookPickerDialog extends StonetopDialog {
	constructor(onPick, options = {}) {
		const { onClose, actorId = null, ...appOptions } = options;
		super(appOptions);
		this._onPick   = onPick;
		// Optional callback fired once the picker closes — picking a playbook closes
		// it too, so callers that care (the first-session flow) track that themselves.
		this._onClose  = onClose ?? null;
		// The character being built, left out of the "Taken by" notes (see playbookHolders).
		this._actorId  = actorId;
		this._playbooks = [];
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-playbook-picker",
			template:  "systems/stonetop-pwd/templates/dialogs/playbook-picker.hbs",
			title:     game.i18n.localize("stonetop.newCharacter.pickerTitle"),
			width:     640,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-playbook-picker"],
		});
	}

	// `_suppressOnClose` is set by creation-flow.js when the character being built is deleted or
	// replaced: `onClose` opens that character's sheet, which by then would be a ghost of a
	// deleted actor. The onboarding walkthrough honours the same switch.
	async close(options = {}) {
		this._unregisterHooks();
		const result = await super.close(options);
		if (!this._suppressOnClose) this._onClose?.();
		return result;
	}

	// Keep the cards' "Taken by" notes current while the picker is open: another player picking
	// (or committing) a playbook, a character arriving or leaving, or a sheet changing hands.
	// Debounced, since a player clicking through onboarding writes their progress on every page.
	_registerHooks() {
		if (this._hooks) return;
		const refresh = foundry.utils.debounce(() => {
			if (this.rendered && !this._picking) this.render(false);
		}, 200);
		const ifCharacter = actor => { if (actor?.type === "character") refresh(); };
		this._hooks = [
			["createActor", Hooks.on("createActor", ifCharacter)],
			["deleteActor", Hooks.on("deleteActor", ifCharacter)],
			["updateActor", Hooks.on("updateActor", (actor, changes) => {
				if (actor?.type !== "character" || actor.id === this._actorId) return;
				if ("ownership" in (changes ?? {}) || changes?.system?.playbook !== undefined) { refresh(); return; }
				const stFlags = changes?.flags?.[STONETOP_SCOPE];
				if (stFlags && Object.keys(stFlags).some(k => k.replace(/^-=/, "") === "onboardingProgress")) refresh();
			})],
			["updateUser", Hooks.on("updateUser", (_user, changes) => { if (changes && "character" in changes) refresh(); })],
		];
	}

	_unregisterHooks() {
		if (!this._hooks) return;
		for (const [name, id] of this._hooks) Hooks.off(name, id);
		this._hooks = null;
	}

	async getData() {
		if (!this._playbooks.length) {
			const pack = await ensurePackIndex(ITEMS_PACK, ["type", "system.slug", "img"]);
			if (pack) {
				const entries = [...pack.index].filter(e =>
					e.type === "playbook" && !!PLAYBOOK_DESCRIPTIONS[e.system?.slug ?? ""]
				);
				const docs = await Promise.all(entries.map(e => pack.getDocument(e._id)));
				this._playbooks = docs
					.filter(Boolean)
					.sort((a, b) => a.name.localeCompare(b.name))
					.map(d => {
						const slug = d.system?.slug ?? "";
						const info = PLAYBOOK_DESCRIPTIONS[slug] ?? {};
						// Use the same avatar art applied to a character on pick
						// (assets/icons/playbooks/<slug>_icon.webp), not the flat
						// playbook item icon.
						const avatar = playbookIconPath(slug);
						return {
							uuid:        d.uuid,
							name:        d.name,
							img:         avatar ?? d.img,
							slug,
							complexity:  info.complexity ?? "",
							description: info.desc       ?? "",
						};
					});
			}
		}
		// Read fresh each render rather than cached with the playbooks: another player may pick
		// while this one is choosing. Display only; nothing is written.
		const holders = playbookHolders({
			actors:         game.actors,
			users:          game.users,
			excludeActorId: this._actorId,
			playbooks:      this._playbooks,
		});
		const playbooks = this._playbooks.map(p => {
			const held = holders.get(p.slug) ?? { taken: [], dead: [] };
			return {
				...p,
				taken:   held.taken.length > 0,
				takenBy: held.taken.length
					? game.i18n.format("stonetop.newCharacter.pickerTakenBy", { names: held.taken.join(", ") })
					: "",
				deadHolders: held.dead.join(", "),
			};
		});
		return { playbooks };
	}

	activateListeners(html) {
		super.activateListeners(html);
		// A live refresh (see _registerHooks) replaces the card a tooltip was pointing at.
		this._removePickerTooltip();
		html.find(".stonetop-playbook-picker-setting-overview").on("click", () => this._openSettingOverview());
		html.find(".stonetop-playbook-picker-card")
			.on("click", ev => this._pickPlaybook(ev.currentTarget.dataset.uuid))
			.on("mouseenter", ev => this._showPickerTooltip(ev.currentTarget))
			.on("mouseleave", () => this._removePickerTooltip());
		this._registerHooks();
	}

	/**
	 * Pick a playbook, once. The cards stay live through the picker's 200ms fade-out, so a
	 * double-click picked twice: two walkthroughs sharing one DOM id. A pick that finds no
	 * document, or whose walkthrough throws, lets the next click try again.
	 */
	async _pickPlaybook(uuid) {
		if (!uuid || this._picking) return;
		this._picking = true;
		let doc = null;
		try { doc = await fromUuid(uuid); } catch (err) { console.error("Stonetop | could not load that playbook", err); }
		if (!doc) {
			this._picking = false;
			return;
		}
		// A pick whose walkthrough failed to open leaves the picker usable, rather than on screen
		// with every card dead until it is closed and reopened.
		try {
			await this._onPick(doc);
		} catch (err) {
			console.error("Stonetop | could not open that playbook", err);
			ui.notifications?.error?.(`Couldn't open ${doc.name}. Try again, or pick another playbook.`);
			this._picking = false;
			return;
		}
		this.close();
	}

	// Open the real seeded Setting Overview journal (the single source of truth),
	// brought to the front on top of the picker. The journal is player-readable;
	// if it isn't seeded/visible yet, say so rather than opening an empty window.
	_openSettingOverview() {
		const journal = findVisibleJournal(SETTING_OVERVIEW_JOURNAL);
		if (!journal) {
			ui.notifications.warn("The Setting Overview journal isn't set up in this world yet.");
			return;
		}
		openJournalSheetAsChild(journal.sheet, {
			childClass: "stonetop-picker-child",
		});
	}

	_removePickerTooltip() {
		document.querySelector(".stonetop-playbook-picker-tooltip")?.remove();
	}

	_showPickerTooltip(card) {
		this._removePickerTooltip();
		const { complexity, description } = card.dataset;
		if (!description) return;

		const tip = document.createElement("div");
		tip.className = "stonetop-playbook-picker-tooltip";
		tip.innerHTML =
			(complexity ? `<span class="stonetop-playbook-picker-tooltip-complexity">${complexity} complexity</span>` : "") +
			`<p class="stonetop-playbook-picker-tooltip-desc">${description}</p>`;
		// Append inside the dialog, not <body>, so the tooltip shares the picker's
		// stacking context and stays above its content. (The window has no
		// transform, so the tooltip's fixed positioning still tracks the viewport.)
		(this.element?.[0] ?? document.body).appendChild(tip);

		const ar  = card.getBoundingClientRect();
		const tr  = tip.getBoundingClientRect();
		let top   = ar.top - tr.height - 8;
		let left  = ar.left + (ar.width - tr.width) / 2;
		if (top < 8) top = ar.bottom + 8;
		const maxLeft = window.innerWidth - tr.width - 8;
		if (left > maxLeft) left = maxLeft;
		if (left < 8)       left = 8;
		tip.style.top  = `${top}px`;
		tip.style.left = `${left}px`;
	}
}
