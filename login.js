// JSS SSO — one-click Solid sign-in.
//
// What this page does:
//   click button
//     → window.nostr.getPublicKey()      (signer extension)
//     → fetch <resolver>/.well-known/did/nostr/<pubkey>.json
//     → read alsoKnownAs[0] → WebID
//     → redirect to that WebID's pod root
//   or, without a signer: paste npub / hex pubkey / nsec (PoC,
//   test keys only — nsec is reduced to its pubkey in memory)
//   and the same resolve-and-redirect steps run.
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

// ---- Manual key entry (PoC) ----
// The current flow only ever needs a *public* key. nsec is accepted
// so the "sign in with your private key" UX can be exercised with
// throwaway keys before phase 2 (NIP-98 signing) lands. The key is
// decoded in memory, reduced to its pubkey, and never stored.

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function polymodStep(pre) {
  const b = pre >> 25;
  let chk = (pre & 0x1ffffff) << 5;
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  return chk;
}

function bech32Decode(s) {
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) return null;
  const hrp = s.slice(0, pos);
  const data = [...s.slice(pos + 1)].map((c) => BECH32_CHARSET.indexOf(c));
  if (data.includes(-1)) return null;
  let chk = 1;
  for (const c of hrp) chk = polymodStep(chk) ^ (c.charCodeAt(0) >> 5);
  chk = polymodStep(chk);
  for (const c of hrp) chk = polymodStep(chk) ^ (c.charCodeAt(0) & 31);
  for (const d of data) chk = polymodStep(chk) ^ d;
  if (chk !== 1) return null;
  let acc = 0, bits = 0;
  const out = [];
  for (const v of data.slice(0, -6)) {
    acc = (acc << 5) | v; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return { hrp, bytes: new Uint8Array(out) };
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pubkeyFromInput(raw) {
  const s = raw.trim().toLowerCase();
  if (!s) throw new Error('Enter a key first.');
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  const dec = bech32Decode(s);
  if (!dec || dec.bytes.length !== 32) {
    throw new Error('Couldn’t parse that key — expected npub1…, nsec1…, or 64 hex characters.');
  }
  if (dec.hrp === 'npub') return toHex(dec.bytes);
  if (dec.hrp === 'nsec') {
    const { getPublicKey } = await import('https://cdn.jsdelivr.net/npm/nostr-tools@2/+esm');
    return getPublicKey(dec.bytes);
  }
  throw new Error(`Unsupported key type “${dec.hrp}” — expected npub or nsec.`);
}

async function flow() {
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

  return resolveAndGo(pubkey);
}

async function resolveAndGo(pubkey) {
  const { resolver, next } = readConfig();

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
  setStatus(`Found your WebID: ${webId}. Taking you to ${base}…`, 'ok');
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

  const toggle = document.querySelector('#alt-toggle');
  const form = document.querySelector('#manual');
  if (toggle && form) {
    toggle.addEventListener('click', () => {
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector('input').focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const go = form.querySelector('button');
      input.disabled = true; go.disabled = true;
      try {
        const pubkey = await pubkeyFromInput(input.value);
        const ok = await resolveAndGo(pubkey);
        if (!ok) { input.disabled = false; go.disabled = false; }
      } catch (err) {
        setStatus(err.message, 'error');
        input.disabled = false; go.disabled = false;
      }
    });
  }

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
