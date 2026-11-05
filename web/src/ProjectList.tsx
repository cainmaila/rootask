import { useEffect, useState } from "react";
import { gh } from "./api";

interface Repo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  description: string | null;
}

async function loadRepos(): Promise<Repo[]> {
  const inst = await gh<{ installations: { id: number }[] }>("/user/installations?per_page=100");
  const lists = await Promise.all(
    inst.installations.map((i) =>
      gh<{ repositories: Repo[] }>(`/user/installations/${i.id}/repositories?per_page=100`).then((r) => r.repositories),
    ),
  );
  return lists.flat().sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export function ProjectList({ installUrl }: { installUrl: string }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRepos().then(setRepos, (e: Error) => setError(e.message));
  }, []);

  return (
    <main className="page">
      <div className="page-head">
        <h2>專案</h2>
        <a className="btn" href={installUrl} target="_blank" rel="noreferrer">
          ＋ 綁定 repo
        </a>
      </div>
      {error && <p className="error">讀取失敗：{error}</p>}
      {!repos && !error && <p className="muted">載入中…</p>}
      {repos?.length === 0 && (
        <div className="empty">
          <p>還沒有可用的專案。</p>
          <p className="muted">每個專案對應一個 repo。按「綁定 repo」選擇要使用的 repo，完成後回到這裡重新整理。</p>
        </div>
      )}
      <ul className="cards">
        {repos?.map((r) => (
          <li key={r.id}>
            <a className="card" href={`#/p/${encodeURIComponent(r.owner.login)}/${encodeURIComponent(r.name)}`}>
              <div className="card-title">
                {r.name} {r.private && <span className="tag">私有</span>}
              </div>
              <div className="muted small">{r.owner.login}</div>
              {r.description && <div className="small">{r.description}</div>}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
