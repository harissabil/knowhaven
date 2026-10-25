"""Links back to Slack messages (brain.integrations.slack.permalink). Pure function."""

from brain.integrations.slack import permalink

BASE = "https://acme.slack.com/"


def test_message_link():
    assert permalink(BASE, "C123", "1729000000.123456") == (
        "https://acme.slack.com/archives/C123/p1729000000123456"
    )


def test_thread_reply_link_points_into_the_thread():
    url = permalink(BASE, "C123", "1729000100.000200", "1729000000.123456")
    assert url == (
        "https://acme.slack.com/archives/C123/p1729000100000200"
        "?thread_ts=1729000000.123456&cid=C123"
    )


def test_no_link_without_workspace_address():
    assert permalink(None, "C123", "1729000000.123456") is None
