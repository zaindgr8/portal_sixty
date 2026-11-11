'use client';
import { useState } from 'react';
import { CheckCircle2, ClipboardCopy, Download, Loader2, Puzzle, Unplug } from 'lucide-react';
import { api } from './ui';

/** Install and pair the Sixty Chrome extension (each agent pairs their own Chrome). */
export function ExtensionCard({ onError }: { onError: (m: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [disconnected, setDisconnected] = useState(false);

  const pair = async () => {
    setBusy(true);
    try {
      const r = await api<{ token: string; portalUrl: string }>('/api/proptech/extension', { method: 'POST' });
      // One string to paste: the portal's address and the token.
      setCode(btoa(JSON.stringify({ u: r.portalUrl, t: r.token })));
      setDisconnected(false);
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not make a code'); }
    finally { setBusy(false); }
  };
  const copy = () => navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  const disconnect = async () => {
    if (!confirm('Disconnect every Sixty extension you paired? You can pair again any time.')) return;
    await api('/api/proptech/extension', { method: 'DELETE' }).then(() => { setCode(''); setDisconnected(true); }).catch((e: Error) => onError(e.message));
  };

  return (
    <section className="card mb-4 p-4 md:p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><Puzzle size={16} className="text-brand" />Chrome extension</h2>
      <p className="mb-3 text-sm text-ink-2">
        Posts listings to Property Finder and Bayut from your own Chrome while the portal APIs aren&apos;t connected: it fills the portal&apos;s form and photos, you check and press Submit, and Sixty records it.
      </p>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
        <li><a className="font-medium text-brand hover:underline" href="/api/proptech/extension/download">Download the extension</a> and unzip it.</li>
        <li>In Chrome open <code className="rounded bg-panel-2 px-1">chrome://extensions</code>, switch on <b>Developer mode</b>, press <b>Load unpacked</b> and pick the <b>sixty-extension</b> folder.</li>
        <li>Press <b>Get pairing code</b> below and paste it into the extension.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <a className="btn" href="/api/proptech/extension/download"><Download size={15} />Download</a>
        <button className="btn btn-primary" onClick={pair} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Puzzle size={15} />}Get pairing code</button>
        <button className="btn btn-ghost" onClick={disconnect}><Unplug size={15} />Disconnect</button>
      </div>
      {code && (
        <div className="mt-3">
          <div className="flex items-start gap-2 rounded-xl border border-line bg-panel-2 p-2">
            <code className="min-w-0 flex-1 break-all text-[11px] leading-snug">{code}</code>
            <button className="btn shrink-0 px-2.5 py-1 text-xs" onClick={copy}>{copied ? <CheckCircle2 size={13} className="text-ok" /> : <ClipboardCopy size={13} />}{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p className="mt-1 text-xs text-ink-3">Works for 90 days, for you only. Treat it like a password: anyone with it can post your listings.</p>
        </div>
      )}
      {disconnected && <p className="mt-2 flex items-center gap-1.5 text-sm text-ok"><CheckCircle2 size={15} />Disconnected. Old codes no longer work.</p>}
    </section>
  );
}
