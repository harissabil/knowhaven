"""Background worker: polls every connected Atlassian site (design doc 15.2, 15.3).

Confluence Cloud webhooks need a Forge/Connect app, so we poll: every SYNC_INTERVAL_S each tenant
with a live Confluence/Jira integration gets one sync pass (unchanged pages cost nothing; the
ingestion pipeline skips them). Slack needs no worker: it pushes events to the API.

    uv run brain-worker            # loop
    uv run brain-worker --once     # one pass, then exit
"""

import argparse
import asyncio
import logging
import time

from brain.config import get_settings
from brain.integrations import store
from brain.integrations.sync import sync_atlassian

log = logging.getLogger("brain.worker")


async def run_once() -> dict:
    tenants = {a.tenant_id for a in await store.list_active(["confluence", "jira"])}
    out = {}
    for tenant_id in tenants:
        t = time.monotonic()
        out[str(tenant_id)] = await sync_atlassian(tenant_id)
        log.info(
            "synced tenant %s in %.1fs: %s", tenant_id, time.monotonic() - t, out[str(tenant_id)]
        )
    return out


async def loop() -> None:
    interval = get_settings().sync_interval_s
    log.info("worker started, interval %ss", interval)
    while True:
        started = time.monotonic()
        try:
            await run_once()
        except Exception:  # noqa: BLE001 - keep polling; the next pass may succeed
            log.exception("sync pass failed")
        await asyncio.sleep(max(5.0, interval - (time.monotonic() - started)))


def main() -> None:
    p = argparse.ArgumentParser(description="Workplace Brain sync worker")
    p.add_argument("--once", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if args.once:
        print(asyncio.run(run_once()))
    else:
        asyncio.run(loop())
