from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "StockAuditApp"
TRUE_VALUES = {"1", "true", "yes", "on"}


def _resolve_bundle_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parent.parent


def _resolve_distribution_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return _resolve_bundle_dir()


def _resolve_local_data_dir() -> Path:
    local_appdata = os.getenv("LOCALAPPDATA")
    if local_appdata:
        return Path(local_appdata) / APP_NAME
    return Path.home() / f".{APP_NAME.lower()}"


def _resolve_data_dir() -> Path:
    custom_home = os.getenv("STOCK_AUDIT_HOME")
    if custom_home:
        return Path(custom_home)

    if IS_VERCEL:
        return Path("/tmp") / APP_NAME

    return _resolve_local_data_dir()


IS_VERCEL = bool(os.getenv("VERCEL"))
# Neon integration may use DATABASE_POSTGRES_URL instead of DATABASE_URL
DATABASE_URL = (
    os.getenv("DATABASE_URL", "")
    or os.getenv("DATABASE_POSTGRES_URL", "")
    or os.getenv("DATABASE_POSTGRES_URL_NON_POOLING", "")
    or os.getenv("POSTGRES_URL", "")
).strip()
IS_CLOUD = bool(DATABASE_URL)
# Allow mutations when a cloud database is configured (even on Vercel)
MUTATIONS_DISABLED = IS_VERCEL and not IS_CLOUD
BASE_DIR = _resolve_bundle_dir()
DISTRIBUTION_DIR = _resolve_distribution_dir()
DATA_DIR = _resolve_data_dir()
ACCOUNT_SHEET_PATH = Path(os.getenv("STOCK_AUDIT_ACCOUNT_SHEET", DATA_DIR / "accounts.xlsx"))
BUNDLED_ACCOUNT_SHEET_PATH = DISTRIBUTION_DIR / "accounts.xlsx"
ACCOUNT_SHEET_URL = os.getenv("STOCK_AUDIT_ACCOUNT_SHEET_URL", "").strip()
ACCOUNT_SHEET_URL_PATH = DATA_DIR / "account-sheet-url.txt"
BUNDLED_ACCOUNT_SHEET_URL_PATH = DISTRIBUTION_DIR / "account-sheet-url.txt"
ADMIN_SETUP_UNLOCK_PATH = DATA_DIR / "allow-admin-setup.txt"
ADMIN_SETUP_ALLOWED = os.getenv("STOCK_AUDIT_ALLOW_ADMIN_SETUP", "").strip().lower() in TRUE_VALUES
PUBLIC_DIR = BASE_DIR / "public"
STATIC_DIR = PUBLIC_DIR / "static"
DATABASE_PATH = DATA_DIR / "stock_audit.db"
