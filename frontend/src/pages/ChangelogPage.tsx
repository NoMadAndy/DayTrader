/**
 * Changelog Page
 * 
 * Displays the application changelog.
 */

import { ChangelogPanel } from '../components/ChangelogPanel';

export function ChangelogPage() {
  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex-1">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="text-3xl">📝</span>
          Changelog
        </h1>
        <p className="text-gray-400 mt-2">
          Alle Änderungen und neue Features
        </p>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <ChangelogPanel />
      </div>
    </div>
  );
}
