"""LLM + embedding layer (design doc 16). Everything model-related goes through here so the
provider can be swapped (16.3) and every call is timed, capped and attributable."""
