"""Pydantic request/response schemas — validation on the boundary (handoff standard)."""

from pydantic import BaseModel


class ChatIn(BaseModel):
    message: str


class ChatOut(BaseModel):
    reply: str
