# Composio Manual Authorization

This scaffold uses Composio with `manage_connections=False` so the app controls when users are redirected into OAuth.

## Installed SDKs

```bash
pip install composio composio-openai-agents openai-agents
```

## Current SDK Shape

The current Python SDK uses an instantiated `Composio` client and exposes `create(...)` on that instance:

```python
from composio import Composio
from composio_openai_agents import OpenAIAgentsProvider

composio = Composio(
    provider=OpenAIAgentsProvider(),
    api_key=os.environ["COMPOSIO_API_KEY"],
)

session = composio.create(
    user_id=external_user_id,
    toolkits={"enable": ["gmail"]},
    manage_connections={"enable": False},
)

connection_request = session.authorize(
    toolkit="gmail",
    callback_url="https://your-app.com/callback-path",
)

print(connection_request.redirect_url)

connected_account = composio.connected_accounts.wait_for_connection(
    connection_request.id
)
print(connected_account.id)
```

## How the scaffold maps this

- Backend route: `POST /api/connections/authorize`
- Backend status poll: `GET /api/connections/{connection_id}`
- Frontend action: opens `redirect_url` in a new tab and polls until Composio reports `ACTIVE`

## White-labeled OAuth

If you have custom Composio auth configs, add them to `services/agent-api/.env`:

```bash
PIPEIQ_GMAIL_AUTH_CONFIG_ID=
PIPEIQ_GOOGLECALENDAR_AUTH_CONFIG_ID=
PIPEIQ_CALENDLY_AUTH_CONFIG_ID=
PIPEIQ_HUBSPOT_AUTH_CONFIG_ID=
```

The backend automatically injects the matching auth config id when it creates the session.

## Notes

- Apollo and Instantly remain explicit API-key seams in this scaffold.
- The current workspace store is in-memory only.
- Replace the masked API-key hint storage with encrypted persistence before production.
