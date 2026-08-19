import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  page,
  totalPages,
  total,
  onChange
}: {
  page: number;
  totalPages: number;
  total?: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <span>
        Page {page} of {totalPages}
        {typeof total === "number" ? ` · ${total.toLocaleString()} total` : ""}
      </span>
      <div className="pageControls">
        <button
          className="btn btnSm"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <button
          className="btn btnSm"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
