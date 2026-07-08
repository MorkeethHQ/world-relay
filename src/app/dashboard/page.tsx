"use client";

import { useState, useEffect } from "react";
import type { Task } from "@/lib/types";
import { ProofOfFavourCard } from "@/components/ProofOfFavourCard";
import { VerificationBadge } from "@/components/VerificationBadge";
import { displayName, profilePicture, useWorldUsers } from "@/hooks/useWorldUser";
import { rewardAmountLabel } from "@/lib/reward";
import { shareInvite } from "@/lib/minikit-helpers";
import {
  Typography,
  Spinner,
  Pill,
  Marble,
  CircularIcon,
} from "@worldcoin/mini-apps-ui-kit-react";
import {
  Wallet,
  OpenNewWindow,
  Shield,
  Coins,
  CheckCircle,
  Lock,
  Clock,
} from "@worldcoin/mini-apps-ui-kit-react/icons";

type OnChainTask = {
  id: number;
  bounty: string;
  status: string;
  description: string;
  claimant: string;
};

type EscrowStats = {
  escrowAddress: string;
  taskCount: number;
  escrowBalance: string;
  totalDeposited: string;
  paidOut: string;
  openLocked: string;
  completedCount: number;
  claimants: number;
  tasks: OnChainTask[];
};

function StatusPill({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5">
        <CheckCircle className="w-3 h-3 text-success-600" />
        <span className="text-xs font-semibold text-success-700">Completed</span>
      </span>
    );
  }
  if (status === "claimed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5">
        <Clock className="w-3 h-3 text-warning-600" />
        <span className="text-xs font-semibold text-warning-700">Claimed</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5">
      <span className="text-xs font-semibold text-gray-500">Open</span>
    </span>
  );
}

export default function ProfilePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chain, setChain] = useState<EscrowStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [verificationLevel, setVerificationLevel] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("relay_user_id");
    const storedLevel = localStorage.getItem("relay_verification_level");
    if (stored) setUserId(stored);
    if (storedLevel) setVerificationLevel(storedLevel);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/tasks").then(r => r.json()).then(d => setTasks(d.tasks || [])),
      fetch("/api/escrow-stats").then(r => r.json()).then(d => { if (!d.error) setChain(d); }),
    ]).finally(() => setLoading(false));
  }, []);

  const addresses = userId ? [userId] : [];
  useWorldUsers(addresses);

  const appCompleted = tasks.filter(t => t.claimant === userId && t.status === "completed");
  const openTasks = tasks.filter(t => t.poster === userId);
  const funded = tasks.filter(t => t.status === "open");

  const userName = userId ? displayName(userId) : "Anonymous";
  const userAvatar = userId ? profilePicture(userId) : null;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 max-w-lg mx-auto">

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4" role="status" aria-label="Loading profile">
          <Spinner />
        </div>
      ) : (
        <div className="px-6 pt-4 pb-28 flex flex-col gap-8">

          {/* User Identity Card */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200">
            <div className="flex items-center gap-4">
              <div className="relative">
                {userAvatar ? (
                  <Marble
                    src={userAvatar}
                    alt={userName}
                    className="w-14 h-14 rounded-full"
                  />
                ) : (
                  <CircularIcon size="lg" className="bg-gray-900">
                    <span className="text-white text-lg font-bold">
                      {userName.replace("@", "").charAt(0).toUpperCase()}
                    </span>
                  </CircularIcon>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <Typography variant="heading" level={4} className="truncate">
                  {userName}
                </Typography>
                <div className="flex items-center gap-2 mt-1">
                  <VerificationBadge level={verificationLevel} size="sm" />
                </div>
              </div>
            </div>

            {/* Quick stats row */}
            <div className="grid grid-cols-3 gap-3 mt-5">
              <div className="text-center">
                <Typography variant="number" level={2} className="text-gray-900">{appCompleted.length}</Typography>
                <Typography variant="body" level={4} className="text-gray-400 mt-0.5">My completed</Typography>
              </div>
              <div className="text-center">
                <Typography variant="number" level={2} className="text-gray-900">{openTasks.length}</Typography>
                <Typography variant="body" level={4} className="text-gray-400 mt-0.5">My posted</Typography>
              </div>
              <div className="text-center">
                <Typography variant="number" level={2} className="text-gray-900">{funded.length}</Typography>
                <Typography variant="body" level={4} className="text-gray-400 mt-0.5">Available</Typography>
              </div>
            </div>
          </div>

          {/* Reputation */}
          <div>
            <Typography variant="subtitle" level={2} className="text-gray-900 mb-3 px-1">
              Reputation
            </Typography>
            <ProofOfFavourCard address={userId || "anonymous"} />
          </div>

          {/* Your activity — only the current user's own tasks (posted or completed) */}
          {(() => {
            const myTasks = userId
              ? tasks.filter((t) => t.poster === userId || t.claimant === userId)
              : [];
            // A user can have a streak (from polls/jury/daily activity) with zero
            // favours. Show an honest empty-state so that reads as intentional,
            // not a broken/missing history (Oscar live-test Jul 8; streak stays
            // activity-based by decision).
            if (myTasks.length === 0) {
              return (
                <div>
                  <div className="flex items-center justify-between mb-3 px-1">
                    <Typography variant="subtitle" level={2} className="text-gray-900">
                      Your activity
                    </Typography>
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-200 px-4 py-8 text-center">
                    <Typography variant="body" level={3} className="text-gray-400">
                      No favours yet
                    </Typography>
                    <Typography variant="body" level={4} className="text-gray-400 mt-1">
                      Complete or post a favour and it shows up here.
                    </Typography>
                  </div>
                </div>
              );
            }
            return (
              <div>
                <div className="flex items-center justify-between mb-3 px-1">
                  <Typography variant="subtitle" level={2} className="text-gray-900">
                    Your activity
                  </Typography>
                  <Pill>
                    <Typography variant="label" level={2}>{myTasks.length}</Typography>
                  </Pill>
                </div>
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  {myTasks.slice().reverse().map((t, i) => {
                    const role = t.poster === userId ? "Posted" : "Completed";
                    return (
                      <div
                        key={t.id}
                        className={`px-4 py-3.5 flex items-center gap-3 ${
                          i < myTasks.length - 1 ? "border-b border-gray-100" : ""
                        }`}
                      >
                        <CircularIcon size="sm" className={
                          t.status === "completed" ? "bg-success-100" :
                          t.status === "claimed" ? "bg-warning-100" :
                          "bg-gray-100"
                        }>
                          {t.status === "completed" ? (
                            <CheckCircle className="w-4 h-4 text-success-600" />
                          ) : t.status === "claimed" ? (
                            <Clock className="w-4 h-4 text-warning-600" />
                          ) : (
                            <Wallet className="w-4 h-4 text-gray-400" />
                          )}
                        </CircularIcon>
                        <div className="flex-1 min-w-0">
                          <Typography variant="body" level={3} className="text-gray-900 truncate leading-snug">
                            {t.description}
                          </Typography>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Typography variant="body" level={4} className="text-gray-400">{role}</Typography>
                          </div>
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end gap-1">
                          <Typography variant="number" level={4} className="text-gray-900">{rewardAmountLabel(t)}</Typography>
                          <StatusPill status={t.status} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Invite a friend (referral: both sides earn points, referrer paid
              when the invitee completes their first clean favour) */}
          {userId && userId.startsWith("0x") && (
            <button
              onClick={() => shareInvite(userId)}
              className="w-full bg-gray-900 text-white rounded-2xl px-5 py-4 flex items-center justify-between active:scale-[0.98] transition-transform"
            >
              <div className="text-left">
                <p className="text-[14px] font-semibold">Invite a friend</p>
                <p className="text-[12px] text-white/60 mt-0.5">You both earn points when they complete their first favour</p>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>
          )}

          {/* Footer */}
          <div className="flex items-center justify-center gap-2 pt-2">
            <Typography variant="body" level={4} className="text-gray-300">FAVOUR</Typography>
            <Typography variant="body" level={4} className="text-gray-300">·</Typography>
            <Typography variant="body" level={4} className="text-gray-300">World Chain</Typography>
          </div>
        </div>
      )}
    </div>
  );
}
