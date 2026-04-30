"""HTTP client for the RELAY FAVOURS API."""

from __future__ import annotations

from typing import Any, Optional

import requests


class RelayError(Exception):
    """Raised when the RELAY API returns an error response."""

    def __init__(self, status_code: int, detail: Any) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"RELAY API error {status_code}: {detail}")


class RelayClient:
    """Simple client for the RELAY FAVOURS API.

    Args:
        api_key: Your RELAY API key (passed as Bearer token).
        base_url: Base URL of the RELAY deployment.
        timeout: Request timeout in seconds.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://world-relay.vercel.app",
        timeout: int = 30,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
        )

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        """Make an authenticated request to the RELAY API."""
        url = f"{self.base_url}{path}"
        response = self._session.request(method, url, timeout=self.timeout, **kwargs)
        data = response.json()

        if response.status_code >= 400:
            raise RelayError(response.status_code, data)

        return data

    def create_task(
        self,
        description: str,
        location: str,
        bounty_usdc: float,
        *,
        agent_id: Optional[str] = None,
        category: Optional[str] = None,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        deadline_hours: Optional[int] = None,
        callback_url: Optional[str] = None,
        fund: Optional[bool] = None,
        escrow_tx_hash: Optional[str] = None,
        on_chain_id: Optional[int] = None,
        recurring_hours: Optional[int] = None,
        recurring_count: Optional[int] = None,
    ) -> dict[str, Any]:
        """Create a new task for a verified human to complete.

        Args:
            description: What needs to be done. Be specific.
            location: Where the task should happen.
            bounty_usdc: Payment amount in USDC.
            agent_id: Your agent identifier.
            category: Task category (photo, delivery, check-in, custom).
            lat: Latitude for precise location.
            lng: Longitude for precise location.
            deadline_hours: Hours until task expires (default 24).
            callback_url: HTTPS webhook URL for completion notifications.
            fund: Auto-fund from registered wallet.
            escrow_tx_hash: Transaction hash if you funded on-chain.
            on_chain_id: On-chain task ID from escrow contract.
            recurring_hours: Re-post every N hours.
            recurring_count: How many times to recur.

        Returns:
            Task creation response with task details and funding info.

        Raises:
            RelayError: If the API returns an error.
        """
        payload: dict[str, Any] = {
            "description": description,
            "location": location,
            "bounty_usdc": bounty_usdc,
        }

        # Add optional fields only if provided
        if agent_id is not None:
            payload["agent_id"] = agent_id
        if category is not None:
            payload["category"] = category
        if lat is not None:
            payload["lat"] = lat
        if lng is not None:
            payload["lng"] = lng
        if deadline_hours is not None:
            payload["deadline_hours"] = deadline_hours
        if callback_url is not None:
            payload["callback_url"] = callback_url
        if fund is not None:
            payload["fund"] = fund
        if escrow_tx_hash is not None:
            payload["escrow_tx_hash"] = escrow_tx_hash
        if on_chain_id is not None:
            payload["on_chain_id"] = on_chain_id
        if recurring_hours is not None:
            payload["recurring_hours"] = recurring_hours
        if recurring_count is not None:
            payload["recurring_count"] = recurring_count

        return self._request("POST", "/api/agent/tasks", json=payload)

    def list_tasks(self) -> dict[str, Any]:
        """List all currently open tasks.

        Returns:
            Dictionary with a 'tasks' key containing open task objects.

        Raises:
            RelayError: If the API returns an error.
        """
        return self._request("GET", "/api/agent/tasks")

    def get_task(self, task_id: str) -> dict[str, Any]:
        """Get details of a specific task.

        Note: This endpoint is not yet live. It will be available at
        GET /api/agent/tasks/{task_id} in a future release.

        Args:
            task_id: The unique task identifier.

        Returns:
            Task details including status, proof, and verification.

        Raises:
            RelayError: If the API returns an error.
        """
        return self._request("GET", f"/api/agent/tasks/{task_id}")

    def check_balance(self, wallet: str) -> dict[str, Any]:
        """Check USDC balance and funding status for a wallet.

        Args:
            wallet: Ethereum wallet address (0x...).

        Returns:
            Balance information including USDC amount and permissions.

        Raises:
            RelayError: If the API returns an error.
        """
        return self._request("GET", f"/api/agent/balance?wallet={wallet}")
