"""AI「顺手改坏」：控制器直接依赖仓储，跳过服务层。"""

from service.order_service import OrderService
from service.payment_service import PaymentService
from repository.order_repository import OrderRepository  # ← 跨层违规
from domain.order import Order


class OrderController:
    def __init__(self, service: OrderService, payment: PaymentService, repo: OrderRepository):
        self.service = service
        self.payment = payment
        self.repo = repo  # ← 控制器不该直接持有仓储

    def create(self, order_id: str, amount: float) -> Order:
        return self.service.create_order(order_id, amount)

    def pay(self, order_id: str) -> Order:
        # AI 图省事：绕过 OrderService，控制器直连仓储
        order = self.repo.find(order_id)
        self.payment.charge(order)
        return order
