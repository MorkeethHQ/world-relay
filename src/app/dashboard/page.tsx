"use client";

import { useState, useEffect } from "react";
import type { Task } from "@/lib/types";
import { HunterCardLive } from "@/components/HunterCardLive";
import { VerificationBadge } from "@/components/VerificationBadge";
import { Group, Note, Pill, Row, Screen } from "@/components/Kit";
import { displayName, profilePicture, useWorldUsers } from "@/hooks/useWorldUser";
import { rewardAmountLabel } from "@/lib/reward";
import { shareInvite } from "@/lib/minikit-helpers";
import styles from "./profile.module.css";

// THE PROFILE (8 Oct 2026 redesign). One identity block, the Hunter card, the
// person's own favours as rows, and the invite as a row. Drawn with the one kit.
//
// No level name, no rank, no streak flame: the Reputation card
// (ProofOfFavourCard) is not mounted here. hunter-profile.ts says why: a title
// is a claim with no rule behind it. The file stays; only this page stopped
// showing it. Reversible by mounting it again.

const STATUS: Record<string, string> = { completed: "Done", claimed: "In progress", open: "Open" };

export default function ProfilePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [verificationLevel, setVerificationLevel] = useState<string | null>(null);
  const [referral, setReferral] = useState<{ invited: number; activated: number; cap: number; capReached: boolean } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("relay_user_id");
    const storedLevel = localStorage.getItem("relay_verification_level");
    if (stored) setUserId(stored);
    if (storedLevel) setVerificationLevel(storedLevel);
  }, []);

  useEffect(() => {
    if (!userId || !userId.startsWith("0x")) return;
    fetch(`/api/referral/stats?address=${userId}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setReferral(d); })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    fetch("/api/tasks").then((r) => r.json()).then((d) => setTasks(d.tasks || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useWorldUsers(userId ? [userId] : []);

  const userName = userId ? displayName(userId) : "Not signed in";
  const userAvatar = userId ? profilePicture(userId) : null;
  const myTasks = userId ? tasks.filter((t) => t.poster === userId || t.claimant === userId).slice().reverse() : [];
  const wallet = !!userId && userId.startsWith("0x");

  return (
    <Screen label="Profile">
      <div className={styles.identity}>
        {userAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={userAvatar} alt="" className={styles.avatar} />
        ) : userId ? (
          <span className={`${styles.avatar} ${styles.avatarInitial}`} aria-hidden="true">{userName.replace("@", "").charAt(0).toUpperCase()}</span>
        ) : null}
        <div className={styles.identityText}>
          <h1 className={styles.userName}>{userName}</h1>
          <div className={styles.badge}><VerificationBadge level={verificationLevel} size="sm" /></div>
        </div>
      </div>

      {/* The person as a hunter and feedback giver (Oscar, 8 Oct 2026): products
          reviewed, reviews accepted, products launched. */}
      <HunterCardLive name="Your work" />

      <Group>Your favours</Group>
      {loading ? (
        <Note kind="loading" quiet>Reading your favours…</Note>
      ) : myTasks.length === 0 ? (
        <Note quiet>No favour yet. Do one and it shows up here.</Note>
      ) : (
        <ul>
          {myTasks.map((t, i) => (
            <Row
              key={t.id}
              picture={<span className={styles.mark} aria-hidden="true">{t.poster === userId ? "P" : "D"}</span>}
              name={t.description}
              sub={`${t.poster === userId ? "Posted" : "Done"} · ${rewardAmountLabel(t)}`}
              pill={STATUS[t.status] ?? t.status}
              pillTone={t.status === "completed" ? "on" : "off"}
              label={t.description}
              last={i === myTasks.length - 1}
              href={`/task/${encodeURIComponent(t.id)}`}
            />
          ))}
        </ul>
      )}

      {/* Invite a friend (referral: both sides earn points, the referrer paid
          when the invitee completes their first clean favour). */}
      {wallet && (
        <>
          <Group>Friends</Group>
          <button type="button" className={`${styles.invite} min-h-[72px]`} onClick={() => shareInvite(userId!)}>
            <span className={styles.inviteText}>
              <span className={styles.inviteName}>Invite a friend</span>
              <span className={styles.inviteSub}>
                {referral && referral.invited > 0
                  ? `${referral.invited} invited · ${referral.activated} active · ${referral.capReached ? `cap of ${referral.cap} reached` : `${referral.activated} of ${referral.cap} rewarded`}`
                  : "You both earn points on their first favour"}
              </span>
            </span>
            <Pill>Invite</Pill>
          </button>
        </>
      )}

      <p className={styles.foot}>FAVOUR · World Chain</p>
    </Screen>
  );
}
