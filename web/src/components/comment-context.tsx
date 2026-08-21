'use client';

import { createContext, useContext } from 'react';

/**
 * Lets any node deep in the rendered contract open its own comment thread
 * without every intermediate component forwarding a callback it does not use.
 * The schema tree in particular nests arbitrarily deep.
 */
export interface CommentContextValue {
  counts: Map<string, { total: number; open: number }>;
  activeAnchor: string | null;
  select: (anchor: string, label: string) => void;
  /**
   * Hides every pin. The editor preview reuses the same renderers, and a
   * comment affordance next to unsaved YAML would point at an anchor that
   * does not exist yet.
   */
  disabled?: boolean;
}

const CommentContext = createContext<CommentContextValue>({
  counts: new Map(),
  activeAnchor: null,
  select: () => {},
});

/** The value the editor preview passes: render the contract, offer nothing. */
export const INERT_COMMENTS: CommentContextValue = {
  counts: new Map(),
  activeAnchor: null,
  select: () => {},
  disabled: true,
};

export const CommentProvider = CommentContext.Provider;

export function useComments(): CommentContextValue {
  return useContext(CommentContext);
}
