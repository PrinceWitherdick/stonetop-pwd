/**
 * The four divisions Book II's bestiary is written in, and which pack folder each one is.
 *
 * They are a real editorial taxonomy, not a shape of the data: "Peoples & Folk" is who you
 * can talk to, "Regions" is what lives in a particular place, "Primordial & Mythic Powers"
 * is what was here first, and "The Makers" is what built the ruins. It's how the book is
 * organised, so it's how someone looking for a monster thinks to look — which is why the
 * bestiary browser leads with it (see dialogs/catalog/MonsterSource.js).
 *
 * `folder` is the pack folder's NAME rather than its id: the ids are pack-build artefacts,
 * while the names are authored and are what a GM sees in the compendium. A monster in some
 * other folder (a homebrew one, or a world actor filed anywhere) resolves to no section and
 * simply isn't matched by these chips — it still shows in the unfiltered list.
 *
 * Ordered roughly mundane → cosmic, which is the order they're easiest to hold in mind.
 */
export const BESTIARY_SECTIONS = [
	{
		key:    "peoples",
		label:  "Peoples",
		folder: "Peoples & Folk",
		icon:   "fas fa-people-group",
		hint:   "Peoples & Folk: the ones you can talk to before you fight them",
	},
	{
		key:    "regions",
		label:  "Regions",
		folder: "Regions",
		icon:   "fas fa-tree",
		hint:   "Regions: what lives in the Hillfolk lands, the fens, the forest, the deeps",
	},
	{
		key:    "powers",
		label:  "Powers",
		folder: "Primordial & Mythic Powers",
		icon:   "fas fa-bolt",
		hint:   "Primordial & Mythic Powers: the old things, the great things, the Things Below",
	},
	{
		key:    "makers",
		label:  "Makers",
		folder: "The Makers",
		icon:   "fas fa-gears",
		hint:   "The Makers: their constructs, their servants, and what they left behind",
	},
];

const _BY_FOLDER = new Map(BESTIARY_SECTIONS.map(s => [s.folder, s.key]));

/** The section key for a pack folder name, or "" for a folder that isn't one of the four. */
export function bestiarySectionForFolder(folderName) {
	return _BY_FOLDER.get(String(folderName ?? "").trim()) ?? "";
}

/**
 * How a monster's numbers scale, from Book I p.393 — solitary things are individually
 * dangerous, a horde is dangerous by weight of numbers. The tag drives HP and damage, so it
 * genuinely changes what you're looking at rather than just labelling it.
 */
export const MONSTER_ORGANIZATIONS = [
	{ key: "solitary", label: "Solitary", icon: "fas fa-user",       hint: "Alone, and individually dangerous" },
	{ key: "group",    label: "Group",    icon: "fas fa-user-group", hint: "Comes in small numbers and fights together" },
	{ key: "horde",    label: "Horde",    icon: "fas fa-users",      hint: "Comes in numbers enough that the numbers ARE the threat" },
];
