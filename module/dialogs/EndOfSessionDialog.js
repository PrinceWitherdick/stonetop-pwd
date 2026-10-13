import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { resetOmenReminder } from "../hooks/StonetopSingleton.js";
import { isOutOfPlay, resetNeverGonnaKeepMeDown } from "../actors/character/deaths-door-actor.js";
import { asArray, getPlayerCharacters, playsCharacter } from "../utils/playbook-actors.js";
import { adjustXp } from "../utils/xp.js";
import { stonetopChatCard } from "../utils/chat.js";
import { escHtml } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { getObjectSetting, setSetting } from "../settings.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { sendEndOfSession, sendEndOfSessionClosed, mirrorClosed, requestEndOfSession } from "./end-of-session-broadcast.js";

const KEY = "stonetop.endOfSession";

/** The four group questions (Book I p.232); each "yes" is +1 XP for everyone. Words in languages/en.json. */
export const GROUP_QUESTIONS = ["learnedWorld", "defeatedThreat", "improvedStanding", "improvedStonetop"];

/** The world setting holding the last award, `{at, xp, ids}`. */
export const LAST_AWARD_SETTING = "lastEndOfSession";

/** How recent an award has to be to count as this session's already: asked about before paying again. */
export const RECENT_AWARD_MS = 12 * 60 * 60 * 1000;

const allUsers = () => asArray(globalThis.game?.users);

/**
 * Whether a character sits at the table: a logged-in player plays them. "Everyone marks XP" (Book I
 * p.232) is everyone playing, not every character the world has ever held.
 *
 * Who PLAYS a character is playbook-actors.js#playsCharacter: a player with an assigned
 * character plays that one and no other; only a player with none assigned plays every character they
 * own. A table that shares every sheet makes each player an owner of every character, and owning
 * alone would tick an absent player's character as soon as anyone else logged in.
 */
export function playedByActivePlayer(actor, users = allUsers()) {
	return users.some(user => user?.active && !user.isGM && playsCharacter(actor, user));
}

/**
 * Every player character, and whether it starts ticked: one an active player plays, and not dead. A
 * dead character (deaths-door-actor.js#isOutOfPlay) starts unticked whoever plays it.
 */
export function endOfSessionRoster(users = allUsers()) {
	return getPlayerCharacters().map(actor => {
		const dead = isOutOfPlay(actor);
		return { actor, dead, ticked: !dead && playedByActivePlayer(actor, users) };
	});
}

/** Minutes since a stored award, or null when there is none recent enough to ask about. */
export function recentAwardMinutes(last, now = Date.now()) {
	const at = Number(last?.at);
	if (!Number.isFinite(at) || at <= 0 || now - at > RECENT_AWARD_MS) return null;
	return Math.max(0, Math.round((now - at) / 60000));
}

/** Only the four questions, each true or false: what a player's copy takes from a message. */
export function groupChecksFrom(checks) {
	return Object.fromEntries(GROUP_QUESTIONS.map(key => [key, checks?.[key] === true]));
}

/**
 * The GM's window, or (with `mirror: {run, checks}`) a player's read-only copy of it: the prompts
 * and the GM's ticks, with no roster and nothing to award. See end-of-session-broadcast.js.
 */
export class EndOfSessionDialog extends StonetopDialog {
	constructor({ mirror, ...options } = {}) {
		super(options);
		this._mirror = !!mirror;
		this._groupChecks = groupChecksFrom(mirror?.checks);
		if (this._mirror) {
			this.run = mirror.run;
			this._roster = [];
			this._pcChecks = {};
			return;
		}
		// The table's copies follow this window by this id (end-of-session-broadcast.js).
		this.run = globalThis.foundry?.utils?.randomID?.() ?? String(Math.random()).slice(2);
		// Whose XP it is, ticked as the table stands now; the GM corrects it before awarding.
		this._roster = endOfSessionRoster();
		this._pcChecks = Object.fromEntries(this._roster.map(row => [row.actor.id, row.ticked]));
	}

	/**
	 * The hotbar macro's way in: the window already open is brought forward. A second window would be
	 * a second run, and the players' copies would flip between the two on every tick.
	 *
	 * A player gets the GM's window as their read-only copy, never one of their own
	 * (end-of-session-broadcast.js#requestEndOfSession). Told so when no copy comes: it arrives only
	 * if a GM has the window open, and a press that seemed to do nothing would be pressed again.
	 */
	static open() {
		if (!globalThis.game?.user?.isGM) {
			return requestEndOfSession({
				onNoAnswer: () => globalThis.ui?.notifications?.info?.(localize(`${KEY}.playerAsk`)),
			});
		}
		return openOrFocus(this.defaultOptions.id, () => new this().render(true));
	}

	/** The group questions as ticked now. */
	get groupChecks() { return { ...this._groupChecks }; }

	/**
	 * A player's copy: the GM ticked or unticked something. Drawn once any draw under way is over,
	 * since core drops a render asked for while one is running and the tick would never show.
	 */
	async showChecks(checks) {
		if (!this._mirror) return;
		this._groupChecks = groupChecksFrom(checks);
		await this.settled();
		if (!this.rendered) return;
		this.render(false);
		await this.settled();
	}

	/**
	 * Resolves once every draw asked for so far is over, however it ended. Core's `render` does not
	 * wait for its own draw, and both a close and a redraw asked for in the middle of one are dropped
	 * (Application#close answers only a window RENDERED or ERROR), so the broadcast waits on this.
	 */
	settled() { return this._drawing ?? Promise.resolve(); }

	_render(force, options) {
		const drawing = (async () => {
			await super._render(force, options);
			// Every draw, so each tick reaches the table. A player's client sends nothing.
			if (!this._mirror) sendEndOfSession(this, this._groupChecks);
		})();
		// Chained, so a redraw asked for mid-draw (which core returns from at once) does not stand in
		// for the draw still running.
		this._drawing = Promise.allSettled([this._drawing, drawing]).then(() => {});
		return drawing;
	}

	async close(options = {}) {
		// After any draw under way, or core drops the close while the table is told it happened.
		await this.settled();
		if (this._mirror) mirrorClosed(this);
		else sendEndOfSessionClosed(this);
		return super.close(options);
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-end-of-session-dialog",
			template:  "systems/stonetop-pwd/templates/dialogs/end-of-session.hbs",
			title:     localize(`${KEY}.title`),
			width:     500,
			height:    620,
			resizable: true,
			classes:   ["stonetop", "stonetop-eos-dialog"],
		});
	}

	getData() {
		const xpCount = Object.values(this._groupChecks).filter(Boolean).length;
		const questions = GROUP_QUESTIONS.map(key => ({
			key,
			label:   localize(`${KEY}.questions.${key}`),
			checked: this._groupChecks[key],
		}));
		const pcs = this._roster.map(({ actor, dead }) => ({
			id: actor.id, name: actor.name, dead, checked: !!this._pcChecks[actor.id],
		}));
		return {
			questions, pcs, xpCount, mirror: this._mirror,
			tally: format(`${KEY}.${this._mirror ? "mirrorTally" : "tally"}`, { xp: xpCount }),
			awardLabel: format(`${KEY}.award`, { xp: xpCount }),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);

		// A player's copy reads; the GM's window is the one that ticks and awards.
		if (this._mirror) {
			html.find(".stonetop-eos-confirm-btn").on("click", () => this.close());
			return;
		}

		html.find(".stonetop-eos-group-check[data-key]").on("change", ev => {
			this._groupChecks[ev.currentTarget.dataset.key] = ev.currentTarget.checked;
			this.render(false);
		});
		html.find(".stonetop-eos-group-check[data-pc]").on("change", ev => {
			this._pcChecks[ev.currentTarget.dataset.pc] = ev.currentTarget.checked;
			this.render(false);
		});

		html.find(".stonetop-eos-confirm-btn").on("click", async (ev) => {
			// Re-entrancy guard, the shared one (StonetopDialog#_guardBusy): awarding walks every
			// ticked character with a separate write apiece, then posts a card and resets the
			// Omen reminder, and the window closes only when all of that has landed. A
			// four-player table therefore leaves this button live and inviting for several round
			// trips, and a second click in that gap awards the whole session's XP twice to
			// everyone.
			await this._guardBusy(ev, () => this._applyGroupXp());
		});
	}

	/**
	 * A press turned down without closing the window (the GM said not to award again, or a player
	 * pressed): drawn afresh, so the button the press greyed is live again. StonetopDialog#_guardBusy
	 * puts it back only on a throw, and counts on the caller to close or redraw otherwise; left
	 * greyed, the GM could neither award nor end the session from it without ticking something first.
	 */
	_redrawButton() {
		if (this.rendered) this.render(false);
	}

	/** The characters ticked to mark the session's XP. */
	_tickedActors() {
		return this._roster.filter(row => this._pcChecks[row.actor.id]).map(row => row.actor);
	}

	/**
	 * Ask before paying a session's XP that was already paid recently: a second GM, or the same GM
	 * reopening the window, would otherwise hand it all out again. True to go ahead.
	 */
	async _confirmAgain({ ask = askWithButtons, now = Date.now() } = {}) {
		const last = getObjectSetting(LAST_AWARD_SETTING);
		const minutes = recentAwardMinutes(last, now);
		if (minutes == null) return true;
		return !!(await ask({
			title:   localize(`${KEY}.againTitle`),
			content: format(`${KEY}.againPrompt`, {
				minutes, xp: Number(last.xp) || 0, count: Array.isArray(last.ids) ? last.ids.length : 0,
			}),
			buttons: [
				{ key: "again", label: localize(`${KEY}.againYes`), value: true },
				{ key: "stop", label: localize(`${KEY}.againNo`), value: false },
			],
			defaultKey: "stop",
		}));
	}

	async _applyGroupXp() {
		// The GM's to award: a player's client cannot write the other players' characters, and would
		// stop part-way through the table.
		if (!globalThis.game?.user?.isGM) {
			globalThis.ui?.notifications?.warn?.(localize(`${KEY}.gmOnly`));
			return this._redrawButton();
		}
		const xpToAward = Object.values(this._groupChecks).filter(Boolean).length;
		const ticked = this._tickedActors();

		if (ticked.length > 0 && xpToAward > 0) {
			if (!(await this._confirmAgain())) return this._redrawButton();

			// Through adjustXp (utils/xp.js) so the award queues behind anything else changing
			// that character's XP and reads their total at the moment it writes. The end of a
			// session is exactly when a last roll is still settling somewhere. One character's
			// failed write does not stop the rest, and the card says who was and was not paid.
			const paid = [];
			const failed = [];
			for (const actor of ticked) {
				try {
					await adjustXp(actor, xpToAward, { move: "End of Session" });
					paid.push(actor);
				} catch (err) {
					console.error(`Stonetop | End of Session could not write ${actor.name}'s XP:`, err);
					failed.push(actor);
				}
			}

			await setSetting(LAST_AWARD_SETTING, { at: Date.now(), xp: xpToAward, ids: paid.map(a => a.id) });

			const names = list => list.map(a => `<strong>${escHtml(a.name)}</strong>`).join(", ");
			const leftOut = this._roster.filter(row => !this._pcChecks[row.actor.id]).map(row => row.actor);
			const yeses = GROUP_QUESTIONS.filter(key => this._groupChecks[key])
				.map(key => `<li>${escHtml(localize(`${KEY}.questions.${key}`))}</li>`).join("");
			const lines = [
				paid.length ? `<p>${format(`${KEY}.cardPaid`, { names: names(paid), xp: xpToAward })}</p>` : "",
				failed.length ? `<p>${format(`${KEY}.cardFailed`, { names: names(failed) })}</p>` : "",
				leftOut.length ? `<p>${format(`${KEY}.cardLeftOut`, { names: names(leftOut) })}</p>` : "",
			].join("");
			const content = stonetopChatCard(
				format(`${KEY}.cardTitle`, { xp: xpToAward }),
				`<div class="card-content">
					<ul class="stonetop-eos-award-list">${yeses}</ul>
					${lines}
				</div>`,
				"stonetop-eos-chat-card",
			);
			ChatMessage.create({ content });
			if (failed.length) {
				globalThis.ui?.notifications?.warn?.(format(`${KEY}.failedWarn`, { names: failed.map(a => a.name).join(", ") }));
			}
		}

		await resetOmenReminder();
		// A new session gives back Never Gonna Keep Me Down's once-a-session 10+ at Death's Door.
		await resetNeverGonnaKeepMeDown(this._roster.map(row => row.actor));
		this.close();
	}
}
