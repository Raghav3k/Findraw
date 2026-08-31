import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { observeLiveEvents, disconnectTwitch, fetchTwitchSession, type TwitchSession } from "../twitch/twitchApi";
import { usePersistentState } from "../ui/usePersistentState";

export const EMPTY_TWITCH_SESSION: TwitchSession = {
  authenticated: false,
  configured: false,
  eventSubStatus: "disconnected",
  canSendChat: false,
  chatCommandsEnabled: true,
  user: null,
};

type SiteIdentityContextValue = {
  ready: boolean;
  twitchSession: TwitchSession;
  setTwitchSession: Dispatch<SetStateAction<TwitchSession>>;
  guestName: string;
  setGuestName: (name: string) => void;
  displayName: string;
  profileImageUrl: string | null;
  source: "twitch" | "guest";
  disconnect: () => Promise<void>;
};

const SiteIdentityContext = createContext<SiteIdentityContextValue | null>(null);

export function SiteIdentityProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [twitchSession, setTwitchSession] = useState<TwitchSession>(EMPTY_TWITCH_SESSION);
  const [guestName, setGuestName] = usePersistentState("room.playerName", "Streamer");

  useEffect(() => {
    let mounted = true;
    fetchTwitchSession().then((session) => {
      if (mounted) setTwitchSession(session);
    }).catch(() => undefined).finally(() => {
      if (mounted) setReady(true);
    });
    const stopEvents = observeLiveEvents((event) => {
      if (event.type === "twitch-session") setTwitchSession(event.payload);
    });
    const refreshIdentity = () => {
      if (document.visibilityState !== "visible") return;
      void fetchTwitchSession().then((session) => { if (mounted) setTwitchSession(session); }).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", refreshIdentity);
    const url = new URL(window.location.href);
    if (url.searchParams.has("twitch")) {
      url.searchParams.delete("twitch");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    return () => { mounted = false; stopEvents(); document.removeEventListener("visibilitychange", refreshIdentity); };
  }, []);

  const value = useMemo<SiteIdentityContextValue>(() => ({
    ready,
    twitchSession,
    setTwitchSession,
    guestName,
    setGuestName,
    displayName: twitchSession.authenticated ? twitchSession.user?.displayName?.trim() || "Streamer" : guestName.trim() || "Player",
    profileImageUrl: twitchSession.authenticated ? twitchSession.user?.profileImageUrl ?? null : null,
    source: twitchSession.authenticated ? "twitch" : "guest",
    disconnect: async () => {
      await disconnectTwitch();
      setTwitchSession((current) => ({ ...EMPTY_TWITCH_SESSION, configured: current.configured }));
    },
  }), [guestName, ready, setGuestName, twitchSession]);

  return <SiteIdentityContext.Provider value={value}>{children}</SiteIdentityContext.Provider>;
}

export function useSiteIdentity() {
  const identity = useContext(SiteIdentityContext);
  if (!identity) throw new Error("useSiteIdentity must be used inside SiteIdentityProvider.");
  return identity;
}
