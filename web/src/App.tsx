import { useEffect, useState } from "react";
import { getSession, type SessionInfo } from "./api";
import { ProjectList } from "./ProjectList";
import { ProjectView } from "./ProjectView";
import { SyncIndicator } from "./SyncIndicator";

type Route = { name: "projects" } | { name: "project"; owner: string; repo: string; task: number | null };

function parseRoute(): Route {
  const m = location.hash.match(/^#\/p\/([^/]+)\/([^/]+)(?:\/t\/(\d+))?/);
  return m
    ? { name: "project", owner: decodeURIComponent(m[1]), repo: decodeURIComponent(m[2]), task: m[3] ? Number(m[3]) : null }
    : { name: "projects" };
}

// 收到分享的任務連結時還沒登入：登入前記住網址，登入回來後還原
const RETURN_KEY = "rootask:return-to";
function rememberReturn() {
  try {
    if (location.hash.length > 2) sessionStorage.setItem(RETURN_KEY, location.hash);
  } catch {
    /* ignore */
  }
}
function restoreReturn() {
  try {
    const h = sessionStorage.getItem(RETURN_KEY);
    if (h) {
      sessionStorage.removeItem(RETURN_KEY);
      if (location.hash !== h) location.hash = h;
    }
  } catch {
    /* ignore */
  }
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [route, setRoute] = useState<Route>(parseRoute);

  useEffect(() => {
    getSession().then(
      (s) => {
        if (s.loggedIn) restoreReturn();
        setSession(s);
      },
      () => setSession({ loggedIn: false, installUrl: "" }),
    );
    const onHash = () => setRoute(parseRoute());
    const onLogout = () => setSession((s) => (s ? { ...s, loggedIn: false } : s));
    window.addEventListener("hashchange", onHash);
    window.addEventListener("rootask:logged-out", onLogout);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("rootask:logged-out", onLogout);
    };
  }, []);

  if (!session) return <div className="center muted">載入中…</div>;

  if (!session.loggedIn) {
    return (
      <div className="login">
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h1>Rootask</h1>
        <p className="muted">把任務從一個根，往下長成一棵樹。</p>
        <a className="btn primary" href="/auth/login" onClick={rememberReturn}>
          使用 GitHub 帳號登入
        </a>
        <p className="fine">本系統使用 GitHub 帳號登入，任務資料存放在你的專案 repo 中。</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <img src="/icon.svg" alt="" width={24} height={24} />
          Rootask
        </a>
        {route.name === "project" && (
          <span className="crumb">
            {route.owner} / <b>{route.repo}</b>
          </span>
        )}
        <SyncIndicator />
        <a className="link" href="/auth/logout">
          登出
        </a>
      </header>
      {route.name === "projects" ? (
        <ProjectList installUrl={session.installUrl} />
      ) : (
        <ProjectView key={`${route.owner}/${route.repo}`} owner={route.owner} repo={route.repo} fullTask={route.task} />
      )}
    </div>
  );
}
