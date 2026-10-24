"""Ingestion (design doc 9): every connector produces `IngestItem`s; one pipeline normalizes,
classifies, masks, chunks and embeds them into `source_items` + `chunks`."""
