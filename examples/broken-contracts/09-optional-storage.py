# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


class Lottery(gl.Contract):
    # BUG: Union types are not storage-eligible. py-genlayer rejects
    # `Address | None` and `u256 | None` at deploy with
    # `incorrect number of generic arguments for <class 'types.UnionType'>`.
    winner: Address | None = None
    pot: u256
    closed: bool

    def __init__(self):
        self.pot = u256(0)
        self.closed = False

    @gl.public.write.payable
    def buy_ticket(self) -> None:
        if self.closed:
            raise gl.vm.UserError("Lottery closed")
        self.pot = self.pot + gl.message.value

    @gl.public.write
    def declare_winner(self, winner_addr: str) -> None:
        if self.closed:
            raise gl.vm.UserError("Already closed")
        self.winner = Address(winner_addr)
        self.closed = True
