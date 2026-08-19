import React, { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  api,
  getToken,
  setToken,
  type ActivityItem,
  type Job,
  type Project,
  type Role,
  type SocialAccount,
  type User,
} from "./api";

type Route =
  | { name: "login" }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "role"; id: string; slug: string }
  | { name: "activity"; id: string }
  | { name: "credits" }
  | { name: "accounts" }
  | { name: "admin" };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/projects";
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "login") return { name: "login" };
  if (parts[0] === "credits") return { name: "credits" };
  if (parts[0] === "accounts") return { name: "accounts" };
  if (parts[0] === "admin") return { name: "admin" };
  if (parts[0] === "projects" && parts[1] && parts[2] === "activity") {
    return { name: "activity", id: parts[1] };
  }
  if (parts[0] === "projects" && parts[1] && parts[2] === "roles" && parts[3]) {
    return { name: "role", id: parts[1], slug: parts[3] };
  }
  if (parts[0] === "projects" && parts[1]) {
    return { name: "project", id: parts[1] };
  }
  return { name: "projects" };
}

function go(path: string) {
  window.location.hash = path;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm mb-3">
      <span className="block text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm";

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    if (!getToken()) {
      setReady(true);
      if (route.name !== "login") {
        window.location.hash = "/login";
        setRoute({ name: "login" });
      }
      return;
    }
    api<{ user: User; balance: number }>("/app/auth/me")
      .then((data) => {
        setUser(data.user);
        setBalance(data.balance);
        if (route.name === "login") go("/projects");
      })
      .catch(() => {
        setToken(null);
        go("/login");
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {user && (
        <header className="border-b border-border px-6 py-3 flex items-center gap-4">
          <button className="font-semibold" onClick={() => go("/projects")}>
            Social Bro
          </button>
          <nav className="flex gap-3 text-sm text-muted-foreground">
            <button onClick={() => go("/projects")}>Projects</button>
            <button onClick={() => go("/accounts")}>Accounts</button>
            <button onClick={() => go("/credits")}>Credits</button>
            {user.isAdmin && (
              <button onClick={() => go("/admin")}>Admin</button>
            )}
          </nav>
          <div className="ml-auto text-sm">
            <span className="text-muted-foreground">{user.username}</span>
            <span className="ml-3 font-medium">{balance} tokens</span>
            <button
              className="ml-4 text-muted-foreground"
              onClick={async () => {
                await api("/app/auth/logout", { method: "POST" });
                setToken(null);
                setUser(null);
                go("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </header>
      )}
      <main className="max-w-5xl mx-auto p-6">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </div>
        )}
        {route.name === "login" && (
          <Login
            onLogin={(next, tok, bal) => {
              setToken(tok);
              setUser(next);
              setBalance(bal);
              go("/projects");
            }}
            onError={setError}
          />
        )}
        {route.name === "projects" && user && <Projects onError={setError} />}
        {route.name === "project" && user && (
          <ProjectHome
            projectId={route.id}
            balance={balance}
            setBalance={setBalance}
            onError={setError}
          />
        )}
        {route.name === "role" && user && (
          <RoleEditor
            projectId={route.id}
            slug={route.slug}
            onError={setError}
          />
        )}
        {route.name === "activity" && user && (
          <Activity projectId={route.id} onError={setError} />
        )}
        {route.name === "credits" && user && (
          <Credits
            balance={balance}
            setBalance={setBalance}
            onError={setError}
          />
        )}
        {route.name === "accounts" && user && <Accounts onError={setError} />}
        {route.name === "admin" && user?.isAdmin && (
          <Admin setBalance={setBalance} onError={setError} />
        )}
      </main>
    </div>
  );
}

function Login({
  onLogin,
  onError,
}: {
  onLogin: (user: User, token: string, balance: number) => void;
  onError: (msg: string) => void;
}) {
  const [username, setUsername] = useState("main");
  const [password, setPassword] = useState("changeme");
  return (
    <form
      className="max-w-sm mx-auto mt-16 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        onError("");
        try {
          const data = await api<{ user: User; token: string }>(
            "/app/auth/login",
            {
              method: "POST",
              body: JSON.stringify({ username, password }),
            },
          );
          setToken(data.token);
          const me = await api<{ balance: number }>("/app/auth/me");
          onLogin(data.user, data.token, me.balance);
        } catch (err) {
          onError(err instanceof ApiError ? err.message : "Sign in failed");
        }
      }}
    >
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-sm text-muted-foreground">
        Hardcoded operator account for this phase. Credits are in-app tokens —
        no real money.
      </p>
      <Field label="Username">
        <input
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <button className="w-full rounded-md bg-primary text-primary-foreground py-2">
        Continue
      </button>
    </form>
  );
}

function Accounts({ onError }: { onError: (msg: string) => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [form, setForm] = useState({
    platform: "twitter",
    handle: "",
    displayName: "",
    profileUrl: "",
  });
  const load = () =>
    api<{ accounts: SocialAccount[] }>("/app/accounts")
      .then((data) => setAccounts(data.accounts))
      .catch((err) => onError(err.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Social accounts</h1>
      <p className="text-sm text-muted-foreground mb-6">
        These are your handles. Bind them to project roles so jobs draft for the
        right account. No live posting from this phase.
      </p>
      <form
        className="rounded-lg border border-border p-4 mb-6 grid gap-3 md:grid-cols-5"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api("/app/accounts", {
              method: "POST",
              body: JSON.stringify(form),
            });
            setForm({
              platform: "twitter",
              handle: "",
              displayName: "",
              profileUrl: "",
            });
            load();
          } catch (err) {
            onError(err instanceof Error ? err.message : "Save failed");
          }
        }}
      >
        <select
          className={inputClass}
          value={form.platform}
          onChange={(e) => setForm({ ...form, platform: e.target.value })}
        >
          {["twitter", "instagram", "youtube", "blog", "support"].map(
            (platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ),
          )}
        </select>
        <input
          className={inputClass}
          placeholder="handle"
          value={form.handle}
          onChange={(e) => setForm({ ...form, handle: e.target.value })}
          required
        />
        <input
          className={inputClass}
          placeholder="Display name"
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
        <input
          className={inputClass}
          placeholder="Profile URL (optional)"
          value={form.profileUrl}
          onChange={(e) => setForm({ ...form, profileUrl: e.target.value })}
        />
        <button className="rounded-md bg-primary text-primary-foreground">
          Add account
        </button>
      </form>
      <div className="grid gap-3">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="rounded-lg border border-border p-4 flex items-start justify-between gap-3"
          >
            <div>
              <div className="font-medium">
                @{account.handle}{" "}
                <span className="text-muted-foreground text-sm">
                  {account.platform}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                {account.displayName}
                {account.profileUrl ? (
                  <>
                    {" · "}
                    <a className="underline" href={account.profileUrl}>
                      {account.profileUrl}
                    </a>
                  </>
                ) : null}
              </div>
            </div>
            <button
              className="text-sm text-destructive"
              onClick={async () => {
                try {
                  await api(`/app/accounts/${account.id}`, {
                    method: "DELETE",
                  });
                  load();
                } catch (err) {
                  onError(err instanceof Error ? err.message : "Delete failed");
                }
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {accounts.length === 0 && (
          <p className="text-muted-foreground">
            Add at least one account per platform you want to run.
          </p>
        )}
      </div>
    </div>
  );
}

function Projects({ onError }: { onError: (msg: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const load = () =>
    api<{ projects: Project[] }>("/app/projects")
      .then((data) => setProjects(data.projects))
      .catch((err) => onError(err.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Projects</h1>
      <form
        className="rounded-lg border border-border p-4 mb-6 grid gap-3 md:grid-cols-3"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const data = await api<{ project: Project }>("/app/projects", {
              method: "POST",
              body: JSON.stringify({ name, brief }),
            });
            setName("");
            setBrief("");
            go(`/projects/${data.project.id}`);
          } catch (err) {
            onError(err instanceof Error ? err.message : "Create failed");
          }
        }}
      >
        <input
          className={inputClass}
          placeholder="New project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className={inputClass}
          placeholder="Optional brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
        <button className="rounded-md bg-primary text-primary-foreground">
          Create project
        </button>
      </form>
      <div className="grid gap-3">
        {projects.map((project) => (
          <button
            key={project.id}
            className="text-left rounded-lg border border-border p-4 hover:bg-accent"
            onClick={() => go(`/projects/${project.id}`)}
          >
            <div className="font-medium">{project.name}</div>
            <div className="text-sm text-muted-foreground">
              {project.status} · {project.id}
            </div>
          </button>
        ))}
        {projects.length === 0 && (
          <p className="text-muted-foreground">
            No projects yet. Create one — configuration is free.
          </p>
        )}
      </div>
    </div>
  );
}

function ProjectHome({
  projectId,
  balance,
  setBalance,
  onError,
}: {
  projectId: string;
  balance: number;
  setBalance: (n: number) => void;
  onError: (msg: string) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [brief, setBrief] = useState("");
  const [name, setName] = useState("");
  const [newRole, setNewRole] = useState({
    name: "",
    slug: "",
    platform: "twitter",
  });
  const load = () =>
    api<{
      project: Project;
      roles: Role[];
      accounts: SocialAccount[];
      jobs: Job[];
      balance: number;
    }>(`/app/projects/${projectId}`)
      .then((data) => {
        setProject(data.project);
        setRoles(data.roles);
        setAccounts(data.accounts || []);
        setJobs(data.jobs);
        setBrief(data.project.brief);
        setName(data.project.name);
        setBalance(data.balance);
      })
      .catch((err) => onError(err.message));
  useEffect(() => {
    load();
  }, [projectId]);
  if (!project) return <div>Loading project…</div>;
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            Status {project.status} · configuring is free · running spends
            tokens. Bind each role to one of your social accounts.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <button
            className="text-muted-foreground"
            onClick={() => go("/accounts")}
          >
            Accounts
          </button>
          <button
            className="text-muted-foreground"
            onClick={() => go(`/projects/${projectId}/activity`)}
          >
            Activity
          </button>
        </div>
      </div>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api(`/app/projects/${projectId}`, {
              method: "PUT",
              body: JSON.stringify({ name, brief }),
            });
            load();
          } catch (err) {
            onError(err instanceof Error ? err.message : "Save failed");
          }
        }}
      >
        <Field label="Project name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Default job brief">
          <input
            className={inputClass}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
        </Field>
        <button className="rounded-md border border-border px-3 py-2 w-fit">
          Save project
        </button>
      </form>
      <section>
        <h2 className="text-lg font-medium mb-3">Run a job</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Balance {balance} tokens. Each draft or video plan spends tokens from
          the global price table. The job stops if credits run out.
        </p>
        <button
          className="rounded-md bg-primary text-primary-foreground px-4 py-2"
          onClick={async () => {
            onError("");
            try {
              const data = await api<{ job: Job; balance: number }>(
                `/app/projects/${projectId}/jobs`,
                {
                  method: "POST",
                  body: JSON.stringify({ brief }),
                },
              );
              setBalance(data.balance);
              load();
              if (data.job.status === "stopped_no_credits") {
                onError(data.job.error || "Stopped: out of tokens");
              }
            } catch (err) {
              onError(err instanceof Error ? err.message : "Run failed");
            }
          }}
        >
          Run enabled roles
        </button>
        {jobs[0] && (
          <p className="text-sm mt-2">
            Last job {jobs[0].id}: {jobs[0].status}, spent {jobs[0].tokensSpent}
            , produced {jobs[0].produced.length}
          </p>
        )}
      </section>
      <section>
        <h2 className="text-lg font-medium mb-3">Roles</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {roles.map((role) => {
            const bound = accounts.find(
              (account) => account.id === role.accountId,
            );
            const matches = accounts.filter(
              (account) => account.platform === role.platform,
            );
            const inferred =
              !bound && matches.length === 1 ? matches[0] : undefined;
            const shown = bound || inferred;
            return (
              <div
                key={role.slug}
                className="rounded-lg border border-border p-4"
              >
                <button
                  className="text-left w-full hover:opacity-80"
                  onClick={() =>
                    go(`/projects/${projectId}/roles/${role.slug}`)
                  }
                >
                  <div className="font-medium">{role.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {role.platform} · cap {role.dailyDraftCap}/day ·{" "}
                    {role.enabled ? "enabled" : "disabled"}
                  </div>
                  <div className="text-sm mt-1">
                    {shown
                      ? `@${shown.handle}`
                      : "No account — add one or pick it on the role"}
                  </div>
                </button>
                {matches.length > 0 && (
                  <select
                    className={`${inputClass} mt-3`}
                    value={role.accountId || inferred?.id || ""}
                    onChange={async (event) => {
                      try {
                        await api(
                          `/app/projects/${projectId}/roles/${role.slug}`,
                          {
                            method: "PUT",
                            body: JSON.stringify({
                              accountId: event.target.value || "",
                            }),
                          },
                        );
                        load();
                      } catch (err) {
                        onError(
                          err instanceof Error ? err.message : "Bind failed",
                        );
                      }
                    }}
                  >
                    <option value="">Select account</option>
                    {matches.map((account) => (
                      <option key={account.id} value={account.id}>
                        @{account.handle}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
        <form
          className="mt-4 grid gap-3 md:grid-cols-4"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api(`/app/projects/${projectId}/roles`, {
                method: "POST",
                body: JSON.stringify(newRole),
              });
              setNewRole({ name: "", slug: "", platform: "twitter" });
              load();
            } catch (err) {
              onError(
                err instanceof Error ? err.message : "Create role failed",
              );
            }
          }}
        >
          <input
            className={inputClass}
            placeholder="Role name"
            value={newRole.name}
            onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
            required
          />
          <input
            className={inputClass}
            placeholder="slug"
            value={newRole.slug}
            onChange={(e) => setNewRole({ ...newRole, slug: e.target.value })}
            required
          />
          <select
            className={inputClass}
            value={newRole.platform}
            onChange={(e) =>
              setNewRole({ ...newRole, platform: e.target.value })
            }
          >
            {["twitter", "instagram", "youtube", "blog", "support"].map(
              (platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ),
            )}
          </select>
          <button className="rounded-md border border-border">Add role</button>
        </form>
      </section>
    </div>
  );
}

function RoleEditor({
  projectId,
  slug,
  onError,
}: {
  projectId: string;
  slug: string;
  onError: (msg: string) => void;
}) {
  const [role, setRole] = useState<Role | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  useEffect(() => {
    Promise.all([
      api<{ role: Role }>(`/app/projects/${projectId}/roles/${slug}`),
      api<{ accounts: SocialAccount[] }>("/app/accounts"),
    ])
      .then(([roleData, accountData]) => {
        setRole(roleData.role);
        setAccounts(accountData.accounts);
      })
      .catch((err) => onError(err.message));
  }, [projectId, slug]);
  if (!role) return <div>Loading role…</div>;
  const set = (patch: Partial<Role>) => setRole({ ...role, ...patch });
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const data = await api<{ role: Role }>(
            `/app/projects/${projectId}/roles/${slug}`,
            { method: "PUT", body: JSON.stringify(role) },
          );
          setRole(data.role);
        } catch (err) {
          onError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      <button
        type="button"
        className="text-sm text-muted-foreground"
        onClick={() => go(`/projects/${projectId}`)}
      >
        ← Project
      </button>
      <h1 className="text-2xl font-semibold">{role.name}</h1>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Name">
          <input
            className={inputClass}
            value={role.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label="Enabled">
          <input
            type="checkbox"
            checked={role.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
        </Field>
        <Field label="Social account">
          <select
            className={inputClass}
            value={role.accountId || ""}
            onChange={(e) => set({ accountId: e.target.value || undefined })}
          >
            <option value="">Select {role.platform} account</option>
            {accounts
              .filter((account) => account.platform === role.platform)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.handle} ({account.displayName})
                </option>
              ))}
          </select>
        </Field>
        <Field label="Daily draft cap">
          <input
            type="number"
            className={inputClass}
            value={role.dailyDraftCap}
            onChange={(e) => set({ dailyDraftCap: Number(e.target.value) })}
          />
        </Field>
        <Field label="Cooldown minutes">
          <input
            type="number"
            className={inputClass}
            value={role.cooldownMinutes}
            onChange={(e) => set({ cooldownMinutes: Number(e.target.value) })}
          />
        </Field>
        <Field label="Quiet hours">
          <input
            className={inputClass}
            value={role.quietHours}
            onChange={(e) => set({ quietHours: e.target.value })}
          />
        </Field>
        <Field label="Timezone">
          <input
            className={inputClass}
            value={role.restTz}
            onChange={(e) => set({ restTz: e.target.value })}
          />
        </Field>
      </div>
      <Field label="System / voice">
        <textarea
          className={`${inputClass} min-h-40`}
          value={role.system}
          onChange={(e) => set({ system: e.target.value })}
        />
      </Field>
      <Field label="Bio (one per line)">
        <textarea
          className={`${inputClass} min-h-24`}
          value={role.bio.join("\n")}
          onChange={(e) =>
            set({ bio: e.target.value.split("\n").filter(Boolean) })
          }
        />
      </Field>
      <Field label="Adjectives (comma separated)">
        <input
          className={inputClass}
          value={role.adjectives.join(", ")}
          onChange={(e) =>
            set({
              adjectives: e.target.value
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <div className="flex gap-3">
        <button className="rounded-md bg-primary text-primary-foreground px-4 py-2">
          Save role
        </button>
        {!role.builtin && (
          <button
            type="button"
            className="rounded-md border border-destructive px-4 py-2"
            onClick={async () => {
              try {
                await api(`/app/projects/${projectId}/roles/${slug}`, {
                  method: "DELETE",
                });
                go(`/projects/${projectId}`);
              } catch (err) {
                onError(err instanceof Error ? err.message : "Delete failed");
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

function Activity({
  projectId,
  onError,
}: {
  projectId: string;
  onError: (msg: string) => void;
}) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [spent, setSpent] = useState(0);
  const [balance, setBalance] = useState(0);
  const [urlById, setUrlById] = useState<Record<string, string>>({});
  useEffect(() => {
    api<{ items: ActivityItem[]; spent: number; balance: number }>(
      `/app/projects/${projectId}/activity`,
    )
      .then((data) => {
        setItems(data.items);
        setSpent(data.spent);
        setBalance(data.balance);
      })
      .catch((err) => onError(err.message));
  }, [projectId]);
  return (
    <div>
      <button
        className="text-sm text-muted-foreground mb-4"
        onClick={() => go(`/projects/${projectId}`)}
      >
        ← Project
      </button>
      <h1 className="text-2xl font-semibold mb-2">Activity</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Spent {spent} tokens on this project · wallet {balance}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2">Time</th>
              <th>Role</th>
              <th>Account</th>
              <th>Action</th>
              <th>Status</th>
              <th>Tokens</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={`${item.ts}-${idx}`} className="border-b border-border">
                <td className="py-2 whitespace-nowrap">
                  {item.ts.replace("T", " ").slice(0, 19)}
                </td>
                <td>{item.roleSlug}</td>
                <td>{item.accountHandle ? `@${item.accountHandle}` : "—"}</td>
                <td>
                  {item.action}
                  {item.queueItemId ? ` · ${item.queueItemId}` : ""}
                </td>
                <td>{item.status}</td>
                <td>{item.tokens}</td>
                <td>
                  {item.publicUrl ? (
                    <a className="underline" href={item.publicUrl}>
                      {item.publicUrl}
                    </a>
                  ) : item.queueItemId ? (
                    <form
                      className="flex gap-1"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const url = urlById[item.queueItemId!] || "";
                        if (!url) return;
                        await api(
                          `/app/projects/${projectId}/queue/${item.queueItemId}/published`,
                          {
                            method: "POST",
                            body: JSON.stringify({ url }),
                          },
                        );
                        const data = await api<{ items: ActivityItem[] }>(
                          `/app/projects/${projectId}/activity`,
                        );
                        setItems(data.items);
                      }}
                    >
                      <input
                        className="rounded border border-border bg-card px-2 py-1"
                        placeholder="https://…"
                        value={urlById[item.queueItemId] || ""}
                        onChange={(e) =>
                          setUrlById({
                            ...urlById,
                            [item.queueItemId!]: e.target.value,
                          })
                        }
                      />
                      <button className="text-xs">Save link</button>
                    </form>
                  ) : (
                    item.note || ""
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Credits({
  balance,
  setBalance,
  onError,
}: {
  balance: number;
  setBalance: (n: number) => void;
  onError: (msg: string) => void;
}) {
  const [packages, setPackages] = useState<
    { id: string; tokens: number; label: string }[]
  >([]);
  const [actions, setActions] = useState<Record<string, number>>({});
  const [ledger, setLedger] = useState<
    { ts: string; type: string; tokens: number; note?: string }[]
  >([]);
  const load = () =>
    api<{
      balance: number;
      packages: { id: string; tokens: number; label: string }[];
      actions: Record<string, number>;
      ledger: { ts: string; type: string; tokens: number; note?: string }[];
    }>("/app/billing")
      .then((data) => {
        setBalance(data.balance);
        setPackages(data.packages);
        setActions(data.actions);
        setLedger(data.ledger);
      })
      .catch((err) => onError(err.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Credits</h1>
        <p className="text-muted-foreground">
          {balance} tokens · in-app only, no real-money checkout
        </p>
      </div>
      <section>
        <h2 className="font-medium mb-3">Buy token packs</h2>
        <div className="grid md:grid-cols-3 gap-3">
          {packages.map((pkg) => (
            <button
              key={pkg.id}
              className="rounded-lg border border-border p-4 text-left hover:bg-accent"
              onClick={async () => {
                try {
                  const data = await api<{ balance: number }>(
                    "/app/billing/checkout",
                    {
                      method: "POST",
                      body: JSON.stringify({ packageId: pkg.id }),
                    },
                  );
                  setBalance(data.balance);
                  load();
                } catch (err) {
                  onError(err instanceof Error ? err.message : "Buy failed");
                }
              }}
            >
              <div className="font-medium">{pkg.label}</div>
              <div className="text-sm text-muted-foreground">
                {pkg.tokens} tokens
              </div>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2 className="font-medium mb-3">Action prices</h2>
        <ul className="text-sm grid md:grid-cols-2 gap-1">
          {Object.entries(actions).map(([key, value]) => (
            <li key={key}>
              {key}: {value} token{value === 1 ? "" : "s"}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium mb-3">Ledger</h2>
        <ul className="text-sm space-y-1">
          {ledger.map((row, idx) => (
            <li key={`${row.ts}-${idx}`}>
              {row.ts.slice(0, 19)} {row.type} {row.tokens} {row.note || ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Admin({
  setBalance,
  onError,
}: {
  setBalance: (n: number) => void;
  onError: (msg: string) => void;
}) {
  const [users, setUsers] = useState<
    { id: string; username: string; balance: number }[]
  >([]);
  const [amount, setAmount] = useState("100");
  const [actions, setActions] = useState<Record<string, number>>({});
  useEffect(() => {
    api<{ users: { id: string; username: string; balance: number }[] }>(
      "/app/admin/users",
    )
      .then((data) => setUsers(data.users))
      .catch((err) => onError(err.message));
    api<{ actions: Record<string, number> }>("/app/admin/billing")
      .then((data) => setActions(data.actions))
      .catch((err) => onError(err.message));
  }, []);
  const actionEntries = useMemo(() => Object.entries(actions), [actions]);
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <section>
        <h2 className="font-medium mb-3">Grant tokens</h2>
        {users.map((user) => (
          <form
            key={user.id}
            className="flex gap-3 items-end"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                const data = await api<{ balance: number }>(
                  `/app/admin/users/${user.id}/credits`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      tokens: Number(amount),
                      note: "admin grant",
                    }),
                  },
                );
                setBalance(data.balance);
                setUsers(
                  users.map((row) =>
                    row.id === user.id
                      ? { ...row, balance: data.balance }
                      : row,
                  ),
                );
              } catch (err) {
                onError(err instanceof Error ? err.message : "Grant failed");
              }
            }}
          >
            <div>
              {user.username} · {user.balance} tokens
            </div>
            <input
              className={inputClass + " w-32"}
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="rounded-md bg-primary text-primary-foreground px-3 py-2">
              Grant
            </button>
          </form>
        ))}
      </section>
      <section>
        <h2 className="font-medium mb-3">Action prices</h2>
        <form
          className="grid md:grid-cols-2 gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api("/app/admin/billing", {
                method: "PUT",
                body: JSON.stringify({ actions }),
              });
            } catch (err) {
              onError(err instanceof Error ? err.message : "Save failed");
            }
          }}
        >
          {actionEntries.map(([key, value]) => (
            <Field key={key} label={key}>
              <input
                type="number"
                className={inputClass}
                value={value}
                onChange={(e) =>
                  setActions({ ...actions, [key]: Number(e.target.value) })
                }
              />
            </Field>
          ))}
          <button className="rounded-md border border-border px-3 py-2 w-fit">
            Save prices
          </button>
        </form>
      </section>
    </div>
  );
}
