from fastapi import APIRouter

from brain.api import admin_members, auth, tenants

router = APIRouter(prefix="/api")
router.include_router(auth.router)
router.include_router(auth.me_router)
router.include_router(tenants.router)
router.include_router(admin_members.router)
