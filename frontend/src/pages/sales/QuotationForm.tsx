import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import api from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { notify } from "../../lib/notify";
import { getFriendlyErrorMessage } from "../../lib/messages";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { useI18n } from "../../i18n/context";
import {
  ALL_OPTIONS_LIMIT,
  useCustomerOptions,
  useInvalidateOptions,
} from "../../hooks";
import { getSuccessMessages } from "../../lib/success-messages";
import { calculateQuotationTotals, quotationLineGross, roundMoney } from "../../lib/quotationTotals";
import type { Customer, ProductModel, Quotation, UnitOfMeasure } from "../../types";
import {
  QuotationDocument,
  buildQuotationDocumentLabels,
  createQuotationPreviewData,
} from "../../features/quotations";

const FONT_UI = "'Manrope', sans-serif";
const NOTE_MAX_LENGTH = 1000;

type ModelWithCategory = ProductModel & {
  category?: { id: number; name: string } | null;
};

interface DraftLine {
  id: string;
  productModelId: number;
  name: string;
  unit: UnitOfMeasure;
  quantity: number;
  price: number;
  lineDiscount: number;
}

const smallInputStyle: CSSProperties = {
  fontFamily: FONT_UI,
  fontVariantNumeric: "tabular-nums",
  color: "var(--ink)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  backgroundColor: "var(--surface)",
  outline: "none",
  boxSizing: "border-box",
};

const numberCellStyle: CSSProperties = {
  fontFamily: FONT_UI,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function addDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateOnlyFromIso(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function QuotationForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();
  const isAdmin = user?.role === "ADMIN";
  const basePath = isAdmin ? "/admin" : "/sales";
  const numericId = id ? Number(id) : null;
  const isEdit = numericId !== null && Number.isFinite(numericId);

  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<"NOT_FOUND" | "NOT_EDITABLE" | null>(null);
  const [existing, setExisting] = useState<Quotation | null>(null);

  const [models, setModels] = useState<ModelWithCategory[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerFallback, setCustomerFallback] = useState<Customer | null>(null);

  // create-customer modal (same flow as the invoice page)
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerType, setNewCustomerType] = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomerNameError, setNewCustomerNameError] = useState("");

  const [items, setItems] = useState<DraftLine[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [itemQuantity, setItemQuantity] = useState("1");
  const [itemPrice, setItemPrice] = useState("");
  const [itemLineDiscount, setItemLineDiscount] = useState("");

  const [date, setDate] = useState(localToday);
  const [validUntil, setValidUntil] = useState(() => addDays(localToday(), 14));
  const [notes, setNotes] = useState("");
  const [discountPercentage, setDiscountPercentage] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: customerOptions = [] } = useCustomerOptions("");
  const invalidateOptions = useInvalidateOptions();
  const SUCCESS_MESSAGES = useMemo(() => getSuccessMessages(t), [t]);

  const employeeName = useMemo(() => {
    if (existing?.createdBy?.name) return existing.createdBy.name;
    return `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();
  }, [existing, user]);

  // ---------- loading ----------
  useEffect(() => {
    const controller = new AbortController();
    api
      .get("/product-models", {
        params: { page: 1, limit: ALL_OPTIONS_LIMIT },
        signal: controller.signal,
      })
      .then((res) => {
        if (controller.signal.aborted) return;
        const payload = res.data?.data ?? res.data;
        setModels(Array.isArray(payload) ? payload : []);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setFormError(getFriendlyErrorMessage(err, t, t.errors.common.connectionIssue));
      });
    return () => controller.abort();
  }, [t]);

  useEffect(() => {
    if (!isEdit || numericId === null) return;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get<Quotation>(`/quotations/${numericId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        const isOwner = data.createdById === user?.id;
        if (data.status !== "DRAFT") {
          setLoadError("NOT_EDITABLE");
          return;
        }
        if (!isAdmin && !isOwner) {
          setLoadError("NOT_EDITABLE");
          return;
        }

        setExisting(data);
        setCustomerId(data.customerId);
        if (data.customer) {
          setCustomerFallback({
            id: data.customer.id,
            name: data.customer.name,
            phone: data.customer.phone ?? undefined,
            type: "INDIVIDUAL",
            isActive: true,
            deletedAt: null,
            createdAt: data.createdAt,
          });
        }
        setDate(dateOnlyFromIso(data.date) || localToday());
        setValidUntil(dateOnlyFromIso(data.validUntil) || addDays(localToday(), 14));
        setNotes(data.notes ?? "");
        setDiscountPercentage(
          Number(data.discountPercentage) > 0 ? String(data.discountPercentage) : "",
        );
        setDiscountAmount(Number(data.discountAmount) > 0 ? String(data.discountAmount) : "");
        setItems(
          data.items.map((item) => ({
            id: `item-${item.id}`,
            productModelId: item.productModelId,
            name: item.productName,
            unit: (item.unit === "METER" ? "METER" : "PIECE") as UnitOfMeasure,
            quantity: Number(item.quantity),
            price: Number(item.price),
            lineDiscount: Number(item.lineDiscount),
          })),
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        if (isAxiosError(err) && err.response?.status === 404) {
          setLoadError("NOT_FOUND");
        } else {
          setFormError(getFriendlyErrorMessage(err, t, t.errors.common.connectionIssue));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [isEdit, numericId, isAdmin, user?.id, t]);

  // Auto-clear transient form errors.
  useEffect(() => {
    if (!formError) return;
    const timer = setTimeout(() => setFormError(null), 6000);
    return () => clearTimeout(timer);
  }, [formError]);

  // ---------- derived data ----------
  const selectedCustomer = useMemo<Customer | null>(() => {
    if (customerId === null) return null;
    return (
      customerOptions.find((customer) => customer.id === customerId) ??
      (customerFallback?.id === customerId ? customerFallback : null)
    );
  }, [customerId, customerOptions, customerFallback]);

  const customerSelectOptions = useMemo(() => {
    const options = customerOptions.map((customer) => ({
      value: String(customer.id),
      label: customer.phone ? `${customer.name} — ${customer.phone}` : customer.name,
    }));
    if (
      customerFallback &&
      !options.some((option) => option.value === String(customerFallback.id))
    ) {
      options.unshift({
        value: String(customerFallback.id),
        label: customerFallback.phone
          ? `${customerFallback.name} — ${customerFallback.phone}`
          : customerFallback.name,
      });
    }
    return options;
  }, [customerOptions, customerFallback]);

  const categoryOptions = useMemo(() => {
    const unique = new Map<number, string>();
    for (const model of models) {
      if (model.category) unique.set(model.category.id, model.category.name);
    }
    return Array.from(unique.entries()).map(([categoryId, name]) => ({
      value: String(categoryId),
      label: name,
    }));
  }, [models]);

  const modelOptions = useMemo(
    () =>
      models
        .filter((model) => !selectedCategoryId || String(model.category?.id) === selectedCategoryId)
        .map((model) => ({ value: String(model.id), label: model.name })),
    [models, selectedCategoryId],
  );

  const selectedModel = models.find((model) => String(model.id) === selectedModelId);

  const totals = useMemo(
    () =>
      calculateQuotationTotals(
        items.map((item) => ({
          price: item.price,
          quantity: item.quantity,
          lineDiscount: item.lineDiscount,
        })),
        Number(discountPercentage) || 0,
        Number(discountAmount) || 0,
      ),
    [items, discountPercentage, discountAmount],
  );

  const previewData = useMemo(
    () =>
      createQuotationPreviewData(
        {
          quotationNumber: existing?.quotationNumber ?? "",
          date: date || localToday(),
          validUntil: validUntil || date || localToday(),
          customerName: selectedCustomer?.name ?? existing?.customerName ?? "",
          customerPhone: selectedCustomer?.phone ?? existing?.customerPhone ?? null,
          employeeName,
          notes,
          discountPercentage: Number(discountPercentage) || 0,
          discountAmount: Number(discountAmount) || 0,
          items: items.map((item) => ({
            id: item.id,
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            price: item.price,
            lineDiscount: item.lineDiscount,
          })),
        },
        t.quotations.previewNotSaved,
      ),
    [
      existing,
      date,
      validUntil,
      selectedCustomer,
      employeeName,
      notes,
      discountPercentage,
      discountAmount,
      items,
      t.quotations.previewNotSaved,
    ],
  );

  const documentLabels = useMemo(() => buildQuotationDocumentLabels(t), [t]);

  // ---------- validation ----------
  const percentageValid =
    discountPercentage.trim() === "" ||
    (Number.isFinite(Number(discountPercentage)) &&
      Number(discountPercentage) >= 0 &&
      Number(discountPercentage) <= 100);

  const amountValid =
    discountAmount.trim() === "" ||
    (Number.isFinite(Number(discountAmount)) && Number(discountAmount) >= 0);

  const itemsValid =
    items.length > 0 &&
    items.every(
      (item) =>
        Number.isFinite(item.quantity) &&
        item.quantity > 0 &&
        Number.isFinite(item.price) &&
        item.price >= 0 &&
        item.lineDiscount >= 0 &&
        item.lineDiscount <= quotationLineGross(item) + 0.001,
    );

  const canSave =
    customerId !== null &&
    itemsValid &&
    Boolean(validUntil) &&
    percentageValid &&
    amountValid &&
    !saving;

  const addDisabled =
    !selectedModel ||
    !(Number(itemQuantity) > 0) ||
    itemPrice.trim() === "" ||
    Number(itemPrice) < 0;

  // ---------- handlers ----------
  const handleAddItem = () => {
    setFormError(null);
    if (!selectedModel) return;

    const rawQuantity = Number(itemQuantity);
    if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
      setFormError(t.quotations.invalidQuantity);
      return;
    }
    const quantity =
      selectedModel.unit === "METER"
        ? roundMoney(rawQuantity)
        : Math.max(1, Math.trunc(rawQuantity));

    const price = Number(itemPrice);
    if (!Number.isFinite(price) || price < 0) {
      setFormError(t.quotations.invalidPrice);
      return;
    }

    const lineDiscount = Math.max(0, Number(itemLineDiscount) || 0);
    const gross = roundMoney(price * quantity);
    if (lineDiscount > gross) {
      setFormError(t.quotations.lineDiscountTooLarge);
      return;
    }

    setItems((previous) => {
      const index = previous.findIndex(
        (item) => item.productModelId === selectedModel.id,
      );
      if (index >= 0) {
        return previous.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                quantity: roundMoney(item.quantity + quantity),
              }
            : item,
        );
      }
      return [
        ...previous,
        {
          id: `line-${selectedModel.id}-${Date.now()}`,
          productModelId: selectedModel.id,
          name: selectedModel.name,
          unit: (selectedModel.unit ?? "PIECE") as UnitOfMeasure,
          quantity,
          price,
          lineDiscount,
        },
      ];
    });

    setSelectedModelId("");
    setItemQuantity("1");
    setItemPrice("");
    setItemLineDiscount("");
  };

  const updateLine = useCallback((lineId: string, patch: Partial<DraftLine>) => {
    setItems((previous) =>
      previous.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    );
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setItems((previous) => previous.filter((line) => line.id !== lineId));
  }, []);

  const handleCreateCustomer = async () => {
    if (!newCustomerName.trim()) {
      setNewCustomerNameError(t.errors.common.required);
      return;
    }
    setNewCustomerNameError("");
    setCreatingCustomer(true);
    try {
      const { data } = await api.post<Customer>("/customers", {
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || undefined,
        type: newCustomerType,
      });
      setCustomerId(data.id);
      setCustomerFallback(data);
      setShowCreateCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerType("INDIVIDUAL");
      void invalidateOptions.customers();
      notify.success(SUCCESS_MESSAGES.customer.added);
    } catch (err) {
      notify.error(getFriendlyErrorMessage(err, t));
    } finally {
      setCreatingCustomer(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setFormError(null);

    if (customerId === null) {
      setFormError(t.quotations.customerRequired);
      return;
    }
    if (items.length === 0) {
      setFormError(t.quotations.itemsRequired);
      return;
    }
    if (!validUntil) {
      setFormError(t.quotations.validUntilRequired);
      return;
    }
    if (!itemsValid) {
      setFormError(t.quotations.lineDiscountTooLarge);
      return;
    }

    const payload = {
      customerId,
      validUntil,
      notes: notes.trim(),
      discountPercentage: Number(discountPercentage) || 0,
      discountAmount: Number(discountAmount) || 0,
      items: items.map((item) => ({
        productModelId: item.productModelId,
        quantity: item.quantity,
        price: item.price,
        lineDiscount: item.lineDiscount,
      })),
    };

    setSaving(true);
    try {
      const { data } = isEdit && numericId !== null
        ? await api.patch<Quotation>(`/quotations/${numericId}`, payload)
        : await api.post<Quotation>("/quotations", payload);
      notify.success(
        isEdit ? t.quotations.success.updated : t.quotations.success.created,
      );
      navigate(`${basePath}/quotations/${data.id}`);
    } catch (err) {
      if (import.meta.env.DEV && isAxiosError(err)) {
        console.error("[quotationSave] rejected:", err.response?.status, err.response?.data);
      }
      const message = getFriendlyErrorMessage(
        err,
        t,
        t.errors.common.unexpectedError,
      );
      setFormError(message);
      notify.error(message);
    } finally {
      setSaving(false);
    }
  };

  // ---------- early states ----------
  if (loading) {
    return (
      <div className="state-block">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  if (loadError) {
    return (
      <EmptyState
        title={loadError === "NOT_FOUND" ? t.quotations.notFound : t.quotations.cannotEdit}
        description={
          loadError === "NOT_FOUND" ? t.quotations.notFoundHint : t.quotations.cannotEditHint
        }
        action={
          <Button variant="secondary" onClick={() => navigate(`${basePath}/quotations`)}>
            {t.quotations.backToList}
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? t.quotations.editQuotation : t.quotations.newQuotation}
        subtitle={isEdit ? existing?.quotationNumber : t.pages.quotationsSubtitle}
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              navigate(
                isEdit && numericId !== null
                  ? `${basePath}/quotations/${numericId}`
                  : `${basePath}/quotations`,
              )
            }
          >
            {isEdit ? t.cancel : t.quotations.backToList}
          </Button>
        }
      />

      <div className="quotation-form-layout">
        <div className="quotation-form-fields">
          {/* Customer + dates */}
          <Card>
            <div className="form-grid">
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <Select
                  label={t.quotations.customer}
                  options={customerSelectOptions}
                  placeholder={t.quotations.selectCustomer}
                  searchablePlaceholder={t.quotations.searchCustomer}
                  value={customerId === null ? "" : String(customerId)}
                  onChange={(event) =>
                    setCustomerId(event.target.value ? Number(event.target.value) : null)
                  }
                  required
                />
                <button
                  type="button"
                  onClick={() => {
                    setNewCustomerNameError("");
                    setShowCreateCustomer(true);
                  }}
                  style={{
                    alignSelf: "flex-start",
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    fontFamily: FONT_UI,
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--brand)",
                    cursor: "pointer",
                  }}
                >
                  {t.newInvoice.createNewCustomer}
                </button>
              </div>

              <Input
                type="date"
                label={t.quotations.validUntil}
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
                required
              />
            </div>

            {selectedCustomer?.phone && (
              <p style={{ margin: "10px 0 0", fontSize: "12px", color: "var(--soft)" }} dir="ltr">
                {selectedCustomer.phone}
              </p>
            )}
            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--soft)" }}>
              {t.quotations.validUntilHint}
            </p>
          </Card>

          {/* Add item */}
          <Card title={t.quotations.items}>
            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: "1 1 140px", minWidth: "120px" }}>
                <Select
                  aria-label={t.quotations.selectCategory}
                  options={categoryOptions}
                  placeholder={t.quotations.selectCategory}
                  value={selectedCategoryId}
                  onChange={(event) => {
                    setSelectedCategoryId(event.target.value);
                    setSelectedModelId("");
                    setItemPrice("");
                  }}
                />
              </div>
              <div style={{ flex: "2 1 180px", minWidth: "160px" }}>
                <Select
                  aria-label={t.quotations.selectModel}
                  options={modelOptions}
                  placeholder={t.quotations.selectModel}
                  value={selectedModelId}
                  onChange={(event) => {
                    const modelId = event.target.value;
                    const model = models.find((item) => String(item.id) === modelId);
                    setSelectedModelId(modelId);
                    setItemPrice(model?.lastPrice ? String(model.lastPrice.price) : "");
                  }}
                />
              </div>
              <div style={{ flex: "1 1 80px" }}>
                <Input
                  type="number"
                  aria-label={t.quotations.quantity}
                  placeholder={t.quotations.quantity}
                  min={selectedModel?.unit === "METER" ? "0.01" : "1"}
                  step={selectedModel?.unit === "METER" ? "0.01" : "1"}
                  value={itemQuantity}
                  onChange={(event) => setItemQuantity(event.target.value)}
                />
              </div>
              <div style={{ flex: "1 1 100px" }}>
                <Input
                  type="number"
                  aria-label={t.quotations.price}
                  placeholder={t.quotations.price}
                  min="0"
                  step="0.01"
                  value={itemPrice}
                  onChange={(event) => setItemPrice(event.target.value)}
                />
              </div>
              <div style={{ flex: "1 1 100px" }}>
                <Input
                  type="number"
                  aria-label={t.quotations.lineDiscount}
                  placeholder={t.quotations.lineDiscount}
                  min="0"
                  step="0.01"
                  value={itemLineDiscount}
                  onChange={(event) => setItemLineDiscount(event.target.value)}
                />
              </div>
              <Button onClick={handleAddItem} disabled={addDisabled}>
                {t.quotations.addLine}
              </Button>
            </div>

            {selectedModel && (
              <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--soft)" }}>
                {t.uom[selectedModel.unit ?? "PIECE"]}
              </p>
            )}

            {formError && (
              <div
                role="alert"
                style={{
                  marginTop: "12px",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  backgroundColor: "var(--accent-bg)",
                  color: "var(--accent)",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                {formError}
              </div>
            )}
          </Card>

          {/* Lines */}
          <Card>
            {items.length === 0 ? (
              <p style={{ margin: 0, textAlign: "center", color: "var(--soft)", padding: "20px 0" }}>
                {t.quotations.emptyItems}
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 680,
                    borderCollapse: "collapse",
                    fontSize: "13px",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={{ textAlign: "start", padding: "6px 8px", fontSize: "11px", color: "var(--soft)" }}>
                        {t.quotations.product}
                      </th>
                      <th style={{ textAlign: "center", padding: "6px 8px", fontSize: "11px", color: "var(--soft)" }}>
                        {t.quotations.quantity}
                      </th>
                      <th style={{ textAlign: "end", padding: "6px 8px", fontSize: "11px", color: "var(--soft)" }}>
                        {t.quotations.price}
                      </th>
                      <th style={{ textAlign: "end", padding: "6px 8px", fontSize: "11px", color: "var(--soft)" }}>
                        {t.quotations.lineDiscount}
                      </th>
                      <th style={{ textAlign: "end", padding: "6px 8px", fontSize: "11px", color: "var(--soft)" }}>
                        {t.quotations.lineTotal}
                      </th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((line) => (
                      <tr key={line.id}>
                        <td style={{ padding: "8px", fontWeight: 600 }}>
                          {line.name}
                          <span style={{ display: "block", fontSize: "11px", color: "var(--soft)", fontWeight: 400 }}>
                            {t.uom[line.unit]}
                          </span>
                        </td>
                        <td style={{ padding: "8px", textAlign: "center" }}>
                          <input
                            type="number"
                            aria-label={t.quotations.quantity}
                            min={line.unit === "METER" ? "0.01" : "1"}
                            step={line.unit === "METER" ? "0.01" : "1"}
                            value={line.quantity}
                            onChange={(event) => {
                              const next = Number(event.target.value);
                              updateLine(line.id, {
                                quantity: Number.isFinite(next) && next > 0 ? next : 0,
                              });
                            }}
                            style={{
                              ...smallInputStyle,
                              width: "68px",
                              padding: "4px 6px",
                              textAlign: "center",
                            }}
                          />
                        </td>
                        <td style={{ padding: "8px", textAlign: "end" }}>
                          <input
                            type="number"
                            aria-label={t.quotations.price}
                            min="0"
                            step="0.01"
                            value={line.price}
                            onChange={(event) =>
                              updateLine(line.id, {
                                price: Math.max(0, Number(event.target.value) || 0),
                              })
                            }
                            style={{
                              ...smallInputStyle,
                              width: "100px",
                              padding: "4px 8px",
                              textAlign: "end",
                            }}
                          />
                        </td>
                        <td style={{ padding: "8px", textAlign: "end" }}>
                          <input
                            type="number"
                            aria-label={t.quotations.lineDiscount}
                            min="0"
                            step="0.01"
                            value={line.lineDiscount}
                            onChange={(event) =>
                              updateLine(line.id, {
                                lineDiscount: Math.max(0, Number(event.target.value) || 0),
                              })
                            }
                            style={{
                              ...smallInputStyle,
                              width: "100px",
                              padding: "4px 8px",
                              textAlign: "end",
                            }}
                          />
                        </td>
                        <td style={{ ...numberCellStyle, padding: "8px", textAlign: "end" }}>
                          {roundMoney(quotationLineGross(line) - line.lineDiscount).toFixed(2)}
                        </td>
                        <td style={{ padding: "8px", textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            title={t.quotations.remove}
                            aria-label={t.quotations.remove}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--accent)",
                              lineHeight: 1,
                            }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Discounts + notes */}
          <Card>
            <div className="form-grid">
              <Input
                type="number"
                label={t.quotations.discountPercentage}
                min="0"
                max="100"
                step="0.01"
                value={discountPercentage}
                onChange={(event) => setDiscountPercentage(event.target.value)}
                error={percentageValid ? undefined : t.errors.common.invalidNumber}
              />
              <Input
                type="number"
                label={t.quotations.discountAmount}
                min="0"
                step="0.01"
                value={discountAmount}
                onChange={(event) => setDiscountAmount(event.target.value)}
                error={amountValid ? undefined : t.errors.common.invalidNumber}
              />
            </div>

            <div style={{ marginTop: "12px" }}>
              <label
                htmlFor="quotation-notes"
                style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}
              >
                {t.quotations.notes}
              </label>
              <textarea
                id="quotation-notes"
                dir="auto"
                rows={3}
                value={notes}
                maxLength={NOTE_MAX_LENGTH}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t.quotations.notesPlaceholder}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--card)",
                  color: "var(--ink)",
                  fontFamily: "'Cairo', sans-serif",
                  fontSize: "13px",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              <small style={{ display: "block", marginTop: "4px", textAlign: "end", color: "var(--soft)" }}>
                {notes.length}/{NOTE_MAX_LENGTH}
              </small>
            </div>
          </Card>

          {/* Totals + save */}
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--soft)" }}>
                <span>{t.quotations.subtotal}</span>
                <span style={numberCellStyle}>{totals.subtotal.toFixed(2)}</span>
              </div>
              {totals.lineDiscountTotal > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--soft)" }}>
                  <span>{t.quotations.lineDiscountTotal}</span>
                  <span style={numberCellStyle}>− {totals.lineDiscountTotal.toFixed(2)}</span>
                </div>
              )}
              {totals.percentageDiscount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--soft)" }}>
                  <span>
                    {t.quotations.discountPercentage} ({Number(discountPercentage) || 0}%)
                  </span>
                  <span style={numberCellStyle}>− {totals.percentageDiscount.toFixed(2)}</span>
                </div>
              )}
              {totals.fixedDiscount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--soft)" }}>
                  <span>{t.quotations.discountAmount}</span>
                  <span style={numberCellStyle}>− {totals.fixedDiscount.toFixed(2)}</span>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  borderTop: "1px solid var(--border)",
                  paddingTop: "10px",
                  marginTop: "4px",
                }}
              >
                <span style={{ fontWeight: 600 }}>{t.total}</span>
                <span style={{ fontSize: "22px", fontWeight: 800, ...numberCellStyle }} dir="ltr">
                  {t.currency} {totals.total.toFixed(2)}
                </span>
              </div>
            </div>

            <Button
              size="lg"
              loading={saving}
              disabled={!canSave}
              onClick={handleSave}
              style={{ width: "100%", marginTop: "14px" }}
            >
              {saving ? t.quotations.saving : isEdit ? t.quotations.saveChanges : t.quotations.saveDraft}
            </Button>
          </Card>
        </div>

        {/* Live print preview */}
        <aside className="quotation-form-preview" aria-label={t.quotations.preview}>
          <Card title={t.quotations.preview}>
            <div className="quotation-live-preview">
              <QuotationDocument
                data={previewData}
                labels={documentLabels}
                currency={t.currency}
                mode="preview"
              />
            </div>
          </Card>
        </aside>
      </div>

      {/* Create customer modal — same flow as invoice creation */}
      <Modal
        isOpen={showCreateCustomer}
        onClose={() => setShowCreateCustomer(false)}
        title={t.newInvoice.newCustomer}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreateCustomer(false)}>
              {t.cancel}
            </Button>
            <Button variant="primary" loading={creatingCustomer} onClick={handleCreateCustomer}>
              {t.create}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Input
            label={t.name}
            value={newCustomerName}
            onChange={(event) => {
              setNewCustomerName(event.target.value);
              setNewCustomerNameError("");
            }}
            placeholder={t.newInvoice.customerNamePlaceholder}
            error={newCustomerNameError}
          />
          <Input
            label={t.newInvoice.phoneOptional}
            value={newCustomerPhone}
            onChange={(event) => setNewCustomerPhone(event.target.value)}
            placeholder={t.newInvoice.phoneNumberPlaceholder}
          />
          <Select
            label={t.customers.type}
            value={newCustomerType}
            onChange={(event) =>
              setNewCustomerType(event.target.value as "INDIVIDUAL" | "COMPANY")
            }
            options={[
              { label: t.newInvoice.retail, value: "INDIVIDUAL" },
              { label: t.newInvoice.wholesale, value: "COMPANY" },
            ]}
          />
        </div>
      </Modal>
    </div>
  );
}
