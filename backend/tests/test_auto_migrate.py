"""Auto-migrate on startup (app.main.startup_migrate / run_migrations)."""

from pathlib import Path

from app.core.config import settings
from app import main


async def test_startup_skips_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_MIGRATE", False)
    called = []
    monkeypatch.setattr(main, "run_migrations", lambda: called.append(1))
    await main.startup_migrate()
    assert called == []  # gate respected


async def test_startup_runs_upgrade_head(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_MIGRATE", True)
    seen = {}

    def fake_run() -> None:
        seen["ran"] = True

    monkeypatch.setattr(main, "run_migrations", fake_run)
    await main.startup_migrate()
    assert seen.get("ran") is True


def test_run_migrations_resolves_paths(monkeypatch):
    """The alembic config must point at real files regardless of process cwd."""
    captured = {}

    def fake_upgrade(cfg, rev):  # noqa: ANN001
        captured["ini"] = cfg.config_file_name
        captured["script"] = cfg.get_main_option("script_location")
        captured["rev"] = rev

    import alembic.command

    monkeypatch.setattr(alembic.command, "upgrade", fake_upgrade)
    main.run_migrations()
    assert captured["rev"] == "head"
    assert Path(captured["ini"]).is_file()
    assert (Path(captured["script"]) / "env.py").is_file()
