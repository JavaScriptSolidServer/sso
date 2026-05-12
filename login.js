// JSS SSO — one-click Solid sign-in.
//
// Two-stage flow:
//
//   Stage 1 — RESOLUTION (in-page, no redirect):
//     click button
//       → window.nostr.getPublicKey()
//       → fetch <resolver>/.well-known/did/nostr/<pubkey>.json
//       → read alsoKnownAs[0] → WebID
//       → fetch WebID profile → read solid:oidcIssuer → IdP URL
//
//   Stage 2 — AUTHENTICATION (Solid-OIDC):
//     → session.login(idp, redirectUri)   triggers redirect to IdP
//     → (user proves identity ONCE at IdP — Schnorr click — and
//        an IdP-side session cookie is set)
//     → IdP redirects back here with ?code=
//     → session.handleRedirectFromLogin()  exchanges code for tokens
//     → redirect to the WebID's pod root, now authenticated
//
// Once the IdP cookie is set, *future* sign-ins (this page or any
// Solid app using the same IdP) silently re-issue tokens — no
// further interaction.
//
// PoC philosophy: assume everything works; show precise diagnosis
// + next-step coaching for each failure node.
//
// URL params:
//   ?resolver=<host>  — DID-doc resolver host (default solid.social)
//   ?next=<url>       — destination after success (default pod root)

import Session from 'https://esm.sh/solid-oidc';

const DEFAULT_RESOLVER = 'https://solid.social';

function readConfig() {
  const p = new URLSearchParams(location.search);
  const resolver = (p.get('resolver') || DEFAULT_RESOLVER).replace(/\/$/, '');
  const next = p.get('next') || '';
  return { resolver, next };
}

function setStatus(msg, kind = 'info') {
  const el = document.querySelector('#status');
  if (!el) return;
  el.innerHTML = '';
  if (typeof msg === 'string') {
    el.textContent = msg;
  } else {
    el.appendChild(msg);
  }
  el.className = kind;
}

function help(textParts, links = []) {
  const frag = document.createDocumentFragment();
  textParts.forEach((t) => frag.appendChild(document.createTextNode(t)));
  if (links.length) {
    const ul = document.createElement('ul');
    ul.className = 'help-links';
    for (const { label, href } of links) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = href; a.textContent = label;
      a.target = href.startsWith('http') ? '_blank' : '_self';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
      ul.appendChild(li);
    }
    frag.appendChild(ul);
  }
  return frag;
}

function podRootFromWebId(webId) {
  try { return new URL('/', webId).href; }
  catch { return null; }
}

// ---- Stage 1: resolution ----

async function resolveWebIdFromPubkey(pubkey, resolver) {
  const res = await fetch(`${resolver}/.well-known/did/nostr/${pubkey}.json`, {
    headers: { Accept: 'application/did+json, application/json' },
  });
  if (res.status === 404) {
    throw new ResolveError('no-binding',
      `Your Nostr key isn't linked to a Solid pod at ${resolver}.`);
  }
  if (!res.ok) {
    throw new ResolveError('resolver-status',
      `Resolver ${resolver} returned ${res.status} ${res.statusText}.`);
  }
  const didDoc = await res.json();
  const aka = Array.isArray(didDoc.alsoKnownAs) ? didDoc.alsoKnownAs : [];
  const webId = aka.find((x) => typeof x === 'string' && /^https?:\/\//.test(x));
  if (!webId) {
    throw new ResolveError('no-webid',
      `Your DID document at ${resolver} doesn't include an alsoKnownAs WebID.`);
  }
  return webId;
}

async function discoverIdpFromWebId(webId) {
  // Solid profiles declare the IdP via `solid:oidcIssuer`. Fall back
  // to the WebID's origin if the field is absent (the pod's own host
  // is also a common IdP).
  try {
    const profileRes = await fetch(webId.split('#')[0], {
      headers: { Accept: 'application/ld+json, application/json' },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      // JSS profiles declare the IdP via the bare term `oidcIssuer`
      // (aliased to solid:oidcIssuer in @context). Try the bare form
      // FIRST, then the prefixed / full-URI forms as fallbacks for
      // profiles emitted by other servers.
      const issuer = profile.oidcIssuer
        || profile['solid:oidcIssuer']
        || profile['http://www.w3.org/ns/solid/terms#oidcIssuer']
        || profile.solid?.oidcIssuer;
      const issuerStr = typeof issuer === 'string'
        ? issuer
        : (issuer && (issuer['@id'] || issuer.id)) || null;
      if (issuerStr) return issuerStr.replace(/\/$/, '');
    }
  } catch { /* fall through to origin */ }
  return new URL(webId).origin;
}

class ResolveError extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}

// ---- Stage 2: authentication via Solid-OIDC ----

async function startAuthFlow(idp) {
  const session = new Session();
  await session.login(idp, location.origin + location.pathname);
  // browser is redirecting; nothing further to do
}

async function handleAuthReturn() {
  // We're back from the IdP with ?code=...
  const session = new Session();
  await session.handleRedirectFromLogin();
  return session;
}

// ---- Top-level flows ----

async function freshFlow() {
  const { resolver } = readConfig();

  // Step 1: extension
  setStatus('Reading your Nostr identity…');
  if (!window.nostr) {
    setStatus(help(
      ['No Nostr signer detected. Install a browser extension that provides ',
       'window.nostr, then reload this page.'],
      [
        { label: 'Podkey (recommended)', href: 'https://github.com/JavaScriptSolidServer/podkey' },
        { label: 'xlogin', href: 'https://github.com/melvincarvalho/xlogin' },
      ],
    ), 'error');
    return false;
  }

  // Step 2: pubkey
  let pubkey;
  try {
    pubkey = (await window.nostr.getPublicKey()).toLowerCase();
  } catch (err) {
    setStatus(help([
      'Your signer declined to share your public key',
      err?.message ? ` (${err.message})` : '',
      '. Click Sign in to try again.',
    ]), 'error');
    return false;
  }
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    setStatus(`Signer returned an invalid public key: ${pubkey}`, 'error');
    return false;
  }

  // Step 3: resolve to WebID
  setStatus(`Resolving did:nostr:${pubkey.slice(0, 8)}… via ${resolver}`);
  let webId;
  try {
    webId = await resolveWebIdFromPubkey(pubkey, resolver);
  } catch (err) {
    if (err.code === 'no-binding') {
      setStatus(help(
        [err.message, ' '],
        [
          { label: 'How to link your Nostr key to a Solid pod', href: 'https://jss.live/docs/' },
          { label: 'Try a different resolver', href: '?resolver=https://nostr.social' },
        ],
      ), 'error');
    } else {
      setStatus(err.message, 'error');
    }
    return false;
  }

  // Step 4: discover IdP from the WebID profile
  setStatus(`Found ${webId}. Looking up your identity provider…`);
  const idp = await discoverIdpFromWebId(webId);

  // Step 5: stash where to land (so post-redirect knows)
  localStorage.setItem('jss-sso:webId', webId);

  // Step 6: kick off OIDC
  setStatus(`Signing you in via ${idp}…`);
  try {
    await startAuthFlow(idp);
    return true; // browser is redirecting
  } catch (err) {
    setStatus(`Could not start sign-in: ${err.message}`, 'error');
    return false;
  }
}

async function returnFlow() {
  // URL has `?code=` — finalize the OIDC handshake.
  setStatus('Completing sign-in…');
  try {
    const session = await handleAuthReturn();
    if (!session.isActive || !session.webId) {
      throw new Error('session did not become active after redirect');
    }
    const { next } = readConfig();
    const webId = session.webId || localStorage.getItem('jss-sso:webId');
    const dest = next || podRootFromWebId(webId);
    localStorage.removeItem('jss-sso:webId');
    setStatus(`Signed in as ${webId}. Taking you to your pod…`);
    setTimeout(() => { location.href = dest; }, 800);
  } catch (err) {
    setStatus(`Sign-in failed: ${err.message}`, 'error');
    const button = document.querySelector('#signin');
    if (button) button.disabled = false;
  }
}

function wire() {
  const button = document.querySelector('#signin');
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    const ok = await freshFlow();
    if (!ok) button.disabled = false;
  });
}

// On page load: if URL has ?code=, we're returning from the IdP —
// finalize the session. Otherwise wire up the button for a fresh
// sign-in.
if (new URLSearchParams(location.search).has('code')) {
  returnFlow();
} else {
  wire();
}
