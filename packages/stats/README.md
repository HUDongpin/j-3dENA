# @3dena/stats

Framework-independent, browser-safe TypeScript statistics for the 3DENA
successor. The package has no runtime dependencies, does not import jENA, and
does not contain or invoke R source. Its public entry points are:

- `analyzeIndependentSamples()` for Welch t, Mann–Whitney/Wilcoxon rank-sum,
  a 95% alternative-aligned Welch mean-difference confidence interval,
  pooled-SD Cohen's d, and independent rank-biserial effect;
- `analyzePairedSamples()` for exact typed-ID matching, paired Wilcoxon
  signed-rank, a 95% alternative-aligned paired-t mean-difference confidence
  interval, paired-difference Cohen's d, and signed-rank rank-biserial effect;
  and
- `adjustPValues()` for `none`, Holm, BH/FDR, and Bonferroni adjustment over an
  explicit complete caller-supplied family.

## Versioned v1 behavior

Both analysis inputs and outputs carry fixed schema versions. Every alternative
uses the `A-minus-B` direction: `greater` means A tends larger than B and `less`
means A tends smaller than B.

- Missing values are only explicit `null`; they are dropped and counted.
  `undefined`, `NaN`, and infinities are invalid.
- Independent samples drop missing values independently. Paired samples match
  collision-safe typed identities first, report unmatched sides, then drop
  matched pairs containing a missing value.
- Integer IDs outside JavaScript's safe range are rejected as numbers and must
  be supplied as strings. Multi-component IDs preserve names, types, and tuple
  boundaries.
- Rank-sum uses exact numeric equality, midranks, tie-corrected asymptotic
  variance, and a continuity-corrected normal approximation. No exact small-N
  distribution is claimed.
- Signed-rank computes A-minus-B differences, drops exact zero differences,
  midranks equal absolute differences, applies tie-corrected asymptotic
  variance, and uses continuity correction. `statistic` is always W+; W− is
  returned separately.
- Independent rank-biserial is `2 * U_A / (n_A * n_B) - 1`. Paired
  rank-biserial is `(W+ - W-) / (W+ + W-)`.
- Independent Cohen's d uses the pooled sample standard deviation. Paired
  Cohen's d uses the mean paired difference divided by the sample standard
  deviation of paired differences. Zero denominators return `null` with an
  explicit diagnostic.
- The combined independent analysis requires at least two valid observations
  on each side, and the paired analysis requires at least two valid matched
  pairs. This keeps every statistic in each versioned result inside its stated
  sample-variance contract.

Independent group moments are calculated in separate finite scales, then
converted to a shared uncertainty scale. Welch–Satterthwaite degrees of freedom
use normalized variance contributions so that squaring cannot erase a real
contribution solely because the other group has a much larger location.
Paired differences use a second internal scale, and fall back to common-scale
subtraction when a raw finite-input subtraction overflows. These rules avoid
unnecessary intermediate overflow and underflow for extreme finite inputs. If
the unstandardized A-minus-B mean itself exceeds `Number.MAX_VALUE`, the
estimate is returned as `null` with `UNREPRESENTABLE_MEAN_DIFFERENCE`;
scale-free test statistics and effects remain available when representable.
An unrepresentable Welch statistic returns `null` and its directional limiting
p-value; an unrepresentable Cohen's d returns `null`. Both cases emit an
explicit diagnostic rather than serializing infinity.

When both independent groups have zero variance, Welch degrees of freedom are
undefined. The statistic is `0` for equal means and otherwise `null`; the
directional limit p-value is returned, and `ZERO_WELCH_STANDARD_ERROR` is
emitted. Both Welch confidence bounds are tagged `undefined`; a zero-width
interval is not manufactured when its reference degrees of freedom do not
exist. The analogous zero denominator for either Cohen effect returns `null`
rather than infinity.

## Boundaries

This package does not select cohorts, infer paired identities, read files,
schedule Workers, draw plots, or define a scientific multiplicity family for a
product screen. Callers must construct the complete sample or pair set and pass
the complete intended p-value family to `adjustPValues()`.

The rank tests are asymptotic candidates, not an R/rENA parity claim. The v1
confidence intervals cover only the parametric A-minus-B mean difference; they
are not confidence intervals for Cohen's d, rank-biserial effects, medians or
rank estimands. The package does not currently provide exact/permutation
p-values, nonparametric/effect-size intervals, Hedges' g, Cliff's delta,
weighted estimands, stratified models, or survey/cluster corrections. Those
require separately versioned contracts and oracle evidence rather than silent
claims.
