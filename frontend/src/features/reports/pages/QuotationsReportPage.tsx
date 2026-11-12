import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../../../lib/api";
import { isAbortError, useDebouncedValue } from "../../../hooks";
import { Card } from "../../../components/ui/Card";
import { Table } from "../../../components/ui/Table";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { Pagination } from "../../../components/ui/Pagination";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { EmptyState } from "../../../components/ui/EmptyState";
import DateRangePicker from "../../../components/ui/DateRangePicker";
import { useI18n } from "../../../i18n/context";
import {
  formatPrintCurrency,
  formatPrintNumber,
} from "../../printing/utils/formatters";
import { useQuotationColumns } from "../../quotations";
import { quotationStatusLabel } from "../../quotations";
import { useReportPrint } from "../hooks/useReportPrint";
import PrintButton from "../components/PrintButton";
import ExcelExportButton from "../components/ExcelExportButton";
import PrintHeader from "../components/PrintHeader";
import ReportPrintLimitWarning from "../components/ReportPrintLimitWarning";
import ReportKpiCard from "../components/ReportKpiCard";
import type {
  Quotation,
  QuotationListMeta,
  QuotationReportResponse,
  QuotationStatus,
} from "../../../types";

const STATUSES: QuotationStatus[] = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CONVERTED",
];

const EMPTY_META: QuotationListMeta = {
  page: 1,
  limit: 25,
  total: 0,
  totalPages: 1,
};

interface EmployeeOption {
  id: number;
  name: string;
}

interface ReportFilters {
  from: string;
  to: string;
  createdById: string;
  status: string;
  search: string;
}

interface QuotationExportRow {
  quotationNumber: string;
  customer: string;
  salesperson: string;
  date: string;
  validUntil: string;
  status: string;
  itemCount: number;
  subtotal: number;
  lineDiscount: number;
  discountPercentage: number;
  discountAmount: number;
  total: number;
  convertedInvoice: string;
}

function localDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return localDate(date);
}

export default function QuotationsReportPage() {
  const { t } = useI18n();
  const { printLimit, requestPrint, notifyReady, notifyFailed } = useReportPrint();

  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return localDate(date);
  });
  const [dateTo, setDateTo] = useState(() => localDate());
  const [createdById, setCreatedById] = useState("");
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [summary, setSummary] = useState<QuotationReportResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  const [rows, setRows] = useState<Quotation[]>([]);
  const [meta, setMeta] = useState<QuotationListMeta>(EMPTY_META);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState(false);

  const filters = useMemo<ReportFilters>(
    () => ({
      from: dateFrom,
      to: dateTo,
      createdById,
      status,
      search,
    }),
    [dateFrom, dateTo, createdById, status, search],
  );

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, createdById, status, search]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get("/employees", {
        params: { isActive: true, page: 1, limit: 200 },
        signal: controller.signal,
      })
      .then((res) => {
        if (controller.signal.aborted) return;
        const list = res.data?.data ?? res.data;
        setEmployees(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const requestParams = useCallback(
    (includePaging: boolean) => {
      const params: Record<string, string | number> = {
        from: filters.from,
        to: filters.to,
      };
      if (filters.createdById) params.createdById = filters.createdById;
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      if (includePaging) {
        if (printLimit) {
          params.all = 1;
        } else {
          params.page = page;
          params.limit = EMPTY_META.limit;
        }
      }
      return params;
    },
    [filters, page, printLimit],
  );

  useEffect(() => {
    const controller = new AbortController();
    setSummaryLoading(true);
    setSummaryError(false);
    api
      .get<QuotationReportResponse>("/quotations/report", {
        params: requestParams(false),
        signal: controller.signal,
      })
      .then((res) => {
        if (controller.signal.aborted) return;
        setSummary(res.data);
      })
      .catch((err) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setSummaryError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummaryLoading(false);
      });
    return () => controller.abort();
  }, [requestParams, reloadToken]);

  useEffect(() => {
    const controller = new AbortController();
    setRowsLoading(true);
    setRowsError(false);
    api
      .get<{ data: Quotation[]; meta: QuotationListMeta }>(
        "/quotations/report/details",
        { params: requestParams(true), signal: controller.signal },
      )
      .then((res) => {
        if (controller.signal.aborted) return;
        setRows(res.data.data ?? []);
        setMeta(res.data.meta ?? EMPTY_META);
      })
      .catch((err) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setRowsError(true);
        setRows([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRowsLoading(false);
      });
    return () => controller.abort();
  }, [requestParams, reloadToken]);

  // Fire the print-ready signal once both datasets have settled.
  const printNotifiedRef = useRef(false);
  const printFailedRef = useRef(false);

  useEffect(() => {
    if (!printLimit) {
      printNotifiedRef.current = false;
      printFailedRef.current = false;
      return;
    }
    if (!printFailedRef.current && (summaryError || rowsError)) {
      printFailedRef.current = true;
      notifyFailed();
      return;
    }
    if (
      !summaryLoading &&
      !rowsLoading &&
      !printNotifiedRef.current
    ) {
      printNotifiedRef.current = true;
      notifyReady();
    }
  }, [
    printLimit,
    summaryLoading,
    rowsLoading,
    summaryError,
    rowsError,
    notifyReady,
    notifyFailed,
  ]);

  const columns = useQuotationColumns();

  const statusOptions = useMemo(
    () => [
      { label: t.quotationReport.allStatuses, value: "" },
      ...STATUSES.map((value) => ({
        label: quotationStatusLabel(t, value),
        value,
      })),
    ],
    [t],
  );

  const employeeOptions = useMemo(
    () => [
      { label: t.quotationReport.allSalespeople, value: "" },
      ...employees.map((employee) => ({
        label: employee.name,
        value: String(employee.id),
      })),
    ],
    [employees, t],
  );

  const visibleFilters = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    const employee = employees.find(
      (item) => String(item.id) === createdById,
    );
    if (employee) {
      list.push({ label: t.quotationReport.salesperson, value: employee.name });
    }
    if (status) {
      list.push({
        label: t.status,
        value: quotationStatusLabel(t, status as QuotationStatus),
      });
    }
    if (search) {
      list.push({ label: t.search, value: search });
    }
    return list;
  }, [employees, createdById, status, search, t]);

  const toExportRow = useCallback(
    (row: Quotation): QuotationExportRow => ({
      quotationNumber: row.quotationNumber,
      customer: row.customerName,
      salesperson: row.createdBy?.name ?? "",
      date: dateOnly(row.date),
      validUntil: dateOnly(row.validUntil),
      status: quotationStatusLabel(t, row.effectiveStatus),
      itemCount: row.itemCount ?? row.items?.length ?? 0,
      subtotal: Number(row.subtotal) || 0,
      lineDiscount: Number(row.lineDiscountTotal) || 0,
      discountPercentage: Number(row.discountPercentage) || 0,
      discountAmount: Number(row.discountAmount) || 0,
      total: Number(row.total) || 0,
      convertedInvoice: row.convertedInvoice?.invoiceNumber ?? "",
    }),
    [t],
  );

  const loadAllRows = useCallback(async (): Promise<
    readonly QuotationExportRow[]
  > => {
    const res = await api.get<{ data: Quotation[] }>(
      "/quotations/report/details",
      { params: { ...requestParams(false), all: 1 } },
    );
    return (res.data.data ?? []).map(toExportRow);
  }, [requestParams, toExportRow]);

  const exportRows = useMemo(() => rows.map(toExportRow), [rows, toExportRow]);

  const data = summary;

  const retrySummary = useCallback(() => {
    setSummaryError(false);
    setRowsError(false);
    setReloadToken((token) => token + 1);
  }, []);

  return (
    <div>
      <div
        className="no-print toolbar"
        style={{ marginBottom: "var(--section-gap)" }}
      >
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
        />
        <div className="toolbar-fixed">
          <Select
            aria-label={t.quotationReport.salesperson}
            options={employeeOptions}
            value={createdById}
            onChange={(event) => setCreatedById(event.target.value)}
          />
        </div>
        <div className="toolbar-fixed">
          <Select
            aria-label={t.status}
            options={statusOptions}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          />
        </div>
        <div className="toolbar-grow">
          <Input
            aria-label={t.quotationReport.searchPlaceholder}
            placeholder={t.quotationReport.searchPlaceholder}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <PrintButton onClick={requestPrint} />
        <ExcelExportButton
          filename="quotations-report"
          rows={exportRows}
          loadRows={loadAllRows}
          sheetName={t.quotationReport.title}
        />
      </div>

      <div className="print-area">
        <PrintHeader
          titleEn={t.quotationReport.title}
          titleAr={t.quotationReport.title}
          range={{ from: dateFrom, to: dateTo }}
          filters={visibleFilters}
        />
        <ReportPrintLimitWarning
          limit={printLimit}
          total={meta.total}
        />

        {summaryLoading ? (
          <div className="state-block">
            <LoadingSpinner size={32} />
          </div>
        ) : summaryError ? (
          <EmptyState
            title={t.reports.failedToLoadData}
            description={t.errors.common.connectionIssue}
            action={
              <button
                type="button"
                className="badge badge-brand"
                onClick={retrySummary}
                style={{
                  border: "none",
                  cursor: "pointer",
                  padding: "8px 16px",
                }}
              >
                {t.reports.retry}
              </button>
            }
          />
        ) : !data ? (
          <EmptyState title={t.quotationReport.noData} />
        ) : (
          <>
            <div
              className="report-card form-grid"
              style={{ gap: "12px", marginBottom: "var(--section-gap)" }}
            >
              <ReportKpiCard
                label={t.quotationReport.totalQuotations}
                value={formatPrintNumber(data.summary.totalCount, {
                  decimals: 0,
                })}
                color="var(--brand)"
              />
              <ReportKpiCard
                label={t.quotationReport.quotedValue}
                value={formatPrintCurrency(data.summary.quotedValue, t.currency)}
                color="var(--mint)"
              />
              <ReportKpiCard
                label={t.quotationReport.convertedCount}
                value={formatPrintNumber(data.summary.convertedCount, {
                  decimals: 0,
                })}
                color="var(--accent)"
              />
              <ReportKpiCard
                label={t.quotationReport.convertedValue}
                value={formatPrintCurrency(data.summary.convertedValue, t.currency)}
                color="var(--peach)"
              />
              <ReportKpiCard
                label={t.quotationReport.conversionRate}
                value={`${formatPrintNumber(data.summary.conversionRate, {
                  decimals: 1,
                })}%`}
                color="var(--brand)"
              />
              <ReportKpiCard
                label={t.quotationReport.averageValue}
                value={formatPrintCurrency(data.summary.averageValue, t.currency)}
                color="var(--mint)"
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: "var(--section-gap)",
                marginBottom: "var(--section-gap)",
              }}
            >
              <Card title={t.quotationReport.byStatus} className="report-card">
                <Table
                  columns={[
                    {
                      key: "status",
                      label: t.status,
                      render: (row) => quotationStatusLabel(t, row.status),
                    },
                    {
                      key: "count",
                      label: t.quotationReport.count,
                      align: "right",
                      render: (row) => formatPrintNumber(row.count, { decimals: 0 }),
                    },
                    {
                      key: "value",
                      label: t.quotationReport.quotedValueColumn,
                      align: "right",
                      render: (row) =>
                        formatPrintCurrency(row.value, t.currency),
                    },
                  ]}
                  data={data.byStatus}
                  emptyMessage={t.quotationReport.noData}
                />
              </Card>

              <Card
                title={t.quotationReport.bySalesperson}
                className="report-card"
              >
                <Table
                  columns={[
                    {
                      key: "employeeName",
                      label: t.quotationReport.salesperson,
                    },
                    {
                      key: "count",
                      label: t.quotationReport.count,
                      align: "right",
                      render: (row) => formatPrintNumber(row.count, { decimals: 0 }),
                    },
                    {
                      key: "quotedValue",
                      label: t.quotationReport.quotedValueColumn,
                      align: "right",
                      render: (row) =>
                        formatPrintCurrency(row.quotedValue, t.currency),
                    },
                    {
                      key: "convertedCount",
                      label: t.quotationReport.convertedCountColumn,
                      align: "right",
                      render: (row) =>
                        formatPrintNumber(row.convertedCount, { decimals: 0 }),
                    },
                    {
                      key: "conversionRate",
                      label: t.quotationReport.rate,
                      align: "right",
                      render: (row) =>
                        `${formatPrintNumber(row.conversionRate, { decimals: 1 })}%`,
                    },
                  ]}
                  data={data.bySalesperson}
                  emptyMessage={t.quotationReport.noData}
                />
              </Card>
            </div>
          </>
        )}

        <Card title={t.quotationReport.details} className="report-card">
          {rowsLoading ? (
            <div className="state-block">
              <LoadingSpinner size={24} />
            </div>
          ) : rowsError ? (
            <EmptyState
              title={t.reports.failedToLoadData}
              description={t.errors.common.connectionIssue}
            />
          ) : rows.length === 0 ? (
            <EmptyState title={t.quotationReport.noDetails} />
          ) : (
            <>
              <Table
                columns={columns}
                data={rows}
                getRowHref={(row) => `/admin/quotations/${row.id}`}
                keyExtractor={(row) => String(row.id)}
              />
              {!printLimit && (
                <div className="no-print">
                  <Pagination
                    currentStart={(meta.page - 1) * meta.limit + 1}
                    currentEnd={Math.min(meta.page * meta.limit, meta.total)}
                    total={meta.total}
                    currentPage={meta.page}
                    totalPages={meta.totalPages}
                    onPrev={() => setPage((current) => Math.max(1, current - 1))}
                    onNext={() =>
                      setPage((current) => Math.min(meta.totalPages, current + 1))
                    }
                  />
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
