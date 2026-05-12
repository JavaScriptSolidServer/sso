// JSS SSO — one-click Solid sign-in.
//
// Uses the xlogin library (https://github.com/melvincarvalho/xlogin)
// for the actual sign-in flow. xlogin is a one-script-tag auth
// widget that handles both Nostr (NIP-07 / NIP-98) and Solid-OIDC
// (with DPoP) login, falling back to a provider picker when no
// signer extension is detected. It exposes `window.xlogin.id` as
// the resolved WebID (or Nostr pubkey) and fires an `xlogin` event
// when authentication succeeds.
//
// Our role here is the smallest possible UI surface — a big
// centered button — that triggers xlogin and then redirects the
// user to their pod root once xlogin reports success.
//
// Configurable via URL params:
//   ?next=<destination-url>  — defaults to the WebID's pod root
//   (xlogin handles IdP selection itself; no `idp` param needed.)

function readConfig() {
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '';
  return { next };
}

function setStatus(msg, isError = false) {
  const el = document.querySelector('#status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function podRootFromWebId(webId) {
  // WebID is typically `https://<pod-host>/profile/card.jsonld#me`
  // or `https://<pod-host>/<name>/profile/card.jsonld#me`. We send
  // the user to the WebID's origin (the pod's server root). Works
  // for both subdomain-mode pods and path-mode root pods. Path-mode
  // named pods land at the server root and can navigate from there.
  try {
    return new URL('/', webId).href;
  } catch {
    return null;
  }
}

function redirectToPod() {
  const { next } = readConfig();
  const webId = window.xlogin?.id;
  if (!webId) return false;
  const dest = next || podRootFromWebId(webId);
  if (!dest) return false;
  setStatus(`Signed in as ${webId}. Taking you to your pod…`);
  setTimeout(() => { location.href = dest; }, 800);
  return true;
}

function init() {
  // If xlogin already reports an active identity (page reload after
  // a successful sign-in), redirect immediately.
  if (window.xlogin?.id) {
    redirectToPod();
    return;
  }

  // Otherwise listen for the xlogin event the library fires on
  // successful authentication.
  document.addEventListener('xlogin', () => {
    redirectToPod();
  });

  // Wire our centered button to trigger xlogin's modal.
  const button = document.querySelector('#signin');
  if (!button) return;
  button.addEventListener('click', () => {
    if (!window.xlogin) {
      setStatus('Sign-in widget not ready, please retry.', true);
      return;
    }
    setStatus('Choose your identity provider…');
    window.xlogin.login();
  });
}

// xlogin loads asynchronously from CDN. Wait for window.xlogin to
// exist before wiring the button (otherwise the user could click
// before the widget is ready and get a no-op).
if (window.xlogin) {
  init();
} else {
  window.addEventListener('load', init);
}
