// JSS SSO — one-click Solid sign-in.
//
// Flow:
//   1. Page loads. If a Solid-OIDC session was already restored
//      (handleIncomingRedirect), redirect straight to the user's
//      pod root. Skip the button.
//   2. Otherwise: button click → `login()` triggers a redirect to
//      the configured IdP's /auth endpoint. The IdP handles the
//      actual identity proof (Schnorr / passkey / password) and
//      redirects back here with auth state.
//   3. On return: step 1 fires, the session is hydrated, and we
//      redirect to the resolved WebID's pod root.
//
// Configurable via URL params or localStorage:
//   ?idp=<oidc-issuer>      — defaults to https://solid.social
//   ?next=<destination-url>  — defaults to the WebID's pod root
//
// Both are persisted so a freshly-redirected-back page knows
// where to send the user even if the params got stripped on the
// IdP round-trip.

import {
  login,
  handleIncomingRedirect,
  getDefaultSession,
} from 'https://esm.sh/@inrupt/[email protected]';

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

  // If we're coming back from the IdP, hydrate the session.
  try {
    await handleIncomingRedirect({
      restorePreviousSession: true,
    });
  } catch (err) {
    setStatus(`Sign-in failed: ${err.message}`, true);
    return;
  }

  const session = getDefaultSession();
  if (session.info.isLoggedIn && session.info.webId) {
    const webId = session.info.webId;
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
      await login({
        oidcIssuer: idp,
        redirectUrl: location.origin + location.pathname,
        clientName: 'JSS SSO',
      });
    } catch (err) {
      setStatus(`Could not start sign-in: ${err.message}`, true);
      button.disabled = false;
    }
  });
}

init();
