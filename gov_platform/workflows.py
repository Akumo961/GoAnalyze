from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from .models import ReviewStatus


@dataclass
class Assignment:
    case_id: UUID
    assignee: str
    queue: str
    due_at: datetime
    escalation_at: datetime
    status: ReviewStatus


class AssignmentEngine:
    def assign(self, case_id: UUID, skill: str, workload: dict[str, int]) -> Assignment:
        candidates = sorted(workload.items(), key=lambda item: (item[1], item[0]))
        assignee = candidates[0][0] if candidates else f"{skill}-pool"
        now = datetime.now(UTC)
        return Assignment(
            case_id=case_id,
            assignee=assignee,
            queue=f"{skill}-review",
            due_at=now + timedelta(days=5),
            escalation_at=now + timedelta(days=4),
            status=ReviewStatus.technical_review,
        )


assignment_engine = AssignmentEngine()

