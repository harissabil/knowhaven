"""Retrieval (design doc 10.2): permission-filtered hybrid search. The permission rule runs inside
the same SQL as ranking, so forbidden items never become candidates and never affect scores."""
