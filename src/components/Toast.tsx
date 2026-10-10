'use client';

import { useEffect, useState } from 'react';

const EVENT = 'app-toast';

export function showToast(message: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

export default function Toast() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onToast = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail ?? '');
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(''), 2400);
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      clearTimeout(timer);
    };
  }, []);
  if (!msg) return null;
  return (
    <div
      role="status"
      className="fade-in pointer-events-none fixed left-1/2 top-5 z-[2000] -translate-x-1/2 rounded-full bg-[#1d1d1f] px-5 py-2.5 text-[13px] font-medium text-white shadow-[0_8px_28px_rgba(0,0,0,0.22)]"
    >
      {msg}
    </div>
  );
}
