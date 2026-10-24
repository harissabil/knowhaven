"""Secrets helpers: random tokens, hashes for lookup, password hashing, credential encryption."""

import hashlib
import secrets
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet

from brain.config import get_settings

_hasher = PasswordHasher()
# Verified against when the email doesn't exist, so login timing doesn't reveal accounts.
_DUMMY_HASH = _hasher.hash("not-a-real-password")

# No 0/O/1/I/L to keep join codes readable when shared verbally.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_join_code() -> str:
    raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_join_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


@lru_cache
def _fernet() -> Fernet:
    return Fernet(get_settings().credentials_key)


def encrypt(value: str) -> bytes:
    return _fernet().encrypt(value.encode())


def decrypt(token: bytes) -> str:
    return _fernet().decrypt(token).decode()
