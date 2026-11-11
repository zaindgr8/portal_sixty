import {
  BarChart3, Bot, Building2, FilePlus2, History, Home as HomeIcon, PlugZap, Puzzle, Kanban, LayoutDashboard, LayoutGrid, ListChecks, Megaphone, MessageCircle, PhoneCall,
  PhoneOutgoing, Rocket, Settings2, ShieldCheck, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import type { ModuleKey, SessionUser } from '@/lib/auth/modules';

export interface NavItem { href: string; label: string; icon: LucideIcon; hint?: string }
export interface NavSection { module?: ModuleKey; title?: string; icon?: LucideIcon; items: NavItem[]; /** Shown as a dropdown that opens and closes. */ collapsible?: boolean }

export const NAV: NavSection[] = [
  { items: [{ href: '/', label: 'Home', icon: LayoutDashboard, hint: 'Both channels at a glance' }] },
  {
    module: 'whatsapp', title: 'WhatsApp', icon: MessageCircle,
    items: [
      { href: '/whatsapp', label: 'Inbox', icon: MessageCircle, hint: 'Live WhatsApp chats' },
      { href: '/whatsapp/leads', label: 'Leads', icon: Users, hint: 'Lead profiles from your WhatsApp agent' },
      { href: '/whatsapp/pipeline', label: 'Pipeline', icon: Kanban, hint: 'Drag chats between stages' },
      { href: '/whatsapp/history', label: 'History', icon: History, hint: 'Search every message' },
      { href: '/whatsapp/team', label: 'Team', icon: UserCog, hint: 'Teammates, assignment and AI scoring' },
      { href: '/whatsapp/agent', label: 'AI agent', icon: Bot, hint: 'Who replies, persona and handoff' },
      { href: '/whatsapp/analytics', label: 'Analytics', icon: BarChart3, hint: 'Funnel and response times' },
    ],
  },
  {
    module: 'calls', title: 'Voice calls', icon: PhoneCall,
    items: [
      { href: '/calls', label: 'Overview', icon: LayoutGrid, hint: 'How your voice agents are performing' },
      { href: '/calls/leads', label: 'Leads', icon: Users, hint: 'Who to call and what to do next' },
      { href: '/calls/new', label: 'New call', icon: PhoneOutgoing, hint: 'An AI agent calls one person now' },
      { href: '/calls/bulk', label: 'Bulk campaign', icon: Megaphone, hint: 'Upload a list and call everyone' },
      { href: '/calls/campaigns', label: 'Campaigns', icon: ListChecks, hint: 'Progress of bulk campaigns' },
      { href: '/calls/history', label: 'Call history', icon: History, hint: 'Recordings, transcripts and outcomes' },
    ],
  },
];

const ROOTS = new Set(['/', '/whatsapp', '/calls', '/proptech']);
export const isActive = (href: string, path: string) => {
  // Listing Detail pages belong to "Auto Listing".
  if (href === '/proptech') return path === '/proptech' || path.startsWith('/proptech/listings/');
  return ROOTS.has(href) ? path === href : path === href || path.startsWith(`${href}/`);
};

/** PropTech (Dubai real estate): shown only to agencies with the proptech_auto_listing feature flag. */
export function proptechSection(user: SessionUser): NavSection {
  const items: NavItem[] = [
    { href: '/proptech', label: 'Auto Listing', icon: HomeIcon, hint: 'Every listing, its status and portals' },
    { href: '/proptech/new', label: 'New Listing', icon: FilePlus2, hint: 'Upload Form A and photos, the AI does the rest' },
  ];
  items.push({ href: '/proptech/extension', label: 'Chrome extension', icon: Puzzle, hint: 'Post to portals from your own Chrome' });
  if (user.role === 'owner' || user.role === 'admin' || user.platformAdmin) items.push({ href: '/proptech/settings', label: 'Portal Settings', icon: PlugZap, hint: 'Property Finder, Bayut and agent numbers' });
  return { title: 'PropTech', icon: Building2, items, collapsible: true };
}

/** The nav sections this user can see: their modules, plus workspace settings and the admin console when they may use them. */
export function navFor(user: SessionUser, features: string[] = []): NavSection[] {
  const sections = NAV.filter((s) => !s.module || user.modules.includes(s.module));
  if (features.includes('proptech_auto_listing')) sections.push(proptechSection(user));
  const manage: NavItem[] = [];
  if (user.role === 'owner' || user.role === 'admin' || user.platformAdmin) {
    manage.push({ href: '/setup', label: 'Get started', icon: Rocket, hint: 'Connect your channels and set up your AI agent' });
    manage.push({ href: '/settings', label: 'Workspace settings', icon: Settings2, hint: 'Connections, people and invites' });
  }
  if (user.platformAdmin) manage.push({ href: '/admin', label: 'Admin console', icon: ShieldCheck, hint: 'All client workspaces' });
  return manage.length ? [...sections, { title: 'Workspace', icon: Settings2, items: manage }] : sections;
}
