# Finance data layer

The LLM is not the source of truth for current prices or market events.

Future adapters can be added here for:

- licensed market data
- news
- onchain RPC/indexers
- Stock Token metadata

The agent should pass verified/current data into the AI context before asking
the model to summarize it.
