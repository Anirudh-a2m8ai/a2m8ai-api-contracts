'use client';

import { useComments } from './comment-context';

/**
 * The comment affordance that turns "the contract" into "this line of the
 * contract". One sits next to every addressable node — the overview, each tag,
 * each operation, each parameter, each response, each schema property.
 *
 * Invisible until hovered or focused while a node has no comments, so the page
 * still reads as documentation; permanently visible, and amber, once somebody
 * has left an open thread on it.
 */
export function Pin({ anchor, label }: { anchor: string; label: string }) {
  const { counts, activeAnchor, select, disabled } = useComments();
  if (disabled) return null;

  const count = counts.get(anchor);
  const total = count?.total ?? 0;
  const open = count?.open ?? 0;

  const title = total
    ? `${total} comment${total === 1 ? '' : 's'} on ${label}${open ? ` — ${open} unresolved` : ' — all resolved'}`
    : `Comment on ${label}`;

  return (
    <button
      type="button"
      className="pin"
      data-has={total > 0}
      data-open-count={open > 0}
      data-active={activeAnchor === anchor}
      title={title}
      aria-label={title}
      onClick={(event) => {
        // Pins sit inside <button> operation headers and clickable rows;
        // without this the click would also toggle the section open or shut.
        event.stopPropagation();
        event.preventDefault();
        select(anchor, label);
      }}
    >
      <span aria-hidden>💬</span>
      {total > 0 ? <span>{total}</span> : null}
    </button>
  );
}
