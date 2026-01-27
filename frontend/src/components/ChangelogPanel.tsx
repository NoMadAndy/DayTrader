/**
 * Changelog Panel Component
 * 
 * Displays the application changelog in a formatted view.
 * Fetches changelog dynamically from the backend API.
 */

import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

interface ChangelogEntry {
  version: string;
  date?: string | null;
  sections: {
    title: string;
    items: string[];
  }[];
}

interface ChangelogData {
  version: string;
  commit: string;
  buildTime: string;
  entries: ChangelogEntry[];
}

export function ChangelogPanel() {
  const [changelogData, setChangelogData] = useState<ChangelogData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Fetch changelog from backend
  useEffect(() => {
    const fetchChangelog = async () => {
      try {
        const response = await fetch(`${API_BASE}/changelog`);
        if (!response.ok) {
          throw new Error('Failed to fetch changelog');
        }
        const data = await response.json();
        setChangelogData(data);
        
        // Expand first version's first section by default
        if (data.entries.length > 0 && data.entries[0].sections.length > 0) {
          setExpandedSections(new Set([`${data.entries[0].version}-${data.entries[0].sections[0].title}`]));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchChangelog();
  }, []);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getSectionIcon = (title: string) => {
    switch (title.toLowerCase()) {
      case 'added':
        return <span className="text-green-400">✨</span>;
      case 'changed':
        return <span className="text-blue-400">🔄</span>;
      case 'fixed':
        return <span className="text-yellow-400">🐛</span>;
      case 'removed':
        return <span className="text-red-400">🗑️</span>;
      case 'deprecated':
        return <span className="text-orange-400">⚠️</span>;
      case 'security':
        return <span className="text-purple-400">🔒</span>;
      default:
        return <span className="text-gray-400">📝</span>;
    }
  };

  const getSectionColor = (title: string) => {
    switch (title.toLowerCase()) {
      case 'added':
        return 'border-green-500/30 bg-green-500/5';
      case 'changed':
        return 'border-blue-500/30 bg-blue-500/5';
      case 'fixed':
        return 'border-yellow-500/30 bg-yellow-500/5';
      case 'removed':
        return 'border-red-500/30 bg-red-500/5';
      case 'deprecated':
        return 'border-orange-500/30 bg-orange-500/5';
      case 'security':
        return 'border-purple-500/30 bg-purple-500/5';
      default:
        return 'border-slate-500/30 bg-slate-500/5';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/30 text-red-400 text-sm">
        Changelog konnte nicht geladen werden: {error}
      </div>
    );
  }

  if (!changelogData) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Build Info */}
      <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
        <div className="text-xs text-gray-400 space-y-1">
          <div className="flex justify-between">
            <span>Version:</span>
            <span className="text-white font-mono">{changelogData.version}</span>
          </div>
          <div className="flex justify-between">
            <span>Commit:</span>
            <span className="text-white font-mono">{changelogData.commit?.substring(0, 7) || 'dev'}</span>
          </div>
          <div className="flex justify-between">
            <span>Build:</span>
            <span className="text-white font-mono">
              {changelogData.buildTime ? new Date(changelogData.buildTime).toLocaleDateString('de-DE') : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Changelog Entries */}
      {changelogData.entries.map((entry) => (
        <div key={entry.version} className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-white font-semibold">
              {entry.version === 'Unreleased' ? '🚀 Unreleased' : `v${entry.version}`}
            </h3>
            {entry.date && (
              <span className="text-gray-500 text-sm">({entry.date})</span>
            )}
          </div>

          {entry.sections.map((section) => {
            const sectionKey = `${entry.version}-${section.title}`;
            const isExpanded = expandedSections.has(sectionKey);

            return (
              <div
                key={sectionKey}
                className={`rounded-lg border ${getSectionColor(section.title)} overflow-hidden`}
              >
                <button
                  onClick={() => toggleSection(sectionKey)}
                  className="w-full flex items-center justify-between p-2 hover:bg-slate-700/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {getSectionIcon(section.title)}
                    <span className="text-sm font-medium text-white">{section.title}</span>
                    <span className="text-xs text-gray-500">({section.items.length})</span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 space-y-1">
                    {section.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="text-sm text-gray-300 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-gray-500"
                        dangerouslySetInnerHTML={{
                          __html: item
                            .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
                            .replace(/`(.*?)`/g, '<code class="bg-slate-700 px-1 rounded text-xs">$1</code>'),
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <p className="text-xs text-gray-500 text-center pt-2">
        Vollständiges Changelog auf{' '}
        <a
          href="https://github.com/NoMadAndy/DayTrader/blob/main/CHANGELOG.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300"
        >
          GitHub
        </a>
      </p>
    </div>
  );
}
