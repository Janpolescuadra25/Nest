import React, { useEffect } from 'react';

interface LogoSplashProps {
  onComplete: () => void;
}

export function LogoSplash({ onComplete }: LogoSplashProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      chrome.storage.local.set({ hasSeenLogoAnimation: true }, () => {
        onComplete();
      });
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[100] bg-white flex items-center justify-center">
      <img
        src="/public/icons/qyra-logo.png"
        alt="Qyra"
        className="w-30 h-30 animate-logo-splash"
        style={{ width: '120px', height: '120px' }}
      />
    </div>
  );
}
