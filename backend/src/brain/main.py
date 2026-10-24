from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from brain import storage
from brain.config import get_settings
from brain.db.engine import create_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.engine = create_engine(settings.app_database_url)
    yield
    await app.state.engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Workplace Brain API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz")
    async def healthz() -> dict:
        async with app.state.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        await storage.check()
        return {"status": "ok", "db": "ok", "storage": "ok"}

    return app


app = create_app()
