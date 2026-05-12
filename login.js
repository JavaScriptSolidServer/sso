// JSS SSO — one-click Solid sign-in.
//
// Happy path (everything configured):
//   click button
//     → window.nostr.getPublicKey()      (signer extension)
//     → fetch <resolver>/.well-known/did/nostr/<pubkey>.json
//     → read alsoKnownAs[0] → WebID
//     → redirect to that WebID's pod root
//
// One click, one (auto-approvable) signer prompt, no IdP page,
// no OIDC redirect.
//
// Trade-off: the user lands at their pod WITHOUT an authenticated
// Solid-OIDC session. They can browse public content; anything
// WAC-protected would prompt for a session via whatever app needs
// it. For "magic SSO landing" that's fine. A v0.2 step would add
// optional NIP-98 → DPoP exchange against the IdP.
//
// Failure path: at every step, if the happy path can't proceed,
// we show a precise diagnosis + the user's next concrete action.
// PoC philosophy: assume everything works; gracefully degrade with
// guidance when it doesn't.
//
// URL params:
//   ?resolver=<host>   — DID-doc resolver host (default solid.social)
//   ?next=<url>        — destination after success (default pod root)

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

// Build a small DOM fragment with text + links. Easier than
// innerHTML for safety (we don't substitute user-controlled
// strings into HTML).
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

async function flow() {
  const { resolver, next } = readConfig();
  setStatus('Reading your Nostr identity…');

  // Step 1 — signer extension present?
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

  // Step 2 — get the pubkey (may prompt user in the extension)
  let pubkey;
  try {
    pubkey = (await window.nostr.getPublicKey()).toLowerCase();
  } catch (err) {
    setStatus(help(
      ['Your signer declined to share your public key',
       err?.message ? ` (${err.message})` : '', '. Click Sign in to try again.'],
    ), 'error');
    return false;
  }
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    setStatus(`Signer returned an invalid public key: ${pubkey}`, 'error');
    return false;
  }

  // Step 3 — resolve pubkey → DID doc via the well-known endpoint
  setStatus(`Resolving did:nostr:${pubkey.slice(0, 8)}… via ${resolver}`);
  let didDoc;
  try {
    const res = await fetch(`${resolver}/.well-known/did/nostr/${pubkey}.json`, {
      headers: { Accept: 'application/did+json, application/json' },
    });
    if (res.status === 404) {
      setStatus(help(
        ['Your Nostr key isn’t linked to a Solid pod at ', resolver, '. '],
        [
          { label: 'How to link your Nostr key to a Solid pod', href: 'https://jss.live/docs/' },
          { label: `Try a different resolver: ?resolver=<host>`, href: '?resolver=https://nostr.social' },
        ],
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
      [`Your did:nostr document at ${resolver} doesn’t include an alsoKnownAs WebID. `],
      [{ label: 'How to fix this', href: 'https://jss.live/docs/' }],
    ), 'error');
    return false;
  }

  // Step 5 — redirect
  const dest = next || podRootFromWebId(webId);
  if (!dest) {
    setStatus(`Resolved WebID is unparseable: ${webId}`, 'error');
    return false;
  }
  setStatus(`Signed in as ${webId}. Taking you to your pod…`);
  setTimeout(() => { location.href = dest; }, 800);
  return true;
}

function wire() {
  const button = document.querySelector('#signin');
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    const ok = await flow();
    if (!ok) button.disabled = false;
  });
}

wire();
