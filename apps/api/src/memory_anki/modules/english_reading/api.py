"""Public English Reading read facade."""

from .application.article_service import list_recent_article_materials as list_recent_materials

__all__ = ["list_recent_materials"]
