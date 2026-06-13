import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { AccountActions } from "../account-actions";
import { UsersAdminSection } from "../users-admin";

export default async function AccountSettingsPage() {
  const session = await auth();
  const userId  = session!.user!.id!;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  const isAdmin = !!user?.isAdmin;

  return (
    <>
      {/* ── Users (admin only) ── */}
      {isAdmin && (
        <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
          <div>
            <h2 className="font-semibold text-primary">Users</h2>
            <p className="text-xs text-muted mt-0.5">Approve or reject access requests</p>
          </div>
          <UsersAdminSection />
        </section>
      )}

      {/* ── Account actions ── */}
      <section className="rounded-2xl bg-surface border border-border p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-primary">Account</h2>
          <p className="text-xs text-muted mt-0.5">Log out or permanently delete your account and all data</p>
        </div>
        <AccountActions />
      </section>
    </>
  );
}
