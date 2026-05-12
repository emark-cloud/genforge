from genlayer import *


class Greeter(gl.Contract):
    greeting: str

    def __init__(self, initial: str):
        self.greeting = initial

    @gl.public.view
    def greet(self, name: str) -> str:
        return f"{self.greeting}, {name}!"

    @gl.public.write
    def set_greeting(self, value: str) -> None:
        if not value.strip():
            raise gl.vm.UserError("Greeting cannot be empty")
        self.greeting = value
