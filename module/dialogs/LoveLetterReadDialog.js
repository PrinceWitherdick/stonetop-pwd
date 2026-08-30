import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { normalizeRollType, STAT_KEYS } from "../utils/roll-types.js";
import { MOVE_TIERS, pickLeadText } from "../utils/move-results.js";

/**
 * Player-facing reader for a love letter (Book I, p.568). Opened from the "Read letter"
 * button on the Moves tab, it shows the letter's full contents — body, any roll and its
 * 10+/7-9/6- outcomes, the shared "choose from this list" pool, and the sign-off — then
 * offers a single action that resolves it (rolls / posts to chat and consumes the letter).
 * The resolve logic itself stays on the sheet (StonetopCharacterSheet._onResolveLoveLetter);
 * this dialog just reads it and calls back.
 */
export class LoveLetterReadDialog extends StonetopDialog {
	/**
	 * @param {object}   [opts]
	 * @param {Item}     opts.item        - the love letter being read
	 * @param {Actor}    [opts.actor]     - the recipient (defaults to the item's parent)
	 * @param {Function} [opts.onResolve] - called (awaited) when the reader resolves it
	 */
	constructor({ item, actor = null, onResolve = null } = {}, options = {}) {
		super(options);
		this._item = item;
		this._actor = actor ?? item?.parent ?? null;
		this._onResolve = onResolve;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: "systems/stonetop-pwd/templates/dialogs/love-letter-read.hbs",
			width: 480,
			height: "auto",
			resizable: true,
			classes: ["stonetop", "stonetop-love-letter-read-dialog"],
		});
	}

	get title() {
		return this._item?.name || game.i18n.localize("stonetop.character.moves.loveLetter.sectionTitle");
	}

	getData() {
		const sys  = this._item?.system ?? {};
		const stat = normalizeRollType(sys.rollType);
		const isRolled = !!stat && STAT_KEYS.includes(stat);
		const statLabel = isRolled ? Handlebars.helpers.statLabel(stat) : "";

		const options = Array.isArray(sys.pickOptions) ? sys.pickOptions.filter(Boolean) : [];
		const hasOptions = options.length > 0;
		const L = (key) => game.i18n.localize(`stonetop.character.moves.loveLetter.${key}`);
		const pickLead = (n) => pickLeadText(n, hasOptions, { pick: L("pickLabel"), fromList: L("pickFromList") });

		const mr = sys.moveResults ?? {};
		const tiers = isRolled
			? MOVE_TIERS
				.map(({ key, label }) => {
					const t = mr[key] ?? {};
					return { label, lead: pickLead(t.pick), value: String(t.value ?? "").trim() };
				})
				.filter((t) => t.lead || t.value)
			: [];

		return {
			description: sys.description ?? "",
			isRolled,
			rollLabel: statLabel,
			tiers,
			hasResults: tiers.length > 0,
			options,
			hasOptions,
			signed: String(sys.signed ?? "").trim(),
			// The lone action: roll it (rolled letters) or read it aloud (no-roll letters).
			resolveLabel: isRolled
				? `${L("rollButton")} +${statLabel}`
				: L("readAloudButton"),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		root.querySelector(".stonetop-love-letter-resolve")?.addEventListener("click", async (ev) => {
			ev.currentTarget.disabled = true;   // single-use — guard a double-click resolving twice
			try {
				await this._onResolve?.();
			} catch (err) {
				console.error("Stonetop | Error resolving love letter from reader:", err);
				ev.currentTarget.disabled = false;
				return;
			}
			this.close();
		});
	}
}
