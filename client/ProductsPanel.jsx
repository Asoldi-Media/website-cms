/** Admin product list with quick edit and the full product form. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ProductFields, emptyProductForm, formFromProduct, payloadFromForm } from './product-form.jsx';
const API = '/api/cms';
function formatPrice(product) {
    if (product?.contactInsteadOfPrice)
        return 'Contact';
    const price = product?.price;
    if (price == null || price === '')
        return '—';
    if (typeof price === 'number')
        return Number.isInteger(price) ? String(price) : price.toFixed(2);
    return String(price);
}
function typeLabel(type, fallback) {
    const value = type || fallback || 'normal';
    if (value === 'menu')
        return 'Menu';
    if (value === 'tiers')
        return 'Tiers';
    return 'Normal';
}
function stockLabel(product) {
    if (product?.soldOut)
        return 'Sold out';
    if (product?.stockQty === 0)
        return '0';
    if (product?.stockQty === '' || product?.stockQty == null)
        return '—';
    return String(product.stockQty);
}
/** Products admin tab. */
export function ProductsPanel({ catalogType, authHeaders, loading, setLoading }) {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [view, setView] = useState('list');
    const [editingProduct, setEditingProduct] = useState(null);
    const [form, setForm] = useState(emptyProductForm(catalogType));
    const [quickId, setQuickId] = useState(null);
    const [quickForm, setQuickForm] = useState(emptyProductForm(catalogType));
    const [categoryName, setCategoryName] = useState('');
    const [imageUploading, setImageUploading] = useState(false);
    const [filterCategoryId, setFilterCategoryId] = useState('all');
    const [filterType, setFilterType] = useState('all');
    const usesCategories = true;
    const fetchProducts = useCallback(async () => {
        const res = await fetch(`${API}/products`, { headers: authHeaders() });
        if (!res.ok)
            return;
        setProducts(await res.json());
    }, [authHeaders]);
    const fetchCategories = useCallback(async () => {
        const res = await fetch(`${API}/categories`, { headers: authHeaders() });
        if (!res.ok)
            return;
        setCategories(await res.json());
    }, [authHeaders]);
    useEffect(() => {
        fetchProducts();
        fetchCategories();
    }, [fetchProducts, fetchCategories]);
    const categoryNameById = useMemo(() => {
        const map = new Map(categories.map((category) => [category.id, category.name]));
        return map;
    }, [categories]);
    const visibleProducts = useMemo(() => {
        return products.filter((product) => {
            if (filterType !== 'all' && (product.productType || catalogType) !== filterType)
                return false;
            if (filterCategoryId === 'all')
                return true;
            if (filterCategoryId === 'uncategorized')
                return !product.categoryId;
            return product.categoryId === filterCategoryId;
        });
    }, [products, filterCategoryId, filterType, catalogType]);
    const uploadImageFile = async (file, applyUrl) => {
        if (!file || !file.type.startsWith('image/'))
            return;
        setImageUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${API}/upload`, {
                method: 'POST',
                headers: authHeaders(),
                body: formData,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.message || 'Upload failed');
                return;
            }
            applyUrl(data.url || '');
        }
        finally {
            setImageUploading(false);
        }
    };
    const saveProduct = async (payload, id) => {
        if (!payload.name)
            return;
        setLoading(true);
        try {
            const res = await fetch(id ? `${API}/products/${id}` : `${API}/products`, {
                method: id ? 'PUT' : 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.message || 'Save failed');
                return false;
            }
            await fetchProducts();
            return true;
        }
        finally {
            setLoading(false);
        }
    };
    const handleDeleteProduct = async (id) => {
        if (!confirm('Move this product to trash? This removes it from the catalog.'))
            return;
        setLoading(true);
        try {
            const res = await fetch(`${API}/products/${id}`, { method: 'DELETE', headers: authHeaders() });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.message || 'Delete failed');
                return;
            }
            if (editingProduct?.id === id) {
                setEditingProduct(null);
                setView('list');
            }
            if (quickId === id)
                setQuickId(null);
            await fetchProducts();
        }
        finally {
            setLoading(false);
        }
    };
    const handleAddCategory = async (e) => {
        e.preventDefault();
        const name = categoryName.trim();
        if (!name)
            return;
        setLoading(true);
        try {
            const res = await fetch(`${API}/categories`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(data.message || 'Failed to create category');
                return;
            }
            setCategoryName('');
            await fetchCategories();
        }
        finally {
            setLoading(false);
        }
    };
    const openEditor = (product) => {
        setEditingProduct(product || null);
        setForm(product ? formFromProduct(product, catalogType) : emptyProductForm(catalogType));
        setView('edit');
        setQuickId(null);
    };
    const fieldsProps = {
        categories,
        loading,
        imageUploading,
        authHeaders,
    };
    if (view === 'edit') {
        return (<div>
        <div className="flex items-center justify-between gap-4 mb-6">
          <h2 className="text-xl font-semibold text-white">{editingProduct ? 'Edit product' : 'Add product'}</h2>
          <button type="button" onClick={() => setView('list')} className="text-sm text-gray-400 hover:text-white">
            ← All products
          </button>
        </div>
        <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-6">
          <ProductFields form={form} setForm={setForm} {...fieldsProps} onUpload={(file) => uploadImageFile(file, (url) => setForm((current) => ({ ...current, imageUrl: url })))}/>
          <div className="flex gap-2 mt-6">
            <button type="button" disabled={loading || !form.name.trim()} onClick={async () => {
                const ok = await saveProduct(payloadFromForm(form), editingProduct?.id);
                if (ok)
                    setView('list');
            }} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium disabled:opacity-50">
              {editingProduct ? 'Update' : 'Publish'}
            </button>
            <button type="button" onClick={() => setView('list')} className="px-4 py-2 rounded-lg bg-white/10 text-white">
              Cancel
            </button>
          </div>
        </div>
      </div>);
    }
    return (<div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-gray-400 text-sm">
          Site catalog default: <span className="text-white">{typeLabel(catalogType)}</span>. Each product can still have its own
          type.
        </p>
        <button type="button" onClick={() => openEditor(null)} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium">
          Add product
        </button>
      </div>

      <div className="rounded-xl bg-[#2a2a2a] border border-white/10 p-4 mb-4">
        <form onSubmit={handleAddCategory} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-400 mb-1">New category</label>
            <input type="text" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-white/20 text-white w-56"/>
          </div>
          <button type="submit" disabled={loading || !categoryName.trim()} className="px-4 py-2 rounded-lg bg-white/10 text-white disabled:opacity-50">
            Add category
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {['all', 'normal', 'menu', 'tiers'].map((id) => (<button key={id} type="button" onClick={() => setFilterType(id)} className={`px-3 py-1.5 rounded-lg text-sm ${filterType === id ? 'bg-[#FF5B00] text-white' : 'bg-white/10 text-gray-300'}`}>
            {id === 'all' ? 'All types' : typeLabel(id)}
          </button>))}
        {usesCategories &&
            [{ id: 'all', name: 'All categories' }, ...categories, { id: 'uncategorized', name: 'Uncategorized' }].map((category) => (<button key={`cat-${category.id}`} type="button" onClick={() => setFilterCategoryId(category.id)} className={`px-3 py-1.5 rounded-lg text-sm ${filterCategoryId === category.id ? 'bg-white text-black' : 'bg-white/10 text-gray-300'}`}>
              {category.name}
            </button>))}
      </div>

      <div className="rounded-xl bg-[#2a2a2a] border border-white/10 overflow-x-auto">
        <table className="w-full text-left min-w-[720px]">
          <thead>
            <tr className="border-b border-white/10 text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-gray-400 font-medium">Image</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Product</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Type</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Price</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Stock</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Category</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Date</th>
              <th className="px-4 py-3 text-gray-400 font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product) => (<React.Fragment key={product.id}>
                <tr className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">
                    {product.imageUrl ? (<img src={product.imageUrl} alt="" className="w-12 h-12 object-cover rounded"/>) : (<span className="text-gray-500 text-sm">—</span>)}
                  </td>
                  <td className="px-4 py-3 text-white">
                    <button type="button" className="text-left hover:underline" onClick={() => openEditor(product)}>
                      {product.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-sm">{typeLabel(product.productType, catalogType)}</td>
                  <td className="px-4 py-3 text-gray-300">{formatPrice(product)}</td>
                  <td className="px-4 py-3 text-gray-300">{stockLabel(product)}</td>
                  <td className="px-4 py-3 text-gray-400">{categoryNameById.get(product.categoryId) || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm">
                    {product.createdAt ? new Date(product.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button type="button" className="text-xs text-[#FF5B00] hover:underline mr-2" onClick={() => {
                setQuickId(product.id);
                setQuickForm(formFromProduct(product, catalogType));
            }}>
                      Quick Edit
                    </button>
                    <button type="button" className="text-xs text-[#FF5B00] hover:underline mr-2" onClick={() => openEditor(product)}>
                      Edit
                    </button>
                    <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => handleDeleteProduct(product.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
                {quickId === product.id && (<tr className="border-b border-white/5 bg-black/30">
                    <td colSpan={8} className="px-4 py-4">
                      <ProductFields compact form={quickForm} setForm={setQuickForm} {...fieldsProps} onUpload={(file) => uploadImageFile(file, (url) => setQuickForm((current) => ({ ...current, imageUrl: url })))}/>
                      <div className="flex gap-2 mt-4">
                        <button type="button" disabled={loading || !quickForm.name.trim()} onClick={async () => {
                    const ok = await saveProduct(payloadFromForm(quickForm), product.id);
                    if (ok)
                        setQuickId(null);
                }} className="px-4 py-2 rounded-lg bg-[#FF5B00] text-white font-medium disabled:opacity-50">
                          Update
                        </button>
                        <button type="button" className="text-xs px-3 py-2 rounded bg-white/10 text-white" onClick={async () => {
                    await saveProduct({ ...payloadFromForm(quickForm), soldOut: true, stockQty: 0 }, product.id);
                    setQuickId(null);
                }}>
                          No more left
                        </button>
                        <button type="button" onClick={() => setQuickId(null)} className="px-4 py-2 rounded-lg bg-white/10 text-white">
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>)}
              </React.Fragment>))}
          </tbody>
        </table>
        {visibleProducts.length === 0 && <p className="px-4 py-8 text-gray-400 text-center">No products yet.</p>}
      </div>
    </div>);
}
