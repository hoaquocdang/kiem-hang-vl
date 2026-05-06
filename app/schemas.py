from __future__ import annotations

from pydantic import BaseModel, Field


class ScanPayload(BaseModel):
    barcode: str = Field(min_length=1)
    quantity: int = Field(default=1, ge=1, le=999)


class ReasonPayload(BaseModel):
    reason_code: str = Field(min_length=1, max_length=100)
    reason_note: str = Field(default="", max_length=500)


class LoginPayload(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class SetupPayload(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(default="", max_length=120)


class CreateUserPayload(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(default="", max_length=120)
    role: str = Field(default="user", pattern="^(admin|user)$")


class ResetPasswordPayload(BaseModel):
    password: str = Field(min_length=8, max_length=200)


class UserStatusPayload(BaseModel):
    is_active: bool
