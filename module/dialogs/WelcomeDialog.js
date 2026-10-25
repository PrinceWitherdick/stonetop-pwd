import { setSetting } from "../settings.js";
import { enrichHTML } from "../utils/foundry-compat.js";
import { findVisibleJournal, settingOverviewPages, SETTING_OVERVIEW_JOURNAL } from "../utils/seeded-journals.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { ensurePackIndex } from "../utils/pack-index.js";
import { applyGuideRail } from "../utils/guide-rail.js";
import { applyLocationTooltips } from "../locations/location-tooltips.js";
import { FoundryBasicsDialog } from "./FoundryBasicsDialog.js";
import { charactersPlayedBy } from "../utils/playbook-actors.js";
import { createCharacterForUser } from "../actors/character/create-character.js";
import { stonetopSteadingHeaderButton } from "../utils/world.js";
import { runImportBookArtMacro } from "../book2-art/macro.js";
import { hasImportedBook2Art } from "../book2-art/reapply.js";
// Shared with the replacement confirmation, so the roster's "on page 4 of 9" and the
// warning shown before that character is deleted can never disagree.
import { progressFor } from "../actors/character/onboarding-progress.js";
import { SYSTEM_ID, JOURNAL_PACK } from "../system-id.js";
import { pastWelcomeGuide, sessionZeroComplete } from "./walkthrough-resume.js";
import { confirmOutcome } from "../utils/ask-with-buttons.js";

// ── WelcomeDialog ───────────────────────────────────────────────────────────
// A GM-only "first session" guide. Walks the GM through the Book I "Getting
// Started" steps (review the setting → set expectations → create characters →
// introduce the PCs → let spring burst forth), and turns the two interactive
// steps into one-click actions:
//   • Create characters — a roster of the world's players, each with a button
//     that mints a fresh character, hands that player ownership, and greets the
//     player with the creation intro on their screen — which walks them through
//     the playbook picker / onboarding and then opens their finished sheet. See
//     _maybeOpenCharacterCreation in hooks/Ready.js.
//   • Introduce the PCs — launches the existing guided Introductions dialog.

// Premise blurb at the top of the guide, pulled from the seeded Setting Overview
// journal's premise page so there's only one copy of the prose to maintain. Its
// first paragraph is the hook; enriching it resolves the {Stonetop} @UUID link to
// this world's village journal. Falls back to a plain sentence if the journal
// hasn't been seeded/isn't visible yet.
const PREMISE_FALLBACK =
	"You play the heroes of <strong>Stonetop</strong>, an isolated village near the edge " +
	"of the known world. Adventures focus on dealing with threats to the village, seizing " +
	"opportunities for the village, or pursuing personal goals. Months or years might pass " +
	"between adventures.";

function premiseSource() {
	const firstPage = settingOverviewPages()[0];
	// Inner HTML of the page's first paragraph — the template already wraps it in
	// its own <p class="stonetop-welcome-lead">, so don't return the <p> itself.
	const firstParagraph = (firstPage?.text?.content ?? "").match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
	return firstParagraph ?? PREMISE_FALLBACK;
}

// The guide's panels, in order, driving the left rail (like Run an Expedition /
// Make a Monster). `key` matches a `<section data-tab>` in the template and the
// rail button's `data-tab`; `title` labels the rail entry and the banner; `icon`
// is a Font Awesome 6 glyph. The overview is the landing panel. The five `step` entries
// are Book I's "Getting Started" steps and drive the banner's "Step N of 5" count. Book
// Art keeps its place in the rail but is not one of the book's steps: it has no `step`,
// so its banner shows only the "optional" tag (the overview shows neither).
const SECTIONS = [
	{ key: "overview",     title: "Getting started",       icon: "fa-signs-post" },
	{ key: "book-art",     title: "Import the book art",     icon: "fa-images",         optional: true },
	{ key: "setting",      title: "Review the setting",    icon: "fa-book-open",      step: 1 },
	{ key: "expectations", title: "Set expectations",      icon: "fa-scale-balanced", step: 2 },
	{ key: "characters",   title: "Create characters",     icon: "fa-user-plus",      step: 3 },
	{ key: "introduce",    title: "Introduce the PCs",     icon: "fa-users",          step: 4 },
	{ key: "spring",       title: "Let spring burst forth", icon: "fa-seedling",      step: 5 },
];
const STEP_COUNT = SECTIONS.filter(s => s.step).length;

export class WelcomeDialog extends Application {
	constructor(options = {}) {
		super(options);
		this._hooks = null;
		// Which rail panel is showing; preserved across the roster's live re-renders
		// (see _registerHooks) so refreshing the player list doesn't snap back to the top.
		this._activeTab = SECTIONS[0].key;
		// Players whose "Create character" press is still being answered (the add-or-replace
		// question, the create, the assignment). Kept on the instance, not the button, because
		// the roster re-renders under a press and draws a fresh, enabled button: the template
		// reads this set to draw it disabled instead. A double-click otherwise minted two.
		this._creatingFor = new Set();
		// The same for "Build N more portraits": a re-render mid-run must not offer it again.
		this._rebuilding = false;
		// "Is book art imported?" and the rebuildable-portrait count are not cached here: both are cheap to re-ask
		// (browseArtDirs keeps the session cache, busted by every writer) and both can change from elsewhere.
	}

	// GM-only, enforced HERE rather than at each caller. The guide mints characters for other
	// players, drives this world's session-zero walkthroughs and launches the art importer —
	// and it is reached through a world macro ("Welcome to Stonetop") that any player can see
	// in the Macro Directory and drag onto their own hotbar, where slot 1 answers the `1` key.
	// A player who did that got a GM console popping open under their hands. The auto-open at
	// ready has its own GM check; this covers the macro, the startup chat card and the console.
	static open() {
		if (!game.user?.isGM) {
			ui.notifications?.warn("The first-session guide is for the GM.");
			return null;
		}
		return openOrFocus("stonetop-welcome", () => new WelcomeDialog().render(true));
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-welcome",
			title:     "Welcome to Stonetop",
			template:  "systems/stonetop-pwd/templates/dialogs/welcome.hbs",
			// Left-rail tabbed sheet (like Run an Expedition / Make a Monster): the rail
			// keeps the window short by showing one step at a time, so it needs less height
			// than the old single-scroll guide and a touch more width for the rail.
			width:     660,
			height:    580,
			resizable: true,
			classes:   ["stonetop", "stonetop-welcome-dialog"],
			// Preserve the reader's place within the active panel when the roster
			// re-renders (e.g. after minting a character), instead of snapping to the top.
			scrollY:   [".stonetop-welcome-main"],
		});
	}

	// "Stonetop" shortcut in the window header — mirrors the steading button on the
	// character sheet header (and the Introductions dialog) — so the GM can jump to
	// the steading sheet straight from the first-session guide.
	_getHeaderButtons() {
		const buttons = super._getHeaderButtons();
		buttons.unshift(stonetopSteadingHeaderButton());
		return buttons;
	}

	async getData() {
		// The premise can carry compendium `@UUID` links (e.g. the village "Stonetop"
		// entry). Those only resolve while enriching if that pack's index is already
		// loaded — and this guide often opens before anything else warms it, which
		// renders the link "broken". Load the index first so it always resolves.
		// Through ensurePackIndex so warming the index for link resolution can't narrow the
		// pack's tracked fields out from under whoever indexed it for their own.
		await ensurePackIndex(JOURNAL_PACK);

		const players = game.users
			.filter(u => !u.isGM)
			.map(u => ({
				id:     u.id,
				name:   u.name,
				avatar: u.avatar,
				active: u.active,
				color:  String(u.color ?? ""),
				// Mid-mint: draw the button disabled (see _creatingFor).
				creating: this._creatingFor.has(u.id),
				// The characters this player PLAYS, which is exactly the list the add-or-replace
				// question behind the button names (createCharacterForUser), so the roster and
				// that question can't disagree about whose characters these are.
				characters: charactersPlayedBy(u.id)
					.map(a => ({
						id: a.id, name: a.name, img: a.img,
						// Live creation progress, stamped by the player's creation flow (see
						// _setOnboardingState in StonetopCharacterSheet). Every character has a
						// note, "Finished" included. Read through progressFor, which also asks
						// whether creation was really finished: a "Save & close" commits the
						// playbook part-way through.
						progress: progressFor(a),
					})),
			}));

		const activeIndex = Math.max(0, SECTIONS.findIndex(s => s.key === this._activeTab));
		const active = SECTIONS[activeIndex];

		// A failed browse reads as "not imported" for this render only: the step then just offers
		// the import, which is the harmless answer either way, and the next render asks again.
		const bookArtImported = await hasImportedBook2Art().catch(() => false);

		// How much could be cut from art already on disk without the PDFs — the detail portraits,
		// the square faces and the creature token squares. Shown here because the one-time chat
		// card that normally offers this latches the moment it is posted, so a GM who missed it has
		// no other way back. Zero (the steady state) renders nothing at all.
		const { countBookArtRebuilds } = await import("../book2-art/run-rebuild.js");
		const rebuildableArt = bookArtImported ? await countBookArtRebuilds() : 0;

		// The guide stops opening by itself once the GM ticks the box OR both session-zero
		// walkthroughs are done (pastWelcomeGuide, the test the auto-open uses). Show what will
		// actually happen: ticked in either case. With the walkthroughs done, unticking could not
		// bring it back, so the box is shown ticked and locked, and says why.
		const sessionDone = sessionZeroComplete();

		return {
			rebuildableArt,
			rebuilding:    this._rebuilding,
			players,
			noPlayers:     players.length === 0,
			// Drives the "you have already done this" state on the Book Art step, so a GM
			// who imported in another world isn't told to go and find their PDFs again.
			bookArtImported,
			dontShowAgain: pastWelcomeGuide(),
			dontShowLocked: sessionDone,
			premiseHtml:   await enrichHTML(premiseSource()),
			// Left rail + banner. Only the first-render active state comes from here;
			// switching panels afterwards is client-side (see _selectTab), so the roster
			// and any partly-filled fields survive without a re-render.
			activeTab:     this._activeTab,
			sections:      SECTIONS.map((s, i) => ({ key: s.key, title: s.title, icon: s.icon, selected: i === activeIndex })),
			active:        { icon: active.icon, title: active.title, optional: !!active.optional, count: this._countLabel(activeIndex) },
			atFirst:       activeIndex === 0,
			atLast:        activeIndex === SECTIONS.length - 1,
		};
	}

	// Banner "Step N of M" for Book I's five steps; blank for the overview landing and the
	// optional, unnumbered Book Art panel. N is the step's ordinal by position (not a stored
	// number), so the count can never skip or repeat.
	_countLabel(index) {
		if (!SECTIONS[index]?.step) return "";
		const ordinal = SECTIONS.slice(0, index + 1).filter(s => s.step).length;
		return `Step ${ordinal} of ${STEP_COUNT}`;
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Give the premise's cross-links (e.g. the village "Stonetop" entry) their
		// hover summary, the same as journal sheets get — this dialog isn't a journal
		// render, so it isn't covered by the journal render hooks in stonetop.js.
		applyLocationTooltips(html);

		// Left-rail tabs + Back/Next: switch which step panel is shown, client-side. No
		// re-render, so the roster and any typed-in fields keep their state.
		html.find(".stonetop-welcome-tab").on("click", ev => this._selectTab(ev.currentTarget.dataset.tab));
		html.find(".stonetop-welcome-back").on("click", () => this._step(-1));
		html.find(".stonetop-welcome-next").on("click", () => this._step(1));

		html.find('[data-action="setting-overview"]').on("click", () => this._openSettingOverview());
		html.find('[data-action="agenda-principles"]').on("click", () => this._openSettingOverview("Agenda & Principles"));
		html.find('[data-action="foundry-basics"]').on("click", () => FoundryBasicsDialog.open());
		html.find('[data-action="introductions"]').on("click", () => this._openIntroductions());
		html.find('[data-action="spring-burst"]').on("click", () => this._openSpringBurst());
		html.find('[data-action="configure-players"]').on("click", () => this._openPlayerConfig());
		html.find('[data-action="import-book-art"]').on("click", () => this._runImportBookArt());
		html.find('[data-action="rebuild-portraits"]').on("click", ev => this._rebuildPortraits(ev.currentTarget));
		html.find(".stonetop-welcome-create").on("click", ev =>
			this._onCreateCharacter(ev.currentTarget.dataset.userId, ev.currentTarget));
		html.find(".stonetop-welcome-player-char").on("click", ev => {
			const actor = game.actors.get(ev.currentTarget.dataset.actorId);
			actor?.sheet?.render(true);
		});
		html.find(".stonetop-welcome-dontshow-input").on("change", ev => {
			// Locked ticked once both walkthroughs are done (see getData): a disabled box fires no change.
			setSetting("gmWelcomeShown", ev.currentTarget.checked)
				.catch(err => console.error("Stonetop | could not save the welcome preference", err));
		});

		this._registerHooks();
	}

	// Walk the rail one panel at a time (Back/Next), stopping at the ends.
	_step(delta) {
		const index = SECTIONS.findIndex(s => s.key === this._activeTab);
		const next = SECTIONS[index + delta];
		if (next) this._selectTab(next.key);
	}

	// Show one step panel and light its rail entry, updating the banner (icon, title,
	// optional tag, count) and the Back/Next disabled state to match. Purely DOM — the
	// guide is never re-rendered, so switching panels preserves the roster and anything
	// the GM has already done. Mirrors CreateMonsterDialog._selectTab.
	_selectTab(key) {
		const index = SECTIONS.findIndex(s => s.key === key);
		if (index < 0) return;
		this._activeTab = key;
		const active = SECTIONS[index];
		const root = this.element;
		if (!root?.length) return;

		applyGuideRail(root[0], {
			key, dataKey: "tab",
			tabSelector: ".stonetop-welcome-tab",
			sectionSelector: ".stonetop-welcome-section",
			iconSelector: ".stonetop-welcome-banner-icon",
			icon: active.icon,
			iconExtraClass: "stonetop-welcome-banner-icon",
			mainSelector: ".stonetop-welcome-main",
		});

		root.find(".stonetop-welcome-banner-title").text(active.title);
		const optional = root.find(".stonetop-welcome-banner-optional")[0];
		if (optional) optional.hidden = !active.optional;
		const count = root.find(".stonetop-welcome-banner-count")[0];
		if (count) {
			const label = this._countLabel(index);
			count.textContent = label;
			count.hidden = !label;
		}

		const back = root.find(".stonetop-welcome-back")[0];
		if (back) back.disabled = index === 0;
		const next = root.find(".stonetop-welcome-next")[0];
		if (next) next.disabled = index === SECTIONS.length - 1;
	}

	// Open the shareable "Setting Overview" journal — the same one that auto-opens
	// for everyone — so the GM can reread it or show it to players. Pass a page name
	// to jump straight to it (e.g. the "Agenda & Principles" tab cited in step 2).
	// The journal is the sole source of this content now, so if it isn't
	// seeded/visible yet, say so rather than opening an empty reader.
	_openSettingOverview(pageName) {
		const journal = findVisibleJournal(SETTING_OVERVIEW_JOURNAL);
		if (!journal) {
			ui.notifications.warn("The Setting Overview journal isn't set up in this world yet.");
			return;
		}
		const page = pageName ? journal.pages.find(p => p.name === pageName) : null;
		journal.sheet.render(true, page ? { pageId: page.id } : {});
	}

	_openIntroductions() {
		openOrFocus("stonetop-introductions", () => game.stonetop?.openIntroductions?.());
	}

	// Walk the GM through Book I's "Let spring burst forth" step. SpringBurstDialog is
	// its own focus-singleton (it brings an already-open copy forward), so just open it.
	_openSpringBurst() {
		game.stonetop?.openSpringBurst?.();
	}

	// Launch the seeded "Import Book Art" macro (step 1). This is a GM-only dialog, so
	// execution is allowed. Leaves this guide open — the macro drives its own dialogs.
	// The launch path (world copy, else the shipped compendium copy) is shared with the
	// post-startup art reminder; see runImportBookArtMacro.
	async _runImportBookArt() {
		const result = await runImportBookArtMacro();
		// Redraw the step, which re-asks "is book art on disk?" (see the constructor's note), so
		// it shows its already-imported state.
		if (this.rendered) await this.render(false);
		return result;
	}

	/**
	 * Cut the portraits that can be derived from art already on disk, without the PDFs.
	 *
	 * The same work the one-time chat card offers. It lives here as well because that card
	 * latches when it is POSTED rather than when it is clicked, so scrolling past it once loses
	 * the offer permanently — and on an upgrade that means the new art silently never appears.
	 */
	async _rebuildPortraits(btn) {
		// Once at a time. The button's own disabled state is not enough: a roster refresh mid-run
		// replaces it with a fresh, enabled one (the template reads `_rebuilding` to prevent that).
		if (this._rebuilding) return;
		this._rebuilding = true;
		let ok = false;
		try {
			const { runBookArtRebuildFromButton } = await import("../book2-art/run-rebuild.js");
			// The disable, the counting spinner, the notification and the restore-on-error are the
			// chat card's too, so they live in run-rebuild.js beside the work itself.
			ok = !!await runBookArtRebuildFromButton(btn);
		} finally {
			this._rebuilding = false;
		}
		// Re-render either way: a failed run needs its button back, and a finished one re-counts
		// from disk rather than assuming it is now zero (a partial run leaves the remainder, and
		// the button has to keep offering it).
		if (this.rendered) await this.render(false);
		return ok;
	}

	// Jump to Foundry's core "Configure Players" screen, the same full-page route the gear-tab
	// button uses. That leaves the game for everyone at this screen (the GM returns once they've
	// added users), so ask first: a stray click mid-session would otherwise drop the GM out of it.
	async _openPlayerConfig() {
		const ok = await confirmOutcome({
			title: "Leave the game to configure players?",
			content: "<p>Foundry's <strong>Configure Players</strong> screen is a separate page: opening it "
				+ "<strong>leaves this game</strong> on your screen. Your players stay connected, and you can "
				+ "come back in once you've added them.</p>",
			yes: { label: "Go to Configure Players", icon: "fa-users-gear" },
			no:  { label: "Stay in the game", icon: "fa-xmark" },
		});
		if (!ok) return;
		window.location.href = foundry.utils?.getRoute?.("players") ?? "/players";
	}

	// Mint a fresh character for the given player, hand them ownership, and flag it
	// to open on their screen. The mint itself (replacement confirmation, ownership,
	// assignment, the greeting) is shared with the sidebar "Create Actor" picker — see
	// createCharacterForUser — so the roster and the sidebar can't diverge. Only the GM
	// ever sees this dialog, so we can assume permission to create.
	//
	// Once per player at a time (see _creatingFor): the add-or-replace question and the create
	// both await, and a second press in that gap minted a second character or stacked a second
	// replace confirmation. The button is disabled for the duration, and stays so across any
	// roster refresh, because the template draws it from the same set.
	async _onCreateCharacter(userId, btn = null) {
		if (!userId || this._creatingFor.has(userId)) return null;
		// The roster can be a moment behind a user being deleted elsewhere: say so rather than
		// doing nothing (createCharacterForUser answers null for an unknown user).
		if (!game.users?.get(userId)) {
			ui.notifications?.warn?.("That player no longer exists in this world.");
			if (this.rendered) this.render(false);
			return null;
		}
		this._creatingFor.add(userId);
		if (btn) btn.disabled = true;
		let actor = null;
		try {
			actor = await createCharacterForUser(userId);
		} finally {
			this._creatingFor.delete(userId);
			if (btn) btn.disabled = false;
			if (this.rendered) this.render(false);
		}
		return actor;
	}

	// Keep the roster live while the dialog is open: players coming online/offline, being
	// added, removed or changed, and characters being created/assigned should refresh the list.
	_registerHooks() {
		if (this._hooks) return;
		// Debounced: a player clicking through onboarding writes the progress flag on
		// every page change (each broadcast to the GM), and several players creating
		// at once would otherwise trigger a burst of full roster re-renders.
		const refresh = foundry.utils.debounce(() => { if (this.rendered) this.render(false); }, 150);
		// The roster only reflects characters and their owners, so ignore actor
		// churn (monsters, HP ticks, token moves) that can't change what we show.
		const refreshIfCharacter = actor => { if (actor?.type === "character") refresh(); };
		// The world settings the footer's "Don't show this again" box reflects (see getData), so
		// a second GM ticking it, or finishing the last walkthrough, shows here too.
		const welcomeKeys = new Set([`${SYSTEM_ID}.gmWelcomeShown`, `${SYSTEM_ID}.sessionZeroDone`]);
		const refreshIfWelcomeSetting = setting => { if (welcomeKeys.has(setting?.key)) refresh(); };
		this._hooks = [
			["userConnected", Hooks.on("userConnected", refresh)],
			// Players added, removed, renamed, recoloured or reassigned: all on the roster.
			["createUser",    Hooks.on("createUser",    refresh)],
			["deleteUser",    Hooks.on("deleteUser",    refresh)],
			["updateUser",    Hooks.on("updateUser", (_user, changes) => {
				if (!changes) return;
				if (["name", "avatar", "color", "role", "character"].some(k => k in changes)) refresh();
			})],
			["createSetting", Hooks.on("createSetting", refreshIfWelcomeSetting)],
			["updateSetting", Hooks.on("updateSetting", refreshIfWelcomeSetting)],
			["createActor",   Hooks.on("createActor",   refreshIfCharacter)],
			["deleteActor",   Hooks.on("deleteActor",   refreshIfCharacter)],
			["updateActor",   Hooks.on("updateActor", (actor, changes) => {
				if (actor?.type !== "character") return;
				if ("name" in changes || "img" in changes || "ownership" in changes) { refresh(); return; }
				// Onboarding progress writes (and the unset on completion, which arrives
				// as a "-=onboardingProgress" key) should update the page count live.
				const stFlags = changes.flags?.[SYSTEM_ID];
				if (stFlags && Object.keys(stFlags).some(k => k.replace(/^-=/, "") === "onboardingProgress")) refresh();
			})],
		];
	}

	_unregisterHooks() {
		if (!this._hooks) return;
		for (const [name, id] of this._hooks) Hooks.off(name, id);
		this._hooks = null;
	}

	async close(options = {}) {
		this._unregisterHooks();
		return super.close(options);
	}
}
