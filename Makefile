.PHONY: demo down logs seed migrate api-test client-test static-check test verify concurrency backup restore

demo:
	docker compose up --build -d
	docker compose exec api uv run python -m app.seed

down:
	docker compose down

logs:
	docker compose logs -f api worker client

seed:
	docker compose exec api uv run python -m app.seed

migrate:
	docker compose exec api uv run alembic upgrade head

api-test:
	cd services/api && UV_CACHE_DIR=/tmp/biletflow-uv-cache uv run pytest

client-test:
	npm test

static-check:
	cd services/api && UV_CACHE_DIR=/tmp/biletflow-uv-cache uv run ruff check app scripts tests
	cd services/api && UV_CACHE_DIR=/tmp/biletflow-uv-cache uv run mypy app
	npm run typecheck
	npm run lint

test: static-check api-test client-test

verify:
	docker compose exec -e BILETFLOW_DEMO_API=http://127.0.0.1:8000 api uv run python scripts/demo_check.py

concurrency:
	docker compose exec -e BILETFLOW_DEMO_API=http://127.0.0.1:8000 api uv run python scripts/concurrency_check.py

backup:
	mkdir -p backups
	docker compose exec -T postgres pg_dump -U biletflow -Fc biletflow > backups/biletflow.dump

restore:
	test -n "$(FILE)"
	docker compose exec -T postgres pg_restore -U biletflow -d biletflow --clean --if-exists < "$(FILE)"
