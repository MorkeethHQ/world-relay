import { Profile } from "@/components/Profile";

// /dashboard: the Profile tab (Oscar, 10 Oct 2026: "profile not done"), redrawn
// in the language of the Favours tab. DESIGN-SYSTEM.md, "Profile". Everything
// the old page did (identity from the stored sign-in, the person's own counts,
// their favours, the invite) is in `Profile`, plus their own apps and their
// company responses.
export default function ProfilePage() {
  return <Profile />;
}
