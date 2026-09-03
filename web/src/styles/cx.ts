/** Join the class names that are truthy: `cx(styles.row, mine && styles.mine)`. */
export const cx = (...names: Array<string | false | null | undefined>): string =>
  names.filter(Boolean).join(" ");
