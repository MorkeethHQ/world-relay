# FAVOUR test product: the 5-minute phone script

A full FAVOUR on your Mac, with TEST DATA only. You play three people on one
phone: TEST Ana posts, TEST Ben does the favour, TEST Reviewer 1 judges.

**Where the data goes.** Nowhere. The store lives in the Mac's memory. Ctrl-C
stops it and removes all of it. Nothing is written to production.

## Before you start (on the Mac, 1 minute)

1. Put the phone on the same Wi-Fi as the Mac.
2. In the repo folder, run:

       sh scripts/test-product.sh

3. Wait for the line "On your phone: http://...:3220/__fixture/". Open that
   link in Safari on the phone. This is the START PAGE. You come back to it
   to change person.

If macOS asks to let "node" accept connections, tap Allow.

## The script (on the phone, 5 minutes)

**1. Ana posts a favour.**
- Start page: tap **Sign in as TEST Ana**.
- Scroll down. Tap **Ask a one-off favour**.
- Type: `FAVOUR TEST, not real: a photo of any cup on your desk`
- Tap **A photo**, then **5 pts**, then **Post**.
- You see: "Posted · live on the board".

**2. Ben does it.**
- Start page: tap **Sign in as TEST Ben**.
- Tap the FAVOUR TEST favour. Tap **Do it**.
- Take a photo of any cup.
- You see: a green **Looks good** box. This is the precheck.
- In the line under the photo, type `TEST FLAG`. Tap **Submit**.
- You see: **Discover more favours**. The proof waits for review.

Why `TEST FLAG`: a proof that passes completes at once, and the chat closes.
A flagged proof keeps the favour open, so Ana and Ben can talk.

**3. Ben writes to Ana.**
- Tap the FAVOUR TEST favour again.
- At the bottom, type a message and send it.
- Known gap: this screen does not show the message. Ana gets it (step 4).

**4. Ana reads, answers and approves.**
- Start page: tap **Sign in as TEST Ana**.
- Start page again: under **TEST favours**, tap **Open the favour page**.
- Tap **XMTP CHAT**. You see Ben's message. Type an answer and send it.
- Tap **Approve**. You see: **Completed**.

**5. Ben gets his points.**
- Start page: tap **Sign in as TEST Ben**.
- You see: **Nice work!** Tap **Maybe later**.
- Tap **Profile**. You see the FAVOUR TEST favour: **5 pts, Completed**.

**6. Reviewer 1 plays the jury.**
- Start page: tap **Sign in as TEST Reviewer 1**.
- Tap **Play**. Swipe one card right (or tap **Matches**).
- You see the count go to **1/10**.

**7. A stranger sees no chat.** (optional)
- Still as Reviewer 1: start page, **Open the favour page**.
- You see the favour and the proof. You see no message.

## When you are done

On the Mac, press Ctrl-C. Everything is gone.

## What this does NOT test

- World App sign-in and the World App camera. This runs in Safari.
- A real model. The precheck and the proof check are stand-ins:
  `TEST FLAG` flags, `TEST FAIL` rejects, `TEST DOWN` fails the check,
  anything else passes.
- Production. A preview in the "Perfect" World App test app cannot work
  today: the store, the session key and the World App id are set for
  Production only in Vercel.

## The same script, run by a machine

    sh scripts/test-product.sh --browser-walk   # taps steps 1 to 7 in a phone-size browser
    sh scripts/test-product.sh --walk           # the same loop through the API, with the jury card of Ben's own proof

Each prints PASS or FAIL per step. Each starts clean and stops when done.
