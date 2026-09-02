"""控制器层：只依赖服务层，不直接碰仓储。"""

from service.order_service import OrderService
from domain.order import Order


class OrderController:
    def __init__(self, service: OrderService):
        self.service = service

    def create(self, order_id: str, amount: float) -> Order:
        return self.service.create_order(order_id, amount)

    def pay(self, order_id: str) -> Order:
        return self.service.pay(order_id)
