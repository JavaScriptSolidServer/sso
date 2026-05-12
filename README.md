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
4. Redirect to the WebID's pod root

**Failure path** — at every step, if something's not set up, the
page shows a precise diagnosis + the user's next concrete action
(install a signer, link the Nostr key to a pod, try a different
resolver, etc.). PoC philosophy: assume everything works; gracefully
degrade with guidance when it doesn't.

**Trade-off**: the user lands at their pod *without* an
authenticated Solid-OIDC session. They can browse public content;
anything WAC-protected prompts for a real session via whatever app
needs it. For the "magic SSO landing" promise that's enough — the
full OIDC + DPoP session is on the v0.2 roadmap.

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
                 │ Solid-OIDC redirect to configured IdP
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

Or open `index.html` directly (CDN imports resolve over the network).

## Configuration

URL params (also persisted to `localStorage` so post-redirect navigation
finds them):

| Param | Default | Purpose |
|-------|---------|---------|
| `idp` | `https://solid.social` | OIDC issuer to authenticate against |
| `next` | pod root derived from WebID | Where to land after sign-in |

Example: a Solid app wants users to authenticate and come back —

```
https://sso.solid.social/?idp=https://solid.social&next=https://myapp.example/
```

## Hosting

Three sensible deployment targets:

1. **GitHub Pages** on this repo (`gh-pages` branch is the default).
2. **A Solid pod** — eats own dog food. Drop `index.html` + `login.js`
   at `<pod>/sso/` and the SSO page itself becomes a Solid resource.
3. **`jss.live/sso/`** — pairs with the other JSS no-build apps
   ([JSS Git](https://jss.live/git/)).

## Status

**0.0.1 — proof of concept**. Demonstrates the one-button UX
end-to-end against `solid.social` as the resolver. Users registered
with solid.social land at their pod in one click. Resolution uses
the JSS resolver chain shipped in
[#408](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/pull/408)
through
[#418](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/pull/418).

## Roadmap

Following JSS's own 0.0.x versioning (small, frequent bumps, each
adding one capability).

- **0.0.1** — One-button flow against a single hardcoded resolver. ✅
- **0.0.2** — Step-by-step coaching UI: checklist that ticks each
  step (extension detected, pubkey resolved, DID doc found, WebID
  extracted, redirect) instead of a one-shot status line.
- **0.0.3** — Multi-resolver fallback: try a configurable list of
  resolvers in order before giving up.
- **0.0.4** — Direct Nostr-relay resolution. Sits on top of
  [JSS#414](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/issues/414).
  Removes the hardcoded-resolver dependency entirely.
- **0.0.5** — User-preferred resolver memory: first successful
  resolution is cached in `localStorage` so subsequent visits skip
  straight to the right host.
- **0.0.6** — Authenticated session: optional NIP-98 → DPoP
  exchange against the IdP, so the user lands at their pod
  already signed in (not just navigated there).
- **0.0.7** — Passkey-only fallback. Sign in without a Nostr
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
