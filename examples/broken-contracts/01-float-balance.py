# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


class Wallet(gl.Contract):
    balances: TreeMap[Address, float]

    def __init__(self):
        pass

    @gl.public.write
    def deposit(self, amount: float) -> None:
        sender = gl.message.sender_address
        if sender in self.balances:
            self.balances[sender] = self.balances[sender] + amount
        else:
            self.balances[sender] = amount

    @gl.public.write
    def withdraw(self, amount: float) -> None:
        sender = gl.message.sender_address
        if sender not in self.balances:
            raise gl.vm.UserError("No balance")
        if self.balances[sender] < amount:
            raise gl.vm.UserError("Insufficient funds")
        self.balances[sender] = self.balances[sender] - amount

    @gl.public.view
    def balance_of(self, who: str) -> float:
        addr = Address(who)
        if addr not in self.balances:
            return 0.0
        return self.balances[addr]
