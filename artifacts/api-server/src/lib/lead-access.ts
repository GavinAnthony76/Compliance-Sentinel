// Row-level ownership rules for individual leads.
//
// These are intentionally pure (no express/db imports) so they can be unit
// tested in isolation. The lead-pipeline router currently gates ALL access to
// managers via requireRole("owner","admin"), but the row-level guard below is
// the second line of defense: if that router-level gating is ever relaxed to
// let staff in, this is the only thing keeping a staff member from reading or
// editing leads that are not assigned to them.

export type LeadAccessUser = { role: string; userId: number };

export function isManagerRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

// Managers (owner/admin) can access any lead within their company. Non-manager
// staff may only access leads explicitly assigned to them. Returns true when the
// user is allowed to read/update the lead.
export function canAccessLead(
  lead: { assignedUserId: number | null },
  user: LeadAccessUser,
): boolean {
  if (isManagerRole(user.role)) return true;
  return lead.assignedUserId === user.userId;
}
