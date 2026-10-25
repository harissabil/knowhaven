# Accountability sheet: Knowhaven

Challenge A, The Workplace Brain. Questions follow the same rules from both entry points, the web app
and the WorkBuddy MCP connector; approvals are made in the web app only.

## What it can access

- Only the user's active company. Every company table has forced row-level security in PostgreSQL,
  and the application connects with a role that cannot bypass it.
- Within that company, only sources mapped to one of the user's business roles: Slack channels,
  WhatsApp exports, Confluence spaces, upload folders and Jira projects. Item-level overrides and
  time-limited grants from approved access requests can add or remove items; a deny always wins.
- New sources are hidden until an admin maps them to roles.
- Personal data (NIK, NPWP, phone, personal email, bank account) is masked. Raw values are used
  only when the user's role may see that data type and the question needs it.
- Admin and auditor roles give no access to sources on their own. Auditors read the audit log,
  which shows each question and answer (personal data masked), because that is what they audit.

## What it does on its own

- Reads, searches, and answers with a citation for every statement.
- Decides between sources that give different amounts or counts with fixed rules (official over
  discussion, newer official over older) and says which source it used and why; a same-day tie is
  shown as a tie.
- Says "I don't know" and names the topic owner, or the company's default contact, when nothing the
  user may see answers the question.
- Masks personal data, checks citations and numbers, and logs every question, the sources it
  retrieved and the answer, in a hash-chained audit log.
- Drafts a change to a document that a newer announcement has made outdated (draft only).

## What requires human approval

| Action | Approved by |
|---|---|
| Applying a document change draft to Confluence or an uploaded document | Topic owner, else document owner, manager, then admin |
| Temporary access to a restricted topic (for example the salary grade table) | Topic owner, else manager, then admin |
| Making a new channel, space or folder visible to roles | Company admin |
| Activating someone who joined with the company code | Company admin |

Nobody approves their own access request; document drafts go to the topic owner. Every approval is
logged.

## What it will never do

- Show another company's data.
- Confirm or hint that hidden content exists: a question about a hidden project gets the same reply
  as one about a project that does not exist.
- Trust a role or identity claimed in the chat ("saya HRD").
- Follow instructions found inside documents or messages.
- Change, send or delete anything without approval. Slack and Jira are read-only; its only write is
  an approved update to a Confluence page or a new version of an uploaded document.
- Change or delete its own audit log.

## Known limitations

- WorkBuddy keeps its own chat history. After access is revoked, the next WorkBuddy answer follows
  the new permissions, but text already shown in the user's WorkBuddy window cannot be removed.
- WorkBuddy's model is instructed to show Knowhaven's answer unchanged but could still paraphrase it.
- It is sometimes too cautious: in our evaluation 4 of 38 answerable questions got "I don't know".
- Conflicts are decided by posting date, not by an effective date written in the text: an
  announcement saying "from 1 November" applies from the day it is posted.
- Only differing amounts and counts are treated as conflicts; differing wording is not.
- Answers that combine chat, documents and Jira sometimes leave the chat source uncited.
- Text sent to Gemini on Google Cloud is masked, except personal data the user may see and the
  question needs. The application and database run on Tencent Cloud Lighthouse and Neon.
