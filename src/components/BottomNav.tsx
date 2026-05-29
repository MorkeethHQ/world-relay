"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabItem } from "@worldcoin/mini-apps-ui-kit-react";
import { SafeAreaView } from "@worldcoin/mini-apps-ui-kit-react";

const HomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const HomeIconActive = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const AgentsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

const AgentsIconActive = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

const ChatIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ChatIconActive = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ProfileIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const ProfileIconActive = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const ROUTES = [
  { value: "/", label: "Favours", icon: <HomeIcon />, altIcon: <HomeIconActive /> },
  { value: "/leaderboard", label: "Agents", icon: <AgentsIcon />, altIcon: <AgentsIconActive /> },
  { value: "/xmtp", label: "Chat", icon: <ChatIcon />, altIcon: <ChatIconActive /> },
  { value: "/dashboard", label: "Profile", icon: <ProfileIcon />, altIcon: <ProfileIconActive /> },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const activeValue = ROUTES.find((r) =>
    r.value === "/" ? pathname === "/" : pathname.startsWith(r.value)
  )?.value ?? "/";

  return (
    <SafeAreaView edges={["bottom"]} className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200">
      <Tabs
        value={activeValue}
        onValueChange={(val) => {
          if (val) router.push(val);
        }}
      >
        {ROUTES.map((route) => (
          <TabItem
            key={route.value}
            value={route.value}
            icon={route.icon}
            altIcon={route.altIcon}
            label={route.label}
          />
        ))}
      </Tabs>
    </SafeAreaView>
  );
}
