"""Coffee Shop API entrypoint."""

from backend.services.order_service import OrderService
from backend.services.payment_service import PaymentService
from backend.services.inventory_service import InventoryService


class App:
    def __init__(self):
        self.orders = OrderService()
        self.payments = PaymentService()
        self.inventory = InventoryService()

    def run(self):
        return "api listening"


if __name__ == "__main__":
    App().run()
