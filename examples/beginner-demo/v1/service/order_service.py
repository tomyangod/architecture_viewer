"""服务层：订单业务。"""

from domain.order import Order
from repository.order_repository import OrderRepository


class OrderService:
    def __init__(self, repo: OrderRepository):
        self.repo = repo

    def create_order(self, order_id: str, amount: float) -> Order:
        order = Order(order_id, amount)
        self.repo.save(order)
        return order

    def pay(self, order_id: str) -> Order:
        order = self.repo.find(order_id)
        order.mark_paid()
        self.repo.save(order)
        return order
