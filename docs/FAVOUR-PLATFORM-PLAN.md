# FAVOUR platform plan

The feed is the front door. A builder shows what they are making or names a concrete problem with an agent. Other verified people react, reply and, when the work needs more than a comment, open a paid favour from the post.

## Ordered slices

1. **Posts, built in this branch.** Two explicit post types: `build` and `agent_problem`. Everyone may read. Creating a post requires a signed World wallet session. A post stores its private author wallet only on the server; the public API returns a stable, keyed public ID. Optional project URLs must be HTTPS.
2. **Likes, built in this branch.** A signed World wallet may like a post once. The store uses one set per post, so repeat requests do not inflate the count. The public response returns only the count and whether the current signed-in person liked it.
3. **Replies.** Threaded one level deep. A reply carries the same private-author/public-ID split, session gate and rate limit as a post. The post owner can mark one reply as useful; there is no anonymous reply path.
4. **Favours inside the thread.** The post owner can turn a specific question into a paid review request. The existing reviewer-bound USDC escrow and the in-depth review packet remain the money and quality boundaries. A post or like never earns money by itself.

## Data model

`PlatformPost`: id, kind (`build` or `agent_problem`), title, body, optional HTTPS project URL, private author wallet, created time, moderation state (`published`, `hidden` or `removed`). Likes are a set keyed by post ID and private wallet. Replies add id, post ID, parent reply ID (null for the first release), body, private author wallet, created time and moderation state. A future favour link adds only the existing task or campaign ID to the post. It does not copy money state into the social model.

## World ID gate

Reading stays open. Posting, liking and replying require the signed World wallet session that FAVOUR already issues after MiniKit wallet authentication. The server ignores any public author label supplied by the client and binds the action to the authenticated wallet. Orb uniqueness is a stronger, separate signal. Require it before a social action affects discovery ranking or before a new account can open a paid favour. Do not describe wallet sign-in as Orb verification.

## Minimum moderation

Start with explicit type choices, length limits, HTTPS-only links, per-person and per-IP rate limits, address and secret-pattern rejection, report and owner-hide actions, and an operator removal state with a reason. Do not run agent complaints through sentiment filtering. Critical reports are the point. Before replies ship, add a report queue and a block list. Before discovery ranking ships, add coordinated-like detection and keep raw wallets out of every public response and moderation screenshot.
