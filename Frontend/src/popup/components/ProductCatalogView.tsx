import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ConfirmDialog } from './shared';
import type { Product, ProductFormData } from '../../types';

interface Props {
  jwt: string;
  locationId: string;
}

const sortByName = (items: Product[]) => [...items].sort((a, b) => a.name.localeCompare(b.name));

export default function ProductCatalogView({ jwt, locationId }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>({ name: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteProductDialog, setDeleteProductDialog] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getProducts(jwt, locationId);
        setProducts(sortByName(data));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load products');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [jwt, locationId]);

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
        const created = await api.createProduct(jwt, locationId, formData);
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
    setDeleteProductDialog({ open: true, product });
  };

  const confirmDeleteProduct = async () => {
    if (!deleteProductDialog.product) return;
    const product = deleteProductDialog.product;
    setDeleteProductDialog({ open: false, product: null });
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
          <h1 className="text-lg font-semibold text-gray-900">Product Catalog</h1>
          <p className="text-xs text-gray-600">Create a product name list for future smart matching.</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2"
        >
          + Add Product
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-300 rounded px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-gray-600">Loading products…</div>
      ) : products.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-[#F5F5F7] p-6 text-center text-sm text-gray-600">
          No products yet. Add your first product to start auto-matching line items from scanned invoices.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-[#F5F5F7]">
          <table className="min-w-full text-left text-xs text-gray-700">
            <thead>
              <tr className="border-b border-gray-200 bg-white text-gray-600">
                <th className="px-3 py-3">Product Name</th>
                <th className="px-3 py-3">Created</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-3 py-3 text-gray-700">{product.name}</td>
                  <td className="px-3 py-3 text-gray-600">{new Date(product.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-3 space-x-2">
                    <button
                      type="button"
                      onClick={() => openEdit(product)}
                      className="text-xs text-emerald-400 hover:text-emerald-600"
                      title="Edit product"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(product)}
                      className="text-xs text-red-600 hover:text-red-600"
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
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{editingProduct ? 'Edit Product' : 'Add Product'}</h2>
                <p className="text-xs text-gray-600">Create or update a product name for invoice matching.</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-gray-600 hover:text-gray-700 text-sm"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-600">Product Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="mt-1 w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="text-xs bg-white hover:bg-gray-100 text-gray-700 rounded px-3 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded px-3 py-2"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deleteProductDialog.open}
        title="Delete Product"
        message={`Delete "${deleteProductDialog.product?.name}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDeleteProduct}
        onCancel={() => setDeleteProductDialog({ open: false, product: null })}
        variant="danger"
      />
    </div>
  );
}
