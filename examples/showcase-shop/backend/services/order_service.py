class OrderService:
    """Create and track coffee orders."""

    def create(self, sku: str, qty: int) -> dict:
        return {"id": "ord_demo", "sku": sku, "qty": qty, "status": "pending"}

    def mark_ready(self, order_id: str) -> None:
        pass
