// WHO SAID IT, IN A FAVOUR'S THREAD (14 Oct 2026).
//
// The in-app favour screen drew a message box and no messages from 28 Jun
// 2026 (75feeca removed the list in a cleanup), so the doer could write and
// never read the poster's answer. The list is back, and each line is named by
// role, never by wallet: the UI shows names, not raw addresses.
export type ThreadRoles = { poster?: string | null; claimant?: string | null; viewer?: string | null };

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The name shown above one message. Pure. */
export function threadSpeaker(sender: string, roles: ThreadRoles): string {
  if (sender === "relay-bot") return "FAVOUR";
  if (same(sender, roles.viewer)) return "You";
  if (same(sender, roles.poster)) return "Poster";
  if (same(sender, roles.claimant)) return "Doer";
  return "Someone";
}
