import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — FAVOUR",
};

// Canonical, linkable privacy policy. Required by World Dev Portal Terms 2.4.
// Every claim here is written against real code — if you change what FAVOUR
// collects, where proof images go, or which providers see them, change this
// page in the same commit:
//   - identity + nullifier ...... src/app/api/verify-identity/route.ts
//   - proof image storage ....... src/lib/image-upload.ts (Vercel Blob, public)
//   - AI verification providers .. src/lib/verify-proof.ts (Anthropic, OpenRouter)
//   - product analytics ......... src/lib/track.ts, @vercel/analytics in layout.tsx
export default function PrivacyPage() {
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
        Privacy Policy
      </h1>
      <p className="text-[13px] text-gray-400 mt-1">Version 1.0 &middot; Last updated 19 July 2026</p>

      <div className="mt-8 flex flex-col gap-7 text-gray-700">
        <section className="flex flex-col gap-2">
          <p className="text-[15px] leading-relaxed">
            FAVOUR is a Mini App inside World App where people post small
            real-world favours and others complete them for points and USDC.
            This page explains exactly what we collect, where it goes, and what
            you can ask us to delete. We have tried to write it plainly rather
            than defensively.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">What we collect</h2>
          <ul className="text-[15px] leading-relaxed list-disc pl-5 flex flex-col gap-1.5">
            <li>
              <strong>Your World wallet address.</strong> This is your account.
              Everything you do in FAVOUR is stored against it.
            </li>
            <li>
              <strong>Your World App username</strong>, so the app can show a
              name instead of a raw address.
            </li>
            <li>
              <strong>A World ID nullifier hash</strong>, if you verify with
              World ID. This is an anonymous, app-specific identifier. It lets
              us confirm one human holds one FAVOUR account without learning who
              you are.
            </li>
            <li>
              <strong>Your activity:</strong> favours you post or complete,
              proof you submit, points, reputation, streaks, votes, and
              predictions.
            </li>
            <li>
              <strong>Photos you submit as proof</strong> of a completed favour.
            </li>
            <li>
              <strong>Basic product analytics:</strong> page views and in-app
              events, so we can see which parts of the app work.
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">What we never collect</h2>
          <p className="text-[15px] leading-relaxed">
            We never see your World ID biometrics, your legal identity, your
            private keys, or your seed phrase. World does not share your
            identity with us, and FAVOUR never has custody of your wallet. We do
            not ask for your email, phone number, or precise location.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Proof photos are public</h2>
          <p className="text-[15px] leading-relaxed">
            Read this part before you photograph anything. When you submit proof
            of a completed favour, the image is uploaded to Vercel Blob storage
            at a public, unguessable URL, and it appears in the FAVOUR feed where
            other users can see it. Anyone with the link can open it.
          </p>
          <p className="text-[15px] leading-relaxed">
            Do not include faces, documents, addresses, screens, or anything
            else you would not put in public. If you have already submitted
            something you want removed, contact us and we will delete it.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Automated proof review</h2>
          <p className="text-[15px] leading-relaxed">
            Proof is checked automatically before any reward is released. To do
            that, we send the image and the text of the favour to third-party AI
            providers &mdash; currently Anthropic, and OpenRouter, which routes
            to further model providers. They process the image to decide whether
            the proof is genuine, and we do not send them your wallet address or
            username alongside it.
          </p>
          <p className="text-[15px] leading-relaxed">
            An automated rejection is not final. If you think a decision was
            wrong, contact us and a human will look at it.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">On-chain activity is permanent</h2>
          <p className="text-[15px] leading-relaxed">
            USDC bounties are funded, held in escrow, and paid out in public
            transactions on World Chain. Those transactions are part of a public
            blockchain: they are visible to anyone, they are linked to your
            wallet address, and neither FAVOUR nor anyone else can edit or
            delete them. This is true of all on-chain activity, not just ours,
            but you should know it before you fund or earn.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Who we share data with</h2>
          <p className="text-[15px] leading-relaxed">
            We do not sell your data and we do not share it for advertising. We
            use a small number of service providers to run the app:
          </p>
          <ul className="text-[15px] leading-relaxed list-disc pl-5 flex flex-col gap-1.5">
            <li><strong>Vercel</strong> &mdash; hosting, analytics, and proof-image storage</li>
            <li><strong>Upstash</strong> &mdash; the database holding accounts and activity</li>
            <li><strong>Anthropic and OpenRouter</strong> &mdash; automated proof review</li>
            <li><strong>World</strong> &mdash; sign-in and World ID verification</li>
          </ul>
          <p className="text-[15px] leading-relaxed">
            We may also disclose information where the law requires it.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">How long we keep it</h2>
          <p className="text-[15px] leading-relaxed">
            Account and activity data is kept while your account exists. Proof
            images are kept so that completed favours stay auditable. On-chain
            transactions are permanent and outside our control.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Your choices</h2>
          <p className="text-[15px] leading-relaxed">
            Email us and we will tell you what we hold on your wallet address,
            correct it, or delete your account and your proof images. We will
            respond within 30 days. We cannot delete on-chain transactions, and
            we may keep the minimum record needed to stop a deleted account
            being used to farm rewards.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Children</h2>
          <p className="text-[15px] leading-relaxed">
            FAVOUR is not for anyone under 18. If you believe a minor is using
            it, contact us and we will remove the account.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-gray-900">Changes and contact</h2>
          <p className="text-[15px] leading-relaxed">
            If this policy changes in a way that affects what we collect, we
            will update the date at the top of this page. For anything privacy
            related, including deletion requests, email{" "}
            <a href="mailto:omorke@gmail.com" className="underline hover:text-gray-900">
              omorke@gmail.com
            </a>
            .
          </p>
        </section>

        <p className="text-[13px] text-gray-400 leading-relaxed">
          See also our{" "}
          <Link href="/terms" className="underline hover:text-gray-600">
            Terms &amp; Community Guidelines
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
