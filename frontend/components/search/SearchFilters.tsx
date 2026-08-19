"use client";

import { Search as SearchIcon } from "lucide-react";
import { CLASSIFICATION_LEVELS } from "@/lib/types";
import { classificationLabel } from "@/lib/utils";

export interface DocumentFiltersValue {
  q: string;
  classification: string;
  content_type: string;
}

export function DocumentFilters({
  value,
  onChange,
  onSubmit
}: {
  value: DocumentFiltersValue;
  onChange: (value: DocumentFiltersValue) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="card"
      style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="formField" style={{ flex: "2 1 260px", marginBottom: 0 }}>
        <label htmlFor="q">Query</label>
        <input
          id="q"
          type="text"
          placeholder="Search document text, filenames, entities…"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
        />
      </div>
      <div className="formField" style={{ flex: "1 1 160px", marginBottom: 0 }}>
        <label htmlFor="classification">Classification</label>
        <select
          id="classification"
          value={value.classification}
          onChange={(e) => onChange({ ...value, classification: e.target.value })}
        >
          <option value="">All levels</option>
          {CLASSIFICATION_LEVELS.map((level) => (
            <option key={level} value={level}>
              {classificationLabel(level)}
            </option>
          ))}
        </select>
      </div>
      <div className="formField" style={{ flex: "1 1 160px", marginBottom: 0 }}>
        <label htmlFor="content_type">Content type</label>
        <input
          id="content_type"
          type="text"
          placeholder="application/pdf"
          value={value.content_type}
          onChange={(e) => onChange({ ...value, content_type: e.target.value })}
        />
      </div>
      <button type="submit" className="btn btnPrimary" style={{ marginBottom: 0 }}>
        <SearchIcon size={15} /> Search
      </button>
    </form>
  );
}
