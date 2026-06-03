"""Pydantic request/response schemas — validation on the boundary (handoff standard)."""

from pydantic import BaseModel


# --- free chat (Phase 1) ---
class ChatIn(BaseModel):
    message: str


class ChatOut(BaseModel):
    reply: str


# --- learning core (Phase 2) ---
class ExerciseOut(BaseModel):
    type: str
    text: str
    options: list[str] = []
    topic: str
    # NOTE: the correct answer is intentionally NOT sent to the client.


class CheckIn(BaseModel):
    type: str
    text: str
    options: list[str] = []
    user_answer: str


class CheckOut(BaseModel):
    correct: bool
    correct_answer: str
    explanation: str
    tip: str
