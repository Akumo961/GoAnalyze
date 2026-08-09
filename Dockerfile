FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml /app/
COPY gov_platform /app/gov_platform
COPY alembic.ini /app/
COPY migrations /app/migrations

RUN pip install --no-cache-dir .

USER 65532:65532

EXPOSE 8080

CMD ["uvicorn", "gov_platform.main:app", "--host", "0.0.0.0", "--port", "8080"]

