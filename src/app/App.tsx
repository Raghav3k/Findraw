import { useCallback, useEffect, useState } from "react";
import { AutoDrawPage } from "../autoDraw/AutoDrawPage";
import { Dashboard } from "../dashboard/Dashboard";
import { ModeHome } from "../home/ModeHome";

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    if (window.location.pathname === "/" && new URLSearchParams(window.location.search).get("twitch") === "connected") {
      window.history.replaceState({}, "", `/draw${window.location.search}`); setPath("/draw"); return;
    }
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const navigate = useCallback((next: string) => { window.history.pushState({}, "", next); setPath(next); window.scrollTo({ top: 0 }); }, []);
  if (path === "/draw") return <Dashboard onNavigate={navigate}/>;
  if (path === "/auto-draw") return <AutoDrawPage onNavigate={navigate}/>;
  return <ModeHome onNavigate={navigate}/>;
}
