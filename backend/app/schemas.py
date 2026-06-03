"""Pydantic request/response schemas — validation on the boundary (handoff standard).

Input length limits keep a single request from exhausting the model / RAM and reject junk
with an automatic 422 before it ever reaches Ollama.
"""

from pydantic import BaseModel, Field

MAX_TEXT = 2000  # chars for free-form fields sent to the model
MAX_ANSWER = 1000
MAX_OPTIONS = 10


# --- free chat (Phase 1) ---
class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_TEXT)


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
    type: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    options: list[str] = Field(default=[], max_length=MAX_OPTIONS)
    user_answer: str = Field(min_length=1, max_length=MAX_ANSWER)


class CheckOut(BaseModel):
    correct: bool
    correct_answer: str
    explanation: str
    tip: str
