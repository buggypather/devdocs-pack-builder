"""Widgets for notebooks."""

import os as _os

__all__ = ['make', 'Panel', 'fetch']


def make(name: str, *, size: int = 3, **options) -> 'Panel':
  """Makes a panel.

  Args:
    name: What it's called. A long description
      that goes on.
    size (int): How big.
    **options: Anything else.

  Returns:
    The new panel.

  Raises:
    ValueError: If the name is empty.
  """
  return Panel(name)


async def fetch(url):
  """Gets a page."""


def helper():
  """Not in __all__, so not public."""


class Panel(object):
  """A panel.

  Example:

  p = Panel('a')
  p.show()
  """

  def __init__(self, name, colour='blue'):
    """Makes it.

    Args:
      name: Its name.
    """

  def show(self, times=1):
    """Shows it."""

  @property
  def width(self):
    """How wide it is."""

  def _private(self):
    pass
