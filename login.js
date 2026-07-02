// JSS SSO — one-click Solid sign-in.
//
// What this page does:
//   click button
//     → window.nostr.getPublicKey()      (signer extension)
//     → fetch <resolver>/.well-known/did/nostr/<pubkey>.json
//     → read alsoKnownAs[0] → WebID
//     → redirect to that WebID's pod root
//
// What this page does NOT do (yet):
//   Establish an authenticated session AT the pod. The SSO page is
//   at one origin (jss.live), the IdP is at another (solid.social),
//   the pod is at a third (e.g. test.solid.social). Browser-cookie
//   sessions don't cross origins, and the pod's own auth widget
//   (xlogin) runs its own Nostr flow independent of any OIDC
//   session the SSO page might establish. So this PoC honors a
//   narrow scope: "find my pod and take me there." Authentication
//   AT the pod is the pod's own concern — typically one more click
//   on the pod's Login button. See sso#8 for the auto-login-on-
//   arrival follow-up.
//
// PoC philosophy: assume the happy path; show precise diagnosis
// and next-step coaching at each failure node.
//
// URL params:
//   ?resolver=<host>   — DID-doc resolver host (default solid.social)
//   ?next=<url>        — destination after success (default pod root)

const DEFAULT_RESOLVER = 'https://solid.social';
const FALLBACK_RESOLVER = 'https://nostr.social'; // did-nostr.com source

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

// Both "not linked" outcomes (404, and a synthesized DID doc with no
// alsoKnownAs — nostr.social answers 200 for any valid key) get the
// same coaching. Don't offer the fallback when we're already on it.
function linkCoaching(resolver) {
  const links = [
    { label: 'How to link your Nostr key to a Solid pod', href: 'https://jss.live/docs/' },
  ];
  if (resolver !== FALLBACK_RESOLVER) {
    const alt = new URLSearchParams(location.search);
    alt.set('resolver', FALLBACK_RESOLVER);
    links.push({ label: 'Try the fallback resolver (nostr.social)', href: `?${alt}` });
  }
  return links;
}

// Signer extensions can inject window.nostr a beat after page load;
// don't declare "no signer" on a fast click without a short grace poll.
function waitForSigner(ms = 1500) {
  return new Promise((resolve) => {
    if (window.nostr) return resolve(true);
    const started = performance.now();
    const poll = setInterval(() => {
      if (window.nostr) { clearInterval(poll); resolve(true); }
      else if (performance.now() - started > ms) { clearInterval(poll); resolve(false); }
    }, 100);
  });
}

async function flow() {
  const { resolver, next } = readConfig();
  setStatus('Reading your Nostr identity…');

  // Step 1 — signer extension present?
  if (!(await waitForSigner())) {
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

  // Step 2 — get the pubkey
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

  // Step 3 — resolve via the well-known DID-doc endpoint
  setStatus(`Resolving did:nostr:${pubkey.slice(0, 8)}… via ${resolver}`);
  let didDoc;
  try {
    const res = await fetch(`${resolver}/.well-known/did/nostr/${pubkey}.json`, {
      headers: { Accept: 'application/did+json, application/json' },
    });
    if (res.status === 404) {
      setStatus(help(
        ['Your Nostr key isn’t linked to a Solid pod at ', resolver, '. '],
        linkCoaching(resolver),
      ), 'error');
      return false;
    }
    if (!res.ok) {
      setStatus(`Resolver ${resolver} returned ${res.status} ${res.statusText}.`, 'error');
      return false;
    }
    didDoc = await res.json();
  } catch (err) {
    setStatus(help(
      [`Couldn’t reach ${resolver}: ${err.message}. Check your connection or try a different resolver.`],
    ), 'error');
    return false;
  }

  // Step 4 — pluck the WebID from alsoKnownAs
  const aka = Array.isArray(didDoc.alsoKnownAs) ? didDoc.alsoKnownAs : [];
  const webId = aka.find((x) => typeof x === 'string' && /^https?:\/\//.test(x));
  if (!webId) {
    setStatus(help(
      [`Your Nostr key isn’t linked to a Solid pod at ${resolver} — the DID document has no alsoKnownAs WebID. `],
      linkCoaching(resolver),
    ), 'error');
    return false;
  }

  // Step 5 — redirect, with the user's DID:nostr WebID attached
  // as a `?webid=` query param. PoC phase 1: no signature, no
  // verification, just deliver the identifier to the pod so its
  // auth widget can pick it up. Phase 2 will sign it (NIP-98).
  const base = next || podRootFromWebId(webId);
  if (!base) {
    setStatus(`Resolved WebID is unparseable: ${webId}`, 'error');
    return false;
  }
  let dest;
  try {
    const url = new URL(base);
    if (!/^https?:$/.test(url.protocol)) {
      setStatus(`Refusing to redirect to a non-HTTP destination: ${base}`, 'error');
      return false;
    }
    url.searchParams.set('webid', `did:nostr:${pubkey}`);
    dest = url.href;
  } catch {
    setStatus(`Could not build redirect URL from: ${base}`, 'error');
    return false;
  }
  setStatus(`Found your WebID: ${webId}. Taking you to ${base}…`);
  // Hopping to the user's own pod is instant; an app-supplied ?next=
  // destination stays on screen for a beat so the user sees where
  // they're being sent before leaving this origin.
  setTimeout(() => { location.href = dest; }, next ? 1500 : 0);
  return true;
}

function wire() {
  const button = document.querySelector('#signin');
  if (!button) return;

  async function run() {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Signing in…';
    const ok = await flow();
    if (!ok) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Sign in';
    }
  }

  button.addEventListener('click', run);

  if (new URLSearchParams(location.search).has('resolver')) {
    // Arriving via a "Try the fallback resolver" link (or any explicit
    // ?resolver=) carries a click's worth of intent — resume the flow
    // instead of asking for a second click.
    run();
  } else {
    // Soft pre-check: coach before the first click if no signer
    // extension has announced itself.
    setTimeout(() => {
      if (!window.nostr && !button.disabled) {
        setStatus('No Nostr signer detected yet — you’ll need a signer extension to sign in.');
      }
    }, 1500);
  }
}

wire();
