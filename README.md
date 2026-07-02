# JSS SSO

Universal one-click sign-in for Solid pods. One screen, one button.
You click, the universe figures out who you are, you land at your pod.

## What it is

A static HTML page (no build step, no server, no dependencies)
that wraps the JSS resolver chain we shipped in
[JSS#408](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/pull/408)
with the smallest possible UI surface — one big button.

**Happy path** (one click, one signer-prompt, no IdP page):

1. User clicks **Sign in**
2. `window.nostr.getPublicKey()` — signer extension hands us the pubkey
3. `fetch <resolver>/.well-known/did/nostr/<pubkey>.json` — DID document with `alsoKnownAs`
4. Redirect to the WebID's pod root with `?webid=did:nostr:<pubkey>`
   attached, so the pod's auth widget knows who just arrived

**Failure path** — at every step, if something's not set up, the
page shows a precise diagnosis + the user's next concrete action
(install a signer, link the Nostr key to a pod, try a different
resolver, etc.). PoC philosophy: assume everything works; gracefully
degrade with guidance when it doesn't.

**Trade-off**: the user lands at their pod *without* an
authenticated session. They can browse public content; anything
WAC-protected prompts for a real session via whatever app needs it.
The `?webid=` handoff is plain text for now — unsigned, unverified.
For the "magic SSO landing" promise that's enough — the signed
handoff (NIP-98) is 0.0.2 phase 2, and the full authenticated
session is 0.0.7 on the roadmap.

No username box. No IdP picker. No "what app are you logging in from?"
question. Click → resolve → arrive.

## What it does

```
┌────────────────────────────────────────┐
│  sso.solid.social (or any host)        │
│   ┌──────────────────────┐             │
│   │   Sign in to Solid   │  ← only UI  │
│   └──────────────────────┘             │
└────────────────┬───────────────────────┘
                 │ fetch /.well-known/did/nostr/<pubkey>.json
                 ▼
┌────────────────────────────────────────┐
│  JSS resolver chain (already shipped)  │
│   1. CID v1 verificationMethod (#399)  │
│   2. Local index (.idp/accounts)       │
│   3. .well-known/did/nostr (#408, #411)│
│   4. External HTTP did:nostr resolver  │
│   5. did:nostr identity (fallback)     │
└────────────────┬───────────────────────┘
                 │ resolved WebID
                 ▼
┌────────────────────────────────────────┐
│  Redirect to pod root                  │
│  + ?webid=did:nostr:<pubkey>           │
└────────────────────────────────────────┘
```

Same-pod users hit the local index — zero typing required. Cross-pod
users hit the configured HTTP resolver until #414 (relay-based resolution)
lands, after which the resolution becomes fully decentralized.

## Run it locally

No build step. Pure static files. Any static server works:

```bash
npx serve .         # any port
python3 -m http.server 8080
```

(A server is required — `login.js` is an ES module, and browsers
block module scripts on `file://` URLs.)

## Configuration

URL params:

| Param | Default | Purpose |
|-------|---------|---------|
| `resolver` | `https://solid.social` | Host serving `/.well-known/did/nostr/<pubkey>.json` |
| `next` | pod root derived from WebID | Where to land after sign-in |

[`https://nostr.social`](https://nostr.social) serves as the
[did-nostr.com](https://did-nostr.com) source fallback when a key
isn't linked at the default resolver.

Example: a Solid app wants users identified and sent back —

```
https://sso.solid.social/?resolver=https://nostr.social&next=https://myapp.example/
```

(Resolver memory in `localStorage` — so return visits skip straight
to the right host — is 0.0.6 on the roadmap.)

## Hosting

Three sensible deployment targets:

1. **GitHub Pages** on this repo (`gh-pages` branch is the default).
2. **A Solid pod** — eats own dog food. Drop `index.html` + `login.js`
   at `<pod>/sso/` and the SSO page itself becomes a Solid resource.
3. **`jss.live/sso/`** — pairs with the other JSS no-build apps
   ([JSS Git](https://jss.live/git/)).

## Status

**0.0.2 phase 1 — identity handoff**. The one-button UX works
end-to-end against `solid.social` as the resolver, and the redirect
now carries `?webid=did:nostr:<pubkey>` so the pod's auth widget can
pick up the arriving identity (unsigned for now; phase 2 signs it
with NIP-98). Resolution uses the JSS resolver chain shipped in
[#408](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/pull/408)
through
[#418](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/pull/418).

## Roadmap

Following JSS's own 0.0.x versioning (small, frequent bumps, each
adding one capability).

- **0.0.1** — One-button flow against a single hardcoded resolver. ✅
- **0.0.2** — Identity handoff to the pod. Phase 1: append
  `?webid=did:nostr:<pubkey>` to the redirect (plain text). ✅
  Phase 2: sign it (NIP-98 in the URL fragment) so the pod can
  verify the arriving identity.
- **0.0.3** — Step-by-step coaching UI: checklist that ticks each
  step (extension detected, pubkey resolved, DID doc found, WebID
  extracted, redirect) instead of a one-shot status line.
- **0.0.4** — Multi-resolver fallback: try a configurable list of
  resolvers in order (`solid.social`, then `nostr.social` as the
  did-nostr.com source fallback) before giving up.
- **0.0.5** — Direct Nostr-relay resolution. Sits on top of
  [JSS#414](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/issues/414).
  Removes the hardcoded-resolver dependency entirely.
- **0.0.6** — User-preferred resolver memory: first successful
  resolution is cached in `localStorage` so subsequent visits skip
  straight to the right host.
- **0.0.7** — Authenticated session: optional NIP-98 → DPoP
  exchange against the IdP, so the user lands at their pod
  already signed in (not just navigated there).
- **0.0.8** — Passkey-only fallback. Sign in without a Nostr
  extension via WebAuthn.

## Why a separate repo?

- The SSO page is a **product**, not a feature of the server. It lives
  on top of JSS but isn't part of JSS's runtime.
- It's a **client** — pure browser code, no Node dependencies, no test
  suite, no deploy pipeline. Different release cadence than the server.
- It can be **hosted by anyone**, including by a Solid pod itself.
- It's the visible artifact of the resolver-chain work — the part of
  the stack people interact with directly.

## License

MIT. See [LICENSE](./LICENSE).
