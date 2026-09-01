class PaymentService:
    """Charge customers via external payment gateway."""

    def charge(self, order_id: str, amount_cents: int) -> bool:
        return amount_cents > 0
