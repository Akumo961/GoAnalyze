"use client";

import { useState } from "react";
import { DocumentFilters, type DocumentFiltersValue } from "@/components/search/SearchFilters";
import { DocumentTable } from "@/components/documents/DocumentTable";
import { Pagination } from "@/components/ui/Pagination";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyBlock, ErrorBlock, TableSkeleton } from "@/components/ui/States";
import { useSearch } from "@/hooks/useSearch";

const PAGE_SIZE = 20;

export default function SearchPage() {
  const { status, data, error, search } = useSearch();
  const [filters, setFilters] = useState<DocumentFiltersValue>({ q: "", classification: "", content_type: "" });
  const [hasSearched, setHasSearched] = useState(false);

  function runSearch(page = 1) {
    setHasSearched(true);
    search({
      q: filters.q,
      classification: filters.classification || undefined,
      content_type: filters.content_type || undefined,
      page,
      page_size: PAGE_SIZE
    });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <AppShell>
      <div className="pageHeading">
        <div>
          <h1>Search</h1>
          <p>
            Full-text document search with relevance ranking and highlighting, via{" "}
            <code className="mono">GET /v1/documents/search</code>.
          </p>
        </div>
      </div>

      <DocumentFilters value={filters} onChange={setFilters} onSubmit={() => runSearch(1)} />

      {!hasSearched && (
        <EmptyBlock title="Search across all documents" description="Enter a query or apply filters to get started." />
      )}
      {status === "loading" && <TableSkeleton rows={8} />}
      {status === "error" && <ErrorBlock error={error} onRetry={() => runSearch(data?.page ?? 1)} />}
      {status === "success" && data && data.results.length === 0 && (
        <EmptyBlock title="No results" description="Try broadening your query or clearing filters." />
      )}
      {status === "success" && data && data.results.length > 0 && (
        <>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
            {data.total.toLocaleString()} result(s) for &ldquo;{data.query || "(all documents)"}&rdquo; via {data.backend}
          </p>
          <DocumentTable results={data.results} />
          <Pagination page={data.page} totalPages={totalPages} total={data.total} onChange={runSearch} />
        </>
      )}
    </AppShell>
  );
}
