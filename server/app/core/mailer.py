"""Email delivery helpers."""
from __future__ import annotations

import os

import resend


def send_password_reset_otp_email(*, recipient_email: str, otp: str, expires_minutes: int) -> None:
    """Send password reset OTP email using Resend."""
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        raise ValueError("RESEND_API_KEY is not configured")

    sender = os.getenv("MAIL_FROM") or "onboarding@resend.dev"
    resend.api_key = api_key

    html = f"""
    <div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">
      <h2>Reset your REMS password</h2>
      <p>Use this OTP to reset your password:</p>
      <p style=\"font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0\">{otp}</p>
      <p>This OTP expires in {expires_minutes} minutes.</p>
      <p>If you did not request this, you can safely ignore this email.</p>
    </div>
    """

    resend.Emails.send(
        {
            "from": sender,
            "to": [recipient_email],
            "subject": "Reset your REMS password",
            "html": html,
        }
    )


def send_signup_otp_email(*, recipient_email: str, otp: str, expires_minutes: int) -> None:
    """Send signup verification OTP email using Resend."""
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        raise ValueError("RESEND_API_KEY is not configured")

    sender = os.getenv("MAIL_FROM") or "onboarding@resend.dev"
    resend.api_key = api_key

    html = f"""
    <div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">
      <h2>Verify your REMS registration</h2>
      <p>Use this OTP to verify your email before registration:</p>
      <p style=\"font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0\">{otp}</p>
      <p>This OTP expires in {expires_minutes} minutes.</p>
      <p>If you did not initiate registration, you can ignore this email.</p>
    </div>
    """

    resend.Emails.send(
        {
            "from": sender,
            "to": [recipient_email],
            "subject": "Verify your REMS account",
            "html": html,
        }
    )
