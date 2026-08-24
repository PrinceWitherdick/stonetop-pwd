// A stand-in for Foundry's `Color`, which is what a LIVE document hands back for a ColorField —
// `textColor` and `texture.tint` on every Note this system draws — rather than the "#rrggbb"
// string the pin was written with and every writer here declares.
//
// IT HAS TO BE A NUMBER SUBCLASS, which is the whole point of the fake. `ColorField#initialize`
// returns `Color.from(value)`, and a `Color` is a subclass of Number, so `note.textColor !== "#1b1009"`
// is true no matter what colour the pin is actually wearing. A fake that was merely a
// differently-spelled string would sail through comparisons the real thing fails, which is
// exactly how every refit pass in this system came to rewrite pins it had promised to leave alone.
//
// Mirrors common/utils/color.mjs: `toString()` is "#" plus the value in lowercase hex, padded to
// six, and `css` is an alias for it.

/** Foundry's `Color`, in the one respect these tests need it: a Number that prints as hex. */
export class FakeColor extends Number {
	toString() { return `#${super.toString(16).padStart(6, "0")}`; }

	get css() { return this.toString(); }
}

/** One "#rrggbb" string as the Color a live document would answer with. */
export const asColor = hex => new FakeColor(Number.parseInt(String(hex).replace("#", ""), 16));
