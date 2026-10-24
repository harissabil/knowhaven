"""Neon Object Storage (S3-compatible). Objects are always keyed under tenants/<tenant_id>/."""

import asyncio
from functools import lru_cache
from uuid import UUID

import boto3
from botocore.config import Config

from brain.config import get_settings


@lru_cache
def _client():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.aws_endpoint_url_s3,
        region_name=s.aws_region,
        aws_access_key_id=s.aws_access_key_id,
        aws_secret_access_key=s.aws_secret_access_key,
        # Neon requires path-style addressing and SigV4.
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def tenant_key(tenant_id: UUID, *parts: str) -> str:
    return "/".join(["tenants", str(tenant_id), *parts])


async def put_object(key: str, body: bytes, content_type: str) -> None:
    await asyncio.to_thread(
        _client().put_object,
        Bucket=get_settings().storage_bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
    )


async def get_object(key: str) -> bytes:
    res = await asyncio.to_thread(
        _client().get_object, Bucket=get_settings().storage_bucket, Key=key
    )
    return await asyncio.to_thread(res["Body"].read)


async def delete_object(key: str) -> None:
    await asyncio.to_thread(_client().delete_object, Bucket=get_settings().storage_bucket, Key=key)


def presigned_get_url(key: str, expires_in: int = 300) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": get_settings().storage_bucket, "Key": key},
        ExpiresIn=expires_in,
    )


async def check() -> None:
    await asyncio.to_thread(_client().head_bucket, Bucket=get_settings().storage_bucket)


def _delete_prefix_sync(prefix: str) -> int:
    client, bucket, n = _client(), get_settings().storage_bucket, 0
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
        if keys:
            client.delete_objects(Bucket=bucket, Delete={"Objects": keys, "Quiet": True})
            n += len(keys)
    return n


async def delete_prefix(prefix: str) -> int:
    """Delete every object under `prefix` (used by the seed reset). Returns the count."""
    if not prefix.startswith("tenants/") or prefix.count("/") < 2:
        raise ValueError("refusing to delete outside a single tenant prefix")
    return await asyncio.to_thread(_delete_prefix_sync, prefix)
