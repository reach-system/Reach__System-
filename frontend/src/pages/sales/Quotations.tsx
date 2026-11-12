import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDebouncedValue, isAbortError } from "../../hooks";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Table } from "../../components/ui/Table";
import { Pagination } from "../../components/ui/Pagination";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { EmptyState } from "../../components/ui/EmptyState";
import DateRangePicker from "../../components/ui/DateRangePicker";
import { useI18n } from "../../i18n/context";
import { useRealtimeRefresh } from "../../hooks/useRealtimeEvents";
import { useQuotationColumns } from "../../features/quotations";
import type { Quotation, QuotationListResponse } from "../../types";

const STATUS_FILTERS = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

const isStatusFilter = (value: string): value is StatusFilter =>
  (STATUS_FILTERS as readonly string[]).includes(value);

const QUOTATION_EVENTS = [
  "quotation.created",
  "quotation.updated",
  "quotation.status",
  "quotation.revised",
  "quotation.converted",
  "quotation.deleted",
  "quotation.expired",
] as const;

export default function Quotations() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "ADMIN";
  const basePath = isAdmin ? "/admin" : "/sales";

  const [searchParams, setSearchParams] = useSearchParams();

  const rawStatus = searchParams.get("status") ?? "";
  const statusFilter: StatusFilter | "" = isStatusFilter(rawStatus) ? rawStatus : "";
  const search = searchParams.get("search") ?? "";
  const debouncedSearch = useDebouncedValue(search, 300);
  const dateFrom = searchParams.get("from") ?? "";
  const dateTo = searchParams.get("to") ?? "";
  const sortBy = searchParams.get("sortBy") ?? "date";
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);

  const setFilter = useCallback(
    (patch: Record<string, string>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(patch).forEach(([key, value]) => {
            if (value) next.set(key, value);
            else next.delete(key);
          });
          return next;
        },
        { replace: true },
      );
      setPage(1);
    },
    [setSearchParams],
  );

  const fetchQuotations = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(false);
      try {
        const params: Record<string, string | number> = {
          page,
          limit: 20,
          sortBy,
          sortDir,
        };
        if (debouncedSearch) params.search = debouncedSearch;
        if (statusFilter) params.status = statusFilter;
        if (dateFrom) params.from = dateFrom;
        if (dateTo) params.to = dateTo;
        const res = await api.get<QuotationListResponse>("/quotations", { params, signal });
        setQuotations(res.data.data ?? []);
        setMeta(res.data.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 });
      } catch (err) {
        if (isAbortError(err)) return;
        setError(true);
        setQuotations([]);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, debouncedSearch, statusFilter, dateFrom, dateTo, sortBy, sortDir],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchQuotations(controller.signal);
    return () => controller.abort();
  }, [fetchQuotations]);

  useRealtimeRefresh(() => {
    void fetchQuotations();
  }, QUOTATION_EVENTS);

  const handleSort = (columnKey: string) => {
    const nextDir = sortBy === columnKey && sortDir === "desc" ? "asc" : "desc";
    setFilter({ sortBy: columnKey, sortDir: nextDir });
  };

  const columns = useQuotationColumns();

  return (
    <div>
      <PageHeader
        title={t.pages.quotations}
        subtitle={t.pages.quotationsSubtitle}
        actions={
          <>
            {isAdmin && (
              <Button
                variant="secondary"
                onClick={() => navigate("/admin/reports/quotations")}
              >
                {t.nav.quotationReport}
              </Button>
            )}
            <Button onClick={() => navigate(`${basePath}/quotations/new`)}>
              {t.quotations.newQuotation}
            </Button>
          </>
        }
      />

      <div className="toolbar">
        <div className="toolbar-grow">
          <Input
            aria-label={t.quotations.searchPlaceholder}
            placeholder={t.quotations.searchPlaceholder}
            value={search}
            onChange={(e) => setFilter({ search: e.target.value })}
          />
        </div>
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(from, to) => setFilter({ from, to })}
        />
        <div className="toolbar-fixed">
          <Select
            aria-label={t.status}
            options={[
              { label: t.quotations.allStatuses, value: "" },
              { label: t.statusLabels.draft, value: "DRAFT" },
              { label: t.statusLabels.sent, value: "SENT" },
              { label: t.statusLabels.accepted, value: "ACCEPTED" },
              { label: t.statusLabels.rejected, value: "REJECTED" },
              { label: t.statusLabels.expired, value: "EXPIRED" },
              { label: t.statusLabels.converted, value: "CONVERTED" },
            ]}
            value={statusFilter}
            onChange={(e) => setFilter({ status: e.target.value })}
          />
        </div>
      </div>

      {loading ? (
        <div className="state-block">
          <LoadingSpinner size={28} />
        </div>
      ) : error ? (
        <EmptyState
          title={t.quotations.noQuotations}
          description={t.errors.common.connectionIssue}
          action={
            <Button variant="secondary" onClick={() => void fetchQuotations()}>
              {t.reports.retry}
            </Button>
          }
        />
      ) : quotations.length === 0 ? (
        <EmptyState
          title={t.quotations.noQuotations}
          description={
            debouncedSearch || statusFilter || dateFrom || dateTo
              ? t.quotations.tryDifferent
              : t.quotations.noQuotationsHint
          }
          action={
            <Button onClick={() => navigate(`${basePath}/quotations/new`)}>
              {t.quotations.newQuotation}
            </Button>
          }
        />
      ) : (
        <>
          <Table
            columns={columns}
            data={quotations}
            getRowHref={(quotation) => `${basePath}/quotations/${quotation.id}`}
            keyExtractor={(quotation) => String(quotation.id)}
            sortColumn={sortBy}
            sortDirection={sortDir}
            onSort={handleSort}
          />
          <Pagination
            currentStart={(meta.page - 1) * meta.limit + 1}
            currentEnd={Math.min(meta.page * meta.limit, meta.total)}
            total={meta.total}
            currentPage={meta.page}
            totalPages={meta.totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
          />
        </>
      )}
    </div>
  );
}
