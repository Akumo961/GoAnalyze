"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { EvidenceCitation } from "@/lib/types";

const EMPTY: EvidenceCitation = {
  document_id: "",
  version: 1,
  chunk_id: "",
  page: null,
  start_offset: null,
  end_offset: null,
  sha256: "",
  excerpt: ""
};

export function CitationBuilder({
  citations,
  onChange
}: {
  citations: EvidenceCitation[];
  onChange: (citations: EvidenceCitation[]) => void;
}) {
  const [draft, setDraft] = useState<EvidenceCitation>(EMPTY);

  function addCitation() {
    if (!draft.document_id || !draft.chunk_id || !draft.sha256 || !draft.excerpt) return;
    onChange([...citations, draft]);
    setDraft(EMPTY);
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="cardHeader">
        <h2>Evidence Citations</h2>
        <span style={{ fontSize: 12, color: "var(--muted-2)" }}>{citations.length} attached</span>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
        The backend verifies citation evidence server-side, so every citation must reference a
        real document chunk you have — copy these from a document&apos;s search result or content.
      </p>

      {citations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {citations.map((c, i) => (
            <div key={i} className="evidenceCard">
              <div className="evidenceMeta">
                <span className="mono">{c.document_id}</span>
                <button
                  className="btn btnSm btnGhost"
                  onClick={() => onChange(citations.filter((_, idx) => idx !== i))}
                  aria-label="Remove citation"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {c.excerpt}
            </div>
          ))}
        </div>
      )}

      <div className="formRow">
        <div className="formField">
          <label htmlFor="cit-doc">Document ID</label>
          <input id="cit-doc" value={draft.document_id} onChange={(e) => setDraft({ ...draft, document_id: e.target.value })} />
        </div>
        <div className="formField">
          <label htmlFor="cit-version">Version</label>
          <input
            id="cit-version"
            type="number"
            min={1}
            value={draft.version}
            onChange={(e) => setDraft({ ...draft, version: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="formRow">
        <div className="formField">
          <label htmlFor="cit-chunk">Chunk ID</label>
          <input id="cit-chunk" value={draft.chunk_id} onChange={(e) => setDraft({ ...draft, chunk_id: e.target.value })} />
        </div>
        <div className="formField">
          <label htmlFor="cit-sha">SHA-256</label>
          <input id="cit-sha" value={draft.sha256} onChange={(e) => setDraft({ ...draft, sha256: e.target.value })} />
        </div>
      </div>
      <div className="formField">
        <label htmlFor="cit-excerpt">Excerpt</label>
        <textarea
          id="cit-excerpt"
          rows={2}
          value={draft.excerpt}
          onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
        />
      </div>
      <button className="btn btnSm" onClick={addCitation}>
        <Plus size={13} /> Add citation
      </button>
    </div>
  );
}
