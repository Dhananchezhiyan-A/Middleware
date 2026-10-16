import { describe, expect, it } from "vitest";
import {
  emptySelection,
  isPageFullySelected,
  isRowSelected,
  selectionReducer,
  selectionSummary,
  sendPayload,
  someOnPageSelected,
} from "./selection";

/**
 * Selection semantics: current-page vs all-filtered, counts, and — most
 * importantly — invalidation when the filter criteria change.
 */

const KEY_A = JSON.stringify({ status: "NEW", quickRange: "today" });
const KEY_B = JSON.stringify({ status: "NEW", quickRange: "yesterday" });

function page(ids: string[], filterKey = KEY_A) {
  let state = emptySelection(filterKey);
  for (const id of ids) state = selectionReducer(state, { type: "toggle-row", id });
  return state;
}

describe("selectionReducer — page mode", () => {
  it("selects and clears one/multiple rows", () => {
    let state = page(["l1"]);
    expect(state.mode).toBe("page");
    expect(state.ids).toEqual(["l1"]);

    state = selectionReducer(state, { type: "toggle-row", id: "l2" });
    expect(state.ids).toEqual(["l1", "l2"]);

    state = selectionReducer(state, { type: "toggle-row", id: "l1" });
    expect(state.ids).toEqual(["l2"]);

    state = selectionReducer(state, { type: "toggle-row", id: "l2" });
    expect(state.mode).toBe("none"); // empty → cleared
  });

  it("select-page sets every loaded row (header checkbox)", () => {
    const state = selectionReducer(emptySelection(KEY_A), {
      type: "select-page",
      pageIds: ["a", "b", "c"],
    });
    expect(state.mode).toBe("page");
    expect(state.ids).toEqual(["a", "b", "c"]);
    expect(isPageFullySelected(state, ["a", "b", "c"])).toBe(true);
    expect(someOnPageSelected(state, ["a", "b", "x"])).toBe(true);
  });

  it("clear resets to an empty selection", () => {
    const state = selectionReducer(page(["l1"]), { type: "clear" });
    expect(state.mode).toBe("none");
    expect(sendPayload(state)).toBeNull();
  });
});

describe("selectionReducer — filtered mode", () => {
  function filtered() {
    return selectionReducer(emptySelection(KEY_A), {
      type: "set-filtered",
      token: "tok_0123456789abcdefghij",
      count: 850,
    });
  }

  it("stores token + count without any lead IDs in the browser", () => {
    const state = filtered();
    expect(state.mode).toBe("filtered");
    expect(state.ids).toEqual([]);
    expect(state.filteredCount).toBe(850);
    expect(sendPayload(state)).toEqual({ selectionToken: "tok_0123456789abcdefghij" });
  });

  it("covers every loaded row; row toggles are refused (no silent narrowing)", () => {
    const state = filtered();
    expect(isPageFullySelected(state, ["a", "b"])).toBe(true);
    expect(isRowSelected(state, "a")).toBe(true);
    expect(selectionReducer(state, { type: "toggle-row", id: "a" })).toBe(state);
    expect(selectionReducer(state, { type: "select-page", pageIds: ["a"] })).toBe(state);
  });

  it("summary distinguishes page vs all-filtered", () => {
    expect(selectionSummary(filtered(), 25)).toBe("850 filtered leads selected across all pages");
    expect(selectionSummary(page(["a", "b", "c"]), 25)).toBe("3 leads selected");
    expect(selectionSummary(page(["a", "b"]), 2)).toBe("2 leads selected on this page");
  });
});

describe("invalidation when filters change", () => {
  it("keeps the selection while the criteria are unchanged", () => {
    const state = page(["l1"]);
    expect(selectionReducer(state, { type: "reconcile", filterKey: KEY_A })).toBe(state);
  });

  it("drops page AND filtered selections when criteria change", () => {
    const onPage = selectionReducer(page(["l1"]), { type: "reconcile", filterKey: KEY_B });
    expect(onPage.mode).toBe("none");

    const filtered = selectionReducer(
      selectionReducer(emptySelection(KEY_A), { type: "set-filtered", token: "tok_0123456789abcdefghij", count: 10 }),
      { type: "reconcile", filterKey: KEY_B },
    );
    expect(filtered.mode).toBe("none");
    expect(filtered.token).toBeNull();
  });
});

describe("edge cases", () => {
  it("never produces a payload from an empty selection", () => {
    expect(sendPayload(emptySelection(KEY_A))).toBeNull();
    expect(sendPayload(selectionReducer(page(["x"]), { type: "clear" }))).toBeNull();
  });

  it("select-page on an empty page clears instead of selecting nothing", () => {
    const state = selectionReducer(page(["x"]), { type: "select-page", pageIds: [] });
    expect(state.mode).toBe("none");
  });

  it("de-duplicates row selections", () => {
    const once = selectionReducer(emptySelection(KEY_A), { type: "select-page", pageIds: ["a", "a", "b"] });
    expect(once.ids).toEqual(["a", "b"]);
  });
});
