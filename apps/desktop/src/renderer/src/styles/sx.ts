import * as stylex from "@stylexjs/stylex";

// StyleX styles as a class string: `class={sx(styles.row, active() && styles.rowActive)}`, or beside a hook class,
// `class={[sx(styles.view), "thread-view"]}`. Falsy entries are skipped; later styles win. It returns only the class,
// so a dynamic style (one that sets an inline `style`) needs `{...stylex.attrs(...)}` instead.
export const sx = (...styles: ReadonlyArray<stylex.StyleXStyles>): string =>
  stylex.attrs(...styles).class ?? "";
