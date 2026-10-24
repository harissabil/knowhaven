from fastapi import HTTPException, status

from brain.tenancy.service import TenancyError

_STATUS = {
    "role_not_found": status.HTTP_404_NOT_FOUND,
    "member_not_found": status.HTTP_404_NOT_FOUND,
    "invite_invalid": status.HTTP_404_NOT_FOUND,
    "join_code_invalid": status.HTTP_404_NOT_FOUND,
    "not_pending": status.HTTP_409_CONFLICT,
    "last_owner": status.HTTP_409_CONFLICT,
    "invite_role_must_be_business": status.HTTP_422_UNPROCESSABLE_CONTENT,
}


def http_error(e: TenancyError) -> HTTPException:
    return HTTPException(_STATUS.get(e.code, status.HTTP_400_BAD_REQUEST), e.code)
