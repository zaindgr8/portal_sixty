'use client';
import { useState } from 'react';
import { ExtensionCard } from '@/components/proptech/ExtensionCard';
import { ErrorBar } from '@/components/proptech/ui';

export default function ExtensionPage() {
  const [error, setError] = useState('');
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Chrome extension</h1>
      <p className="mb-5 text-sm text-ink-2">Post approved listings to Property Finder and Bayut from your own Chrome, signed in with your own portal account.</p>
      <ErrorBar error={error} onClose={() => setError('')} />
      <ExtensionCard onError={setError} />
      <section className="card p-4 text-sm text-ink-2 md:p-5">
        <h2 className="mb-2 font-semibold text-ink">How posting works</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Portal API connected</b> (Property Finder keys, Bayut feed): Sixty posts directly when you approve.</li>
          <li><b>Not connected yet:</b> the listing waits in the extension. Open it, press <b>Post</b>, sign in (PF Expert or Bayut Profolio), open the Add listing form and press <b>Fill everything</b>: Sixty fills every step, adds the photos and presses Next until only Submit is left. Check, press the portal&apos;s Submit, then <b>I&apos;ve submitted it</b>.</li>
          <li>Every step shows on the listing in Sixty (Portal event log), so the office sees what was posted where.</li>
          <li><b>Next:</b> a Sixty browser that does the posting for you.</li>
        </ul>
      </section>
    </div>
  );
}
