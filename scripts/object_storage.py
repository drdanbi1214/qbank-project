"""Supabase Storage/R2를 같은 논리 경로로 다루는 관리 스크립트용 래퍼.

DB에는 계속 ``<logical-bucket>/<path>``만 저장한다. 실제 저장소는
``OBJECT_STORAGE_PROVIDER=supabase|r2``로 고르며 기본값은 안전하게
Supabase다. R2 관리용 비밀키는 macOS 키체인에서만 읽고 Worker가 바인딩된
비공개 버킷에 전달한다. Cloudflare 계정 API 키는 필요 없다.
"""

from __future__ import annotations

import os
import hashlib
import subprocess
import sys
import time
import urllib.parse
from dataclasses import dataclass

import requests

KEYCHAIN_ACCOUNT = "qbank-project"
R2_MIGRATION_SECRET_SERVICE = "qbank-project-r2-migration-secret"


def _keychain_value(service: str) -> str | None:
    if sys.platform != "darwin":
        return None
    result = subprocess.run(
        [
            "security",
            "find-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            service,
            "-w",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    value = result.stdout.strip()
    return value if result.returncode == 0 and value else None


@dataclass(frozen=True)
class R2Settings:
    gateway_url: str
    migration_secret: str

    @classmethod
    def load(cls) -> "R2Settings":
        gateway_url = os.environ.get("R2_MIGRATION_GATEWAY_URL", "").strip().rstrip("/")
        migration_secret = (
            os.environ.get("R2_MIGRATION_SECRET", "").strip()
            or _keychain_value(R2_MIGRATION_SECRET_SERVICE)
            or ""
        )
        if not gateway_url or len(migration_secret.encode()) < 32:
            raise RuntimeError(
                "R2_MIGRATION_GATEWAY_URL과 macOS 키체인의 R2 migration secret이 필요합니다."
            )
        return cls(gateway_url, migration_secret)


class R2Backend:
    def __init__(self, settings: R2Settings | None = None):
        self.settings = settings or R2Settings.load()

    def _url(self, logical_bucket: str, path: str) -> str:
        key = urllib.parse.quote(f"{logical_bucket}/{path}", safe="/")
        return f"{self.settings.gateway_url}/v1/internal/objects/{key}"

    @property
    def _headers(self) -> dict[str, str]:
        return {"X-Qbank-Migration-Secret": self.settings.migration_secret}

    def upload(
        self,
        logical_bucket: str,
        path: str,
        data: bytes,
        content_type: str,
        *,
        sha256: str | None = None,
    ) -> None:
        digest = sha256 or hashlib.sha256(data).hexdigest()
        last_error = ""
        for attempt in range(3):
            try:
                response = requests.put(
                    self._url(logical_bucket, path),
                    headers={
                        **self._headers,
                        "Content-Type": content_type,
                        "X-Content-Sha256": digest,
                    },
                    data=data,
                    timeout=(15, 180),
                )
                if response.status_code in (200, 201):
                    return
                last_error = f"HTTP {response.status_code}: {response.text[:300]}"
                if response.status_code not in (408, 429) and response.status_code < 500:
                    break
            except requests.RequestException as exc:
                last_error = str(exc)
            if attempt < 2:
                time.sleep(0.5 * (2 ** attempt))
        raise RuntimeError(f"R2 업로드 실패: {last_error}")

    def head(self, logical_bucket: str, path: str) -> dict | None:
        response = requests.head(
            self._url(logical_bucket, path),
            headers=self._headers,
            timeout=60,
        )
        if response.status_code == 404:
            return None
        if not response.ok:
            raise RuntimeError(f"R2 HEAD 실패 {response.status_code}: {response.text[:200]}")
        return {
            "ContentLength": int(response.headers.get("Content-Length") or 0),
            "Metadata": {"sha256": response.headers.get("X-Qbank-Sha256", "")},
        }

    def download(self, logical_bucket: str, path: str) -> bytes:
        response = requests.get(
            self._url(logical_bucket, path),
            headers=self._headers,
            timeout=(15, 180),
        )
        if not response.ok:
            raise RuntimeError(f"R2 다운로드 실패 {response.status_code}: {response.text[:200]}")
        return response.content


class ObjectStorage:
    """관리 스크립트의 업로드 대상을 환경변수로 전환한다."""

    def __init__(self, supabase_url: str, supabase_secret_key: str):
        self.supabase_url = supabase_url.rstrip("/")
        self.supabase_secret_key = supabase_secret_key
        self.provider = os.environ.get("OBJECT_STORAGE_PROVIDER", "supabase").strip().lower()
        if self.provider not in {"supabase", "r2"}:
            raise RuntimeError("OBJECT_STORAGE_PROVIDER는 supabase 또는 r2여야 합니다.")
        self.r2 = R2Backend() if self.provider == "r2" else None

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> bool:
        if self.r2:
            self.r2.upload(bucket, path, data, content_type)
            return True

        encoded_path = urllib.parse.quote(path, safe="/")
        last_error = ""
        for attempt in range(3):
            try:
                response = requests.post(
                    f"{self.supabase_url}/storage/v1/object/{bucket}/{encoded_path}",
                    data=data,
                    headers={
                        "apikey": self.supabase_secret_key,
                        "Content-Type": content_type,
                        "x-upsert": "true",
                        "Connection": "close",
                    },
                    timeout=(15, 120),
                )
                if response.status_code in (200, 201):
                    return True
                last_error = f"HTTP {response.status_code}: {response.text[:200]}"
            except requests.RequestException as exc:
                last_error = str(exc)
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"스토리지 업로드 실패 ({bucket}/{path}): {last_error}")
