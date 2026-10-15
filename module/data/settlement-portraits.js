// Which book picture each settlement's portrait is cut from, and where the square sits in it.
//
// Picked and framed by the user, 2026-10-14, in the local settlement-portrait picker (a page over
// the GM's own extracted art; nothing in it ships). Keyed like a settlement's `system.sourceSlug`:
// a roster slug for a named place, a template id for one of Book II's typical blocks.
//
// NO PIXELS SHIP. `src` names a picture the Import Book Art macro extracts from the GM's own PDF
// into the durable art folder, and `crop` is a fractional rect [x0, y0, x1, y1] of it, square in
// PIXELS (the picker settled that). actors/settlement/settlement-portrait.js cuts the square on the
// GM's machine. A place missing here, or one whose picture is not on disk, wears the first letter
// of its name instead. The two Whitefang places were left on their letter on purpose.

export const SETTLEMENT_PORTRAITS = Object.freeze({
	"marshedge":         { src: "assets/locations/marshedge-1.webp",       crop: [0.367, 0, 0.646, 0.656] },
	"gordins-delve":     { src: "assets/locations/gordins-delve-1.webp",   crop: [0.629, 0, 0.923, 0.999] },
	"barrier-pass":      { src: "assets/locations/barrier-pass-1.webp",    crop: [0.504, 0, 1, 0.673] },
	"lygos":             { src: "assets/bestiary/antiquarian.webp",        crop: [0.542, 0, 0.876, 1] },
	"hillfolk-band":     { src: "assets/bestiary/hillfolk-rider.webp",     crop: [0.299, 0.048, 0.842, 0.799] },
	"manmarch-hamlet":   { src: "assets/locations/north-manmarch-1.webp",  crop: [0.172, 0.652, 0.373, 0.963] },
	"manmarch-hillfort": { src: "assets/locations/north-manmarch-1.webp",  crop: [0.795, 0.106, 0.945, 0.338] },
	"mammoth-herders":   { src: "assets/bestiary/mammoth.webp",            crop: [0.133, 0.186, 0.533, 0.91] },
	"thraulgwyn-band":   { src: "assets/locations/the-labyrinth-2.webp",   crop: [0.071, 0.14, 0.65, 0.948] },
});
