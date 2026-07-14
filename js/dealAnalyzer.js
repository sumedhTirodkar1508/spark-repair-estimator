/**
 * js/dealAnalyzer.js
 * Pure deal math — no DOM, no state reads or writes, no db.
 *
 * Named exports:
 *   WATCH_RATIO          {number}  0.6
 *   isDealReady(inputs)  -> boolean
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
// isDealReady
// ============================================================================

/**
 * Single source of truth for "is there enough input to show a deal verdict."
 * Ready only when ARV, offer/purchase price, and target profit are all
 * present and strictly positive — blank, undefined, null, NaN, zero, and
 * negative values never count as ready. Used identically by the UI (to show
 * a PASS/WATCH/FAIL badge) and by the Excel exporter (to decide whether to
 * emit a verdict/MAO/Offer Gap row), so the two can never disagree.
 *
 * @param {{ arv?:number, offerPrice?:number, targetProfit?:number }} inputs
 * @returns {boolean}
 */
export function isDealReady(inputs) {
  const inp = inputs || {};
  return Number(inp.arv) > 0 && Number(inp.offerPrice) > 0 && Number(inp.targetProfit) > 0;
}

// ============================================================================
// computeDeal
// ============================================================================

/**
 * Compute the deal analysis for a real-estate acquisition.
 *
 * Formulas:
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
