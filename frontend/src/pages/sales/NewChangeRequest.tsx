import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "../../lib/api";
import { ALL_OPTIONS_LIMIT, isAbortError } from "../../hooks";
import { notify } from "../../lib/notify";
import { getFriendlyErrorMessage } from "../../lib/messages";
import { getSuccessMessages } from "../../lib/success-messages";
import { useI18n } from "../../i18n/context";
import { useAuth } from "../../lib/auth";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  calculateInvoiceDiscountFactor,
  calculateOutstandingInvoiceTotal,
  getEffectivePrice,
  getRemainingQuantity,
  roundMoney,
} from "../../lib/invoiceTotals";
import type { Invoice, PaginatedResponse, ProductModel, UnitOfMeasure } from "../../types";

type LineAction = "RETURN_ITEM" | "REMOVE_ITEM" | "CHANGE_PRICE";
type RequestType = "EDIT" | "PARTIAL_RETURN" | "FULL_RETURN";

interface UnitAssignment {
  id: number;
  productUnitId: number;
  productUnit: { id: number; barcode: string; status: string };
}

interface ChangeLine {
  id: number;
  quantity: number;
  price: number;
  productModel?: { id: number; name: string; isSerialized: boolean; unit?: UnitOfMeasure };
  unitAssignments?: UnitAssignment[];
  priceAdjustments?: { newPrice: number }[];
}

interface ChangeRow {
  key: string;
  kind: "line" | "add";
  action: LineAction | "ADD_ITEM";
  invoiceItemId?: number;
  productUnitId?: number;
  productModelId?: number;
  quantity: string;
  proposedPrice: string;
}

const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let rowSeq = 0;
const nextKey = () => `row-${(rowSeq += 1)}`;

export default function NewChangeRequest() {
  const { invoiceId } = useParams<{ invoiceId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();
  const SUCCESS_MESSAGES = getSuccessMessages(t);

  const isAdmin = user?.role === "ADMIN";
  const requestsPath = isAdmin ? "/admin/change-requests" : "/sales/my-requests";
  const changeRequestBase = isAdmin ? "/admin/change-request" : "/sales/change-request";
  const invoicesPath = isAdmin ? "/admin/invoices" : "/sales/invoice-search";

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [models, setModels] = useState<ProductModel[]>([]);
  const [loading, setLoading] = useState(Boolean(invoiceId));
  const [pickerLoading, setPickerLoading] = useState(!invoiceId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const initialType: RequestType = searchParams.get("type") === "RETURN" ? "FULL_RETURN" : "EDIT";
  const [type, setType] = useState<RequestType>(initialType);
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<ChangeRow[]>([]);

  const lines = useMemo(() => (invoice?.items ?? []) as unknown as ChangeLine[], [invoice]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function loadInvoice() {
      setLoading(true);
      try {
        const { data } = await api.get<Invoice>(`/invoices/${invoiceId}`, { signal });
        setInvoice(data);
      } catch (err) {
        if (isAbortError(err)) return;
        setInvoice(null);
        setError(getFriendlyErrorMessage(err, t));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }

    async function loadPicker() {
      setPickerLoading(true);
      try {
        const { data } = await api.get<PaginatedResponse<Invoice>>("/invoices", {
          params: { page: 1, limit: ALL_OPTIONS_LIMIT },
          signal,
        });
        const eligible = (data.data ?? []).filter(
          (row) => row.status === "CONFIRMED" || row.status === "DELIVERED",
        );
        setInvoices(eligible);
      } catch (err) {
        if (isAbortError(err)) return;
        setInvoices([]);
      } finally {
        if (!signal.aborted) setPickerLoading(false);
      }
    }

    async function loadModels() {
      try {
        const { data } = await api.get<PaginatedResponse<ProductModel>>("/product-models", {
          params: { page: 1, limit: ALL_OPTIONS_LIMIT },
          signal,
        });
        setModels(data.data ?? []);
      } catch (err) {
        if (isAbortError(err)) return;
        setModels([]);
      }
    }

    if (invoiceId) {
      void loadInvoice();
      void loadModels();
    } else {
      void loadPicker();
    }

    return () => controller.abort();
  }, [invoiceId, t]);

  const setRow = (key: string, patch: Partial<ChangeRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const removeRow = (key: string) => setRows((current) => current.filter((row) => row.key !== key));

  // Server-authoritative rules mirrored for display: latest approved price and
  // quantity net of approved returns. The backend recomputes on approval.
  const projected = useMemo(() => {
    if (!invoice) return null;

    const currentTotal = Number(invoice.currentTotal ?? 0);

    // A full return gives back every remaining unit, so nothing stays owed.
    if (type === "FULL_RETURN") {
      return {
        currentTotal,
        projectedTotal: 0,
        delta: roundMoney(-currentTotal),
      };
    }

    const discountFactor = calculateInvoiceDiscountFactor(
      Number(invoice.originalTotal ?? 0),
      Number(invoice.discountPercentage ?? 0),
      Number(invoice.discountAmount ?? 0),
    );

    const outstanding: { price: number; quantity: number }[] = [];

    for (const line of lines) {
      const soldQuantity = Number(line.quantity ?? 0);
      let remaining = getRemainingQuantity(line.id, soldQuantity, invoice.returns);
      let price = getEffectivePrice(line);

      const row = rows.find((candidate) => candidate.kind === "line" && candidate.invoiceItemId === line.id);
      if (row?.action === "RETURN_ITEM" || row?.action === "REMOVE_ITEM") {
        if (line.productModel?.isSerialized) {
          remaining = Math.max(0, remaining - (row.productUnitId ? 1 : 0));
        } else {
          const requested = Number(row.quantity);
          if (Number.isFinite(requested) && requested > 0) {
            remaining = Math.max(0, roundMoney(remaining - requested));
          }
        }
      }
      if (row?.action === "CHANGE_PRICE" && row.proposedPrice !== "") {
        const proposed = Number(row.proposedPrice);
        if (Number.isFinite(proposed) && proposed >= 0) price = roundMoney(proposed);
      }

      outstanding.push({ price, quantity: remaining });
    }

    for (const row of rows) {
      if (row.kind !== "add" || !row.productModelId) continue;
      const quantity = Number(row.quantity);
      const price = Number(row.proposedPrice);
      if (Number.isFinite(quantity) && quantity > 0 && row.proposedPrice !== "" && Number.isFinite(price) && price >= 0) {
        outstanding.push({ price: roundMoney(price), quantity });
      }
    }

    const { total: projectedTotal } = calculateOutstandingInvoiceTotal(outstanding, discountFactor);

    return {
      currentTotal,
      projectedTotal,
      delta: roundMoney(projectedTotal - currentTotal),
    };
  }, [invoice, lines, rows, type]);

  const toggleLineAction = (line: ChangeLine, action: string) => {
    setRows((current) => {
      const existing = current.find((row) => row.kind === "line" && row.invoiceItemId === line.id);
      if (!action) {
        return current.filter((row) => !(row.kind === "line" && row.invoiceItemId === line.id));
      }
      const next: ChangeRow = {
        key: existing?.key ?? nextKey(),
        kind: "line",
        action: action as LineAction,
        invoiceItemId: line.id,
        productUnitId: existing?.productUnitId,
        quantity: existing?.quantity ?? "",
        proposedPrice: existing?.proposedPrice ?? "",
      };
      return existing
        ? current.map((row) => (row.key === existing.key ? next : row))
        : [...current, next];
    });
  };

  const addAddRow = () =>
    setRows((current) => [
      ...current,
      {
        key: nextKey(),
        kind: "add",
        action: "ADD_ITEM",
        quantity: "1",
        proposedPrice: "",
      },
    ]);

  /**
   * A full return always targets every remaining unit on the invoice:
   * non-serialized lines by quantity, serialized lines by each active unit.
   */
  const buildFullReturnItems = (): { items: Record<string, unknown>[]; error?: string } => {
    const items: Record<string, unknown>[] = [];

    for (const line of lines) {
      const remaining = getRemainingQuantity(
        line.id,
        Number(line.quantity ?? 0),
        invoice?.returns,
      );
      if (remaining <= 0) continue;

      if (line.productModel?.isSerialized) {
        const units = line.unitAssignments ?? [];
        if (units.length === 0) {
          return { items: [], error: t.changeRequestForm.errors.unitRequired };
        }
        for (const assignment of units) {
          items.push({
            action: "RETURN_ITEM",
            invoiceItemId: line.id,
            productUnitId: assignment.productUnitId,
          });
        }
      } else {
        items.push({
          action: "RETURN_ITEM",
          invoiceItemId: line.id,
          quantity: roundMoney(remaining),
        });
      }
    }

    return { items };
  };

  const buildPayload = (): { items: Record<string, unknown>[]; error?: string } => {
    if (type === "FULL_RETURN") {
      return buildFullReturnItems();
    }

    const items: Record<string, unknown>[] = [];

    for (const row of rows) {
      if (row.kind === "line") {
        const line = lines.find((item) => item.id === row.invoiceItemId);
        if (!line) continue;
        const serialized = Boolean(line.productModel?.isSerialized);

        if (row.action === "CHANGE_PRICE") {
          const remaining = getRemainingQuantity(line.id, Number(line.quantity ?? 0), invoice?.returns);
          if (remaining <= 0) {
            return { items, error: t.changeRequestForm.errors.fullyReturned };
          }
          const price = Number(row.proposedPrice);
          if (row.proposedPrice === "" || !Number.isFinite(price) || price < 0) {
            return { items, error: t.changeRequestForm.errors.priceRequired };
          }
          items.push({ action: "CHANGE_PRICE", invoiceItemId: line.id, proposedPrice: price });
          continue;
        }

        if (serialized) {
          if (!row.productUnitId) {
            return { items, error: t.changeRequestForm.errors.unitRequired };
          }
          items.push({ action: row.action, invoiceItemId: line.id, productUnitId: row.productUnitId });
        } else {
          const unit = line.productModel?.unit ?? "PIECE";
          const quantity = Number(row.quantity);
          const normalized = unit === "METER" ? Math.round(quantity * 100) / 100 : quantity;
          const remaining = getRemainingQuantity(line.id, Number(line.quantity ?? 0), invoice?.returns);
          const valid = Number.isFinite(quantity) && normalized > 0 && normalized <= remaining &&
            (unit === "METER" || Number.isInteger(normalized));
          if (!valid) {
            return { items, error: t.changeRequestForm.errors.quantityRequired };
          }
          items.push({ action: row.action, invoiceItemId: line.id, quantity: normalized });
        }
        continue;
      }

      const quantity = Number(row.quantity);
      const price = Number(row.proposedPrice);
      if (!row.productModelId) {
        return { items, error: t.changeRequestForm.errors.modelRequired };
      }
      const addModel = models.find((model) => model.id === row.productModelId);
      const addUnit = addModel?.unit ?? "PIECE";
      const normalizedAddQuantity = addUnit === "METER" ? Math.round(quantity * 100) / 100 : quantity;
      if (!Number.isFinite(quantity) || normalizedAddQuantity <= 0 ||
        (addUnit !== "METER" && !Number.isInteger(normalizedAddQuantity))) {
        return { items, error: t.changeRequestForm.errors.quantityRequired };
      }
      if (row.proposedPrice === "" || !Number.isFinite(price) || price < 0) {
        return { items, error: t.changeRequestForm.errors.priceRequired };
      }
      items.push({ action: "ADD_ITEM", productModelId: row.productModelId, quantity: normalizedAddQuantity, proposedPrice: price });
    }

    return { items };
  };

  const handleSubmit = async () => {
    setError("");
    if (!invoice) return;
    if (!reason.trim()) {
      setError(t.changeRequestForm.errors.reasonRequired);
      return;
    }
    if (rows.length === 0 && type !== "FULL_RETURN") {
      setError(t.changeRequestForm.errors.noChanges);
      return;
    }
    const { items, error: payloadError } = buildPayload();
    if (payloadError) {
      setError(payloadError);
      return;
    }
    if (items.length === 0) {
      setError(
        type === "FULL_RETURN"
          ? t.changeRequestForm.errors.nothingToReturn
          : t.changeRequestForm.errors.noChanges,
      );
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/invoices/${invoice.id}/change-requests`, {
        type,
        reason: reason.trim(),
        items,
      });
      notify.success(SUCCESS_MESSAGES.changeRequest.submitted);
      navigate(requestsPath);
    } catch (err) {
      setError(getFriendlyErrorMessage(err, t));
      notify.error(getFriendlyErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="state-block">
        <LoadingSpinner size={28} />
      </div>
    );
  }

  if (!invoiceId) {
    const options = invoices.map((row) => ({
      value: String(row.id),
      label: `${row.invoiceNumber} · ${row.customer?.name || t.invoices.customer}`,
    }));

    return (
      <div>
        <PageHeader title={t.changeRequestForm.title} subtitle={t.changeRequestForm.subtitle} />
        {pickerLoading ? (
          <div className="state-block">
            <LoadingSpinner size={28} />
          </div>
        ) : options.length === 0 ? (
          <p style={{ color: "var(--soft)" }}>{t.changeRequestForm.noEligibleInvoices}</p>
        ) : (
          <div style={{ maxWidth: 460, display: "flex", flexDirection: "column", gap: 14 }}>
            <Select
              label={t.changeRequestForm.selectInvoice}
              options={options}
              placeholder={t.changeRequestForm.selectInvoicePlaceholder}
              onChange={(event) => {
                const value = event.target.value;
                if (value) navigate(`${changeRequestBase}/${value}`);
              }}
            />
            <Button variant="secondary" onClick={() => navigate(requestsPath)}>
              {t.back}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!invoice) {
    return (
      <div>
        <PageHeader title={t.changeRequestForm.title} subtitle={t.changeRequestForm.subtitle} />
        <p style={{ color: "var(--soft)" }}>{t.invoices.invoiceNotFound}</p>
        <Button variant="secondary" onClick={() => navigate(invoicesPath)}>
          {t.invoices.backToSearch}
        </Button>
      </div>
    );
  }

  const typeOptions = [
    { value: "EDIT", label: t.changeRequestForm.typeEdit },
    { value: "PARTIAL_RETURN", label: t.changeRequestForm.typePartialReturn },
    { value: "FULL_RETURN", label: t.changeRequestForm.typeFullReturn },
  ];

  const actionOptions = [
    { value: "", label: t.changeRequestForm.noChange },
    { value: "RETURN_ITEM", label: t.changeRequestForm.actionReturn },
    { value: "REMOVE_ITEM", label: t.changeRequestForm.actionRemove },
    { value: "CHANGE_PRICE", label: t.changeRequestForm.actionChangePrice },
  ];

  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    background: "var(--card)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };

  return (
    <div>
      <PageHeader
        title={t.changeRequestForm.title}
        subtitle={`${invoice.invoiceNumber} · ${invoice.customer?.name || ""}`}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 }}>
        <div style={{ ...cardStyle, gap: 12 }}>
          <Select
            label={t.changeRequestForm.type}
            options={typeOptions}
            value={type}
            onChange={(event) => setType(event.target.value as RequestType)}
          />
          <label
            style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
            htmlFor="change-reason"
          >
            {t.changeRequestForm.reason}*
          </label>
          <textarea
            id="change-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t.changeRequestForm.reasonPlaceholder}
            rows={3}
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontSize: "14px",
              color: "var(--ink)",
              backgroundColor: "var(--card)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 12px",
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>

        {type === "FULL_RETURN" ? (
          <div style={cardStyle}>
            <strong style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14 }}>
              {t.changeRequestForm.fullReturnTitle}
            </strong>
            <small style={{ color: "var(--soft)", fontSize: 12 }}>
              {t.changeRequestForm.fullReturnHint}
            </small>

            {lines.map((line) => {
              const remaining = getRemainingQuantity(
                line.id,
                Number(line.quantity ?? 0),
                invoice.returns,
              );
              if (remaining <= 0) return null;
              const serialized = Boolean(line.productModel?.isSerialized);
              const units = (line.unitAssignments ?? []).length;

              return (
                <div
                  key={line.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--border-strong)",
                  }}
                >
                  <span style={{ fontSize: 14 }}>
                    {line.productModel?.name || `#${line.id}`}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--soft)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {serialized
                      ? `${units} ${t.changeRequestForm.unit}`
                      : `${t.changeRequestForm.quantity} ${remaining}`}
                  </span>
                </div>
              );
            })}

            {lines.every(
              (line) =>
                getRemainingQuantity(
                  line.id,
                  Number(line.quantity ?? 0),
                  invoice.returns,
                ) <= 0,
            ) && (
              <small style={{ color: "var(--soft)", fontSize: 13 }}>
                {t.changeRequestForm.errors.nothingToReturn}
              </small>
            )}
          </div>
        ) : (
          <>
        <div style={cardStyle}>
          <strong style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14 }}>
            {t.changeRequestForm.lines}
          </strong>

          {lines.map((line) => {
            const row = rows.find((candidate) => candidate.kind === "line" && candidate.invoiceItemId === line.id);
            const serialized = Boolean(line.productModel?.isSerialized);
            const currentPrice = getEffectivePrice(line);
            const remaining = getRemainingQuantity(line.id, Number(line.quantity ?? 0), invoice.returns);
            const units = line.unitAssignments ?? [];

            return (
              <div
                key={line.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-end",
                  gap: 12,
                  paddingBottom: 12,
                  borderBottom: "1px solid var(--border-strong)",
                }}
              >
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 14 }}>
                    {line.productModel?.name || `#${line.id}`}
                  </strong>
                  <small style={{ color: "var(--soft)", fontSize: 12 }}>
                    {t.invoices.qty} {line.quantity}
                    {remaining !== Number(line.quantity ?? 0) ? ` · ${t.changeRequestForm.remaining} ${remaining}` : ""}
                    {" · "}{t.currency} {money(Number(currentPrice))}
                  </small>
                </div>

                <div style={{ flex: "0 1 210px" }}>
                  <Select
                    label={t.changeRequestForm.action}
                    options={actionOptions}
                    value={row?.action ?? ""}
                    onChange={(event) => toggleLineAction(line, event.target.value)}
                    clearable={false}
                  />
                </div>

                {row?.action === "RETURN_ITEM" || row?.action === "REMOVE_ITEM" ? (
                  serialized ? (
                    <div style={{ flex: "0 1 220px" }}>
                      <Select
                        label={t.changeRequestForm.unit}
                        required
                        options={units.map((assignment) => ({
                          value: String(assignment.productUnitId),
                          label: assignment.productUnit?.barcode || String(assignment.productUnitId),
                        }))}
                        value={row.productUnitId ? String(row.productUnitId) : ""}
                        placeholder={t.changeRequestForm.selectUnitPlaceholder}
                        onChange={(event) =>
                          setRow(row.key, { productUnitId: event.target.value ? Number(event.target.value) : undefined })
                        }
                        error={row.productUnitId ? "" : undefined}
                      />
                    </div>
                  ) : (
                    <div style={{ flex: "0 1 130px" }}>
                      <Input
                        label={`${t.changeRequestForm.quantity} (max ${remaining})`}
                        type="number"
                        min={line.productModel?.unit === "METER" ? 0.01 : 1}
                        max={remaining}
                        step={line.productModel?.unit === "METER" ? "0.01" : "1"}
                        value={row.quantity}
                        onChange={(event) => setRow(row.key, { quantity: event.target.value })}
                      />
                    </div>
                  )
                ) : null}

                {row?.action === "CHANGE_PRICE" ? (
                  <div style={{ flex: "0 1 160px" }}>
                    <Input
                      label={t.changeRequestForm.newPrice}
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.proposedPrice}
                      onChange={(event) => setRow(row.key, { proposedPrice: event.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <strong style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14 }}>
              {t.changeRequestForm.addLine}
            </strong>
            <Button variant="secondary" onClick={addAddRow}>
              + {t.changeRequestForm.addLine}
            </Button>
          </div>

          {rows
            .filter((row) => row.kind === "add")
            .map((row) => {
              const addModel = models.find((m) => m.id === row.productModelId);
              const addUnit = addModel?.unit ?? "PIECE";
              return (
              <div
                key={row.key}
                style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}
              >
                <div style={{ flex: "1 1 240px" }}>
                  <Select
                    label={t.changeRequestForm.product}
                    required
                    options={models.map((model) => ({
                      value: String(model.id),
                      label: `${model.name}${model.isSerialized ? ` · ${t.invoices.serialized}` : ""}`,
                    }))}
                    value={row.productModelId ? String(row.productModelId) : ""}
                    placeholder={t.changeRequestForm.selectProductPlaceholder}
                    onChange={(event) =>
                      setRow(row.key, { productModelId: event.target.value ? Number(event.target.value) : undefined })
                    }
                  />
                </div>
                <div style={{ flex: "0 1 120px" }}>
                  <Input
                    label={`${t.changeRequestForm.quantity}${addModel ? ` (${t.uom[addUnit]})` : ""}`}
                    type="number"
                    min={addUnit === "METER" ? 0.01 : 1}
                    step={addUnit === "METER" ? "0.01" : "1"}
                    value={row.quantity}
                    onChange={(event) => setRow(row.key, { quantity: event.target.value })}
                  />
                </div>
                <div style={{ flex: "0 1 150px" }}>
                  <Input
                    label={t.changeRequestForm.newPrice}
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.proposedPrice}
                    onChange={(event) => setRow(row.key, { proposedPrice: event.target.value })}
                  />
                </div>
                <Button variant="quiet" onClick={() => removeRow(row.key)}>
                  {t.changeRequestForm.removeLine}
                </Button>
              </div>
              );
            })}
        </div>
          </>
        )}

        <div style={{ ...cardStyle, gap: 10 }}>
          <strong style={{ fontFamily: "'Manrope', sans-serif", fontSize: 14 }}>
            {t.changeRequestForm.projectedTotals}
          </strong>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--soft)" }}>
            <span>{t.changeRequestForm.currentTotal}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{t.currency} {money(projected?.currentTotal ?? 0)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700 }}>
            <span>{t.changeRequestForm.projectedTotal}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{t.currency} {money(projected?.projectedTotal ?? 0)}</span>
          </div>
          {projected && projected.delta !== 0 ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: projected.delta < 0 ? "var(--accent)" : "var(--mint-ink, var(--ink))",
              }}
            >
              <span>{t.changeRequestForm.projectedDelta}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {projected.delta > 0 ? "+" : ""}{money(projected.delta)}
              </span>
            </div>
          ) : null}
          <small style={{ color: "var(--soft)", fontSize: 12 }}>
            {t.changeRequestForm.projectedHint}
          </small>
        </div>

        {error ? (
          <p role="alert" style={{ color: "var(--accent)", margin: 0, fontSize: 13 }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            onClick={handleSubmit}
            disabled={submitting || (type !== "FULL_RETURN" && rows.length === 0)}
          >
            {submitting ? t.changeRequestForm.submitting : t.changeRequestForm.submit}
          </Button>
          <Button variant="secondary" onClick={() => navigate(requestsPath)}>
            {t.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
