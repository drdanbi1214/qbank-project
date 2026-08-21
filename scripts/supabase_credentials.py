"""관리 스크립트용 Supabase 자격 증명을 안전하게 불러온다.

신형 ``sb_secret_`` 키는 macOS 키체인을 우선 사용한다. CI나 다른 운영체제는
``SUPABASE_SECRET_KEY`` 환경변수를 쓰고, 전환 기간에만 기존
``SUPABASE_SERVICE_KEY``를 마지막 호환 경로로 허용한다.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys

KEYCHAIN_ACCOUNT = "qbank-project"
KEYCHAIN_SERVICE = "qbank-project-supabase-secret"


def _load_env_files() -> None:
    script_env = pathlib.Path(__file__).resolve().parent / ".env"
    for path in (pathlib.Path(".env"), script_env):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            name, value = line.strip().split("=", 1)
            os.environ.setdefault(name, value)


def _keychain_secret() -> str | None:
    if sys.platform != "darwin":
        return None
    result = subprocess.run(
        [
            "security",
            "find-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    value = result.stdout.strip()
    return value if result.returncode == 0 and value.startswith("sb_secret_") else None


def load_supabase_credentials() -> tuple[str, str]:
    _load_env_files()
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SECRET_KEY")
        or _keychain_secret()
        or os.environ.get("SUPABASE_SERVICE_KEY")
    )
    if not url or not key:
        raise SystemExit(
            "SUPABASE_URL과 SUPABASE_SECRET_KEY(또는 macOS 키체인)가 필요합니다."
        )
    return url, key
