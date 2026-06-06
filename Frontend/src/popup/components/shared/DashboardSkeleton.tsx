import React from 'react';

interface Props {
  rows?: number;
  type?: 'list' | 'cards' | 'table';
}

export default function DashboardSkeleton({ rows = 4, type = 'list' }: Props) {
  if (type === 'cards') {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="animate-pulse bg-slate-800 border border-slate-700 rounded-lg h-20" />
        ))}
      </div>
    );
  }

  if (type === 'table') {
    return (
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="animate-pulse bg-slate-800 border border-slate-700 rounded-lg h-10" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="animate-pulse bg-slate-800 border border-slate-700 rounded-lg h-16" />
      ))}
    </div>
  );
}
