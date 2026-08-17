import { CatalogSource, summarize, searchIndex } from "./CatalogSource.js";
import { packId } from "../../system-id.js";
import { CREATURE_TYPES, creatureTypeIcon, creatureTypeLabel } from "../../bestiary/creature-types.js";
import { isBestiaryPlaceholderImg } from "../../bestiary/monster-portrait.js";
import { BESTIARY_SECTIONS, MONSTER_ORGANIZATIONS, bestiarySectionForFolder } from "../../bestiary/bestiary-sections.js";
import { PERSON_DEFAULT_IMG } from "../../utils/person-portrait.js";

const BESTIARY_PACK = packId("stonetop-bestiary");

/**
 * Every monster stat block the world can reach: the 212-entry bestiary compendium, plus any
 * world monster actors — a GM's own creations, and the copies dragged out of the pack to be
 * edited.
 *
 * The compendium lists monsters as bare names in four folders, so it could only be looked
 * something UP in, never looked THROUGH. This is the other view: what have I got, and which
 * of it fits the scene I'm about to run.
 *
 * Its chip groups, all single-select:
 *
 *  • SECTION — the book's own four divisions, off the pack folder
 *  • TYPE — the 12 creature types from Book I p.392, as their own circular art
 *  • NUMBERS — Solitary / Group / Horde, the tag that drives HP and damage
 */
export class MonsterSource extends CatalogSource {
	constructor() {
		super({
			key:   "monsters",
			label: "Monsters",
			icon:  "fas fa-dragon",
			noun:  "monsters",
			nounOne: "monster",
			search: { title: "Search monsters", placeholder: "Filter monsters…" },
			empty:  "No monsters match those filters.",
			// A world monster edit stales this list; CatalogSource#staleFor spells out what that
			// does and does not count as.
			worldActorType: "monster",
			// A stat block drags as the Actor it is — onto a scene to place its token (core
			// imports the pack copy into the world first), into the Actors directory to keep one,
			// onto a character sheet to offer the follower conversion.
			dragType: "Actor",
		});
	}

	facetGroups() {
		return [
			{
				key:   "section",
				label: "Section",
				chips: BESTIARY_SECTIONS.map(s => ({ key: s.key, label: s.label, icon: s.icon, hint: s.hint })),
			},
			{
				key:      "type",
				label:    "Type",
				// A dropdown rather than chips: thirteen of them, and several ("Spirit /
				// Construct", "Corrupted / Fomoraij") have names no pill can carry. The list
				// spells each one out with its count, which the icon chips could only manage in
				// a tooltip. Each row still wears its type's disc as a badge, so the art the
				// taxonomy is taught by hasn't gone anywhere.
				control:  "select",
				allLabel: "Any type",
				chips:    CREATURE_TYPES.map(t => ({ key: t.slug, label: t.label })),
			},
			{
				key:   "organization",
				label: "Numbers",
				chips: MONSTER_ORGANIZATIONS.map(o => ({ key: o.key, label: o.label, icon: o.icon, hint: o.hint })),
			},
		];
	}

	/**
	 * A world actor with the same name as a compendium one wins and the pack copy is dropped —
	 * the same precedence the bestiary cross-reference index uses, and for the same reason:
	 * when a GM has made their own version, that is the one they mean.
	 */
	async loadRows() {
		const world = [...(game.actors ?? [])].filter(a => a.type === "monster");
		const taken = new Set(world.map(a => a.name));
		const rows  = world.map(doc => this._row(doc, /* homebrew */ true));
		rows.push(...(await this._packRows()).filter(row => !taken.has(row.title)));
		rows.sort((a, b) => a.title.localeCompare(b.title));
		return rows;
	}

	/**
	 * The compendium half of the list, built once per window.
	 *
	 * Memoised (CatalogSource#_once) separately from the browser's row cache because it costs 212
	 * document reads and a compendium cannot change under us — while the world half is re-read on
	 * every monster edit. Without the split, a GM renaming one monster would re-pull the whole
	 * bestiary.
	 */
	async _packRows() {
		return this._once("packRows", async () => {
			const pack = game.packs.get(BESTIARY_PACK);
			if (!pack) return [];
			// One query for the lot. getDocument() falls through to a getDocuments({_id}) per
			// uncached id, so asking per index entry is 212 server round-trips for the same data.
			const docs = (await pack.getDocuments()).filter(d => d.type === "monster");
			return docs.map(doc => this._row(doc, false));
		});
	}

	_row(doc, homebrew) {
		const sys     = doc.system ?? {};
		const type    = sys.creatureType ?? "";
		const org     = sys.organization ?? "";
		const section = bestiarySectionForFolder(doc.folder?.name);
		const concept = summarize(sys.concept ?? "");
		const hp      = sys.attributes?.hp?.max ?? 0;
		const armor   = sys.attributes?.armor?.value ?? 0;
		// Every stat block ships wearing its creature-type disc, so "has no art" is a real
		// state for most of the pack until a GM imports the book illustrations.
		const placeholder = isBestiaryPlaceholderImg(doc.img);

		const flags = [];
		const sectionDef = BESTIARY_SECTIONS.find(s => s.key === section);
		if (sectionDef) flags.push({ label: sectionDef.label, mod: "strong" });
		if (homebrew)   flags.push({ label: "World" });

		const badges = [];
		if (type) badges.push({ label: creatureTypeLabel(type), img: creatureTypeIcon(type), hint: "Creature type" });
		if (org)  badges.push({ label: MONSTER_ORGANIZATIONS.find(o => o.key === org)?.label ?? org, hint: "How many of them there are" });
		if (hp)   badges.push({ label: `${hp} HP`, hint: armor ? `${armor} armor: ${sys.attributes?.armor?.source || "armor"}` : "Hit points" });
		if (sys.size) badges.push({ label: sys.size, hint: "Size" });

		return {
			key:   doc.uuid,
			uuid:  doc.uuid,
			title: doc.name,
			img:   placeholder ? (creatureTypeIcon(type) ?? doc.img ?? PERSON_DEFAULT_IMG) : doc.img,
			placeholderImg: placeholder,
			summary: concept,
			// The monster's own tag line, which is prose on the stat block and reads as prose
			// here — and is the thing a GM actually searches ("something stealthy and hardy").
			note:  sys.tags ?? "",
			flags,
			badges,
			facets: { section, type, organization: org },
			// `attributes.instinct.value`, not the NPC's flat `system.instinct` — a monster keeps
			// its instinct inside `attributes` (MonsterModel), so the NPC row's expression read
			// undefined here and no monster's instinct was searchable at all.
			search: searchIndex(
				doc.name, concept, sys.tags, sys.attributes?.instinct?.value,
				creatureTypeLabel(type), org, sys.size, sectionDef?.label,
			),
		};
	}
}
