// Workspace shapes shared by the server and the browser (no secrets in here).
import type { ModuleKey, Role } from "../auth/modules";

export type WorkspaceStatus = "pending" | "active" | "suspended";
export const PLANS = ["starter", "growth", "scale"] as const;

/** Non-secret connection settings. */
export interface WorkspaceConfig {
  twilioAccountSid?: string;
  twilioFrom?: string;
  twilioMessagingServiceSid?: string;
  retellAgentIds?: string[];
  /** The Instagram professional account connected with "Connect Instagram". */
  instagram?: InstagramAccount;
  /** WhatsApp connected through Meta's Embedded Signup (WhatsApp Cloud API). */
  whatsappCloud?: WhatsAppCloudAccount;
}

export interface WhatsAppCloudAccount {
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  verifiedName: string;
  connectedAt: string;
  connectedBy?: string;
}

export interface InstagramAccount {
  /** Instagram professional account id (the id Meta's webhooks use). */
  userId: string;
  username: string;
  name?: string;
  picture?: string;
  connectedAt: string;
  connectedBy?: string;
  tokenExpiresAt?: string;
}

/** What a client tells us about their business while onboarding (used to build their agent). */
export interface BusinessInfo {
  website?: string;
  about?: string;
  offer?: string;
  prices?: string;
  customers?: string;
  faqs?: string;
  goal?: string;
  bookingLink?: string;
  tone?: string;
  languages?: string;
  agentName?: string;
}

export interface OnboardingDoc { id: string; name: string; chars: number; addedAt: string; text: string }

export interface Onboarding {
  business?: BusinessInfo;
  docs?: OnboardingDoc[];
  /** When the client finished the business step. */
  submittedAt?: string;
  /** Set by a platform admin when the agent is built and switched on. */
  agentLiveAt?: string;
  agentLiveBy?: string;
}

export type SetupStepKey = "account" | "whatsapp" | "instagram" | "business" | "team" | "agent";
export interface SetupStep { key: SetupStepKey; done: boolean; optional?: boolean }

/** Stored encrypted. */
export interface WorkspaceSecrets {
  twilioAuthToken?: string;
  retellApiKey?: string;
  instagramToken?: string;
  whatsappCloudToken?: string;
  whatsappCloudPin?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  status: WorkspaceStatus;
  plan: string;
  modules: ModuleKey[];
  /** Feature flags, e.g. "proptech_auto_listing". */
  features: string[];
  isPrimary: boolean;
  contactName: string;
  contactEmail: string;
  config: WorkspaceConfig;
  /** Which secrets are saved, without their values. */
  secretsSet: Record<keyof WorkspaceSecrets, boolean>;
  notes: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

/** A row in the admin console. */
export interface WorkspaceSummary extends WorkspaceInfo {
  setup: SetupStep[];
  users: number;
  conversations: number;
  lastActivityAt?: string;
  connected: { whatsapp: boolean; calls: boolean };
}

export interface Invite {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  role: Role;
  modules: ModuleKey[];
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}
