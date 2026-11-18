# BLOCK PARTY Secret Santa

A ten-person holiday exchange for the Richmond BLOCK PARTY group chat. The opening reel features the group's photos and custom bios. Each guest claims a name, optionally vetoes one other person, and opens their own assignment once everyone registers. Gleb can see the aggregate veto count privately after matching and announce it at the party.

## Run locally

A clean checkout uses demo portraits. To work with the actual roster, supply the private local bundle and ROSTER_KEY, or use ROSTER_KEY with access to the private Blob store. The checkout never needs personal files in Git.

Use Node.js 24. Run `npm ci`, then `npm run dev` and open the localhost URL. Open `/join/host-local` in a separate browser profile for host controls. Local state is stored in `.local/`. Run `npm test` and `npm run build` for verification.

## Deploy on Vercel

Import the repository as a Next.js project, using Node.js 24. Connect a **private** Vercel Blob store. Set three distinct random server-side values for `GROUP_INVITE`, `HOST_INVITE`, and `SESSION_SECRET` (32 random bytes each, base64url encoded), then deploy. Set ROSTER_KEY to the separate key for the encrypted roster in that store. The env example lists the variable names.

The custom domain for this event is `secretsanta.ratemyrichmond.com`. Give the group the deployment address followed by `/join/<GROUP_INVITE>`. Gleb uses `/join/<HOST_INVITE>`. The bare site asks for an invitation. Guests can copy a private return link after registering to recover their assignment on a new device. Keep the host and personal return links private.

Only the host sees the most-vetoed name or names and the count. The group sees no results button. A draw with no valid matching asks guests to change a veto voluntarily. Preview deployments have independent game state from production.
