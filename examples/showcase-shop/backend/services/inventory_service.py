class InventoryService:
    """Reserve beans and cups from stock."""

    def reserve(self, sku: str, qty: int) -> bool:
        return qty > 0
