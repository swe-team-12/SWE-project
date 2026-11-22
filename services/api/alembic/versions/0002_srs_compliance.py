"""Event reports, support escalation and moderation reasons.

The initial revision builds the schema from the current model metadata, so a
database created after this revision was written already contains everything
below. Every step therefore checks what exists first; that keeps the upgrade
safe both for fresh databases and for populated ones created before it.
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_srs_compliance"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _columns(inspector: sa.Inspector, table: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table)}


def _indexes(inspector: sa.Inspector, table: str) -> set[str]:
    return {str(index["name"]) for index in inspector.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    event_columns = _columns(inspector, "events")
    if "suspension_reason" not in event_columns:
        op.add_column("events", sa.Column("suspension_reason", sa.Text(), nullable=True))
    if "paid_sales_suspension_reason" not in event_columns:
        op.add_column(
            "events", sa.Column("paid_sales_suspension_reason", sa.Text(), nullable=True)
        )

    case_columns = _columns(inspector, "support_cases")
    if "escalated" not in case_columns:
        op.add_column(
            "support_cases",
            sa.Column("escalated", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if "escalated_at" not in case_columns:
        op.add_column(
            "support_cases",
            sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "escalated_by_id" not in case_columns:
        op.add_column(
            "support_cases",
            sa.Column("escalated_by_id", sa.Uuid(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            "fk_support_cases_escalated_by_id_users",
            "support_cases",
            "users",
            ["escalated_by_id"],
            ["id"],
        )

    if not inspector.has_table("event_reports"):
        op.create_table(
            "event_reports",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column(
                "event_id",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("events.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "reporter_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
            ),
            sa.Column("category", sa.String(length=40), nullable=False),
            sa.Column("details", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("resolution_note", sa.Text(), nullable=True),
            sa.Column(
                "resolved_by_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True
            ),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    report_indexes = _indexes(sa.inspect(bind), "event_reports")
    if "ix_event_reports_event_id" not in report_indexes:
        op.create_index("ix_event_reports_event_id", "event_reports", ["event_id"])
    if "ix_event_reports_reporter_id" not in report_indexes:
        op.create_index("ix_event_reports_reporter_id", "event_reports", ["reporter_id"])
    if "ix_event_reports_status_time" not in report_indexes:
        op.create_index(
            "ix_event_reports_status_time", "event_reports", ["status", "created_at"]
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("event_reports"):
        op.drop_table("event_reports")
    case_columns = _columns(inspector, "support_cases")
    if "escalated_by_id" in case_columns:
        foreign_keys = {key["name"] for key in inspector.get_foreign_keys("support_cases")}
        if "fk_support_cases_escalated_by_id_users" in foreign_keys:
            op.drop_constraint(
                "fk_support_cases_escalated_by_id_users", "support_cases", type_="foreignkey"
            )
        op.drop_column("support_cases", "escalated_by_id")
    for name in ("escalated_at", "escalated"):
        if name in case_columns:
            op.drop_column("support_cases", name)
    event_columns = _columns(inspector, "events")
    for name in ("paid_sales_suspension_reason", "suspension_reason"):
        if name in event_columns:
            op.drop_column("events", name)
