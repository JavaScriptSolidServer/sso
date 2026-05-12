// JSS SSO — one-click Solid sign-in.
//
// Uses the JSS org's own `solid-oidc` package — a zero-build,
// single-file (~600 lines), zero-dependency Solid-OIDC client.
// Source: https://github.com/JavaScriptSolidServer/solid-oidc
//
// Flow:
//   1. Page loads. If a previous session is in localStorage, hydrate
//      it (session.init()). If the URL is a redirect-back, finalize
//      it (session.handleRedirectFromLogin()). Either way, if we
//      end up active, jump to the user's pod and skip the button.
//   2. Otherwise: button click → session.login(idp, redirectUri)
//      triggers a redirect to the configured IdP's /auth endpoint.
//      The IdP handles the actual identity proof (Schnorr / passkey /
//      password) and redirects back here.
//   3. On return: step 1 finalizes the session and we redirect to
//      the resolved WebID's pod root.
//
// Configurable via URL params (also persisted to localStorage so a
// freshly-redirected-back page knows where to send the user even if
// the params got stripped on the IdP round-trip):
//   ?idp=<oidc-issuer>      — defaults to https://solid.social
//   ?next=<destination-url>  — defaults to the WebID's pod root

import Session from 'https://esm.sh/solid-oidc';

const DEFAULT_IDP = 'https://solid.social';

function readConfig() {
  const params = new URLSearchParams(location.search);
  const idp = params.get('idp')
    || localStorage.getItem('jss-sso:idp')
    || DEFAULT_IDP;
  const next = params.get('next')
    || localStorage.getItem('jss-sso:next')
    || '';
  return { idp, next };
}

function setStatus(msg, isError = false) {
  const el = document.querySelector('#status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function podRootFromWebId(webId) {
  // WebID is typically `https://<pod-host>/profile/card.jsonld#me`
  // or `https://<pod-host>/<name>/profile/card.jsonld#me`. The pod
  // root is the origin (+ pod-name segment if present). For v0.1
  // we just go to the origin — works for both subdomain-mode pods
  // and path-mode root pods. Path-mode named pods land at the
  // server root and can navigate from there.
  try {
    return new URL('/', webId).href;
  } catch {
    return null;
  }
}

async function init() {
  const { idp, next } = readConfig();
  const session = new Session();

  // Hydrate any prior session OR finalize a redirect-back from the IdP.
  try {
    await session.init();
    if (location.search.includes('code=')) {
      await session.handleRedirectFromLogin();
    }
  } catch (err) {
    setStatus(`Sign-in failed: ${err.message}`, true);
    return;
  }

  if (session.isActive && session.webId) {
    const webId = session.webId;
    const dest = next || podRootFromWebId(webId);
    setStatus(`Signed in as ${webId}. Taking you to your pod…`);
    // Clear the saved `next` so a subsequent visit doesn't re-use it.
    localStorage.removeItem('jss-sso:next');
    setTimeout(() => { location.href = dest; }, 800);
    return;
  }

  // Fresh visit. Wire the button.
  const button = document.querySelector('#signin');
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    setStatus('Redirecting to your identity provider…');
    // Persist config so the redirect back can find it.
    localStorage.setItem('jss-sso:idp', idp);
    if (next) localStorage.setItem('jss-sso:next', next);
    try {
      await session.login(idp, location.origin + location.pathname);
    } catch (err) {
      setStatus(`Could not start sign-in: ${err.message}`, true);
      button.disabled = false;
    }
  });
}

init();
