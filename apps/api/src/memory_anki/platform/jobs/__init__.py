"""Unified background job lease/handler registry (scaffold)."""

from .registry import JobHandler, JobRegistry, get_job_registry

__all__ = ["JobHandler", "JobRegistry", "get_job_registry"]
