"use client";

import { useId, useState, type ReactNode } from "react";

type Tab = { id: string; label: string; content: ReactNode };

export function SettingsTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const baseId = useId();

  if (tabs.length === 0) return null;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Secciones de configuración"
        className="mb-6 flex flex-wrap gap-2"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={`rounded-full border-2 px-4 py-2 font-display text-sm font-bold transition-colors ${
                selected
                  ? "border-pink bg-rose text-plum shadow-sm"
                  : "border-rose/60 bg-white text-muted hover:border-lavender hover:text-plum"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <div
            key={tab.id}
            id={`${baseId}-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            hidden={!selected}
            className={selected ? "space-y-6" : undefined}
          >
            {selected ? tab.content : null}
          </div>
        );
      })}
    </div>
  );
}
