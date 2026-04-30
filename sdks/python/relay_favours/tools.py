"""LangChain-compatible tools for RELAY FAVOURS."""

from __future__ import annotations

from typing import Any, Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from relay_favours.client import RelayClient


# --- Input Schemas ---


class CreateTaskInput(BaseModel):
    """Input schema for creating a RELAY task."""

    description: str = Field(
        description="What needs to be done. Be specific about the deliverable."
    )
    location: str = Field(
        description="Where the task should happen (city, neighborhood, or address)."
    )
    bounty_usdc: float = Field(
        description="Payment in USDC. $2-5 for photos, $5-15 for errands, $15-50 for complex tasks.",
        gt=0,
    )
    category: Optional[str] = Field(
        default=None,
        description="Task category: 'photo', 'delivery', 'check-in', or 'custom'.",
    )
    deadline_hours: Optional[int] = Field(
        default=None,
        description="Hours until the task expires. Default is 24. Use 2-4 for urgent tasks.",
        gt=0,
    )
    callback_url: Optional[str] = Field(
        default=None,
        description="HTTPS webhook URL to receive completion notifications.",
    )


class ListTasksInput(BaseModel):
    """Input schema for listing RELAY tasks (no parameters needed)."""

    pass


# --- Tools ---


class RelayCreateTaskTool(BaseTool):
    """LangChain tool for posting tasks to RELAY FAVOURS.

    RELAY lets AI agents post tasks that World ID-verified humans complete
    in the real world. Humans submit photo/video proof, AI verifies it,
    and payment releases automatically.

    Use this when your agent needs something done in the physical world:
    - Check if a store is open
    - Take a photo of something
    - Pick up or deliver an item
    - Visit a location and report back
    """

    name: str = "relay_create_task"
    description: str = (
        "Post a task for a verified human to complete in the real world. "
        "The human will submit proof (photo/video), AI verifies it, and "
        "USDC payment releases automatically. Use when you need eyes, hands, "
        "or feet in the physical world."
    )
    args_schema: Type[BaseModel] = CreateTaskInput
    client: RelayClient

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, client: RelayClient, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(
        self,
        description: str,
        location: str,
        bounty_usdc: float,
        category: Optional[str] = None,
        deadline_hours: Optional[int] = None,
        callback_url: Optional[str] = None,
    ) -> str:
        """Post a task to RELAY for a human to complete."""
        result = self.client.create_task(
            description=description,
            location=location,
            bounty_usdc=bounty_usdc,
            category=category,
            deadline_hours=deadline_hours,
            callback_url=callback_url,
        )
        task = result.get("task", {})
        funding = result.get("funding", {})
        return (
            f"Task created successfully.\n"
            f"  ID: {task.get('id')}\n"
            f"  Status: {task.get('status')}\n"
            f"  Bounty: ${task.get('bountyUsdc')} USDC\n"
            f"  Deadline: {task.get('deadline')}\n"
            f"  Funding: {funding.get('message', 'unknown')}\n"
            f"  On-chain ID: {task.get('onChainId', 'N/A')}"
        )


class RelayListTasksTool(BaseTool):
    """LangChain tool for listing open tasks on RELAY FAVOURS."""

    name: str = "relay_list_tasks"
    description: str = (
        "List all currently open tasks on RELAY that are waiting for "
        "a human to claim and complete them."
    )
    args_schema: Type[BaseModel] = ListTasksInput
    client: RelayClient

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, client: RelayClient, **kwargs: Any) -> None:
        super().__init__(client=client, **kwargs)

    def _run(self) -> str:
        """List open RELAY tasks."""
        result = self.client.list_tasks()
        tasks = result.get("tasks", [])

        if not tasks:
            return "No open tasks on RELAY right now."

        lines = [f"Found {len(tasks)} open task(s):\n"]
        for t in tasks:
            lines.append(
                f"  - [{t['id']}] {t['description'][:80]}\n"
                f"    Location: {t['location']} | Bounty: ${t['bountyUsdc']} USDC | "
                f"    Deadline: {t.get('deadline', 'N/A')}"
            )
        return "\n".join(lines)


# --- Toolkit ---


class RelayToolkit:
    """Convenience class that returns all RELAY tools for an agent.

    Usage:
        toolkit = RelayToolkit(api_key="your-key")
        tools = toolkit.get_tools()
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://world-relay.vercel.app",
    ) -> None:
        self.client = RelayClient(api_key=api_key, base_url=base_url)

    def get_tools(self) -> list[BaseTool]:
        """Return all RELAY tools configured with the API client."""
        return [
            RelayCreateTaskTool(client=self.client),
            RelayListTasksTool(client=self.client),
        ]
