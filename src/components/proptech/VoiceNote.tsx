'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, Upload } from 'lucide-react';
import { MAX_AUDIO_SECONDS } from '@/lib/proptech/files';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

/** Record a voice note in the browser (max 3 minutes) or pick an audio file. */
export function VoiceNote({ value, onChange, onError }: {
  value: { blob: Blob; name: string; url: string; seconds: number } | null;
  onChange: (v: { blob: Blob; name: string; url: string; seconds: number } | null) => void;
  onError: (m: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => () => { clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const start = async () => {
    const mime = pickMime();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return onError('This browser can\'t record audio. Upload a voice memo instead.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      const t0 = Date.now();
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
        setRecording(false);
        const type = (r.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        onChange({ blob, name: `voice-note.${ext}`, url: URL.createObjectURL(blob), seconds: Math.round((Date.now() - t0) / 1000) });
      };
      rec.current = r;
      r.start(1000);
      setSecs(0);
      setRecording(true);
      timer.current = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        setSecs(s);
        if (s >= MAX_AUDIO_SECONDS && r.state === 'recording') r.stop();
      }, 250);
    } catch {
      onError('Microphone access was blocked. Allow it in your browser settings, or upload a voice memo.');
    }
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('audio/') && !/\.(m4a|mp3|webm|ogg|wav|aac)$/i.test(f.name)) return onError('Choose an audio file (m4a, mp3, webm, ogg or wav).');
    if (f.size > 20 * 1024 * 1024) return onError('Voice notes up to 20 MB, please.');
    const url = URL.createObjectURL(f);
    const a = new Audio(url);
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > MAX_AUDIO_SECONDS + 2) { URL.revokeObjectURL(url); return onError('Voice notes can be up to 3 minutes.'); }
      onChange({ blob: f, name: f.name, url, seconds: Math.round(a.duration || 0) });
    };
    a.onerror = () => onChange({ blob: f, name: f.name, url, seconds: 0 });
  };

  if (value && !recording) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-panel p-2">
        <audio src={value.url} controls className="h-10 min-w-0 flex-1" />
        <button className="btn btn-ghost px-2" aria-label="Remove voice note" onClick={() => { URL.revokeObjectURL(value.url); onChange(null); }}><Trash2 size={16} /></button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {recording ? (
        <button className="btn border-bad text-bad" onClick={() => rec.current?.stop()}>
          <Square size={14} fill="currentColor" />Stop · <span className="tabular-nums">{fmt(secs)}</span> / {fmt(MAX_AUDIO_SECONDS)}
        </button>
      ) : (
        <button className="btn" onClick={start}><Mic size={16} />Record voice note</button>
      )}
      {!recording && <button className="btn btn-ghost" onClick={() => file.current?.click()}><Upload size={16} />Upload audio</button>}
      <input ref={file} type="file" accept="audio/*,.m4a,.mp3,.webm,.ogg,.wav" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {recording && <span className="flex items-center gap-1.5 text-xs text-bad"><span className="h-2 w-2 animate-pulse rounded-full bg-bad" />Recording</span>}
    </div>
  );
}
