/** Join the class names that are truthy: `cx(styles.row, mine && styles.mine)`. */
export const cx = (...names) => names.filter(Boolean).join(" ");
