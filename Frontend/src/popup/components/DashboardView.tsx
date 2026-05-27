import React from 'react';
// TODO: Implement full dashboard UI and data fetching
export default function DashboardView({ jwt }: { jwt: string }) {
  return (
    <div className="p-6 text-white">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">🏠 Dashboard <span className="text-xs font-normal text-gray-400">(stub)</span></h2>
      <div className="text-gray-400">Dashboard content will appear here.</div>
    </div>
  );
}