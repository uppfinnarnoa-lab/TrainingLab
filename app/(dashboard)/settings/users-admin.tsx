"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Check, X, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  status: "pending" | "active" | "rejected";
  isAdmin: boolean;
  createdAt: string;
}

const STATUS_BADGE: Record<UserRow["status"], string> = {
  pending:  "bg-warning/10 text-warning border-warning/20",
  active:   "bg-accent/10 text-accent border-accent/20",
  rejected: "bg-error/10 text-error border-error/20",
};

export function UsersAdminSection() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(userId: string, action: "approve" | "reject" | "revoke") {
    setActing(userId + action);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) await load();
    setActing(null);
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" />Loading users…</div>;

  const pending  = users.filter(u => u.status === "pending");
  const active   = users.filter(u => u.status === "active");
  const rejected = users.filter(u => u.status === "rejected");

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-1 overflow-hidden">
          <p className="text-xs font-semibold text-warning px-3 py-2">
            {pending.length} pending {pending.length === 1 ? "request" : "requests"}
          </p>
          <div className="divide-y divide-border">
            {pending.map(u => (
              <UserRow key={u.id} u={u} acting={acting} onAct={act} />
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <p className="text-xs font-semibold text-muted px-3 py-2 border-b border-border bg-surface-2">Active users</p>
          <div className="divide-y divide-border">
            {active.map(u => (
              <UserRow key={u.id} u={u} acting={acting} onAct={act} />
            ))}
          </div>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <p className="text-xs font-semibold text-muted px-3 py-2 border-b border-border bg-surface-2">Rejected</p>
          <div className="divide-y divide-border">
            {rejected.map(u => (
              <UserRow key={u.id} u={u} acting={acting} onAct={act} />
            ))}
          </div>
        </div>
      )}

      {users.length === 0 && (
        <p className="text-sm text-muted text-center py-4">No users yet.</p>
      )}
    </div>
  );
}

function UserRow({ u, acting, onAct }: {
  u: UserRow;
  acting: string | null;
  onAct: (id: string, action: "approve" | "reject" | "revoke") => void;
}) {
  const isActing = (a: string) => acting === u.id + a;

  return (
    <div className="px-3 py-3 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-primary truncate">{u.name ?? u.email}</p>
        {u.name && <p className="text-xs text-muted truncate">{u.email}</p>}
        <p className="text-[10px] text-muted">{new Date(u.createdAt).toLocaleDateString("en-SE")}</p>
      </div>
      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", STATUS_BADGE[u.status])}>
        {u.isAdmin ? "admin" : u.status}
      </span>
      {!u.isAdmin && (
        <div className="flex gap-1">
          {u.status === "pending" && (
            <>
              <ActionBtn label="Approve" icon={<Check size={13} />} color="accent" loading={isActing("approve")} onClick={() => onAct(u.id, "approve")} />
              <ActionBtn label="Reject"  icon={<X size={13} />}     color="error"  loading={isActing("reject")}  onClick={() => onAct(u.id, "reject")} />
            </>
          )}
          {u.status === "active" && (
            <ActionBtn label="Revoke" icon={<ShieldOff size={13} />} color="error" loading={isActing("revoke")} onClick={() => onAct(u.id, "revoke")} />
          )}
          {u.status === "rejected" && (
            <ActionBtn label="Approve" icon={<Check size={13} />} color="accent" loading={isActing("approve")} onClick={() => onAct(u.id, "approve")} />
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, icon, color, loading, onClick }: {
  label: string; icon: React.ReactNode;
  color: "accent" | "error"; loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick} disabled={loading} title={label}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50",
        color === "accent"
          ? "border-accent/30 text-accent hover:bg-accent/10"
          : "border-error/30 text-error hover:bg-error/10"
      )}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}
