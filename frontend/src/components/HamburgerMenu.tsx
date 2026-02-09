/**
 * Hamburger Menu Component
 * 
 * Mobile navigation menu component.
 */

import { useState } from 'react';

interface HamburgerMenuProps {
  items?: { label: string; href: string; icon?: string }[];
}

export function HamburgerMenu({ items = [] }: HamburgerMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="relative sm:hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
        aria-label="Menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>
      
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50">
          {items.map((item, index) => (
            <a
              key={index}
              href={item.href}
              className="flex items-center gap-2 px-4 py-2 hover:bg-slate-700/50 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              {item.icon && <span>{item.icon}</span>}
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default HamburgerMenu;
