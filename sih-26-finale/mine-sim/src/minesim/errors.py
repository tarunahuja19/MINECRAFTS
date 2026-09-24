"""Error types defined across the minesim interface contracts."""

class UnpinnedParameterError(ValueError):
    """Raised when a required parameter is null or missing in config."""
    pass

class ProvenanceError(ValueError):
    """Raised when a Value is built without a valid provenance tag ('real', 'pinned', 'synthetic')."""
    pass

class ContractViolation(RuntimeError):
    """Raised when an interface contract or gate invariant is broken at runtime."""
    pass
