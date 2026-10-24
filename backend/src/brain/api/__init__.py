from fastapi import APIRouter

from brain.api import admin_members, admin_rbac, audit, auth, chat, tenants, uploads

router = APIRouter(prefix="/api")
router.include_router(auth.router)
router.include_router(auth.me_router)
router.include_router(tenants.router)
router.include_router(admin_members.router)
router.include_router(admin_rbac.router)
router.include_router(uploads.router)
router.include_router(chat.router)
router.include_router(audit.router)
