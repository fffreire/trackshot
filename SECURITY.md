# Security

## Reporting

Please don't open a public issue for security problems. Use GitHub's **Report a vulnerability** button on this repository's Security tab (private vulnerability reporting). Include what you found, how to reproduce it, and what an attacker could do with it.

We aim to acknowledge reports within a week and will keep you posted until it's fixed. This is a volunteer project, so there's no bug bounty.

## In scope

- Session cookies: decrypting, forging or swapping `ts_*` cookies, or weaknesses in how `SESSION_SECRET` is used.
- OAuth flows: state or PKCE bypass, open redirects, token leaks through redirects or logs.
- Cross-site requests that log users out, connect accounts or add songs without their consent.
- Ways to make the server call a service with another user's tokens, or add to a playlist the user didn't choose.
- Anything that sends the screenshot image off the user's device.
- Getting around input validation in the API routes in a way that does harm.

## Out of scope

- The limits documented in ARCHITECTURE.md under "Known limits": the per-instance rate limit and duplicate guard, `X-Forwarded-For` spoofing without a proxy, and the Apple developer token being public.
- Quotas and policies of Spotify, Apple and Google.
- Problems in tesseract.js, MusicKit JS or the music services themselves. Report those upstream.
- Instances run by other people with their own configuration.
