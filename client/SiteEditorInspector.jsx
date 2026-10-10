import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';

function lockCopy(lock) {
  if (lock?.reason === 'menu-unbound') return 'Denne prisen hentes fra produkter. Koble feltet på nytt ved neste publisering fra Website Creator.';
  if (lock?.reason === 'cms-slot' || lock?.reason === 'template') {
    return lock.tab === 'blog'
      ? 'Dette feltet styres av bloggen, ikke av sideinnholdet.'
      : 'Dette feltet styres av produkter, ikke av sideinnholdet.';
  }
  return 'Dette feltet kan ikke redigeres her.';
}

function Field({ id, label, children }) {
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-medium text-neutral-600 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#FF5B00]/30 focus:border-[#FF5B00]';

export function SiteEditorInspector({
  selected,
  onClose,
  onTextChange,
  onHrefChange,
  onPickMedia,
  onSectionAction,
  onOpenTab,
  onProductPriceSave,
}) {
  const [text, setText] = useState('');
  const [href, setHref] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => {
    setText(selected?.value || '');
    setHref(selected?.href || '');
    setPrice(String(selected?.value || '').replace(/[^0-9.,-]/g, ''));
  }, [selected?.key, selected?.route, selected?.kind, selected?.value, selected?.href]);

  if (!selected) {
    return (
      <aside className="w-80 shrink-0 border-l border-neutral-200 bg-white flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-neutral-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Redigering</p>
        </div>
        <div className="flex-1 px-4 py-8 text-sm text-neutral-500">
          Klikk tekst, bilde eller en seksjon på siden. Innholdet redigeres her, ikke direkte på nettsiden.
        </div>
      </aside>
    );
  }

  const lock = selected.lock || { locked: false };
  const kind = selected.kind;
  const title = selected.chip || 'Element';

  return (
    <aside className="w-80 shrink-0 border-l border-neutral-200 bg-white flex flex-col min-h-0" aria-label="Innholdsredigering">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Redigering</p>
          <p className="text-sm font-medium text-neutral-900 truncate">{title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          aria-label="Lukk panel"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {lock.locked ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-600">{lockCopy(lock)}</p>
            {lock.reason === 'cms-slot' && /price/i.test(lock.slot || '') && lock.productId ? (
              <Field id="inspector-product-price" label="Pris i produkter">
                <div className="flex gap-2">
                  <input
                    id="inspector-product-price"
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => onProductPriceSave(lock.productId, price)}
                    className="shrink-0 px-3 py-2 rounded-md bg-[#FF5B00] text-white text-sm"
                  >
                    Lagre
                  </button>
                </div>
              </Field>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenTab?.(lock.tab === 'blog' ? 'blog' : 'ecommerce')}
              className="w-full px-3 py-2 rounded-md bg-neutral-900 text-white text-sm"
            >
              {lock.tab === 'blog' ? 'Åpne Blogg' : 'Åpne Produkter'}
            </button>
          </div>
        ) : null}

        {!lock.locked && (kind === 'text' || kind === 'price' || kind === 'link') ? (
          <Field id="inspector-text" label={kind === 'price' ? 'Pris' : 'Tekst'}>
            <textarea
              id="inspector-text"
              value={text}
              rows={kind === 'price' ? 2 : 6}
              onChange={(e) => {
                setText(e.target.value);
                onTextChange(e.target.value, { commit: false });
              }}
              onBlur={() => onTextChange(text, { commit: true })}
              className={`${inputClass} resize-y min-h-[4.5rem]`}
            />
          </Field>
        ) : null}

        {!lock.locked && kind === 'link' ? (
          <Field id="inspector-href" label="Lenke">
            <input
              id="inspector-href"
              type="text"
              value={href}
              placeholder="/kontakt"
              onChange={(e) => {
                setHref(e.target.value);
                onHrefChange(e.target.value, { commit: false });
              }}
              onBlur={() => onHrefChange(href, { commit: true })}
              className={inputClass}
            />
          </Field>
        ) : null}

        {!lock.locked && (kind === 'media' || selected.mediaKey) ? (
          <div className="space-y-3">
            <p className="text-xs font-medium text-neutral-600">{kind === 'media' ? 'Bilde' : 'Bakgrunnsbilde'}</p>
            <div className="aspect-video rounded-md border border-neutral-200 bg-neutral-50 overflow-hidden flex items-center justify-center">
              {selected.mediaUrl ? (
                <img src={selected.mediaUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={28} className="text-neutral-400" />
              )}
            </div>
            <button
              type="button"
              onClick={onPickMedia}
              className="w-full px-3 py-2 rounded-md bg-[#FF5B00] text-white text-sm"
            >
              Bytt bilde
            </button>
          </div>
        ) : null}

        {!lock.locked && (kind === 'section' || selected.mediaIsSection) ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-neutral-600">Seksjon</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => onSectionAction('hide')} className="px-3 py-2 rounded-md border border-neutral-200 text-sm hover:bg-neutral-50">
                Skjul
              </button>
              <button type="button" onClick={() => onSectionAction('show')} className="px-3 py-2 rounded-md border border-neutral-200 text-sm hover:bg-neutral-50">
                Vis
              </button>
              <button type="button" onClick={() => onSectionAction('up')} className="px-3 py-2 rounded-md border border-neutral-200 text-sm hover:bg-neutral-50">
                Flytt opp
              </button>
              <button type="button" onClick={() => onSectionAction('down')} className="px-3 py-2 rounded-md border border-neutral-200 text-sm hover:bg-neutral-50">
                Flytt ned
              </button>
              <button type="button" onClick={() => onSectionAction('duplicate')} className="px-3 py-2 rounded-md border border-neutral-200 text-sm hover:bg-neutral-50">
                Dupliser
              </button>
              {selected.inserted ? (
                <button type="button" onClick={() => onSectionAction('remove')} className="px-3 py-2 rounded-md border border-red-200 text-sm text-red-700 hover:bg-red-50">
                  Slett
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
