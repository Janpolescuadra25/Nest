import React from 'react';

interface Props {
  jwt: string;
}

export default function LocationsTab({ jwt: _jwt }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
      <div className="text-4xl mb-3">📍</div>
      <h2 className="text-sm font-semibold text-white mb-1">Locations</h2>
      <p className="text-xs text-gray-400">Location management coming soon.</p>
    </div>
  );
}
