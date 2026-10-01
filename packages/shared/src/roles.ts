export const ROLES = ['ADMIN', 'MANAGER', 'CREATOR'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { CREATOR: 1, MANAGER: 2, ADMIN: 3 };

/** True when `role` is at least as privileged as `required`. */
export function hasRole(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required];
}
