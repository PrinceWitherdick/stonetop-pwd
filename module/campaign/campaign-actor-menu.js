// The campaign's ways out of play, on an actor's right-click menu in the Actors sidebar (Book I p.584):
//  - "Retire..." for a PC still in play: its owner or the GM (campaign/retire-pc.js). The sheet header
//    carries the same button.
//  - "Becomes a Threat..." for a PC or an NPC (a follower's actor among them): GM only
//    (campaign/become-threat.js).
//  - "Return to Play" for a PC who retired, left or turned villain: GM only, for a mistake or a return.

import { contextMenuEntry } from "../utils/foundry-compat.js";
import { canRetire, openRetireDialog, returnToPlay } from "./retire-pc.js";
import { canBecomeThreat, openBecomeThreatDialog } from "./become-threat.js";
import { hasLeftPlay } from "./left-play.js";

/** The world actor a sidebar row stands for. */
const actorOfRow = target => globalThis.game?.actors?.get?.(target?.dataset?.entryId) ?? null;

/** The three entries, readable by both v13 and v14 cores. */
export function campaignMenuEntries() {
	return [
		contextMenuEntry({
			label: "Retire...",
			icon: "fa-solid fa-door-open",
			visible: target => canRetire(actorOfRow(target)),
			run: target => openRetireDialog(actorOfRow(target)),
		}),
		contextMenuEntry({
			label: "Becomes a Threat...",
			icon: "fa-solid fa-skull",
			visible: target => canBecomeThreat(actorOfRow(target)),
			run: target => openBecomeThreatDialog(actorOfRow(target)),
		}),
		contextMenuEntry({
			label: "Return to Play",
			icon: "fa-solid fa-rotate-left",
			visible: target => !!globalThis.game?.user?.isGM && hasLeftPlay(actorOfRow(target)),
			run: target => returnToPlay(actorOfRow(target)),
		}),
	];
}

function addEntries(_directory, options) {
	options.push(...campaignMenuEntries());
}

/** Register the menu entries. Call once, in init. */
export function registerCampaignActorMenu() {
	Hooks.on("getActorContextOptions", addEntries);
}
