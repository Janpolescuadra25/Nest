import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Product, ProductFormData } from '../../types';

interface Props {
  jwt: string;
}

const sortByName = (items: Product[]) => [...items].sort((a, b) => a.name.localeCompare(b.name));

export default function ProductCatalogView({ jwt }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>({ name: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getProducts(jwt);
        setProducts(sortByName(data));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load products');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [jwt]);

  const openAdd = () => {
    setEditingProduct(null);
    setFormData({ name: '' });
    setError(null);
    setShowModal(true);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({ name: product.name });
    setError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError('Product name is required');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      if (editingProduct) {
        const updated = await api.updateProduct(jwt, editingProduct.id, formData);
        setProducts((prev) => sortByName(prev.map((item) => (item.id === updated.id ? updated : item))));
      } else {
        const created = await api.createProduct(jwt, formData);
        setProducts((prev) => sortByName([...prev, created]));
      }
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: Product) => {
    const confirmed = window.confirm(`Delete "${product.name}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api.deleteProduct(jwt, product.id);
      setProducts((prev) => prev.filter((item) => item.id !== product.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete product');
    }
  };

  return (
    <div className="p-3 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Product Catalog</h1>
          <p className="text-xs text-gray-400">Create a product name list for future smart matching.</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded px-3 py-2"
        >
          + Add Product
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-gray-400">Loading products…</div>
      ) : products.length === 0 ? (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-sm text-gray-400">
          No products yet. Add your first product to start auto-matching line items from scanned invoices.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900">
          <table className="min-w-full text-left text-xs text-gray-200">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800 text-gray-300">
                <th className="px-3 py-3">Product Name</th>
                <th className="px-3 py-3">Created</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-gray-800 hover:bg-gray-900/80">
                  <td className="px-3 py-3 text-gray-200">{product.name}</td>
                  <td className="px-3 py-3 text-gray-400">{new Date(product.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-3 space-x-2">
                    <button
                      type="button"
                      onClick={() => openEdit(product)}
                      className="text-xs text-cyan-400 hover:text-cyan-300"
                      title="Edit product"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(product)}
                      className="text-xs text-red-400 hover:text-red-300"
                      title="Delete product"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">{editingProduct ? 'Edit Product' : 'Add Product'}</h2>
                <p className="text-xs text-gray-400">Create or update a product name for invoice matching.</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-200 text-sm"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400">Product Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded px-3 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="text-xs bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded px-3 py-2"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
