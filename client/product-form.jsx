/** Shared product fields used by the full editor and quick edit. */
import { useRef, useState } from 'react';
import { MediaPicker } from './MediaPanel.jsx';
export const PRODUCT_TYPES = [
    { id: 'normal', label: 'Normal' },
    { id: 'menu', label: 'Menu' },
    { id: 'tiers', label: 'Tiers' },
];
/** Blank product form for a catalog type. */
export function emptyProductForm(catalogType = 'normal') {
    return {
        name: '',
        price: '',
        comparePrice: '',
        contactInsteadOfPrice: false,
        description: '',
        imageUrl: '',
        categoryId: '',
        allergens: '',
        subtitle: '',
        includedText: '',
        extraTexts: '',
        extraOptionsText: '',
        cta: '',
        productType: catalogType === 'menu' || catalogType === 'tiers' ? catalogType : 'normal',
        stockQty: '',
        soldOut: false,
    };
}
/** Form state loaded from a stored product. */
export function formFromProduct(product, catalogType = 'normal') {
    const extraOptions = Array.isArray(product?.extraOptions) ? product.extraOptions : [];
    return {
        name: product?.name || '',
        price: product?.price == null ? '' : String(product.price),
        comparePrice: product?.comparePrice || '',
        contactInsteadOfPrice: Boolean(product?.contactInsteadOfPrice),
        description: product?.description || '',
        imageUrl: product?.imageUrl || '',
        categoryId: product?.categoryId || '',
        allergens: product?.allergens || '',
        subtitle: product?.subtitle || '',
        includedText: Array.isArray(product?.included) && product.included.length
            ? product.included.join('\n')
            : Array.isArray(product?.bullets)
                ? product.bullets.join('\n')
                : '',
        extraTexts: Array.isArray(product?.extraTexts) ? product.extraTexts.join('\n') : '',
        extraOptionsText: extraOptions
            .map((item) => (item.price ? `${item.name} | ${item.price}` : item.name))
            .join('\n'),
        cta: product?.cta || '',
        productType: product?.productType || catalogType || 'normal',
        stockQty: product?.stockQty === 0 || product?.stockQty ? String(product.stockQty) : '',
        soldOut: Boolean(product?.soldOut),
    };
}
/** Product payload ready for the admin API. */
export function payloadFromForm(form) {
    const extraOptions = String(form.extraOptionsText || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const [name, price] = line.split('|').map((part) => part.trim());
        return { name, price: price || '' };
    });
    return {
        name: form.name.trim(),
        price: form.contactInsteadOfPrice ? form.price : form.price,
        comparePrice: form.comparePrice.trim(),
        contactInsteadOfPrice: Boolean(form.contactInsteadOfPrice),
        description: form.description.trim(),
        imageUrl: form.imageUrl || '',
        categoryId: form.categoryId || '',
        allergens: form.allergens.trim(),
        subtitle: form.subtitle.trim(),
        included: String(form.includedText || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        extraTexts: String(form.extraTexts || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        extraOptions,
        cta: form.cta.trim(),
        productType: form.productType || 'normal',
        stockQty: form.soldOut ? 0 : form.stockQty,
        soldOut: Boolean(form.soldOut),
    };
}
function ImageDropzone({ imageUrl, uploading, onUpload, onClear, disabled, onPickUrl, authHeaders }) {
    const inputRef = useRef(null);
    const [dragOver, setDragOver] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    return (<div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs text-gray-400">Image</label>
        {authHeaders && onPickUrl && (<button type="button" disabled={disabled} onClick={() => setPickerOpen(true)} className="text-xs text-[#FF5B00] hover:underline">
            Choose from media library
          </button>)}
      </div>
      {authHeaders && onPickUrl && (<MediaPicker authHeaders={authHeaders} open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(item) => onPickUrl(item.url)} kind="image"/>)}
      <input ref={inputRef} type="file" accept="image/*" disabled={disabled || uploading} onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
                onUpload(file);
            e.target.value = '';
        }} className="hidden"/>
      <div onDragOver={(e) => {
            e.preventDefault();
            if (!disabled)
                setDragOver(true);
        }} onDragLeave={() => setDragOver(false)} onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer?.files?.[0];
            if (file && !disabled)
                onUpload(file);
        }} onClick={() => !disabled && inputRef.current?.click()} className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragOver ? 'border-[#FF5B00] bg-[#FF5B00]/10' : 'border-white/20 hover:border-white/40 bg-[#1a1a1a]/50'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {uploading ? (<p className="text-gray-400">Uploading…</p>) : imageUrl ? (<div className="flex items-center justify-center gap-3">
            <img src={imageUrl} alt="" className="w-20 h-20 object-cover rounded"/>
            <div className="text-left">
              <p className="text-white text-sm">Image added</p>
              <button type="button" onClick={(e) => {
                e.stopPropagation();
                onClear();
            }} className="text-xs text-[#FF5B00] hover:underline mt-1">
                Remove
              </button>
            </div>
          </div>) : (<>
            <p className="text-gray-400 text-sm">Drag image here or click to browse</p>
            <p className="text-gray-500 text-xs mt-1">PNG, JPG, WebP, etc.</p>
          </>)}
      </div>
    </div>);
}
/** Product field inputs shared by quick edit and the full editor. */
export function ProductFields({ form, setForm, categories, loading, imageUploading, onUpload, compact = false, authHeaders }) {
    const type = form.productType || 'normal';
    const usesCategories = type === 'menu' || type === 'normal';
    const field = (label, children) => (<div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>);
    const inputClass = 'w-full px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white placeholder-gray-500';
    return (<div className={`grid gap-4 ${compact ? 'md:grid-cols-2' : 'md:grid-cols-2'}`}>
      {field('Product type', <select value={type} onChange={(e) => setForm((current) => ({ ...current, productType: e.target.value }))} className={inputClass}>
          {PRODUCT_TYPES.map((item) => (<option key={item.id} value={item.id}>
              {item.label}
            </option>))}
        </select>)}
      {field(type === 'tiers' ? 'Plan name' : 'Name', <input type="text" value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} className={inputClass}/>)}
      {field('Price', <input type="text" value={form.price} disabled={form.contactInsteadOfPrice} onChange={(e) => setForm((current) => ({ ...current, price: e.target.value }))} placeholder={type === 'tiers' ? 'e.g. 1499,-/mnd' : 'e.g. 109,-'} className={inputClass}/>)}
      {field('Compare-at price', <input type="text" value={form.comparePrice} onChange={(e) => setForm((current) => ({ ...current, comparePrice: e.target.value }))} placeholder="Optional" className={inputClass}/>)}
      <label className="flex items-center gap-2 text-sm text-gray-300 md:col-span-2">
        <input type="checkbox" checked={form.contactInsteadOfPrice} onChange={(e) => setForm((current) => ({ ...current, contactInsteadOfPrice: e.target.checked }))}/>
        No price — show contact instead
      </label>
      {usesCategories &&
            field('Category', <select value={form.categoryId} onChange={(e) => setForm((current) => ({ ...current, categoryId: e.target.value }))} className={inputClass}>
            <option value="">Uncategorized</option>
            {categories.map((category) => (<option key={category.id} value={category.id}>
                {category.name}
              </option>))}
          </select>)}
      {(type === 'normal' || type === 'tiers') &&
            field('Subtitle', <input type="text" value={form.subtitle} onChange={(e) => setForm((current) => ({ ...current, subtitle: e.target.value }))} className={inputClass}/>)}
      {type !== 'tiers' &&
            field('Description', <textarea value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} rows={3} className={inputClass}/>)}
      {type === 'menu' &&
            field('Allergens', <input type="text" value={form.allergens} onChange={(e) => setForm((current) => ({ ...current, allergens: e.target.value }))} placeholder="e.g. Gluten, milk, sesame" className={inputClass}/>)}
      {type === 'tiers' &&
            field('Included (one per line)', <textarea value={form.includedText} onChange={(e) => setForm((current) => ({ ...current, includedText: e.target.value }))} rows={4} className={inputClass}/>)}
      {type === 'tiers' &&
            field('CTA', <input type="text" value={form.cta} onChange={(e) => setForm((current) => ({ ...current, cta: e.target.value }))} placeholder="e.g. Contact us" className={inputClass}/>)}
      {field('Extra notes (one per line)', <textarea value={form.extraTexts} onChange={(e) => setForm((current) => ({ ...current, extraTexts: e.target.value }))} rows={2} placeholder="Inkluderer 2 års garanti" className={inputClass}/>)}
      {field('Add-ons (name | price per line)', <textarea value={form.extraOptionsText} onChange={(e) => setForm((current) => ({ ...current, extraOptionsText: e.target.value }))} rows={2} placeholder={'Ekstra ost | 15'} className={inputClass}/>)}
      {field('In stock', <input type="number" min="0" value={form.stockQty} disabled={form.soldOut} onChange={(e) => setForm((current) => ({ ...current, stockQty: e.target.value }))} className={inputClass}/>)}
      <label className="flex items-center gap-2 text-sm text-white md:col-span-2">
        <input type="checkbox" checked={form.soldOut} onChange={(e) => setForm((current) => ({
            ...current,
            soldOut: e.target.checked,
            stockQty: e.target.checked ? '0' : current.stockQty,
        }))}/>
        No more left / sold out
      </label>
      <div className="md:col-span-2">
        <ImageDropzone imageUrl={form.imageUrl} uploading={imageUploading} disabled={loading} onUpload={onUpload} onClear={() => setForm((current) => ({ ...current, imageUrl: '' }))} authHeaders={authHeaders} onPickUrl={(url) => setForm((current) => ({ ...current, imageUrl: url }))}/>
      </div>
    </div>);
}
