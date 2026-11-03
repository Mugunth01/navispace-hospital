import React from 'react';
import { Map, Search, Stethoscope } from 'lucide-react';

const TABS = [['map', 'Map', Map], ['search', 'Search', Search], ['doctors', 'Doctors', Stethoscope]];

export default function MobileTabs({ tab, setTab, badge = {} }) {
  return (
    <nav className="mTabs" aria-label="Sections">
      {TABS.map(([id, label, Icon]) => (
        <button key={id} type="button" className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
          <Icon size={20} aria-hidden="true" /><span>{label}</span>{badge[id] ? <i className="mTabDot" aria-label={`${badge[id]}`} /> : null}
        </button>
      ))}
    </nav>
  );
}
