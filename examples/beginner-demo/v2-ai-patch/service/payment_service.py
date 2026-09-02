"""AI 新增：支付服务。"""

from domain.order import Order
from repository.order_repository import OrderRepository


class PaymentService:
    def __init__(self, repo: OrderRepository):
        self.repo = repo

    def charge(self, order: Order) -> bool:
        if order.amount <= 0:
            return False
        order.mark_paid()
        self.repo.save(order)
        return True
