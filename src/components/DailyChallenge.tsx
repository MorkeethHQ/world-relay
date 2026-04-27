"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DailyChallengeData = {
  id: string;
  title: string;
  description: string;
  why: string;
  pointsBase: number;
  completedCount: number;
  userStreak: number;
  alreadyCompleted: boolean;
  pointsEarned?: number;
  streakBonus?: number;
  completedAt?: string;
};

type Props = {
  address: string | null;
  onComplete?: () => void;
};

// ---------------------------------------------------------------------------
// Image resize utility
// ---------------------------------------------------------------------------

function resizeImage(file: File, maxWidth = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas context unavailable"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Sun icon (inline SVG)
// ---------------------------------------------------------------------------

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-400"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Camera icon
// ---------------------------------------------------------------------------

function CameraIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-500"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Checkmark icon
// ---------------------------------------------------------------------------

function CheckCircleIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" fill="#22c55e" opacity={0.15} />
      <circle cx="12" cy="12" r="10" stroke="#22c55e" strokeWidth="2" />
      <path
        d="M8 12.5L10.5 15L16 9"
        stroke="#22c55e"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Streak flame (light mode version)
// ---------------------------------------------------------------------------

function StreakFlame({ streak }: { streak: number }) {
  if (streak === 0) return null;

  let flameColor: string;
  if (streak >= 7) {
    flameColor = "#f97316";
  } else if (streak >= 3) {
    flameColor = "#fb923c";
  } else {
    flameColor = "#fdba74";
  }

  return (
    <span className="inline-flex items-center gap-1">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 2C12 2 7 8.5 7 13C7 16.5 9.5 19 12 20C14.5 19 17 16.5 17 13C17 8.5 12 2 12 2Z"
          fill={flameColor}
          opacity={0.85}
        />
        <path
          d="M12 8C12 8 9.5 11.5 9.5 14C9.5 16 10.8 17.5 12 18C13.2 17.5 14.5 16 14.5 14C14.5 11.5 12 8 12 8Z"
          fill="#fde68a"
          opacity={0.9}
        />
      </svg>
      <span
        className="text-xs font-semibold tabular-nums"
        style={{ color: flameColor }}
      >
        {streak} day{streak !== 1 ? "s" : ""}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function DailyChallengeSkeleton() {
  const shimmer =
    "bg-[length:200%_100%] bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 animate-[shimmer_1.5s_infinite]";

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className={`w-3.5 h-3.5 rounded-full ${shimmer}`} />
        <div className={`h-3 rounded-md w-28 ${shimmer}`} />
      </div>
      <div className={`h-5 rounded-md w-3/4 ${shimmer}`} />
      <div className={`h-4 rounded-md w-full ${shimmer}`} />
      <div className={`h-3 rounded-md w-2/3 ${shimmer}`} />
      <div className="flex justify-between items-center pt-2">
        <div className={`h-3 rounded-md w-32 ${shimmer}`} />
        <div className={`h-10 rounded-2xl w-36 ${shimmer}`} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DailyChallenge({ address, onComplete }: Props) {
  const [data, setData] = useState<DailyChallengeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Completion form state
  const [showForm, setShowForm] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [completionResult, setCompletionResult] = useState<{
    pointsEarned: number;
    streakBonus: number;
    newStreak: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // Fetch challenge data
  // -------------------------------------------------------------------------

  const fetchChallenge = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const query = address ? `?address=${encodeURIComponent(address)}` : "";
      const res = await fetch(`/api/daily-challenge${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DailyChallengeData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchChallenge();
  }, [fetchChallenge]);

  // -------------------------------------------------------------------------
  // Image capture handler
  // -------------------------------------------------------------------------

  const handleImageCapture = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const resized = await resizeImage(file, 800);
        setImageData(resized);
      } catch {
        // Fallback: use FileReader directly
        const reader = new FileReader();
        reader.onload = () => setImageData(reader.result as string);
        reader.readAsDataURL(file);
      }
    },
    []
  );

  // -------------------------------------------------------------------------
  // Submit completion
  // -------------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (!data || !address) return;
    try {
      setSubmitting(true);
      const res = await fetch("/api/daily-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          challengeId: data.id,
          image: imageData,
          note: note.trim() || undefined,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();

      setCompletionResult({
        pointsEarned: result.pointsEarned ?? data.pointsBase,
        streakBonus: result.streakBonus ?? 0,
        newStreak: result.newStreak ?? (data.userStreak + 1),
      });
      setJustCompleted(true);
      setShowForm(false);
      onComplete?.();
    } catch {
      setError("Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [data, address, imageData, note, onComplete]);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading) {
    return <DailyChallengeSkeleton />;
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error && !data) {
    return (
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
        <p className="text-sm text-gray-400">
          Could not load today&apos;s challenge.
        </p>
      </div>
    );
  }

  if (!data) return null;

  // -------------------------------------------------------------------------
  // Already completed (from API) or just completed
  // -------------------------------------------------------------------------

  const isCompleted = data.alreadyCompleted || justCompleted;

  if (isCompleted) {
    const earned =
      completionResult?.pointsEarned ??
      data.pointsEarned ??
      data.pointsBase;
    const bonus =
      completionResult?.streakBonus ?? data.streakBonus ?? 0;
    const streak =
      completionResult?.newStreak ?? data.userStreak;

    return (
      <div
        className={`
          rounded-2xl bg-white border-2 border-green-100 shadow-sm p-5
          flex flex-col gap-3
          transition-all duration-500
          ${justCompleted ? "animate-[scaleIn_0.4s_ease-out]" : ""}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SunIcon />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Daily Challenge
            </span>
          </div>
          <div
            className={`
              transition-transform duration-500
              ${justCompleted ? "animate-[checkPop_0.5s_ease-out]" : ""}
            `}
          >
            <CheckCircleIcon size={28} />
          </div>
        </div>

        {/* Title */}
        <h3 className="text-base font-bold text-gray-900 leading-snug">
          {data.title}
        </h3>

        {/* Completed message */}
        <p className="text-sm text-gray-500">
          You completed today&apos;s challenge
        </p>

        {/* Points earned */}
        <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3.5 py-2.5">
          <span className="text-sm font-bold text-green-700">
            +{earned} points
          </span>
          {bonus > 0 && (
            <span className="text-xs text-green-600">
              ({earned - bonus} base + {bonus} streak bonus)
            </span>
          )}
        </div>

        {/* Streak */}
        {streak > 0 && (
          <div className="flex items-center gap-2">
            <StreakFlame streak={streak} />
            <span className="text-xs text-gray-400">streak</span>
          </div>
        )}

        {/* Footer */}
        <p className="text-xs text-gray-400 pt-1">
          Come back tomorrow for a new challenge
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Not logged in state
  // -------------------------------------------------------------------------

  if (!address) {
    return (
      <div className="rounded-2xl bg-white border border-gray-200/60 shadow-sm p-5 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <SunIcon />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Daily Challenge
          </span>
        </div>

        {/* Title */}
        <h3 className="text-lg font-bold text-gray-900 leading-snug">
          {data.title}
        </h3>

        {/* Description */}
        <p className="text-sm text-gray-600 leading-relaxed">
          {data.description}
        </p>

        {/* Why */}
        {data.why && (
          <p className="text-xs italic text-gray-400">
            {data.why}
          </p>
        )}

        {/* Stats + disabled button */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-gray-400 tabular-nums">
            {data.completedCount} completed today
          </span>
          <button
            disabled
            className="px-5 py-2.5 rounded-2xl bg-gray-200 text-gray-400 text-sm font-semibold cursor-not-allowed"
          >
            Sign in to participate
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Active challenge (logged in, not completed)
  // -------------------------------------------------------------------------

  return (
    <div className="rounded-2xl bg-white border border-gray-200/60 shadow-sm p-5 flex flex-col gap-3 transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SunIcon />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Daily Challenge
          </span>
        </div>
        {data.userStreak > 0 && <StreakFlame streak={data.userStreak} />}
      </div>

      {/* Title */}
      <h3 className="text-lg font-bold text-gray-900 leading-snug">
        {data.title}
      </h3>

      {/* Description */}
      <p className="text-sm text-gray-600 leading-relaxed">
        {data.description}
      </p>

      {/* Why this matters */}
      {data.why && (
        <p className="text-xs italic text-gray-400">
          {data.why}
        </p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-gray-400 tabular-nums">
        <span>{data.completedCount} completed today</span>
        {data.userStreak > 0 && (
          <>
            <span className="w-px h-3 bg-gray-200" />
            <span>{data.userStreak} day streak</span>
          </>
        )}
      </div>

      {/* Completion form (expandable) */}
      <div
        className={`
          overflow-hidden transition-all duration-300 ease-out
          ${showForm ? "max-h-[400px] opacity-100 mt-1" : "max-h-0 opacity-0"}
        `}
      >
        <div className="flex flex-col gap-3 pt-2 border-t border-gray-100">
          {/* Image capture */}
          <div className="flex items-start gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleImageCapture}
            />

            {imageData ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200 shrink-0 group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageData}
                  alt="Proof"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-xs font-medium">Change</span>
                </div>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="
                  w-16 h-16 rounded-xl border-2 border-dashed border-gray-200
                  flex items-center justify-center shrink-0
                  hover:border-gray-300 hover:bg-gray-50 transition-colors
                "
              >
                <CameraIcon />
              </button>
            )}

            {/* Note field */}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (optional)"
              rows={2}
              className="
                flex-1 resize-none rounded-xl border border-gray-200
                bg-gray-50 px-3 py-2 text-sm text-gray-900
                placeholder:text-gray-400
                focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300
                transition-all
              "
            />
          </div>

          {/* Submit button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="
              w-full py-2.5 rounded-2xl bg-black text-white
              text-sm font-semibold
              hover:bg-gray-800 active:bg-gray-900
              disabled:bg-gray-300 disabled:text-gray-500
              transition-colors
            "
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Submitting...
              </span>
            ) : (
              "Submit"
            )}
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}

      {/* Complete Challenge button (shown when form is hidden) */}
      {!showForm && (
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-900 tabular-nums">
              +{data.pointsBase} pts
            </span>
            {data.userStreak > 0 && (
              <span className="text-xs text-gray-400">
                + streak bonus
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              setError(null);
            }}
            className="
              px-5 py-2.5 rounded-2xl bg-black text-white
              text-sm font-semibold
              hover:bg-gray-800 active:bg-gray-900
              transition-colors
            "
          >
            Complete Challenge
          </button>
        </div>
      )}
    </div>
  );
}
