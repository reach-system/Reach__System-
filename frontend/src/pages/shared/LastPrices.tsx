import { useEffect, useState } from "react";
import api from "../../lib/api";
import { PageHeader } from "../../components/ui/PageHeader";
import { Input } from "../../components/ui/Input";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { Pagination } from "../../components/ui/Pagination";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { useI18n } from "../../i18n/context";
import { notify } from "../../lib/notify";
import { getFriendlyErrorMessage } from "../../lib/messages";

interface LastPriceEntry {
  id: number;
  name: string;
  category?: { id: number; name: string } | null;
  lastPrice?: {
    id: number;
    price: number;
    source: string | null;
    sourceInvoiceId?: number | null;
    sourceInvoice?: { id: number; invoiceNumber: string } | null;
    effectiveAt?: string | null;
    version: number;
    updatedByEmployeeId?: number | null;
    updatedBy?: { id: number; name: string } | null;
  } | null;
}

export default function LastPricesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<LastPriceEntry[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0, limit: 25 });
  const [editingRow, setEditingRow] = useState<LastPriceEntry | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [priceError, setPriceError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const params: Record<string, string | number> = { page, limit: 25 };
        if (search.trim()) params.search = search.trim();

        const res = await api.get<{ data?: LastPriceEntry[]; meta?: typeof meta }>('/product-models/last-prices', {
          params,
          signal: controller.signal,
        });

        setRows(res.data?.data ?? []);
        setMeta(
          res.data?.meta ?? {
            page: 1,
            totalPages: 1,
            total: 0,
            limit: 25,
          },
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [page, search]);

  const totalPages = Math.max(1, meta.totalPages || 1);

  const openEdit = (row: LastPriceEntry) => {
    setEditingRow(row);
    setPriceInput(row.lastPrice ? String(row.lastPrice.price) : "");
    setPriceError("");
  };

  const closeEdit = () => {
    if (!saving) setEditingRow(null);
  };

  const savePrice = async () => {
    if (!editingRow) return;

    const price = Number(priceInput);
    if (!priceInput.trim() || !Number.isFinite(price) || price <= 0) {
      setPriceError(t.errors.common.greaterThanZero);
      return;
    }

    setPriceError("");
    setSaving(true);
    try {
      const { data } = await api.patch<NonNullable<LastPriceEntry["lastPrice"]>>(
        `/product-models/${editingRow.id}/last-price`,
        { price, version: editingRow.lastPrice?.version },
      );
      setRows((current) =>
        current.map((row) =>
          row.id === editingRow.id ? { ...row, lastPrice: data } : row,
        ),
      );
      setEditingRow(null);
      notify.success(t.lastPricePage.updated);
    } catch (error) {
      notify.error(getFriendlyErrorMessage(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t.lastPricePage.title}
        subtitle={t.lastPricePage.subtitle}
      />

      <div className="toolbar">
        <div className="toolbar-grow">
          <Input
            placeholder={t.lastPricePage.search}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {loading ? (
        <div className="state-block">
          <LoadingSpinner size={28} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t.lastPricePage.noPrices}
          description={t.lastPricePage.noPricesDescription}
        />
      ) : (
        <>
          <div className="card" style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>{t.lastPricePage.product}</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>{t.lastPricePage.category}</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>{t.lastPricePage.lastPrice}</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>{t.lastPricePage.source}</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>{t.lastPricePage.effective}</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>{t.lastPricePage.updatedBy}</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const price = row.lastPrice ? Number(row.lastPrice.price) : null;
                  const source = row.lastPrice?.source === "INVOICE"
                    ? t.lastPricePage.invoiceSource
                    : row.lastPrice
                      ? t.lastPricePage.manualSource
                      : "—";
                  const effectiveAt = row.lastPrice?.effectiveAt ? new Date(row.lastPrice.effectiveAt).toLocaleString() : "—";
                  const updatedBy = row.lastPrice?.updatedBy?.name ?? "—";

                  return (
                    <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "12px 16px" }}>{row.name}</td>
                      <td style={{ padding: "12px 16px" }}>{row.category?.name ?? "—"}</td>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                        {price === null ? "—" : `${t.currency} ${price.toFixed(2)}`}
                      </td>
                      <td style={{ padding: "12px 16px" }}>{source}</td>
                      <td style={{ padding: "12px 16px" }}>{effectiveAt}</td>
                      <td style={{ padding: "12px 16px" }}>{updatedBy}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>
                          {t.edit}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentStart={(meta.page - 1) * meta.limit + 1}
            currentEnd={Math.min(meta.page * meta.limit, meta.total)}
            total={meta.total}
            currentPage={meta.page}
            totalPages={totalPages}
            onPrev={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
          />
        </>
      )}

      <Modal
        isOpen={editingRow !== null}
        onClose={closeEdit}
        title={t.lastPricePage.editTitle}
        footer={
          <>
            <Button variant="secondary" onClick={closeEdit} disabled={saving}>
              {t.cancel}
            </Button>
            <Button onClick={savePrice} loading={saving}>
              {t.save}
            </Button>
          </>
        }
      >
        {editingRow && (
          <Input
            autoFocus
            type="number"
            min="0.01"
            step="0.01"
            label={`${editingRow.name} — ${t.lastPricePage.lastPrice}`}
            value={priceInput}
            error={priceError}
            onChange={(event) => {
              setPriceInput(event.target.value);
              setPriceError("");
            }}
          />
        )}
      </Modal>
    </div>
  );
}
