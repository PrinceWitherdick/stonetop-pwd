import { CatalogSource, searchIndex } from "./CatalogSource.js";
import { facetChipsFromRows } from "../../utils/catalog-filters.js";
import { NPC_STATUSES, npcStatusMeta } from "../../data-models/npc-status.js";
import { PERSON_DEFAULT_IMG } from "../../utils/person-portrait.js";
import { isDefaultImg } from "../../utils/strings.js";
// The village-is-the-default rule belongs to the module that writes the field, not to a reader.
import { HOME_STONETOP, npcHome } from "../../actors/steading/steading-people.js";

/**
 * Icons for the NPC lifecycle statuses. Kept here rather than in npc-status.js because they
 * are this list's chip vocabulary, not part of what a status IS — the sheet and the steading
 * roster render the same statuses without any of these.
 *
 * `""` (the active default) is remapped to the key "active": an empty chip key is how the
 * filter layer spells "nothing lit", so a chip keyed "" could never light (see
 * utils/catalog-filters.js).
 */
const NPC_STATUS_ICONS = {
	active:  "fas fa-circle",
	away:    "fas fa-route",
	missing: "fas fa-question",
	retired: "fas fa-mug-hot",
	dead:    "fas fa-skull",
};

/** The chip key for a stored status value; "" (active) becomes "active". */
function statusKey(value) {
	return npcStatusMeta(value).value || "active";
}

/**
 * Every NPC actor in the world, sorted by name — the status chips do the triage.
 *
 * NPCs are scattered down the Actors sidebar among the PCs and followers, so there was
 * nowhere to ask "who have we got, and who is still alive". An NPC list is the GM's own
 * notes — status, home, who's dead — which is half of why the browser holding it is GM-only.
 *
 * Its two chip groups, both single-select:
 *
 *  • STATUS — Active / Away / Missing / Retired / Dead
 *  • HOME — Stonetop and every steading the NPCs actually come from
 */
export class PeopleSource extends CatalogSource {
	constructor() {
		super({
			key:   "people",
			label: "People",
			icon:  "fas fa-user-group",
			noun:  "people",
			search: { title: "Search people", placeholder: "Filter people…" },
			empty:  "No one matches those filters. (People are the world's NPC actors: a fresh world has none until the steading roster is filled in.)",
			// An NPC edit stales this list; CatalogSource#staleFor spells out what that does and
			// does not count as.
			worldActorType: "npc",
			// Everyone here is already a world Actor, so a row drags as one — onto a scene to put
			// them on the map, onto a character sheet to offer the follower conversion.
			dragType: "Actor",
		});
	}

	facetGroups(rows) {
		return [
			{
				key:   "status",
				label: "Status",
				chips: NPC_STATUSES.map(s => ({
					key:   statusKey(s.value),
					label: s.label,
					icon:  NPC_STATUS_ICONS[statusKey(s.value)],
					hint:  s.inactive ? `${s.label}: no longer an active presence` : s.label,
				})),
			},
			{
				key:   "home",
				label: "Home",
				// Built from the world rather than a fixed list: which steadings the NPCs come
				// from is a fact about this campaign. Stonetop leads, being where it happens.
				chips: facetChipsFromRows(rows, "home", { first: HOME_STONETOP })
					.map(chip => ({ ...chip, hint: chip.key === HOME_STONETOP ? "Lives in Stonetop itself" : `Lives in ${chip.label}` })),
			},
		];
	}

	async loadRows() {
		return [...(game.actors ?? [])]
			.filter(a => a.type === "npc")
			.map(doc => this._row(doc))
			.sort((a, b) => a.title.localeCompare(b.title));
	}

	_row(doc) {
		const sys    = doc.system ?? {};
		const status = npcStatusMeta(sys.status);
		// A blank `home` means a resident of Stonetop itself — the steading sheet's Neighbors
		// column only fills it in for people from somewhere else. Normalised to a real name so
		// it can be a chip key at all (see the empty-key rule in utils/catalog-filters.js).
		const home   = npcHome(doc);
		const placeholder = isDefaultImg(doc.img);

		const flags = [{ label: status.label, mod: status.inactive ? "bad" : "" }];
		if (home !== HOME_STONETOP) flags.push({ label: home });

		const badges = [];
		if (sys.pronouns)  badges.push({ label: sys.pronouns, hint: "Pronouns" });
		if (sys.occupation) badges.push({ label: sys.occupation, hint: "What they do" });
		if (sys.hasStats)  badges.push({ label: "Has stats", icon: "fas fa-shield-halved", hint: "Carries the optional combat overlay: HP, armor, damage, GM moves" });

		// Their instinct is the anchor field the book tells a GM to look at when they don't
		// know what an NPC would do (p.457), so it leads; relations answer "who is this to
		// anyone?", which is the other thing you scan a list of people for.
		const summary = [sys.instinct, sys.relations].map(s => (s ?? "").trim()).filter(Boolean).join(" · ");

		return {
			key:   doc.uuid,
			uuid:  doc.uuid,
			title: doc.name,
			img:   placeholder ? PERSON_DEFAULT_IMG : doc.img,
			placeholderImg: placeholder,
			inactive: status.inactive,
			summary,
			note:  (sys.traits ?? "").trim(),
			flags,
			badges,
			facets: { status: statusKey(sys.status), home },
			search: searchIndex(
				doc.name, sys.occupation, sys.traits, sys.instinct, sys.relations,
				sys.pronouns, home, status.label,
			),
		};
	}
}
