import React from 'react';

interface Action {
  label: string;
  onClick: () => void;
}

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: Action;
}

export default function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="text-center py-10">
      {icon && <div className="text-3xl mb-2">{icon}</div>}
      <p className="text-sm text-gray-300 font-semibold">{title}</p>
      {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-2 rounded"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
