import { describe, it, expect } from "vitest";
import { fittedHeight, wireGrowableFields, refitGrowableFields } from "../../module/utils/growable-fields.js";

// The suite runs on `environment: "node"` with no jsdom, so these run against stand-ins for the
// two kinds of growable field. A stand-in cannot lay text out, but it can answer the four numbers
// the module actually reads — the content height, the chrome around it, and the floor and ceiling
// from the stylesheet — and those are what the rules here are about: a field fits what it holds,
// a field nobody can see is left alone, and a height the author dragged is never fitted over.

/** getComputedStyle, as far as this module is concerned. */
function styled(el, { min = "0px", max = "none" }) {
	el.ownerDocument = { defaultView: { getComputedStyle: () => ({ minHeight: min, maxHeight: max }) } };
	return el;
}

/**
 * What a field measures as: whatever height it was last given. A field that reported something
 * else would be one the author had dragged, which is exactly how the module tells the two apart —
 * so a stand-in that ignored its own inline height would look dragged from the first re-fit.
 */
function measured(el, fallback) {
	const h = Number.parseFloat(el.style.height);
	return Number.isFinite(h) ? h : fallback;
}

function fakeTextarea({ scrollHeight = 60, border = 2, min = "0px", max = "none", visible = true, data = {} } = {}) {
	const el = {
		tagName: "TEXTAREA",
		dataset: data,
		style: { height: "" },
		scrollHeight,
		// offsetHeight - clientHeight is the border; both are only read while the box is released.
		offsetHeight: 30 + border,
		clientHeight: 30,
		listeners: {},
		getClientRects: () => (visible ? [{}] : []),
		getBoundingClientRect() { return { height: visible ? measured(this, 30) : 0 }; },
		closest: () => null,
		addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
	};
	return styled(el, { min, max });
}

function fakeRich({ content = 200, chrome = 55, containerMin = "70px", min = "130px", max = "none",
	live = true, visible = true, data = {} } = {}) {
	const container = styled({ offsetHeight: 130 - chrome }, { min: containerMin });
	const el = {
		tagName: "PROSE-MIRROR",
		dataset: data,
		style: { height: "" },
		// Released, the host sits at its floor; the container takes what the toolbar leaves.
		offsetHeight: 130,
		listeners: {},
		getClientRects: () => (visible ? [{}] : []),
		getBoundingClientRect() { return { height: visible ? measured(this, 130) : 0 }; },
		closest: () => null,
		addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
		querySelector: sel => {
			if (!live) return null;
			return sel === ".editor-container" ? container : { scrollHeight: content, scrollTop: 0 };
		},
	};
	return styled(el, { min, max });
}

/** A form holding those fields. */
const fakeRoot = (...fields) => ({ querySelectorAll: () => fields });

describe("fittedHeight", () => {
	it("adds the chrome the content height leaves out", () => {
		expect(fittedHeight({ content: 100, chrome: 12 })).toBe(112);
	});

	it("never drops below the floor the stylesheet sets", () => {
		expect(fittedHeight({ content: 10, chrome: 2, min: 130 })).toBe(130);
	});

	it("never climbs past the ceiling — a field is not a page", () => {
		expect(fittedHeight({ content: 4000, chrome: 55, min: 130, max: 500 })).toBe(500);
	});

	it("grows without limit when the stylesheet sets no ceiling", () => {
		expect(fittedHeight({ content: 4000, chrome: 0 })).toBe(4000);
	});

	it("rounds up, so a fractional last line is not clipped", () => {
		expect(fittedHeight({ content: 100.4, chrome: 2 })).toBe(103);
	});
});

describe("wireGrowableFields", () => {
	it("fits a textarea to its text plus its border", () => {
		const el = fakeTextarea({ scrollHeight: 60, border: 2 });
		wireGrowableFields(fakeRoot(el));
		expect(el.style.height).toBe("62px");
	});

	it("holds a short field at the floor rather than collapsing it", () => {
		const el = fakeTextarea({ scrollHeight: 18, border: 2, min: "40px" });
		wireGrowableFields(fakeRoot(el));
		expect(el.style.height).toBe("40px");
	});

	it("re-fits as the author types", () => {
		const el = fakeTextarea({ scrollHeight: 60, border: 2 });
		wireGrowableFields(fakeRoot(el));
		el.scrollHeight = 300;
		el.listeners.input[0]();
		expect(el.style.height).toBe("302px");
	});

	it("leaves a field in a hidden section alone, and fits it once its section is up", () => {
		const el = fakeTextarea({ scrollHeight: 200, visible: false });
		wireGrowableFields(fakeRoot(el));
		expect(el.style.height).toBe("");

		el.getClientRects = () => [{}];
		refitGrowableFields(fakeRoot(el));
		expect(el.style.height).toBe("202px");
	});

	it("hands a dragged height back to the same field after a re-render, and stops fitting it", () => {
		const heights = new Map([["field:front.description", 420]]);
		const keyOf = el => el.dataset.arcField ? `field:${el.dataset.arcField}` : null;
		const el = fakeTextarea({ scrollHeight: 60, data: { arcField: "front.description" } });

		wireGrowableFields(fakeRoot(el), { heights, keyOf });
		expect(el.style.height).toBe("420px");

		el.scrollHeight = 90;
		refitGrowableFields(fakeRoot(el));
		el.listeners.input[0]();
		expect(el.style.height).toBe("420px");
	});

	it("keeps a height the author just dragged, without waiting for an observer", () => {
		// A ResizeObserver reports the drag on the next frame; a keystroke can arrive before that,
		// so the height itself is what settles who set it — anything but our own fit is theirs.
		const el = fakeTextarea({ scrollHeight: 60, border: 2 });
		wireGrowableFields(fakeRoot(el));
		el.style.height = "90px";
		el.listeners.input[0]();
		expect(el.style.height).toBe("90px");
	});

	it("sizes a live prose-mirror to its content plus the toolbar above it", () => {
		const host = fakeRich({ content: 200, chrome: 55 });
		wireGrowableFields(fakeRoot(host));
		expect(host.style.height).toBe("255px");
	});

	it("floors a prose-mirror at the toolbar plus the container's own floor", () => {
		// 55 of chrome over a container that will not go below 70 — so 130, not the 60 the
		// content asks for. Below that the container overflows a host that clips.
		const host = fakeRich({ content: 5, chrome: 55, containerMin: "70px", min: "0px" });
		wireGrowableFields(fakeRoot(host));
		expect(host.style.height).toBe("125px");
	});

	it("waits for the editor to go live before measuring it", () => {
		const host = fakeRich({ live: false });
		wireGrowableFields(fakeRoot(host));
		expect(host.style.height).toBe("");
		expect(host.listeners.open).toHaveLength(1);

		host.querySelector = fakeRich({ content: 200, chrome: 55 }).querySelector;
		host.listeners.open[0]();
		expect(host.style.height).toBe("255px");
	});
});
