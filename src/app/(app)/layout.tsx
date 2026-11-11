import { redirect } from 'next/navigation';
import AppShell from '@/components/shell/AppShell';
import { currentUser } from '@/lib/auth/current';
import { getWorkspace } from '@/lib/tenant/workspaces';
import WorkspaceBlocked from '@/components/shell/WorkspaceBlocked';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await currentUser();
  if (!user) redirect('/login');
  // Sessions last a week, so check the workspace is still live on every page load.
  const ws = await getWorkspace(user.workspace).catch(() => null);
  if (!user.platformAdmin && (!ws || ws.status !== 'active')) {
    return <WorkspaceBlocked name={ws?.name ?? user.workspaceName} status={ws?.status ?? 'missing'} />;
  }
  return <AppShell user={user} features={ws?.features ?? []}>{children}</AppShell>;
}
