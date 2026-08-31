import { apiUrl, hasApiBaseUrl } from "../apiUrls";

type Turnstile = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
let sessionPromise: Promise<void> | null = null;
let humanPromise: Promise<void> | null = null;
let verifiedUntil = 0;

export function ensureBrowserSession(): Promise<void> {
  if (!hasApiBaseUrl) return Promise.resolve(); // The loopback-only development server is separate.
  return sessionPromise ||= fetch(apiUrl("/api/security/session"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" })
    .then(async response => { if (!response.ok) throw new Error((await response.json()).error || "Could not establish a secure session."); })
    .catch(error => { sessionPromise = null; throw error; });
}

export async function ensureHuman(): Promise<void> {
  if (!hasApiBaseUrl || Date.now() < verifiedUntil) return;
  if (humanPromise) return humanPromise;
  humanPromise = (async () => {
    await ensureBrowserSession();
    const configResponse = await fetch(apiUrl("/api/security/config"), { credentials: "include" });
    const config = await configResponse.json();
    if (!configResponse.ok || !config.siteKey) throw new Error("Public access verification is not configured yet.");
    const hostWindow = window as Window & { turnstile?: Turnstile };
    if (!hostWindow.turnstile) await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script"); script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.onload = () => resolve(); script.onerror = () => { script.remove(); reject(new Error("Verification could not load. Please retry.")); }; document.head.append(script);
    });
    await new Promise<void>((resolve, reject) => {
      const backdrop = document.createElement("div"); backdrop.className = "security-verification";
      const panel = document.createElement("section"); panel.className = "security-verification-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "Verify public access");
      const heading = document.createElement("h2"); heading.textContent = "Before you join";
      const text = document.createElement("p"); text.textContent = "A quick check helps keep Findraw free of spam.";
      const widget = document.createElement("div");
      const cancel = document.createElement("button"); cancel.textContent = "Cancel";
      panel.append(heading, text, widget, cancel); backdrop.append(panel); document.body.append(backdrop);
      let widgetId: string | undefined; let finished = false;
      const cleanup = () => { if (widgetId) hostWindow.turnstile?.remove(widgetId); backdrop.remove(); };
      const fail = () => { if (finished) return; finished = true; cleanup(); reject(new Error("Verification cancelled or expired. Please try again.")); };
      cancel.onclick = fail; cancel.focus();
      widgetId = hostWindow.turnstile!.render(widget, { sitekey: config.siteKey, action: "findraw_access", theme: "light", "error-callback": fail, "expired-callback": fail,
        callback: async (token: string) => {
          if (finished) return;
          try {
            const response = await fetch(apiUrl("/api/security/verify"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
            if (!response.ok) throw new Error("Verification failed.");
            if (finished) return; finished = true; verifiedUntil = Date.now() + 25 * 60000; cleanup(); resolve();
          } catch { fail(); }
        },
      });
    });
  })().finally(() => { humanPromise = null; });
  return humanPromise;
}

export async function secureFetch(path: string, init: RequestInit = {}, human = false) {
  await ensureBrowserSession(); if (human) await ensureHuman();
  return fetch(apiUrl(path), { ...init, credentials: "include" });
}
