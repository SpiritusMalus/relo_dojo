"""Pydantic request/response schemas — validation on the boundary (handoff standard §5)."""

from pydantic import BaseModel


class EchoIn(BaseModel):
    text: str


class EchoOut(BaseModel):
    text: str
