/**
 * js/dealAnalyzer.js — Phase 8 (Agent E)
 * Pure deal math — no DOM, no state reads or writes, no db.
 *
 * Named exports (frozen contract §25):
 *   WATCH_RATIO          {number}  0.6
 *   computeDeal(inputs, repairTotal) -> {repairTotal, sellingCosts, holding,
 *                                        expectedProfit, mao, status}
 *
 * All blank / non-numeric inputs treated as 0.
 */

// ============================================================================
// WATCH_RATIO
// ============================================================================

/** Status threshold: "WATCH" when expectedProfit >= WATCH_RATIO * targetProfit */
export const WATCH_RATIO = 0.6;

// ============================================================================
// computeDeal
// ============================================================================

/**
 * Compute the deal analysis for a real-estate acquisition.
 *
 * Formulas (contract §25):
 *   sellingCosts    = arv * sellingPct / 100
 *   holding         = holdingMonths * monthlyHolding
 *   expectedProfit  = arv - offerPrice - repairTotal - closingCosts - sellingCosts - holding
 *   mao             = arv - repairTotal - closingCosts - sellingCosts - holding - targetProfit
 *
 * Status:
 *   PASS  — offerPrice <= mao AND expectedProfit >= targetProfit
 *   WATCH — expectedProfit >= WATCH_RATIO * targetProfit  (and not PASS)
 *   FAIL  — otherwise
 *
 * @param {{ arv?:number, offerPrice?:number, closingCosts?:number, sellingPct?:number,
 *            holdingMonths?:number, monthlyHolding?:number, targetProfit?:number }} inputs
 * @param {number} repairTotal   from computeGrandTotal (already Math.ceil-rounded integers)
 * @returns {{ repairTotal:number, sellingCosts:number, holding:number,
 *             expectedProfit:number, mao:number, status:'PASS'|'WATCH'|'FAIL' }}
 */
export function computeDeal(inputs, repairTotal) {
  // Normalise inputs — treat missing/blank/NaN as 0
  const inp = inputs || {};
  const arv            = _n(inp.arv);
  const offerPrice     = _n(inp.offerPrice);
  const closingCosts   = _n(inp.closingCosts);
  const sellingPct     = _n(inp.sellingPct);
  const holdingMonths  = _n(inp.holdingMonths);
  const monthlyHolding = _n(inp.monthlyHolding);
  const targetProfit   = _n(inp.targetProfit);
  const rt             = _n(repairTotal);

  // Core calculations
  const sellingCosts   = arv * sellingPct / 100;
  const holding        = holdingMonths * monthlyHolding;
  const expectedProfit = arv - offerPrice - rt - closingCosts - sellingCosts - holding;
  const mao            = arv - rt - closingCosts - sellingCosts - holding - targetProfit;

  // Status determination
  let status;
  if (offerPrice <= mao && expectedProfit >= targetProfit) {
    status = 'PASS';
  } else if (expectedProfit >= WATCH_RATIO * targetProfit) {
    status = 'WATCH';
  } else {
    status = 'FAIL';
  }

  return {
    repairTotal: rt,
    sellingCosts,
    holding,
    expectedProfit,
    mao,
    status,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Coerce a value to a finite number; returns 0 for blank/null/NaN/undefined.
 * @param {any} v
 * @returns {number}
 */
function _n(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
