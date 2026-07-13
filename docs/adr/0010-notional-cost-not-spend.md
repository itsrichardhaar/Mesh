# Usage is priced as Notional Cost (published API rates), never as money spent

Mesh v7's money layer puts a dollar figure on **Usage**. That figure is **Notional Cost** — Usage Event token counts multiplied by published per-Model API rates — a measure of usage *intensity*, not an invoice. Mesh never claims to show money the user actually spent.

The reasoning is the same trade-off `token-usage-analytics` records in its ADR-0003. Mesh's users run Claude Code on **flat-fee subscriptions**. Under a subscription, marginal spend per token is ≈ $0, and true spend is both unknowable from local data and approximately equal to the monthly fee regardless of how much you use. A "real spend" number would therefore be either unavailable, misleading, or a flat constant. What *is* meaningful is: *what would this usage have cost at API rates?* — a legible, dollar-denominated proxy for how hard you are leaning on the tool, and the input to **Subscription Utilization** (v8: Notional Cost vs the plan fee — "is the subscription paying off?").

## Considered Options

- **Show real spend via a billing API** — rejected: no local source (violates local-first), requires networked billing access and credentials, and on flat-fee plans the number is ~0 marginal or ~the fee — misleading and uninteresting. Solves a question the user isn't asking.
- **Tokens only, no monetary figure** — rejected: loses the most legible signal. "You'd have paid $340 in API fees this month" communicates intensity in one glance in a way raw token counts do not; it is the headline value users came from `token-usage-analytics` for.
- **Notional Cost (API-rate value) with a permanent clarifier** — chosen: dollar-legible, honest about what it is, and the foundation Subscription Utilization builds on.

## Consequences

- **A per-Model pricing table ships in-repo** (rates for Claude models; service-tier aware, since `service_tier` in the JSONL is pricing-relevant). It drifts from reality whenever Anthropic changes prices — acceptable for a personal intensity gauge, and surfaced in-app so the user knows the rates are a snapshot, not a live feed.
- **The word "Cost" never stands naked.** The "Cost" metric toggle always means Notional Cost and always carries the clarifier *"at API rates — not money spent"* wherever a dollar figure is headlined.
- **CONTEXT fences the vocabulary** — "spend," "bill," "invoice," and bare "cost" are on the avoid list; **Notional Cost** is the only monetary term for Usage, and **Subscription Utilization** the only "Utilization."
- **No billing-API integration, ever, under this ADR.** Reversing it (to show real spend) would require a networked billing credential and a new ADR — deliberately a high bar.
