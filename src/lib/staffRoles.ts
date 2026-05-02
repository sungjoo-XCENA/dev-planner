import type { StaffRole } from "@/types/player";

export const STAFF_ROLES: StaffRole[] = ["단장", "감독", "코치"];

export function extractStaffRole(memo?: string): StaffRole | null {
  const normalized = memo?.replace(/\s+/g, "").trim() ?? "";
  if (!normalized) return null;

  const matches = STAFF_ROLES
    .map((role) => ({ role, index: normalized.indexOf(role) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  return matches[0]?.role ?? null;
}
