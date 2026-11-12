import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { showMenu, type MenuItem } from "../session";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { icon, type IconName } from "./Icon";
import { MenuChip } from "./Menus";
import { Tabs, type Tab } from "./Tabs";

// A column (Notion's property): its name and type icon, its width, how it sorts, and its cell.
export type Column<T> = {
  label: string;
  icon: IconName;
  width: number;
  sort: (row: T) => string | number;
  cell: (row: T) => JSX.Element;
};

const muted = colors.textTertiary;

// A tool in a table's toolbar: an icon button. Its New is `button.solid`.
export const tool = stylex.create({
  icon: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: radii.row,
    cursor: "pointer",
  },
});
export const iconTool = [base.bare, base.hover, base.dim, tool.icon];

const s = stylex.create({
  toolbar: { display: "flex", gap: 8, alignItems: "center", height: 40, marginTop: 20 },
  // The tabs, tools and rows all pull out 6px past the page's edges, so their text lines up with the page's and their
  // fills share one edge either side.
  tabs: { marginLeft: -6 },
  tools: { display: "flex", gap: 2, alignItems: "center", marginLeft: "auto", marginRight: -6 },
  // Wider than the page, the table scrolls sideways on its own.
  // Its full height, so the page scrolls it rather than its box (which a page's flex column would shrink).
  scroll: { flexShrink: 0, margin: "0 -6px", overflowX: "auto", paddingBottom: 24 },
  // As wide as the page; the columns' minimum widths make it wider (and scroll) when the page is narrower.
  table: {
    width: "100%",
    // `separate`: a collapsed table paints a row's see-through hover with seams between its cells.
    borderCollapse: "separate",
    // A little air between rows, so each hover reads as its own rounded fill.
    borderSpacing: "0 2px",
    fontSize: fontSizes.body,
  },
  // One line, under the header; rows are rounded fills on hover, as the sidebar's are.
  cell: { padding: "0 6px", textAlign: "left", verticalAlign: "middle", whiteSpace: "nowrap" },
  head: {
    height: 36,
    padding: "0 0 4px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
    color: muted,
    fontWeight: 400,
  },
  headButton: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    width: "100%",
    height: 28,
    padding: "0 6px",
    borderRadius: radii.row,
    color: muted,
    backgroundColor: { default: "transparent", ":hover": colors.bgQuaternary },
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  },
  headIcon: { display: "flex", flexShrink: 0, opacity: 0.7 },
  td: {
    maxWidth: 280,
    height: 32,
    overflow: "hidden",
    color: colors.textPrimary,
    textOverflow: "ellipsis",
  },
  // A row that opens: its fill is its cells', rounded at its two ends (a step rounder than the sidebar's shorter rows).
  tdOpens: {
    backgroundColor: {
      default: "transparent",
      [stylex.when.ancestor(":hover")]: colors.bgQuaternary,
      [stylex.when.ancestor(":focus-visible")]: colors.bgQuaternary,
    },
    borderTopLeftRadius: { default: 0, ":first-child": radii.panel },
    borderBottomLeftRadius: { default: 0, ":first-child": radii.panel },
    borderTopRightRadius: { default: 0, ":last-child": radii.panel },
    borderBottomRightRadius: { default: 0, ":last-child": radii.panel },
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  },
  row: { outline: "none" },
  rowOpens: { cursor: "pointer" },
  dim: { opacity: 0.55 },
  // The last column takes the room left over, so the others keep their widths; a row's action sits in it, shown while
  // the row's hovered.
  end: { width: "100%", textAlign: "right" },
  endShown: { visibility: { default: "hidden", [stylex.when.ancestor(":hover")]: "visible" } },
  empty: { margin: "12px 0 0", color: muted },
});

// The bar over a page's table: the page's tabs on the left, the open tab's tools on the right.
export function Toolbar(props: {
  tabs: Tab[];
  chosen: Tab;
  onChoose: (tab: Tab) => void;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div class={sx(s.toolbar)}>
      <span class={sx(s.tabs)}>
        <Tabs label="Page" tabs={props.tabs} chosen={props.chosen} onChoose={props.onChoose} />
      </span>
      <span class={sx(s.tools)}>{props.children}</span>
    </div>
  );
}

// Rows of any kind under columns, as Notion draws a table view: each header sorts (and, but for the first, hides) from
// its menu, and a row that opens something washes on hover and opens on a click or Enter. Until you sort, rows keep the order they come in.
export function Table<T>(props: {
  columns: Column<T>[];
  rows: T[];
  empty: string;
  // A row that opens something fills on hover and opens on a click or Enter; without, only its cells' own controls do
  // anything.
  open?: (row: T) => void;
  menu?: (row: T) => MenuItem[];
  dim?: (row: T) => boolean;
  hide?: (label: string) => void;
  end?: (row: T) => JSX.Element;
}): JSX.Element {
  const [sort, setSort] = createSignal<{ column: Column<T>; down: boolean } | null>(null);
  const rows = (): T[] => {
    const by = sort();
    if (!by) return props.rows;
    const key = (row: T) => by.column.sort(row);
    return [...props.rows].sort(
      (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (by.down ? -1 : 1),
    );
  };
  const sortBy = (column: Column<T>, down: boolean): MenuItem => ({
    label: down ? "Sort descending" : "Sort ascending",
    icon: icon(down ? "nav-down" : "nav-up", 13),
    run: () => setSort({ column, down }),
  });
  const menu = (c: Column<T>): MenuItem[] => [
    sortBy(c, false),
    sortBy(c, true),
    ...(sort()?.column === c ? [{ label: "Clear sort", run: () => setSort(null) }] : []),
    ...(props.hide && c !== props.columns[0]
      ? [
          "separator" as const,
          { label: "Hide", icon: icon("hidden", 13), run: () => props.hide!(c.label) },
        ]
      : []),
  ];
  return (
    <div class={sx(s.scroll)}>
      <table class={sx(s.table)}>
        <thead>
          <tr>
            <For each={props.columns}>
              {(c) => (
                <th
                  class={sx(s.cell, s.head)}
                  style={{ width: `${c.width}px`, "min-width": `${c.width}px` }}
                  aria-sort={
                    sort()?.column !== c ? "none" : sort()!.down ? "descending" : "ascending"
                  }
                >
                  <MenuChip
                    look={[base.bare, s.headButton]}
                    label={
                      <>
                        <span class={sx(s.headIcon)}>{icon(c.icon, 14)}</span>
                        <span class={sx(base.ellipsis)}>{c.label}</span>
                        <Show when={sort()?.column === c}>
                          {icon(sort()!.down ? "nav-down" : "nav-up", 12)}
                        </Show>
                      </>
                    }
                    items={menu(c)}
                  />
                </th>
              )}
            </For>
            <th class={sx(s.cell, s.head, s.end)} />
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(row) => (
              <tr
                class={sx(
                  s.row,
                  props.open && s.rowOpens,
                  props.dim?.(row) && s.dim,
                  stylex.defaultMarker(),
                )}
                tabindex={props.open ? "0" : undefined}
                onClick={() => props.open?.(row)}
                onKeyDown={(event) => event.key === "Enter" && props.open?.(row)}
                onContextMenu={(event) => props.menu && showMenu(event, props.menu(row))}
              >
                <For each={props.columns}>
                  {(c) => <td class={sx(s.cell, s.td, props.open && s.tdOpens)}>{c.cell(row)}</td>}
                </For>
                <td
                  class={sx(s.cell, s.td, props.open && s.tdOpens, s.end)}
                  onClick={(event) => props.end && event.stopPropagation()}
                >
                  <span class={sx(s.endShown)}>{props.end?.(row)}</span>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={props.rows.length === 0}>
        <p class={sx(s.empty)}>{props.empty}</p>
      </Show>
    </div>
  );
}
