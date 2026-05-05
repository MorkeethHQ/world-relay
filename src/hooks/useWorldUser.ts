"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface WorldUser {
  username: string | null;
  profilePictureUrl: string | null;
}

const cache = new Map<string, WorldUser>();
const pending = new Map<string, Promise<void>>();

function truncateAddress(addr: string): string {
  if (addr.startsWith("0x") && addr.length > 10) return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  if (addr.startsWith("dev_") || addr.startsWith("demo_")) return addr;
  return addr.slice(0, 12);
}

async function fetchProfiles(addresses: string[]): Promise<void> {
  const unique = addresses.filter(
    (a) => a.startsWith("0x") && !cache.has(a) && !pending.has(a)
  );
  if (unique.length === 0) return;

  const batchPromise = (async () => {
    try {
      const res = await fetch("https://usernames.worldcoin.org/api/v1/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: unique }),
      });
      if (!res.ok) throw new Error("Failed to fetch profiles");
      const results: { address: string; username: string | null; profile_picture_url: string | null }[] = await res.json();
      for (const r of results) {
        cache.set(r.address.toLowerCase(), {
          username: r.username,
          profilePictureUrl: r.profile_picture_url,
        });
      }
      for (const addr of unique) {
        if (!cache.has(addr.toLowerCase())) {
          cache.set(addr.toLowerCase(), { username: null, profilePictureUrl: null });
        }
      }
    } catch {
      for (const addr of unique) {
        cache.set(addr.toLowerCase(), { username: null, profilePictureUrl: null });
      }
    } finally {
      for (const addr of unique) {
        pending.delete(addr.toLowerCase());
      }
    }
  })();

  for (const addr of unique) {
    pending.set(addr.toLowerCase(), batchPromise);
  }

  await batchPromise;
}

export function displayName(address: string): string {
  if (!address) return "";
  if (address.startsWith("agent_")) return address.replace("agent_", "");
  if (address === "relay-bot") return "RELAY";
  const cached = cache.get(address.toLowerCase());
  if (cached?.username) return `@${cached.username}`;
  return truncateAddress(address);
}

export function profilePicture(address: string): string | null {
  if (!address.startsWith("0x")) return null;
  return cache.get(address.toLowerCase())?.profilePictureUrl ?? null;
}

export function useWorldUsers(addresses: string[]) {
  const [, setTick] = useState(0);
  const prevAddrs = useRef<string>("");

  const resolve = useCallback(async () => {
    const wallets = addresses.filter((a) => a.startsWith("0x"));
    const unresolved = wallets.filter((a) => !cache.has(a.toLowerCase()));
    if (unresolved.length === 0) return;
    await fetchProfiles(unresolved);
    setTick((t) => t + 1);
  }, [addresses]);

  useEffect(() => {
    const key = addresses.sort().join(",");
    if (key === prevAddrs.current) return;
    prevAddrs.current = key;
    resolve();
  }, [addresses, resolve]);

  return { displayName, profilePicture };
}
