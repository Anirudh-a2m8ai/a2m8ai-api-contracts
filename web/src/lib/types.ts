/** Shapes shared between the server routes and the client components. */

export type Role = 'owner' | 'contributor' | 'guest';

export interface Viewer {
  login: string;
  name: string | null;
  avatar: string | null;
  role: Role;
}

/** The signed-out reader. Sees everything, may change nothing. */
export const GUEST: Viewer = { login: '', name: null, avatar: null, role: 'guest' };

export interface SpecVersion {
  id: number;
  message: string;
  authorLogin: string;
  authorAvatar: string | null;
  fromProposal: number | null;
  createdAt: string;
}

export type ProposalStatus = 'open' | 'merged' | 'rejected' | 'withdrawn';

export interface Proposal {
  id: number;
  title: string;
  body: string;
  status: ProposalStatus;
  authorLogin: string;
  authorAvatar: string | null;
  baseVersionId: number | null;
  mergedVersionId: number | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  commentCount?: number;
  /** Only hydrated on the detail endpoint — it is the whole 160 KiB spec. */
  yaml?: string;
}

export interface Comment {
  id: number;
  anchor: string;
  anchorLabel: string;
  proposalId: number | null;
  parentId: number | null;
  body: string;
  authorLogin: string;
  authorAvatar: string | null;
  resolved: boolean;
  resolvedBy: string | null;
  createdAt: string;
}

/** A top-level comment with its replies attached, ordered oldest first. */
export interface CommentThread extends Comment {
  replies: Comment[];
}

export interface ApiError {
  error: string;
}
