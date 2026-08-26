/**
 * The specs this app hosts. Code-managed, not user-created: adding a third
 * spec means adding a row here and running the split/bundle pipeline against
 * it, the same way adding an operation to an existing spec already works.
 *
 * `db.ts`'s ensureSchema() upserts this into the `specs` table on every cold
 * start, so it's always the source of truth even though a row also exists in
 * Postgres — the DB row exists to be a real FK target, not to be edited
 * independently of this file.
 */

export interface SpecMeta {
  slug: string;
  name: string;
  description: string;
  /** Repo-relative source directory, e.g. for build/pull-spec.mjs messages. */
  sourceDir: string;
  sortOrder: number;
}

export const SPEC_REGISTRY: SpecMeta[] = [
  {
    slug: 'course-outline',
    name: 'Course Outline',
    description: 'Generating course structure from uploaded teaching materials.',
    sourceDir: 'course-outline',
    sortOrder: 0,
  },
  {
    slug: 'content-generation',
    name: 'Content Generation',
    description: 'Writing the teaching content of each SubTopic.',
    sourceDir: 'content-generation',
    sortOrder: 1,
  },
];

export function getSpecMeta(slug: string): SpecMeta | null {
  return SPEC_REGISTRY.find((s) => s.slug === slug) ?? null;
}

export function listSpecs(): SpecMeta[] {
  return [...SPEC_REGISTRY].sort((a, b) => a.sortOrder - b.sortOrder);
}
