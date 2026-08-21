"""Supabase Storage/R2를 같은 논리 경로로 다루는 관리 스크립트용 래퍼.

DB에는 계속 ``<logical-bucket>/<path>``만 저장한다. 실제 저장소는
``OBJECT_STORAGE_PROVIDER=supabase|r2``로 고르며 기본값은 안전하게
Supabase다. R2 자격 증명은 환경변수 또는 macOS 키체인에서만 읽는다.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.parse
from dataclasses import dataclass

import requests

KEYCHAIN_ACCOUNT = "qbank-project"
R2_ACCESS_KEY_SERVICE = "qbank-project-r2-access-key-id"
R2_SECRET_KEY_SERVICE = "qbank-project-r2-secret-access-key"


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
    account_id: str
    bucket_name: str
    access_key_id: str
    secret_access_key: str

    @classmethod
    def load(cls) -> "R2Settings":
        account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
        bucket_name = os.environ.get("R2_BUCKET_NAME", "qbank-storage").strip()
        access_key_id = (
            os.environ.get("R2_ACCESS_KEY_ID", "").strip()
            or _keychain_value(R2_ACCESS_KEY_SERVICE)
            or ""
        )
        secret_access_key = (
            os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
            or _keychain_value(R2_SECRET_KEY_SERVICE)
            or ""
        )
        if not all((account_id, bucket_name, access_key_id, secret_access_key)):
            raise RuntimeError(
                "R2_ACCOUNT_ID, R2_BUCKET_NAME과 R2 API 키(환경변수 또는 macOS 키체인)가 필요합니다."
            )
        return cls(account_id, bucket_name, access_key_id, secret_access_key)


class R2Backend:
    def __init__(self, settings: R2Settings | None = None):
        try:
            import boto3
            from botocore.exceptions import ClientError
        except ImportError as exc:
            raise RuntimeError("boto3가 필요합니다. pip install -r scripts/requirements.txt") from exc

        self.settings = settings or R2Settings.load()
        self.client_error = ClientError
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{self.settings.account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=self.settings.access_key_id,
            aws_secret_access_key=self.settings.secret_access_key,
            region_name="auto",
        )

    def upload(
        self,
        logical_bucket: str,
        path: str,
        data: bytes,
        content_type: str,
        *,
        sha256: str | None = None,
    ) -> None:
        metadata = {"source": "qbank"}
        if sha256:
            metadata["sha256"] = sha256
        self.client.put_object(
            Bucket=self.settings.bucket_name,
            Key=f"{logical_bucket}/{path}",
            Body=data,
            ContentType=content_type,
            CacheControl="private, max-age=300",
            Metadata=metadata,
        )

    def head(self, logical_bucket: str, path: str) -> dict | None:
        try:
            return self.client.head_object(
                Bucket=self.settings.bucket_name,
                Key=f"{logical_bucket}/{path}",
            )
        except self.client_error as exc:
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                return None
            raise

    def download(self, logical_bucket: str, path: str) -> bytes:
        response = self.client.get_object(
            Bucket=self.settings.bucket_name,
            Key=f"{logical_bucket}/{path}",
        )
        return response["Body"].read()


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
