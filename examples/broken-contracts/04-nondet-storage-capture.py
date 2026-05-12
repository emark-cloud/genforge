# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


class Reviewer(gl.Contract):
    text: str
    score: u256

    def __init__(self, text: str):
        self.text = text
        self.score = u256(0)

    @gl.public.write
    def score_text(self) -> None:
        def evaluate() -> str:
            return gl.nondet.exec_prompt(
                f"Rate the clarity of the following text 0-100. Respond with only a number.\n\n{self.text}"
            ).strip()

        result = gl.eq_principle.prompt_non_comparative(
            evaluate,
            task="Score clarity 0-100",
            criteria="Response must be an integer 0-100",
        )
        try:
            n = int(result)
        except ValueError:
            raise gl.vm.UserError("Validator returned non-numeric score")
        if n < 0 or n > 100:
            raise gl.vm.UserError("Score out of range")
        self.score = u256(n)

    @gl.public.view
    def get_score(self) -> u256:
        return self.score
