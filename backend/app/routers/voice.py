"""Voice endpoints (pronunciation): read-aloud transcription + an ephemeral Gemini Live token.

The whole /voice/* surface 404s unless settings.VOICE_ENABLED (mirrors /billing/*) — deploying the
code is inert until the owner flips the flag after the legal/RKN gate. Both endpoints require auth
and the conservative voice rate limit (audio→Gemini is pricier than text). The real GEMINI_API_KEY
stays server-side: the client never gets it, only a short-lived ephemeral Live token.

- POST /voice/transcribe   -> {transcript} for the client's read-aloud pass/fail check
- POST /voice/live-token   -> {token, expiresAt, model} for a client↔Google Live session
"""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.config import settings
from ..db.models import User
from ..deps import get_current_user, voice_rate_limit
from ..schemas import LiveTokenOut, TranscribeIn, TranscribeOut
from ..services import voice_live, voice_transcribe
from ..services.llm import LLMError

router = APIRouter(prefix="/voice", tags=["voice"])


def _require_enabled() -> None:
    """Keep the whole voice surface invisible until VOICE_ENABLED is flipped (post legal gate)."""
    if not settings.VOICE_ENABLED:
        raise HTTPException(status_code=404, detail="Not found.")


def _map_llm_error(exc: LLMError) -> HTTPException:
    """Map a provider error to HTTP: a missing/rejected key or model is a 502 (our config), not the
    client's fault; everything else surfaces as a 502 too with a safe message."""
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.post("/transcribe", response_model=TranscribeOut)
async def transcribe(
    payload: TranscribeIn,
    user: User = Depends(get_current_user),
    _rl: None = Depends(voice_rate_limit),
) -> TranscribeOut:
    """Transcribe a read-aloud clip to verbatim text (the binary compare is client-side)."""
    _require_enabled()
    # Enforce the byte guard on the decoded audio (413) before spending a Gemini call.
    try:
        raw = base64.b64decode(payload.audio, validate=True)
    except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=400, detail="Audio is not valid base64.") from exc
    if len(raw) > settings.VOICE_MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,  # Content Too Large
            detail=f"Audio too large (max {settings.VOICE_MAX_AUDIO_BYTES} bytes).",
        )
    try:
        transcript = await voice_transcribe.transcribe(payload.audio, payload.mime, payload.lang)
    except LLMError as exc:
        raise _map_llm_error(exc) from exc
    return TranscribeOut(transcript=transcript)


@router.post("/live-token", response_model=LiveTokenOut)
async def live_token(
    user: User = Depends(get_current_user),
    _rl: None = Depends(voice_rate_limit),
) -> LiveTokenOut:
    """Mint a short-lived ephemeral Live token + resolved model so the client never holds the key."""
    _require_enabled()
    try:
        model = await voice_live.resolve_live_model()
        token, expires_at = await voice_live.mint_live_token()
    except LLMError as exc:
        raise _map_llm_error(exc) from exc
    return LiveTokenOut(token=token, expiresAt=expires_at, model=model)
