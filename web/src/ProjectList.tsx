import { useEffect, useMemo, useState } from "react";
import { ApiError, gh } from "./api";

interface Repo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  description: string | null;
  pushed_at: string | null;
}

const PER_PAGE = 100;

/** 依 GitHub 回傳的 total_count 把所有頁都抓回來 */
async function loadInstallationRepos(id: number): Promise<Repo[]> {
  const first = await gh<{ total_count: number; repositories: Repo[] }>(
    `/user/installations/${id}/repositories?per_page=${PER_PAGE}&page=1`,
  );
  const pages = Math.ceil(first.total_count / PER_PAGE);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      gh<{ repositories: Repo[] }>(`/user/installations/${id}/repositories?per_page=${PER_PAGE}&page=${i + 2}`).then(
        (r) => r.repositories,
      ),
    ),
  );
  return [first.repositories, ...rest].flat();
}

async function loadRepos(): Promise<Repo[]> {
  const inst = await gh<{ installations: { id: number }[] }>("/user/installations?per_page=100");
  const lists = await Promise.all(inst.installations.map((i) => loadInstallationRepos(i.id)));
  const seen = new Set<number>();
  return lists
    .flat()
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    // 最近有動靜的排前面，新開的 repo 也會在最上面
    .sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""));
}

/** 接受 owner/repo、https://github.com/owner/repo(.git)、git@github.com:owner/repo.git */
export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m =
    s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i) ??
    s.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/i) ??
    s.match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function projectHref(owner: string, repo: string) {
  return `#/p/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function ProjectList({ installUrl }: { installUrl: string }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    loadRepos().then(setRepos, (e: Error) => setError(e.message));
  }, []);

  const pasted = parseRepoInput(query);
  const filtered = useMemo(() => {
    if (!repos) return null;
    const q = query.trim().toLowerCase();
    if (!q || pasted) return pasted ? repos.filter((r) => r.full_name.toLowerCase() === `${pasted.owner}/${pasted.repo}`.toLowerCase()) : repos;
    return repos.filter(
      (r) => r.full_name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q),
    );
  }, [repos, query, pasted]);

  /** 貼上的 repo：確認 App 已安裝在上面再進入 */
  async function openPasted() {
    if (!pasted) return;
    setOpening(true);
    setOpenMsg(null);
    try {
      await gh(`/repos/${pasted.owner}/${pasted.repo}`);
      // 使用者看得到 repo 還不夠，App 也要裝在上面才能讀寫 issue
      const known = repos?.some((r) => r.full_name.toLowerCase() === `${pasted.owner}/${pasted.repo}`.toLowerCase());
      if (known === false) {
        setOpenMsg("找到這個 repo，但還沒綁定。請按「綁定 repo」把它加入後再回來。");
        return;
      }
      location.hash = projectHref(pasted.owner, pasted.repo);
    } catch (e) {
      setOpenMsg(
        e instanceof ApiError && e.status === 404
          ? "找不到這個 repo，或它還沒綁定。請確認名稱，或按「綁定 repo」加入。"
          : `開啟失敗：${(e as Error).message}`,
      );
    } finally {
      setOpening(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <h2>專案</h2>
        <a className="btn" href={installUrl} target="_blank" rel="noreferrer">
          ＋ 綁定 repo
        </a>
      </div>

      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (pasted) void openPasted();
          else if (filtered?.length === 1) location.hash = projectHref(filtered[0].owner.login, filtered[0].name);
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenMsg(null);
          }}
          placeholder="搜尋專案，或貼上 repo 網址／owner/repo"
          autoFocus
        />
        {pasted && (
          <button className="btn primary" disabled={opening}>
            開啟
          </button>
        )}
      </form>
      {openMsg && <p className="banner">{openMsg}</p>}

      {error && <p className="error">讀取失敗：{error}</p>}
      {!repos && !error && <p className="muted">載入中…</p>}
      {repos?.length === 0 && (
        <div className="empty">
          <p>還沒有可用的專案。</p>
          <p className="muted">每個專案對應一個 repo。按「綁定 repo」選擇要使用的 repo，完成後回到這裡重新整理。</p>
        </div>
      )}
      {repos && repos.length > 0 && (
        <p className="muted small">
          {query.trim() ? `${filtered?.length ?? 0} / ` : ""}
          {repos.length} 個專案
        </p>
      )}
      {repos && repos.length > 0 && filtered?.length === 0 && !pasted && (
        <p className="muted">沒有符合的專案。找不到新開的 repo 的話，可能還沒綁定，請按「綁定 repo」。</p>
      )}
      <ul className="cards">
        {filtered?.map((r) => (
          <li key={r.id}>
            <a className="card" href={projectHref(r.owner.login, r.name)}>
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
