// ── Seasons Change: the threat its roll calls for (Book I pp.516-517, 520) ──────
// "On a 7-9 in spring or autumn, or a 6- in summer, either introduce a new threat to the steading or have an
// existing threat advance towards impending doom" (p.520). "Threats abound: on a 6- in spring, autumn, or
// winter ... Multiple threats advance towards impending doom" (p.520).
//
// The GM's step in the Seasons Change window, beside the roll: which results call for a threat this season,
// a button to the threats (the GM Toolkit's Threats tab, where a new one is written up), and each written-up
// threat's next grim portent with a button that marks it come to pass. WHICH threat, and whether at all, is
// the GM's call (p.521: "Pick threats ... based on the results, the established fiction, the needs of your
// game"), so nothing is marked until a button is pressed, and any number can be.

import { escHtml } from "../../utils/strings.js";
import { isThreatResolved, listThreatPages, setPortentDone } from "../../threats/threat-store.js";
import { theGmToolkit } from "../gmtoolkit/gm-toolkit-actor.js";
import { SEASON_FORTUNES, SEASON_TIER_LABELS } from "./season-fortunes.js";

// What the GM does about each kind of threat result (the `threat` tags on season-fortunes.js's table).
const THREAT_TEXT = {
	known: "A threat to the steading makes itself known or gets worse: introduce a new threat, or advance one toward its impending doom.",
	abound: "Threats abound: make things bad. Several threats may advance toward their impending dooms.",
};

/**
 * The results of this season's +Fortunes roll that call for a threat, as `[tier, text]` rows. PURE.
 * Spring and autumn: 7-9 and 6-. Summer: 6- only (its 7-9 is a gain). Winter: 6- only.
 */
export function seasonThreatRows(seasonId) {
	return (SEASON_FORTUNES[seasonId]?.rows ?? [])
		.filter(row => row.threat)
		.map(row => [SEASON_TIER_LABELS[row.tier], THREAT_TEXT[row.threat]]);
}

/**
 * Each written-up threat's next grim portent, the first not yet come to pass: `{pageId, name, index, text}`.
 * A threat whose impending doom has come, or one marked resolved, has nothing left to advance. PURE.
 */
export function nextPortents(pages = []) {
	const out = [];
	for (const page of pages) {
		const sys = page?.system ?? {};
		if (isThreatResolved(page) || sys.impendingDoom?.done) continue;
		const portents = Array.isArray(sys.grimPortents) ? sys.grimPortents : [];
		const index = portents.findIndex(p => !p?.done);
		if (index < 0) continue;
		out.push({ pageId: page.id, name: page.name ?? "", index, text: String(portents[index]?.text ?? "").trim() });
	}
	return out;
}

/** The step's markup. `portents` from nextPortents; `threatCount` how many threats are written up. PURE. */
export function seasonThreatsStepHtml(seasonId, portents = [], { threatCount = portents.length } = {}) {
	const rows = seasonThreatRows(seasonId);
	const list = portents.length
		? `<ul class="stonetop-season-threat-list">
			${portents.map(p => `<li class="stonetop-season-threat">
				<span class="stonetop-season-threat-name">${escHtml(p.name)}</span>
				<span class="stonetop-season-threat-portent">${escHtml(p.text || `Grim portent ${p.index + 1}`)}</span>
				<button type="button" class="stonetop-season-btn" data-action="advance-portent" data-page-id="${escHtml(p.pageId)}" data-index="${p.index}">
					<i class="fas fa-skull"></i> It comes to pass
				</button>
			</li>`).join("")}
		</ul>`
		: `<p class="stonetop-season-note">${threatCount
			? "None of the written-up threats has a grim portent left to mark."
			: "No threats are written up yet. Open the threats to write one up."}</p>`;
	return `<p>When the roll calls for it (Book I p.520):</p>
		<ul>${rows.map(([tier, text]) => `<li><strong>${tier}:</strong> ${escHtml(text)}</li>`).join("")}</ul>
		<div class="stonetop-season-actions">
			<button type="button" class="stonetop-season-btn" data-action="open-threat-board">
				<i class="fas fa-book-skull"></i> Open the threats (write one up)
			</button>
		</div>
		<p class="stonetop-season-gains-label">Advance a threat <span class="stonetop-season-gains-hint">(its next grim portent)</span></p>
		${list}`;
}

/** The step for a steading, off its written-up threats (the Seasons Change window builds it with this). */
export function seasonThreatsStepFor(steadingActor, seasonId, { listPages = listThreatPages } = {}) {
	const pages = listPages(steadingActor);
	return seasonThreatsStepHtml(seasonId, nextPortents(pages), { threatCount: pages.length });
}

/**
 * Open the threats: the GM Toolkit's Threats tab, on top. Whether there was a toolkit to open.
 * @param {{toolkit?: object|null, notify?: object}} [deps]
 */
export function openThreatBoard({ toolkit = theGmToolkit(), notify = globalThis.ui?.notifications } = {}) {
	const sheet = toolkit?.sheet;
	if (!sheet) {
		notify?.warn?.("There is no GM Toolkit in this world to keep threats on.");
		return false;
	}
	const tabs = sheet._tabs?.[0];
	if (sheet.rendered) {
		tabs?.activate?.("threats", { triggerCallback: true });
		sheet.bringToTop?.();
		sheet.maximize?.();
	} else {
		if (tabs) tabs.active = "threats";
		sheet.render(true);
	}
	return true;
}

/**
 * Wire the step: the board button, and each portent's "It comes to pass" (setPortentDone), which says so in
 * place of the button once written.
 *
 * @param {HTMLElement} root  the window's content
 * @param {Actor} steadingActor
 * @param {object} [deps]  injectable for tests
 */
export function wireSeasonThreats(root, steadingActor, {
	listPages = listThreatPages, setDone = setPortentDone, openBoard = openThreatBoard,
	notify = globalThis.ui?.notifications,
} = {}) {
	root?.querySelector?.("[data-action='open-threat-board']")?.addEventListener("click", () => openBoard());
	for (const btn of root?.querySelectorAll?.("[data-action='advance-portent']") ?? []) {
		btn.addEventListener("click", async () => {
			if (btn.disabled) return;
			btn.disabled = true;
			try {
				const page = listPages(steadingActor).find(p => p.id === btn.dataset.pageId);
				const wrote = page ? await setDone(page, Number(btn.dataset.index), true) : false;
				if (!wrote) {
					notify?.warn?.("That grim portent has already come to pass, or the threat is gone.");
				} else {
					notify?.info?.(`${page.name}: a grim portent comes to pass.`);
				}
				const done = btn.ownerDocument.createElement("span");
				done.className = "stonetop-season-threat-done";
				done.textContent = wrote ? "Come to pass." : "Already marked.";
				btn.replaceWith(done);
			} catch (err) {
				btn.disabled = false;
				throw err;
			}
		});
	}
}
