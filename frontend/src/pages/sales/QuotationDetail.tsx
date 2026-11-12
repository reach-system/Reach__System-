import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { notify } from "../../lib/notify";
import { getFriendlyErrorMessage } from "../../lib/messages";
import { isAbortError } from "../../hooks";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { useI18n } from "../../i18n/context";
import { useRealtimeRefresh } from "../../hooks/useRealtimeEvents";
import { prepareAndPrint } from "../../features/printing/utils/printDocument";
import {
  formatPrintDate,
  formatPrintDateTime,
} from "../../features/printing/utils/formatters";
import { buildWhatsAppUrl } from "../../lib/quotationPhone";
import {
  QuotationDocument,
  QuotationStatusBadge,
  buildQuotationDocumentLabels,
  buildQuotationShareText,
  createQuotationDocumentData,
  quotationEventLabel,
  quotationStatusLabel,
} from "../../features/quotations";
import type { Quotation } from "../../types";

type PendingAction = "send" | "accept" | "reject" | "delete" | "revise" | "convert";

const QUOTATION_EVENTS = [
  "quotation.created",
  "quotation.updated",
  "quotation.status",
  "quotation.revised",
  "quotation.converted",
  "quotation.deleted",
  "quotation.expired",
] as const;

const bannerStyle: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: "var(--soft)", bg: "var(--bg-active)" },
  SENT: { color: "var(--peach)", bg: "var(--peach-bg)" },
  ACCEPTED: { color: "var(--mint)", bg: "var(--mint-bg)" },
  REJECTED: { color: "var(--accent)", bg: "var(--accent-bg)" },
  EXPIRED: { color: "var(--soft)", bg: "var(--bg-active)" },
  CONVERTED: { color: "var(--brand)", bg: "var(--brand-bg)" },
};

const BANNER_KEYS = {
  DRAFT: "draft",
  SENT: "sent",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EXPIRED: "expired",
  CONVERTED: "converted",
} as const;

export default function QuotationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();
  const isAdmin = user?.role === "ADMIN";
  const basePath = isAdmin ? "/admin" : "/sales";
  /** Sales and Admin use different invoice-detail routes. */
  const invoicePath = (invoiceId: number) =>
    isAdmin ? `/admin/invoices/${invoiceId}` : `/sales/invoice/${invoiceId}`;

  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [printRequestedAt, setPrintRequestedAt] = useState<Date | null>(null);
  const [reviseValidUntil, setReviseValidUntil] = useState("");
  const [reviseNotes, setReviseNotes] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!id) return;
      setLoading(true);
      setLoadError(null);
      try {
        const { data } = await api.get<Quotation>(`/quotations/${id}`, { signal });
        setQuotation(data);
        setNotFound(false);
      } catch (err) {
        if (isAbortError(err)) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          setNotFound(true);
          setQuotation(null);
        } else {
          setLoadError(getFriendlyErrorMessage(err, t, t.errors.common.connectionIssue));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id, t],
  );

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [id, load]);

  useRealtimeRefresh(() => {
    void load();
  }, QUOTATION_EVENTS);

  useEffect(() => {
    if (!printRequestedAt) return;
    const finishPrint = () => setPrintRequestedAt(null);
    window.addEventListener("afterprint", finishPrint);
    const timer = window.setTimeout(() => {
      void prepareAndPrint().catch(() => {
        setPrintRequestedAt(null);
        notify.error(t.reports.printPrepareFailed);
      });
    }, 100);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finishPrint);
    };
  }, [printRequestedAt, t.reports.printPrepareFailed]);

  const documentLabels = useMemo(() => buildQuotationDocumentLabels(t), [t]);

  const documentData = useMemo(
    () =>
      quotation
        ? createQuotationDocumentData(quotation, {
            printedAt: printRequestedAt ?? undefined,
            statusLabel: quotationStatusLabel(t, quotation.effectiveStatus),
          })
        : null,
    [quotation, printRequestedAt, t],
  );

  const shareText = useMemo(() => {
    if (!quotation) return "";
    return buildQuotationShareText(
      quotation,
      {
        message: t.quotations.shareMessage,
        line: t.quotations.shareLine,
        totals: t.quotations.shareTotals,
        totalsWithDiscount: t.quotations.shareTotalsWithDiscount,
      },
      t.currency,
    );
  }, [quotation, t]);

  const whatsappUrl = useMemo(
    () => (quotation ? buildWhatsAppUrl(quotation.customerPhone, shareText) : null),
    [quotation, shareText],
  );

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const canMutate = Boolean(
    quotation && (isAdmin || quotation.createdById === user?.id),
  );
  const status = quotation?.effectiveStatus ?? "DRAFT";

  const canEdit = canMutate && status === "DRAFT";
  const canSend = canMutate && status === "DRAFT";
  const canAccept = canMutate && status === "SENT";
  const canReject = canMutate && status === "SENT";
  const canRevise =
    canMutate && (status === "SENT" || status === "REJECTED" || status === "EXPIRED");
  const canConvert = canMutate && (status === "SENT" || status === "ACCEPTED");
  const canDelete = isAdmin && status !== "CONVERTED";

  const closeAction = () => {
    if (busy) return;
    setPendingAction(null);
    setActionError(null);
    setRejectReason("");
    setReviseNotes("");
    setReviseValidUntil("");
  };

  const openAction = (action: PendingAction) => {
    setActionError(null);
    if (action === "revise" && quotation) {
      setReviseValidUntil(
        new Date(quotation.validUntil).toISOString().slice(0, 10),
      );
      setReviseNotes("");
    }
    setPendingAction(action);
  };

  const handleAction = async () => {
    if (!quotation || !pendingAction || busy) return;
    setBusy(true);
    setActionError(null);

    try {
      switch (pendingAction) {
        case "send": {
          await api.patch(`/quotations/${quotation.id}/send`);
          notify.success(t.quotations.success.sent);
          break;
        }
        case "accept": {
          await api.patch(`/quotations/${quotation.id}/accept`);
          notify.success(t.quotations.success.accepted);
          break;
        }
        case "reject": {
          await api.patch(`/quotations/${quotation.id}/reject`, {
            reason: rejectReason.trim() || undefined,
          });
          notify.success(t.quotations.success.rejected);
          break;
        }
        case "delete": {
          await api.delete(`/quotations/${quotation.id}`);
          notify.success(t.quotations.success.deleted);
          navigate(`${basePath}/quotations`);
          return;
        }
        case "revise": {
          const { data } = await api.post<Quotation>(
            `/quotations/${quotation.id}/revise`,
            {
              validUntil: reviseValidUntil || undefined,
              notes: reviseNotes.trim() || undefined,
            },
          );
          notify.success(t.quotations.success.revised);
          navigate(`${basePath}/quotations/${data.id}`);
          return;
        }
        case "convert": {
          navigate(`${basePath}/new-invoice?fromQuotationId=${quotation.id}`);
          return;
        }
        default:
          break;
      }

      closeAction();
      await load();
    } catch (err) {
      const message = getFriendlyErrorMessage(err, t, t.errors.common.unexpectedError);
      setActionError(message);
      notify.error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    if (!quotation) return;
    if (!canShare) {
      notify.warning(t.quotations.shareUnavailable);
      return;
    }
    try {
      await navigator.share({
        title: `${t.quotations.documentTitle} ${quotation.quotationNumber}`,
        text: shareText,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      notify.error(t.quotations.shareUnavailable);
    }
  };

  const handleWhatsApp = () => {
    if (!whatsappUrl) {
      notify.warning(t.quotations.whatsappUnavailable);
      return;
    }
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return (
      <div className="state-block">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  if (notFound || !quotation || !documentData) {
    return (
      <EmptyState
        title={t.quotations.notFound}
        description={loadError ?? t.quotations.notFoundHint}
        action={
          <Button variant="secondary" onClick={() => navigate(`${basePath}/quotations`)}>
            {t.quotations.backToList}
          </Button>
        }
      />
    );
  }

  const banner = bannerStyle[status];
  const modalTitle =
    pendingAction === "send"
      ? t.quotations.confirm.sendTitle
      : pendingAction === "accept"
        ? t.quotations.confirm.acceptTitle
        : pendingAction === "reject"
          ? t.quotations.confirm.rejectTitle
          : pendingAction === "delete"
            ? t.quotations.confirm.deleteTitle
            : pendingAction === "revise"
              ? t.quotations.confirm.reviseTitle
              : t.quotations.confirm.convertTitle;

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title={`${t.quotations.quotationDetails} · ${quotation.quotationNumber}`}
          subtitle={quotation.customerName}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => navigate(`${basePath}/quotations`)}
              >
                {t.quotations.backToList}
              </Button>
              {canEdit && (
                <Button
                  variant="secondary"
                  onClick={() => navigate(`${basePath}/quotations/${quotation.id}/edit`)}
                >
                  {t.quotations.actions.edit}
                </Button>
              )}
              {canSend && (
                <Button onClick={() => openAction("send")}>
                  {t.quotations.actions.send}
                </Button>
              )}
              {canAccept && (
                <Button onClick={() => openAction("accept")}>
                  {t.quotations.actions.accept}
                </Button>
              )}
              {canReject && (
                <Button variant="secondary" onClick={() => openAction("reject")}>
                  {t.quotations.actions.reject}
                </Button>
              )}
              {canRevise && (
                <Button variant="secondary" onClick={() => openAction("revise")}>
                  {t.quotations.actions.revise}
                </Button>
              )}
              {canConvert && (
                <Button onClick={() => openAction("convert")}>
                  {t.quotations.actions.convert}
                </Button>
              )}
              {canDelete && (
                <Button variant="danger" onClick={() => openAction("delete")}>
                  {t.quotations.actions.delete}
                </Button>
              )}
            </>
          }
        />

        {/* Status banner */}
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            padding: "10px 14px",
            marginBottom: "var(--section-gap)",
            borderRadius: "var(--radius-md)",
            backgroundColor: banner.bg,
            color: banner.color,
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          <QuotationStatusBadge status={status} />
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>
            {t.quotations.banners[BANNER_KEYS[status]]}
          </span>
        </div>

        {/* Document actions */}
        <div className="toolbar">
          <Button variant="secondary" onClick={() => setPrintRequestedAt(new Date())}>
            {t.quotations.actions.print}
          </Button>
          <Button
            variant="secondary"
            onClick={handleWhatsApp}
            disabled={!whatsappUrl}
            title={!whatsappUrl ? t.quotations.whatsappUnavailable : undefined}
          >
            {t.quotations.actions.whatsapp}
          </Button>
          <Button variant="secondary" onClick={handleShare} disabled={!canShare}>
            {t.quotations.actions.share}
          </Button>
          {canConvert && <span style={{ fontSize: "12px", color: "var(--soft)" }}>{t.quotations.convertHint}</span>}
        </div>

        {/* Converted invoice / revisions links */}
        {(quotation.convertedInvoice || quotation.revisedFrom || (quotation.revisions?.length ?? 0) > 0) && (
          <Card title={t.quotations.revisions}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
              {quotation.revisedFrom && (
                <div>
                  <span style={{ color: "var(--soft)" }}>{t.quotations.revisedFrom}: </span>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`${basePath}/quotations/${quotation.revisedFrom!.id}`)
                    }
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "var(--brand)",
                      fontWeight: 600,
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    {quotation.revisedFrom.quotationNumber}
                  </button>
                </div>
              )}

              {quotation.revisions?.map((revision) => (
                <div key={revision.id} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => navigate(`${basePath}/quotations/${revision.id}`)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "var(--brand)",
                      fontWeight: 600,
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    {revision.quotationNumber}
                  </button>
                  <QuotationStatusBadge status={revision.status} />
                  <span style={{ color: "var(--soft)" }}>
                    {formatPrintDate(revision.date)}
                  </span>
                </div>
              ))}

              {quotation.convertedInvoice && (
                <div>
                  <span style={{ color: "var(--soft)" }}>{t.quotations.convertedInvoice}: </span>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(invoicePath(quotation.convertedInvoice!.id))
                    }
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "var(--brand)",
                      fontWeight: 600,
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    {quotation.convertedInvoice.invoiceNumber}
                  </button>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="quotation-detail-layout">
        <div className="print-area quotation-document-scroll">
          <QuotationDocument
            data={documentData}
            labels={documentLabels}
            currency={t.currency}
            mode="saved"
          />
        </div>

        <aside className="no-print" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {quotation.rejectedReason && (
            <Card title={t.quotations.confirm.rejectReason}>
              <p style={{ margin: 0 }} dir="auto">
                {quotation.rejectedReason}
              </p>
            </Card>
          )}

          <Card title={t.quotations.timeline}>
            {!quotation.events || quotation.events.length === 0 ? (
              <p style={{ margin: 0, color: "var(--soft)", fontSize: "13px" }}>
                {t.quotations.noTimeline}
              </p>
            ) : (
              <ol
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                {quotation.events.map((event) => (
                  <li
                    key={event.id}
                    style={{
                      borderInlineStart: "3px solid var(--brand)",
                      paddingInlineStart: "10px",
                    }}
                  >
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      <strong style={{ fontSize: "13px" }}>
                        {quotationEventLabel(t, event.type)}
                      </strong>
                      <span style={{ fontSize: "12px", color: "var(--soft)" }}>
                        {formatPrintDateTime(event.createdAt)}
                      </span>
                    </div>
                    {event.actor?.name && (
                      <div style={{ fontSize: "12px", color: "var(--soft)" }}>
                        {event.actor.name}
                      </div>
                    )}
                    {event.message && (
                      <p style={{ margin: "4px 0 0", fontSize: "12px" }} dir="auto">
                        {event.message}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title={t.quotations.revisions}>
            {!quotation.revisions || quotation.revisions.length === 0 ? (
              <p style={{ margin: 0, color: "var(--soft)", fontSize: "13px" }}>
                {t.quotations.noRevisions}
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                {quotation.revisions.map((revision) => (
                  <li key={revision.id} style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => navigate(`${basePath}/quotations/${revision.id}`)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "var(--brand)",
                        fontWeight: 600,
                        cursor: "pointer",
                        font: "inherit",
                      }}
                    >
                      {revision.quotationNumber}
                    </button>
                    <QuotationStatusBadge status={revision.status} />
                    <span style={{ fontSize: "12px", color: "var(--soft)" }}>
                      {formatPrintDate(revision.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {quotation.convertedInvoice && (
              <Button
                variant="secondary"
                size="sm"
                style={{ marginTop: "12px" }}
                onClick={() => navigate(invoicePath(quotation.convertedInvoice!.id))}
              >
                {t.quotations.viewInvoice}
              </Button>
            )}
          </Card>
        </aside>
      </div>

      <Modal
        isOpen={pendingAction !== null}
        onClose={closeAction}
        title={modalTitle}
        footer={
          <>
            <Button variant="secondary" onClick={closeAction} disabled={busy}>
              {t.quotations.confirm.cancel}
            </Button>
            <Button
              variant={pendingAction === "delete" ? "danger" : "primary"}
              loading={busy}
              onClick={handleAction}
            >
              {pendingAction === "convert"
                ? t.quotations.actions.convert
                : t.quotations.confirm.confirm}
            </Button>
          </>
        }
      >
        {pendingAction === "send" && <p style={{ margin: 0 }}>{t.quotations.confirm.sendBody}</p>}
        {pendingAction === "accept" && <p style={{ margin: 0 }}>{t.quotations.confirm.acceptBody}</p>}
        {pendingAction === "delete" && <p style={{ margin: 0 }}>{t.quotations.confirm.deleteBody}</p>}
        {pendingAction === "convert" && <p style={{ margin: 0 }}>{t.quotations.confirm.convertBody}</p>}

        {pendingAction === "reject" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ margin: 0 }}>{t.quotations.confirm.rejectBody}</p>
            <Input
              label={t.quotations.confirm.rejectReason}
              value={rejectReason}
              maxLength={500}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder={t.quotations.confirm.rejectReasonPlaceholder}
            />
          </div>
        )}

        {pendingAction === "revise" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ margin: 0 }}>{t.quotations.confirm.reviseBody}</p>
            <Input
              type="date"
              label={t.quotations.confirm.reviseValidUntil}
              value={reviseValidUntil}
              onChange={(event) => setReviseValidUntil(event.target.value)}
            />
            <Input
              label={t.quotations.confirm.reviseNotes}
              value={reviseNotes}
              maxLength={1000}
              onChange={(event) => setReviseNotes(event.target.value)}
            />
          </div>
        )}

        {actionError && (
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
            {actionError}
          </div>
        )}
      </Modal>
    </div>
  );
}
