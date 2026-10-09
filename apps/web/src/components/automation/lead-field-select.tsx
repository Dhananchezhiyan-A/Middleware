"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  LEAD_FIELD_CATEGORIES,
  findLeadField,
  searchLeadFields,
  type LeadFieldDefinition,
} from "@middleware/types";
import { cn } from "@/lib/utils";

type PickerItem = { kind: "clear" } | { kind: "field"; field: LeadFieldDefinition };

export interface LeadFieldSelectProps {
  /** Canonical source path stored on the row ("" while unset). */
  value: string;
  onChange: (value: string) => void;
  /** Sources already used by the OTHER rows — offered, but disabled. */
  usedValues?: readonly string[];
  disabled?: boolean;
  id?: string;
  /** Accessible name of the trigger. */
  ariaLabel?: string;
}

/**
 * Searchable dropdown for `FieldMappingField.source`.
 *
 * - The stored value is always the canonical key from `LEAD_FIELDS`; labels are
 *   display-only (`email`, never "Email").
 * - Options already chosen in another row render disabled, so one mapping
 *   version cannot pick the same source twice by accident.
 * - Values saved before this picker existed (anything outside the catalog)
 *   still render verbatim, so existing versions keep loading unchanged.
 */
export function LeadFieldSelect({
  value,
  onChange,
  usedValues,
  disabled = false,
  id,
  ariaLabel,
}: LeadFieldSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const selected = findLeadField(value);
  const used = useMemo(
    () => new Set((usedValues ?? []).map((entry) => entry.trim()).filter(Boolean)),
    [usedValues],
  );

  const isEnabled = (item: PickerItem) =>
    item.kind === "clear" || !used.has(item.field.key) || item.field.key === value;

  const composeGroups = (rawQuery: string) => {
    const matches = searchLeadFields(rawQuery);
    return LEAD_FIELD_CATEGORIES.map((category) => ({
      category,
      fields: matches.filter((field) => field.category === category.id),
    })).filter((group) => group.fields.length > 0);
  };

  const composeItems = (rawQuery: string): PickerItem[] => {
    const fieldItems: PickerItem[] = composeGroups(rawQuery).flatMap((group) =>
      group.fields.map((field) => ({ kind: "field" as const, field })),
    );
    const canClear = value !== "" && rawQuery.trim() === "";
    return canClear ? [{ kind: "clear" }, ...fieldItems] : fieldItems;
  };

  /** First option the keyboard may land on (skips options other rows took). */
  const firstEnabled = (list: PickerItem[]) => list.findIndex((item) => isEnabled(item));

  /** Wrapped scan for the next enabled option; -1 when nothing is offered. */
  const scan = (list: PickerItem[], from: number, step: number): number => {
    if (list.length === 0) return -1;
    let index = ((from % list.length) + list.length) % list.length;
    for (let attempts = 0; attempts < list.length; attempts += 1) {
      if (isEnabled(list[index])) return index;
      index = (index + step + list.length) % list.length;
    }
    return -1;
  };

  const groups = composeGroups(query);
  const items = composeItems(query);
  const showClear = value !== "" && query.trim() === "";
  const indexByKey = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, index) => {
      if (item.kind === "field") map.set(item.field.key, index);
    });
    return map;
  }, [items]);

  const activePosition = items.length === 0 ? -1 : Math.min(Math.max(activeIndex, 0), items.length - 1);
  const activeItem = activePosition >= 0 ? items[activePosition] : null;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const close = (focusTrigger = true) => {
    setOpen(false);
    setQuery("");
    if (focusTrigger) triggerRef.current?.focus();
  };

  const openMenu = (preferLast = false) => {
    setQuery("");
    setActiveIndex(preferLast ? scan(composeItems(""), -1, -1) : firstEnabled(composeItems("")));
    setOpen(true);
  };

  const choose = (item: PickerItem) => {
    if (item.kind === "clear") {
      onChange("");
    } else if (isEnabled(item)) {
      onChange(item.field.key);
    }
    close();
  };

  // Focus the search box whenever the menu opens.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  /**
   * Escape must close this menu only. Radix's Dialog dismisses on Escape from
   * a document-level *capture* listener, which runs before React's handler —
   * so intercept on window (earlier in the capture path) and cancel the event
   * to keep the dialog underneath open.
   */
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  // Click-outside closes the menu without touching the selection.
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  // Keep the highlighted option visible while arrowing through long groups.
  useEffect(() => {
    if (!open || activePosition < 0) return;
    document.getElementById(optionId(activePosition))?.scrollIntoView({ block: "nearest" });
  }, [open, activePosition]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(event.key === "ArrowUp");
    }
  };

  const handleQueryChange = (next: string) => {
    setQuery(next);
    const nextItems = composeItems(next);
    const index = firstEnabled(nextItems);
    setActiveIndex(index === -1 ? 0 : index);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex(scan(items, activePosition + 1, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex(scan(items, activePosition - 1, -1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(scan(items, 0, 1));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(scan(items, items.length - 1, -1));
        break;
      case "Enter":
        event.preventDefault();
        if (activeItem) choose(activeItem);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      default:
        break;
    }
  };

  const optionClass = (index: number, unavailable: boolean) =>
    cn(
      "relative flex w-full select-none items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none transition-colors",
      index === activePosition ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      unavailable && "pointer-events-none opacity-40",
    );

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        // Tabbing away closes the menu instead of leaving it orphaned.
        if (rootRef.current && !rootRef.current.contains(event.relatedTarget as Node | null)) {
          close(false);
        }
      }}
    >
      <button
        type="button"
        id={id}
        ref={triggerRef}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        className={cn(
          "flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-left shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              "truncate text-sm leading-tight",
              value ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {value ? (selected ? selected.label : value) : "Select a lead field…"}
          </span>
          {selected ? (
            <span className="truncate font-mono text-[11px] leading-tight text-muted-foreground">
              {value}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {value && !selected ? (
            <span
              title="Not in the canonical field catalog — kept from the saved mapping"
              className="rounded border border-border px-1 py-px text-[10px] leading-none text-muted-foreground"
            >
              custom
            </span>
          ) : null}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg shadow-black/40">
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search lead fields…"
              aria-label="Search lead fields"
              aria-controls={listId}
              aria-expanded
              aria-autocomplete="list"
              aria-activedescendant={activePosition >= 0 ? optionId(activePosition) : undefined}
              autoComplete="off"
              className="h-6 w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>

          <div
            id={listId}
            role="listbox"
            aria-label="Lead fields"
            className="scrollbar-thin max-h-56 overflow-y-auto py-1"
          >
            {items.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No lead fields found
              </p>
            ) : (
              <>
                {showClear ? (
                  <button
                    type="button"
                    id={optionId(0)}
                    role="option"
                    aria-selected={false}
                    onMouseEnter={() => setActiveIndex(0)}
                    onClick={() => choose({ kind: "clear" })}
                    className={optionClass(0, false)}
                  >
                    <span className="flex items-center gap-2">
                      <X className="size-3.5" /> Clear selection
                    </span>
                  </button>
                ) : null}

                {groups.map((group) => (
                  <div key={group.category.id} role="group" aria-label={group.category.label}>
                    <div
                      aria-hidden="true"
                      className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {group.category.label}
                    </div>
                    {group.fields.map((field) => {
                      const index = indexByKey.get(field.key) ?? -1;
                      const unavailable = used.has(field.key) && field.key !== value;
                      return (
                        <button
                          key={field.key}
                          type="button"
                          id={optionId(index)}
                          role="option"
                          aria-selected={field.key === value}
                          disabled={unavailable}
                          title={unavailable ? "Already used in another row" : undefined}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => choose({ kind: "field", field })}
                          className={optionClass(index, unavailable)}
                        >
                          <span className="min-w-0 truncate">{field.label}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {field.key}
                            </span>
                            {field.key === value ? <Check className="size-3.5" /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
