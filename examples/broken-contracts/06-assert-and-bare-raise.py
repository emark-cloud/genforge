# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


class Counter(gl.Contract):
    n: u256
    cap: u256

    def __init__(self, cap: int):
        if cap <= 0:
            raise Exception("cap must be positive")
        self.n = u256(0)
        self.cap = u256(cap)

    @gl.public.write
    def inc(self) -> None:
        assert self.n < self.cap, "Counter would exceed cap"
        self.n = self.n + u256(1)

    @gl.public.write
    def reset(self) -> None:
        if int(self.n) == 0:
            raise Exception("Already at zero")
        self.n = u256(0)

    @gl.public.view
    def value(self) -> u256:
        return self.n
