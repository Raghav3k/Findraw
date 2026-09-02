import { useCallback, useEffect, useState } from "react";
import { Dashboard } from "../dashboard/Dashboard";
import { ModeHome } from "../home/ModeHome";
import { RoomModePage } from "../room/RoomModePage";
import { PrivateRoomSetupPage } from "../room/PrivateRoomSetupPage";
import { PublicMatchPage } from "../room/PublicMatchPage";
import { RoomPortalPage } from "../room/RoomPortalPage";
import { SiteIdentityProvider } from "../identity/SiteIdentity";

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const navigate = useCallback((next: string) => { window.history.pushState({}, "", next); setPath(next); window.scrollTo({ top: 0 }); }, []);
  const page = path === "/draw"
    ? <Dashboard onNavigate={navigate}/>
    : path === "/room"
        ? <RoomPortalPage onNavigate={navigate}/>
        : path === "/room/private"
          ? <PrivateRoomSetupPage onNavigate={navigate}/>
          : path === "/room/multiplayer"
            ? <PublicMatchPage onNavigate={navigate}/>
            : path === "/room/play"
              ? <RoomModePage onNavigate={navigate}/>
      : <ModeHome onNavigate={navigate}/>;
  return <SiteIdentityProvider>{page}</SiteIdentityProvider>;
}
