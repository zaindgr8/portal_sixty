import { Building2 } from 'lucide-react';
import { currentUser } from '@/lib/auth/current';
import { getWorkspace } from '@/lib/tenant/workspaces';
import { proptechOn } from '@/lib/proptech/access';

// PropTech pages are only for agencies with the "proptech_auto_listing" feature flag (Admin console → workspace → Features).
export default async function ProptechLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const ws = user ? await getWorkspace(user.workspace).catch(() => null) : null;
  if (!proptechOn(ws)) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-sm">
          <Building2 className="mx-auto mb-3 text-ink-3" size={32} />
          <h1 className="text-lg font-semibold">PropTech isn&apos;t switched on for {ws?.name ?? 'this workspace'}</h1>
          <p className="mt-1 text-sm text-ink-2">Auto Listing is part of Sixty for real-estate agencies. Ask the Sixty team to enable it for your agency.</p>
        </div>
      </div>
    );
  }
  return <div className="scroll-thin h-full overflow-y-auto">{children}</div>;
}
