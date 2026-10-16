/**
 * Pure selection model for the All Leads table.
 *
 * Two mutually exclusive modes:
 *  - "page"    — explicit IDs of the rows the user ticked / selected on the
 *                current page (bounded by what was loaded), and
 *  - "filtered" — an opaque SERVER-SIDE selection token covering every lead
 *                matching the filters; the browser only knows the count, so
 *                off-page leads are never fetched into the browser.
 *
 * Every selection remembers the criteria snapshot (`filterKey`) it was made
 * under — `reconcile` invalidates it the moment filters/search change, so
 * previously hidden leads can never be sent accidentally.
 */

export type SelectionMode = "none" | "page" | "filtered";

export interface LeadSelectionState {
  mode: SelectionMode;
  /** Explicit lead IDs — only in "page" mode. */
  ids: readonly string[];
  /** How many leads the server resolved for a filtered snapshot. */
  filteredCount: number | null;
  /** Opaque expiring token of the server-side snapshot ("filtered" mode). */
  token: string | null;
  /** Serialized filter criteria this selection belongs to. */
  filterKey: string;
}

/** Request body shared by preview/send; the view adds `destinationIds`. */
export interface SelectionOnlyPayload {
  selectionToken?: string;
  leadIds?: string[];
}

export type SelectionAction =
  | { type: "toggle-row"; id: string }
  | { type: "select-page"; pageIds: readonly string[] }
  | { type: "set-filtered"; token: string; count: number }
  | { type: "clear" }
  | { type: "reconcile"; filterKey: string };

export function emptySelection(filterKey: string): LeadSelectionState {
  return { mode: "none", ids: [], filteredCount: null, token: null, filterKey };
}

export function selectionReducer(
  state: LeadSelectionState,
  action: SelectionAction,
): LeadSelectionState {
  switch (action.type) {
    // Criteria changed → the old selection is gone (spec: invalidate).
    case "reconcile":
      return state.filterKey === action.filterKey ? state : emptySelection(action.filterKey);

    case "clear":
      return emptySelection(state.filterKey);

    case "set-filtered":
      return {
        mode: "filtered",
        ids: [],
        filteredCount: action.count,
        token: action.token,
        filterKey: state.filterKey,
      };

    case "select-page": {
      // A filtered snapshot already covers the whole page; the view blocks
      // this action instead of silently narrowing it.
      if (state.mode === "filtered") return state;
      const next = [...new Set(action.pageIds)];
      if (next.length === 0) return emptySelection(state.filterKey);
      return { mode: "page", ids: next, filteredCount: null, token: null, filterKey: state.filterKey };
    }

    case "toggle-row": {
      if (state.mode === "filtered") return state;
      const set = new Set(state.ids);
      if (set.has(action.id)) set.delete(action.id);
      else set.add(action.id);
      if (set.size === 0) return emptySelection(state.filterKey);
      return { mode: "page", ids: [...set], filteredCount: null, token: null, filterKey: state.filterKey };
    }
  }
}

/** True when every currently loaded row is selected (header checkbox state). */
export function isPageFullySelected(
  state: LeadSelectionState,
  pageIds: readonly string[],
): boolean {
  if (pageIds.length === 0) return false;
  if (state.mode === "filtered") return true;
  if (state.mode === "none") return false;
  const selected = new Set(state.ids);
  return pageIds.every((id) => selected.has(id));
}

/** True when at least one loaded row is selected (header indeterminate state). */
export function someOnPageSelected(
  state: LeadSelectionState,
  pageIds: readonly string[],
): boolean {
  if (pageIds.length === 0) return false;
  if (state.mode === "filtered") return true;
  const selected = new Set(state.ids);
  return pageIds.some((id) => selected.has(id));
}

/** Row checkbox value — filtered selections cover every matching lead. */
export function isRowSelected(state: LeadSelectionState, id: string): boolean {
  if (state.mode === "filtered") return true;
  return state.ids.includes(id);
}

/** Summary line exactly as the spec requires it displayed. */
export function selectionSummary(
  state: LeadSelectionState,
  loadedCount: number,
): string | null {
  switch (state.mode) {
    case "none":
      return null;
    case "filtered":
      return `${state.filteredCount ?? 0} filtered leads selected across all pages`;
    case "page":
      return state.ids.length === loadedCount
        ? `${loadedCount} lead${loadedCount === 1 ? "" : "s"} selected on this page`
        : `${state.ids.length} lead${state.ids.length === 1 ? "" : "s"} selected`;
  }
}

/** The exact body (minus destinations) to send to preview/manual-send. */
export function sendPayload(state: LeadSelectionState): SelectionOnlyPayload | null {
  if (state.mode === "filtered" && state.token) return { selectionToken: state.token };
  if (state.mode === "page" && state.ids.length > 0) return { leadIds: [...state.ids] };
  return null;
}
