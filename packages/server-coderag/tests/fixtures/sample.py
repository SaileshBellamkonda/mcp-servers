class Calculator:
    """A simple calculator class."""

    def __init__(self, initial_value: float = 0):
        self.value = initial_value

    def add(self, x: float) -> float:
        self.value += x
        return self.value

    def reset(self) -> None:
        self.value = 0


def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b
