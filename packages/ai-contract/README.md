# `@3dena/ai-contract`

Internal, provider-neutral aggregate-only AI boundary for j-3dENA. AI is
disabled by default. The package accepts no raw rows, participant identifiers,
file names, group labels, code labels, prompts, or free-form research context.
Its fixed metric vocabulary uses ordinal group/edge/period roles and suppresses
cells below a versioned minimum sample size before an injected provider can see
the envelope.

`invokeAggregateAiV1()` requires explicit consent, a local rate limiter, an
opaque SHA-256 rate-limit scope, a deadline, and a provider adapter that honors
`AbortSignal`. Provider exceptions and invalid responses become closed error
codes; the package neither logs provider errors nor accepts a mutable analysis
object. No real provider, secret, Web route, billing policy, deployment, or
production evidence is included.

Status: `IMPLEMENTED_UNVERIFIED`. This package is not exported as a public
`@3dena/analysis` subpath and does not block an AI-disabled first release.
