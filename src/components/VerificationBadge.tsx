import {
  VerificationBadge as WorldVerificationBadge,
} from "@worldcoin/mini-apps-ui-kit-react";

type Props = {
  level: "orb" | "device" | "wallet" | "unverified" | string | null | undefined;
  size?: "sm" | "md";
};

const BADGE_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  orb: {
    color: "text-success-600",
    bg: "bg-success-100",
    border: "border-success-200",
    label: "Orb Verified",
  },
  device: {
    color: "text-gray-500",
    bg: "bg-gray-100",
    border: "border-gray-200",
    label: "Device Verified",
  },
  wallet: {
    color: "text-gray-400",
    bg: "bg-gray-50",
    border: "border-gray-300",
    label: "Wallet",
  },
};

function ShieldIcon({ level, size }: { level: string; size: number }) {
  const strokeColor =
    level === "orb" ? "rgb(var(--success-600))" : level === "device" ? "rgb(var(--gray-500))" : "rgb(var(--gray-400))";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={strokeColor}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      {level === "orb" && <circle cx="12" cy="11" r="3" />}
      {level === "device" && <polyline points="9 12 11 14 15 10" />}
    </svg>
  );
}

export function VerificationBadge({ level, size = "sm" }: Props) {
  if (!level || level === "unverified") return null;

  const config = BADGE_CONFIG[level];
  if (!config) return null;

  if (size === "md") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border ${config.bg} ${config.border}`}
        role="status"
        aria-label={config.label}
      >
        <ShieldIcon level={level} size={12} />
        <span className={`text-xs font-semibold ${config.color}`}>
          {config.label}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${config.bg} ${config.border}`}
      role="status"
      aria-label={config.label}
    >
      <ShieldIcon level={level} size={9} />
      <span className={`text-xs font-semibold ${config.color}`}>
        {config.label}
      </span>
    </span>
  );
}

export function RequiredTierBadge({
  bountyUsdc,
}: {
  bountyUsdc: number;
}) {
  if (bountyUsdc < 5) return null;

  const requiredLevel = bountyUsdc >= 10 ? "orb" : "device";
  const label = requiredLevel === "orb" ? "Orb Required" : "Device Required";
  const config = BADGE_CONFIG[requiredLevel];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${config.bg} ${config.border}`}
      role="status"
      aria-label={label}
    >
      <span className="text-xs">{"\u{1F512}"}</span>
      <span className={`text-xs font-semibold ${config.color}`}>
        {label}
      </span>
    </span>
  );
}
