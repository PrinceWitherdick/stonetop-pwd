// RUNNING A SITE, as a reference panel on every site card (Book I p.348): the considerations to
// keep in mind while the PCs explore, and the book's quick reference for light sources and their
// tags. The same on every site, so it is a constant, folded shut under the card's own sections.
//
// The light tags are the gear tags the system already knows (module/data/gear-terms.js: hand,
// close, reach, area, crude, dangerous, slow), read here the way the book reads them for a light
// source. Book text, CC BY-SA, condensed only where a sentence would not stand alone.

/** "As PCs explore sites ... keep in mind:" (p.348). A name and one line each. */
export const SITE_CONSIDERATIONS = Object.freeze([
	{ name: "The physical space", line: "Rough dimensions, construction, ceilings and passages, obstacles, footing, slopes, levels." },
	{ name: "Light sources", line: "Who's carrying them? What are their tags? How far can they see, what out in the dark can see them, and how long will they last?" },
	{ name: "Senses other than sight", line: "Sounds, but also odors and textures, heat and cold and humidity, air pressure and movement." },
	{ name: "Marching order", line: "Who's going first, who's next, and who's bringing up the rear? Especially in cramped quarters or when something attacks." },
	{ name: "Equipment", line: "What's in hand or at the ready? How heavy a load? Room to swing that maul? Can they fit through with their shield?" },
	{ name: "Followers and NPCs", line: "Where are they, what are they doing, how do they react? If left at camp or on guard, what befalls them?" },
	{ name: "Physical and mental states", line: "Hunger and thirst, fatigue, irritability, disorientation, dread. How do the PCs react? How do NPCs handle it?" },
	{ name: "Denizens", line: "Who or what else is here? What signs of them? Would they notice the PCs, and are they hostile, wary or curious?" },
]);

/** "Light sources & tags ... Here's a quick reference" (p.348). */
export const LIGHT_TAGS = Object.freeze([
	{ name: "Hand", line: "E.g., a rushlight. Illuminates no farther than your reach. Barely enough to navigate or read by." },
	{ name: "Close, area", line: "E.g., a candle, oil lamp, or lantern. Casts light a few feet, enough for 2 people to navigate by." },
	{ name: "Reach, area", line: "E.g., a torch. Illuminates out to ~10 feet, enough for a small party to navigate by." },
	{ name: "Crude", line: "E.g., a rushlight, an oil lamp. Prone to flicker or snuff out when moved quickly or in light wind." },
	{ name: "Dangerous", line: "E.g., a torch. A big open flame, smoky, prone to catch things on fire if not careful." },
	{ name: "Slow", line: "E.g., a tinderbox. It takes at least a few minutes to start a new fire!" },
]);

/** The book's closing note under the light reference (p.348). */
export const LAMP_OIL_NOTE = "Lamp oil is useless as a weapon. It takes time and effort to light, doesn't burn very hot, and goes out if spilled.";

/** The card's fold for this panel, shut by default wherever the card is drawn. */
export const SITE_RUNNING_GROUP = Object.freeze({
	id: "run", label: "Running it (p.348)", holds: Object.freeze(["Light & tags", "Marching order"]), show: true, open: false,
});
