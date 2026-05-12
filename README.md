# JSS SSO

Universal one-click sign-in for Solid pods. One screen, one button.
You click, the universe figures out who you are, you land at your pod.

## What it is

A static HTML page (no build step, no server) that wraps the standard
Solid-OIDC flow with the smallest possible UI surface — a single button.
The button kicks off OIDC against a configurable IdP, the IdP handles
the actual identity proof (Schnorr via [Podkey](https://github.com/JavaScriptSolidServer/podkey)
/ [xlogin](https://github.com/JavaScriptSolidServer/xlogin), passkey,
or password), and the user lands at their pod root.

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

**v0.1 — proof of concept**. Demonstrates the one-button UX end-to-end
against `solid.social` as the IdP. Same-pod resolution works zero-typing
(JSS shipped the underlying resolver chain in
[#408](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/pull/408)
through
[#418](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/pull/418)).

## Roadmap

- **v0.1** — Single-button OIDC against a configurable IdP. ✅ (this commit)
- **v0.2** — Auto-discover IdP from a Nostr extension's pubkey (NIP-05 or
  did:nostr DID-doc).
- **v0.3** — Direct Nostr-relay resolution (sits on top of
  [JSS #414](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer/issues/414)).
  Removes the configured-IdP dependency for cross-pod identities.
- **v0.4** — Passkey-only fallback. Sign in without ever installing a
  Nostr extension.

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
