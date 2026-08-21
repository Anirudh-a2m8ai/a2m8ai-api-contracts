/**
 * How a comment addresses "a specific part of the contract".
 *
 * Pure string helpers, imported by both the server routes and the client
 * components. The scheme is intentionally human-readable rather than a JSON
 * Pointer: an anchor shows up in the URL bar, and a reviewer pasting a link
 * into chat should leave the recipient able to tell what it points at.
 *
 *   info                                  the contract's overview
 *   tag:course-creation                   a tag group
 *   op:post /api/v1/outline               a whole operation
 *   op:post /api/v1/outline#responses.422 one part of an operation
 *   schema:ErrorResponse                  a schema
 *   schema:ErrorResponse#errorCode        one property of a schema
 */

export const INFO_ANCHOR = 'info';

/** Free-standing discussion on an edit request, not pinned to a spec node. */
export const DISCUSSION_ANCHOR = 'discussion';

export function tagAnchor(name: string): string {
  return `tag:${name}`;
}

export function opAnchor(method: string, path: string): string {
  return `op:${method.toLowerCase()} ${path}`;
}

export function partAnchor(base: string, part: string): string {
  return `${base}#${part}`;
}

export function schemaAnchor(name: string): string {
  return `schema:${name}`;
}

export function splitAnchor(anchor: string): [base: string, part: string | null] {
  const hash = anchor.indexOf('#');
  if (hash === -1) return [anchor, null];
  return [anchor.slice(0, hash), anchor.slice(hash + 1)];
}

/**
 * A readable label for an anchor, used when rendering a comment away from the
 * thing it points at — the review inbox, or an anchor whose operation has
 * since been renamed out of the contract.
 */
export function anchorLabel(anchor: string): string {
  const [base, part] = splitAnchor(anchor);

  let label: string;
  if (base === INFO_ANCHOR) {
    label = 'Overview';
  } else if (base === DISCUSSION_ANCHOR) {
    label = 'Discussion';
  } else if (base.startsWith('tag:')) {
    label = base.slice(4);
  } else if (base.startsWith('op:')) {
    const [method, ...rest] = base.slice(3).split(' ');
    label = `${method.toUpperCase()} ${rest.join(' ')}`;
  } else if (base.startsWith('schema:')) {
    label = base.slice(7);
  } else {
    label = base;
  }

  return part ? `${label} › ${part}` : label;
}

/**
 * Rejects anything that is not one of the forms above, so the comments table
 * cannot accumulate anchors nothing will ever render next to.
 */
export function isValidAnchor(anchor: unknown): anchor is string {
  if (typeof anchor !== 'string') return false;
  if (anchor.length === 0 || anchor.length > 400) return false;

  const [base] = splitAnchor(anchor);
  if (base === INFO_ANCHOR || base === DISCUSSION_ANCHOR) return true;
  if (base.startsWith('tag:') && base.length > 4) return true;
  if (base.startsWith('schema:') && base.length > 7) return true;
  if (/^op:(get|put|post|delete|patch|head|options|trace) \/\S*$/.test(base)) return true;
  return false;
}

/** Tallies a flat comment list by the anchor each one points at. */
export function countByAnchor(comments: { anchor: string; resolved: boolean }[]) {
  const counts = new Map<string, { total: number; open: number }>();
  for (const comment of comments) {
    const entry = counts.get(comment.anchor) ?? { total: 0, open: 0 };
    entry.total += 1;
    if (!comment.resolved) entry.open += 1;
    counts.set(comment.anchor, entry);
  }
  return counts;
}
