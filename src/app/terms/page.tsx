import Link from "next/link";

export const metadata = {
  title: "Terms & Community Guidelines — FAVOUR",
};

// Canonical, linkable terms and community guidelines. The onboarding flow shows
// a summary and records acceptance; this page holds the full text.
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white max-w-lg mx-auto w-full px-6 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-[14px] text-gray-500 hover:text-gray-900 transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Back
      </Link>

      <h1 className="text-[28px] font-bold tracking-tight text-gray-900 mt-6">
        Terms &amp; Community Guidelines
      </h1>
      <p className="text-[13px] text-gray-400 mt-1">Version 1.0</p>

      <div className="mt-8 flex flex-col gap-7 text-gray-700">
        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">What FAVOUR is</h2>
          <p className="text-[15px] leading-relaxed">
            FAVOUR is a network where people post small real-world favours and
            others complete them for rewards in points and USDC. You sign in with
            your World wallet to take part. Sign-in proves you control a World
            wallet. It is not, on its own, a proof that you are a unique human.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Doing favours honestly</h2>
          <ul className="text-[15px] leading-relaxed list-disc pl-5 flex flex-col gap-1.5">
            <li>Only submit proof for work you genuinely completed.</li>
            <li>Do not submit AI-generated, stock, reused, or unrelated images as proof.</li>
            <li>Proof is reviewed before rewards are released. Fake or low-effort proof will be rejected.</li>
            <li>Do not post favours that are illegal, unsafe, or that ask others to break the law.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Treating people with respect</h2>
          <ul className="text-[15px] leading-relaxed list-disc pl-5 flex flex-col gap-1.5">
            <li>No harassment, hate speech, threats, or discrimination.</li>
            <li>No spam, scams, or attempts to manipulate other users.</li>
            <li>Respect the privacy of people you interact with.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Rewards and payments</h2>
          <p className="text-[15px] leading-relaxed">
            Rewards depend on genuine, verified work. USDC bounties are held in
            escrow and released when a submission passes verification. FAVOUR may
            flag ambiguous submissions for manual review before any payout.
          </p>
          <p className="text-[15px] leading-relaxed">
            A total fee of 5% is deducted from each bounty on payout: 3% to
            FAVOUR and 2% to the community pool. The rates are set in the escrow
            contract on World Chain and apply to the poster&rsquo;s bounty, so a
            $10 favour pays out $9.50 to the person who completed it.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Enforcement</h2>
          <p className="text-[15px] leading-relaxed">
            Accounts that break these rules may be limited or removed. Repeated
            or serious violations can result in loss of access to FAVOUR.
          </p>
        </section>

        <p className="text-[13px] text-gray-400 leading-relaxed">
          By continuing through onboarding and tapping &ldquo;I agree&rdquo;, you
          accept these terms and community guidelines. See also our{" "}
          <Link href="/privacy" className="underline hover:text-gray-600">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
