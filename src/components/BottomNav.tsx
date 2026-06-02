"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabItem } from "@worldcoin/mini-apps-ui-kit-react";
import { SafeAreaView } from "@worldcoin/mini-apps-ui-kit-react";
import { Home, Group, ChatBubble, User } from "@worldcoin/mini-apps-ui-kit-react/icons";

const ROUTES = [
  { value: "/", label: "Favours", icon: <Home /> },
  { value: "/leaderboard", label: "Agents", icon: <Group /> },
  { value: "/xmtp", label: "Chat", icon: <ChatBubble /> },
  { value: "/dashboard", label: "Profile", icon: <User /> },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const activeValue = ROUTES.find((r) =>
    r.value === "/" ? pathname === "/" : pathname.startsWith(r.value)
  )?.value ?? "/";

  return (
    <SafeAreaView edges={["bottom"]} className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200" role="navigation" aria-label="Main navigation">
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
            label={route.label}
          />
        ))}
      </Tabs>
    </SafeAreaView>
  );
}
