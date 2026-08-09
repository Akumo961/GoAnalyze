from .models import AIFinding, EvidenceCitation


class GroundedRagService:
    def answer(self, question: str, citations: list[EvidenceCitation]) -> AIFinding:
        grounded = bool(citations)
        if not grounded:
            return AIFinding(
                finding_type="rag_answer",
                statement="The repository evidence supplied to the RAG service does not support an answer.",
                confidence=0.0,
                citations=[],
                grounded=False,
                explanation="No citations were available, so the response is withheld.",
            )
        joined = " ".join(citation.excerpt for citation in citations[:3])
        return AIFinding(
            finding_type="rag_answer",
            statement=f"Based on cited evidence: {joined[:600]}",
            confidence=min(0.92, 0.55 + len(citations) * 0.08),
            citations=citations[:5],
            grounded=True,
            explanation="Answer generated only from retrieved citation excerpts.",
        )


rag_service = GroundedRagService()

