// The supplied dark bento component, adapted to JamPulse session content.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

export type JamBentoItem = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  date: string;
  location: string;
  host: string;
  instruments: string[];
  saved: boolean;
  attending: boolean;
};

type GridProps = {
  items: JamBentoItem[];
  selectedId?: string;
  reduceMotion?: boolean;
  onSelect: (id: string) => void;
  onContact: (id: string) => void;
  onSave: (id: string) => void;
  onJoin: (id: string) => Promise<void>;
};

export default function FUIBentoGridDark({items, selectedId, reduceMotion, onSelect, onContact, onSave, onJoin}: GridProps) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <div className="jam-bento-grid grid grid-cols-1 gap-4 lg:grid-cols-6" aria-label="Jam session bento grid">
      {items.map((item, index) => {
        const position = index % 5;
        const remaining = items.length - (index - position);
        const span = remaining === 1 ? 6 : position < 2 ? 3 : remaining === 4 && position === 3 ? 4 : 2;
        return <BentoCard
          key={item.id}
          reduceMotion={reduceMotion}
          className={clsx('jam-bento-tile', `bento-span-${span}`, selectedId === item.id && 'is-selected')}
          eyebrow={item.eyebrow}
          title={item.title}
          description={item.description}
          graphic={<button type="button" className="bento-art-button" onClick={() => onSelect(item.id)} aria-label={`Show ${item.title} on map`}><img src={item.image} alt="" draggable={false}/><span className="bento-map-link">Find this circle <span aria-hidden="true">↗</span></span></button>}
          fade={['bottom']}
          save={<button type="button" className="bento-save" aria-label={item.saved ? `Unsave ${item.title}` : `Save ${item.title}`} aria-pressed={item.saved} onClick={() => onSave(item.id)}>{item.saved ? '♥' : '♡'}</button>}
          metadata={<><span>{item.date}</span><span>{item.location}</span></>}
          actions={<>
            <div className="bento-host"><span className="bento-host-initial" aria-hidden="true">{item.host.slice(0,1)}</span><span>Hosted by <strong>{item.host}</strong></span></div>
            <div className="bento-actions"><button type="button" className="bento-contact" onClick={() => onContact(item.id)}>Contact</button><button type="button" className="bento-join" disabled={pending !== null} onClick={async () => {setPending(item.id);try {await onJoin(item.id);} finally {setPending(null);}}}>{pending === item.id ? 'Joining…' : item.attending ? '✓ In circle' : 'Ask to join ↗'}</button></div>
          </>}
          instruments={item.instruments}
          sessionId={item.id}
        />;
      })}
    </div>
  );
}

export function BentoCard({dark = false, className = '', eyebrow, title, description, graphic, fade = [], metadata, actions, save, instruments = [], sessionId, reduceMotion}: {
  dark?: boolean;
  className?: string;
  eyebrow: ReactNode;
  title: ReactNode;
  description: ReactNode;
  graphic?: ReactNode;
  fade?: ('top' | 'bottom')[];
  metadata?: ReactNode;
  actions?: ReactNode;
  save?: ReactNode;
  instruments?: string[];
  sessionId?: string;
  reduceMotion?: boolean;
}) {
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = reduceMotion ?? systemReducedMotion;
  return <motion.article
    initial="idle"
    whileHover="active"
    variants={{idle:{y:0}, active:{y:reducedMotion ? 0 : -3}}}
    transition={{duration:.18}}
    data-dark={dark ? 'true' : undefined}
    data-jam-id={sessionId}
    className={clsx(className, 'group relative flex flex-col overflow-hidden rounded-lg bg-black shadow-sm ring-1 ring-white/10')}
  >
    <div className="bento-graphic relative shrink-0">
      {graphic}
      {fade.includes('top') && <div className="bento-fade-top"/>}
      {fade.includes('bottom') && <div className="bento-fade-bottom"/>}
    </div>
    <div className="bento-card-content relative z-20 isolate text-white">
      <div className="bento-eyebrow-row"><p>{eyebrow}</p>{save}</div>
      <h3>{title}</h3>
      <div className="bento-metadata">{metadata}</div>
      <p className="bento-description">{description}</p>
      {!!instruments.length && <div className="bento-instruments">{instruments.map(instrument=><span key={instrument}>{instrument}</span>)}</div>}
      <div className="bento-card-footer">{actions}</div>
    </div>
  </motion.article>;
}
