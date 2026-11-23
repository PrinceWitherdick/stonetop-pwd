// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
	askGroupSize, answerFrom, countLabel, groupSizeQuestion, groupSizeQuestions, groupSizeWindow, numberedNames, spotsAround, typedSize,
	COUNT_FIELD, OTHER_FIELD, SCALE_FIELD,
} from "../../module/fight/group-size.js";
import { GRID } from "../fakes/fight.js";

// How many of a monster that comes in numbers join a fight.

const sq = (col, row) => ({ x: col * GRID, y: row * GRID, w: GRID, h: GRID });

describe("groupSizeQuestion", () => {
	it("offers a group 2 to 5 and a horde 6 to 12, with the stat block's count as the usual", () => {
		expect(groupSizeQuestion({ organization: "group", count: 3 })).toEqual({ organization: "group", sizes: [2, 3, 4, 5], usual: 3, fromSheet: true });
		expect(groupSizeQuestion({ organization: "horde", count: 6 })).toEqual({ organization: "horde", sizes: [6, 8, 10, 12], usual: 6, fromSheet: true });
	});

	it("adds a stat block's own count when the usual sizes leave it out", () => {
		expect(groupSizeQuestion({ organization: "horde", count: 20 })).toEqual({ organization: "horde", sizes: [6, 8, 10, 12, 20], usual: 20, fromSheet: true });
	});

	it("takes the smallest size as the usual when no count was recorded", () => {
		expect(groupSizeQuestion({ organization: "Horde", count: 0 })).toMatchObject({ usual: 6, fromSheet: false });
	});

	it("asks nothing about a solitary monster, one whose stat block says 1, or one fought as a single group token", () => {
		expect(groupSizeQuestion({ organization: "solitary", count: 1 })).toBeNull();
		expect(groupSizeQuestion({ organization: "", count: 1 })).toBeNull();
		expect(groupSizeQuestion({ organization: "group", count: 1 })).toBeNull();
		expect(groupSizeQuestion({ organization: "horde", count: 6, fightAsGroup: true })).toBeNull();
	});
});

describe("groupSizeQuestions", () => {
	const info = {
		"token:tCrin": { kind: "Actor.crinwin", organization: "horde", count: 6 },
		"actor:Actor.crinwin": { kind: "Actor.crinwin", organization: "horde", count: 6 },
		"actor:Actor.bandit": { kind: "Actor.bandit", organization: "group", count: 3 },
		"actor:Actor.wolf": { kind: "Actor.wolf", organization: "group", count: 3 },
		"token:tWolf": { kind: "Actor.wolf", organization: "group", count: 3 },
	};
	const infoFor = pick => info[pick.id] ?? null;

	it("asks once per monster, in the order they were picked, about the first pick of each", () => {
		const questions = groupSizeQuestions([
			{ id: "token:tBram", name: "Bram" },
			{ id: "actor:Actor.bandit", name: "Bandit" },
			{ id: "token:tCrin", name: "Crinwin" },
		], infoFor);
		expect(questions.map(q => [q.pickId, q.name, q.usual])).toEqual([["actor:Actor.bandit", "Bandit", 3], ["token:tCrin", "Crinwin", 6]]);
	});

	it("leaves a monster alone when the GM already ticked more than one of it, token or not", () => {
		const questions = groupSizeQuestions([
			{ id: "actor:Actor.wolf", name: "Wolf" },
			{ id: "token:tWolf", name: "Wolf" },
		], infoFor);
		expect(questions).toEqual([]);
	});
});

describe("spotsAround", () => {
	it("fills the ring touching the token first, nearest squares before corners", () => {
		const spots = spotsAround({ anchor: sq(5, 5), count: 4, size: GRID });
		expect(spots).toHaveLength(4);
		for (const spot of spots) expect(Math.abs(spot.x - 500) + Math.abs(spot.y - 500)).toBe(GRID);
	});

	it("goes a ring further out when the first is full, and never onto another token", () => {
		const others = [sq(4, 4), sq(5, 4), sq(6, 4), sq(4, 5), sq(6, 5), sq(4, 6), sq(5, 6)];
		const spots = spotsAround({ anchor: sq(5, 5), count: 3, size: GRID, others });
		expect(spots[0]).toEqual({ x: 600, y: 600 });
		for (const spot of spots.slice(1)) expect(Math.max(Math.abs(spot.x - 500), Math.abs(spot.y - 500))).toBe(2 * GRID);
		const all = spots.map(s => `${s.x},${s.y}`);
		expect(new Set(all).size).toBe(all.length);
	});

	it("takes the spots `prefer` picks first, from any ring (a split horde stays on the hero it was fighting)", () => {
		// Live: a merged horde beside Bram split, and one member landed two squares from him, out of the fight.
		const hero = sq(4, 5);
		const others = [hero, sq(5, 4)];
		const touchesHero = at => Math.max(Math.abs(at.x - hero.x), Math.abs(at.y - hero.y)) <= GRID;
		const preferred = spotsAround({ anchor: sq(5, 5), count: 5, size: GRID, others, prefer: touchesHero });
		expect(preferred).toHaveLength(5);
		expect(preferred.every(touchesHero)).toBe(true);
		const plain = spotsAround({ anchor: sq(5, 5), count: 5, size: GRID, others });
		expect(plain.every(touchesHero)).toBe(false);
	});

	it("falls back to the nearest spots when the preferred ones run out", () => {
		const hero = sq(4, 5);
		const touchesHero = at => Math.max(Math.abs(at.x - hero.x), Math.abs(at.y - hero.y)) <= GRID;
		const spots = spotsAround({ anchor: sq(5, 5), count: 8, size: GRID, others: [hero], prefer: touchesHero });
		expect(spots).toHaveLength(8);
		expect(spots.slice(0, 7).every(touchesHero)).toBe(true);
		expect(Math.max(Math.abs(spots[7].x - 500), Math.abs(spots[7].y - 500))).toBe(GRID);
	});

	it("keeps inside the scene, and gives back fewer when there is no more room", () => {
		const spots = spotsAround({ anchor: sq(0, 0), count: 20, size: GRID, sceneRect: { x: 0, y: 0, w: 2 * GRID, h: 2 * GRID } });
		expect(spots).toEqual([{ x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]);
	});
});

describe("numberedNames", () => {
	it("numbers a new group from 1", () => {
		expect(numberedNames("Crinwin", [], 3)).toEqual(["Crinwin (1)", "Crinwin (2)", "Crinwin (3)"]);
	});

	it("counts an un-numbered token already there as 1, and skips numbers in use", () => {
		expect(numberedNames("Crinwin", ["Crinwin", "Crinwin (3)"], 3)).toEqual(["Crinwin (2)", "Crinwin (4)", "Crinwin (5)"]);
	});

	it("reads a name with brackets or dots in it literally", () => {
		expect(numberedNames("Mr. (Big)", ["Mr. (Big) (1)", "MrX (Big) (2)"], 1)).toEqual(["Mr. (Big) (2)"]);
	});
});

describe("the group size window", () => {
	const question = { name: "Crinwin", organization: "horde", sizes: [6, 8, 10, 12], usual: 6, fromSheet: true };

	it("asks how many on a strip of sizes, the usual one chosen, with a box for any other", () => {
		const view = groupSizeWindow(question);
		expect(view.title).toBe("Crinwin: how many?");
		expect(view.content).toContain("Crinwin is a horde monster, found 6 or more at a time. Its sheet");
		expect(view.content).toContain("group size is 6.");
		const sizes = [...view.content.matchAll(new RegExp(`name="${COUNT_FIELD}" value="(\\d+)"( checked)?`, "g"))];
		expect(sizes.map(m => [Number(m[1]), !!m[2]])).toEqual([[6, true], [8, false], [10, false], [12, false]]);
		expect(view.content).toMatch(new RegExp(`type="number" name="${OTHER_FIELD}" min="2" max="99"`));
	});

	it("leaves out the sheet's size when the sheet records none", () => {
		expect(groupSizeWindow({ ...question, fromSheet: false }).content).not.toContain("group size is");
	});

	it("names the outcome on its buttons: the count first (the default), then Just one", () => {
		const view = groupSizeWindow(question);
		expect(view.buttons.map(b => [b.action, b.label, b.default])).toEqual([["count", "6 tokens", true], ["one", "Just one", false]]);
	});

	it("offers one group token only when the heroes bring a group (p.416), and says why otherwise", () => {
		// "If the PCs have a group of followers... If the group deals damage to another group".
		const alone = groupSizeWindow(question).content;
		expect(alone).not.toContain(SCALE_FIELD);
		expect(alone).toContain("offered when the heroes have a group of followers");
		const crew = groupSizeWindow({ ...question, offerGroup: true }).content;
		expect(crew).toMatch(new RegExp(`name="${SCALE_FIELD}" value="tokens" checked`));
		expect(crew).toMatch(new RegExp(`name="${SCALE_FIELD}" value="group">`));
		expect(crew).toContain("One token for the whole group");
	});

	it("escapes the monster's name", () => {
		expect(groupSizeWindow({ ...question, name: "<b>Crin</b>" }).content).not.toContain("<b>Crin</b>");
	});
});

describe("reading the answer", () => {
	const fields = values => name => values[name] ?? null;

	it("takes a whole number from 2 to 99, and nothing else, as a size", () => {
		expect([typedSize("20"), typedSize(" 7 "), typedSize("2"), typedSize("99")]).toEqual([20, 7, 2, 99]);
		expect(["", "1", "0", "100", "6.5", "-3", null].map(typedSize)).toEqual([null, null, null, null, null, null, null]);
	});

	it("lets the box win over the strip, and falls back to the usual size", () => {
		// p.416's own horde is 20 crinwin, past every size on the strip.
		expect(answerFrom(fields({ [COUNT_FIELD]: "8", [OTHER_FIELD]: "20" }), { usual: 6 }).size).toBe(20);
		expect(answerFrom(fields({ [COUNT_FIELD]: "8", [OTHER_FIELD]: "1" }), { usual: 6 }).size).toBe(8);
		expect(answerFrom(fields({ [OTHER_FIELD]: "" }), { usual: 6 }).size).toBe(6);
	});

	it("counts the group scale only where it was offered", () => {
		const group = fields({ [COUNT_FIELD]: "8", [SCALE_FIELD]: "group" });
		expect(answerFrom(group, { usual: 6, offerGroup: true })).toEqual({ size: 8, asGroup: true });
		expect(answerFrom(group, { usual: 6, offerGroup: false })).toEqual({ size: 8, asGroup: false });
	});

	it("words the count button for either scale", () => {
		expect(countLabel({ size: 8 })).toBe("8 tokens");
		expect(countLabel({ size: 8, asGroup: true })).toBe("1 group token of 8");
	});
});

describe("askGroupSize", () => {
	const question = { name: "Crinwin", organization: "horde", sizes: [6, 8, 10, 12], usual: 6, fromSheet: true };

	/**
	 * A DialogV2 that renders the window into a real form with a footer, runs its render hook, lets
	 * `act` work the fields, then presses the button with `action`.
	 */
	const working = (action, act = () => {}) => ({
		wait: vi.fn(async config => {
			const root = document.createElement("div");
			const form = document.createElement("form");
			form.append(config.content);
			const footer = document.createElement("footer");
			for (const b of config.buttons) {
				const button = document.createElement("button");
				button.dataset.action = b.action;
				const span = document.createElement("span");
				span.textContent = b.label;
				button.append(span);
				footer.append(button);
			}
			form.append(footer);
			root.append(form);
			config.render?.({}, { element: root });
			act(form, root);
			return config.buttons.find(b => b.action === action).callback({}, { form });
		}),
	});
	const pick = (form, name, value) => {
		const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
		input.checked = true;
		input.dispatchEvent(new Event("input", { bubbles: true }));
	};
	const type = (form, value) => {
		const box = form.elements.namedItem(OTHER_FIELD);
		box.value = value;
		box.dispatchEvent(new Event("input", { bubbles: true }));
	};
	const label = root => root.querySelector('button[data-action="count"] span').textContent;
	const checked = form => [...form.querySelectorAll(`input[name="${COUNT_FIELD}"]`)].filter(i => i.checked).map(i => i.value);

	it("answers the size chosen as that many tokens, in a themed window with an element for content", async () => {
		const DialogV2 = working("count", form => pick(form, COUNT_FIELD, "8"));
		expect(await askGroupSize(question, { DialogV2, document })).toEqual({ size: 8, asGroup: false });
		const config = DialogV2.wait.mock.calls[0][0];
		expect(config.classes).toContain("stonetop");
		expect(typeof config.content).toBe("object");
		expect(config.buttons.find(b => b.default).action).toBe("count");
	});

	it("takes a size typed in the box, clearing the strip, and the button says it", async () => {
		let seen = null;
		const answer = await askGroupSize(question, { DialogV2: working("count", (form, root) => {
			type(form, "20");
			seen = { label: label(root), strip: checked(form) };
		}), document });
		expect(answer).toEqual({ size: 20, asGroup: false });
		expect(seen).toEqual({ label: "20 tokens", strip: [] });
	});

	it("puts a box left holding no size back to the usual size on the strip", async () => {
		let seen = null;
		await askGroupSize(question, { DialogV2: working("count", (form, root) => {
			type(form, "20");
			type(form, "500");
			form.elements.namedItem(OTHER_FIELD).dispatchEvent(new Event("change", { bubbles: true }));
			seen = { box: form.elements.namedItem(OTHER_FIELD).value, strip: checked(form), label: label(root) };
		}), document });
		expect(seen).toEqual({ box: "", strip: ["6"], label: "6 tokens" });
	});

	it("clears the box when a size is picked on the strip", async () => {
		const answer = await askGroupSize(question, { DialogV2: working("count", form => {
			type(form, "20");
			pick(form, COUNT_FIELD, "10");
		}), document });
		expect(answer).toEqual({ size: 10, asGroup: false });
	});

	it("answers one group token where the scale is offered, and the button says so", async () => {
		let seen = null;
		const answer = await askGroupSize({ ...question, offerGroup: true }, { DialogV2: working("count", (form, root) => {
			pick(form, SCALE_FIELD, "group");
			pick(form, COUNT_FIELD, "12");
			seen = label(root);
		}), document });
		expect(answer).toEqual({ size: 12, asGroup: true });
		expect(seen).toBe("1 group token of 12");
	});

	it("makes Just one a single creature whatever is chosen, and closing it no answer", async () => {
		const one = working("one", form => { pick(form, SCALE_FIELD, "group"); pick(form, COUNT_FIELD, "8"); });
		expect(await askGroupSize({ ...question, offerGroup: true }, { DialogV2: one, document })).toEqual({ size: 1, asGroup: false });
		expect(await askGroupSize(question, { DialogV2: { wait: async () => null }, document })).toBeNull();
	});
});

