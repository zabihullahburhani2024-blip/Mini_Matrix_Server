/**
 * Mini Matrix — Centralized Gold & Jewelry Calculation Engine
 * Single source of truth for all karat / mithqal / AFN math.
 * Pure functions — no DOM, no side effects.
 */
(function (global) {
  'use strict';

  // Business constants (match existing wholesale where possible)
  var OUNCE_GRAMS = 31.10345;       // existing project value
  var TARGET_KARAT = 23.88;         // FIXED settlement purity
  var MITHQAL_GRAMS = 4.58;         // 4.58 g @ 23.88K
  var TOLA_GRAMS = 12.15;
  var DEFAULT_USED_DEDUCTION = 10;  // percent

  function isValidNumber(n) {
    return typeof n === 'number' && isFinite(n);
  }

  /** Live XAU/USD → price per gram at 23.88K (full precision) */
  function pricePerGram23_88(ouncePrice) {
    if (!isValidNumber(ouncePrice) || ouncePrice <= 0) return null;
    return ouncePrice / OUNCE_GRAMS;
  }

  /**
   * Convert physical gold to equivalent weight at 23.88K
   * eq = weight × karat / 23.88
   */
  function equivalentWeight(weightGrams, karat) {
    if (!isValidNumber(weightGrams) || weightGrams <= 0) return null;
    if (!isValidNumber(karat) || karat <= 0 || karat > 24) return null;
    return weightGrams * karat / TARGET_KARAT;
  }

  function purchaseValue(weightGrams, karat, ouncePrice, usedDeductionPct) {
    var eq = equivalentWeight(weightGrams, karat);
    var ppg = pricePerGram23_88(ouncePrice);
    if (eq == null || ppg == null) return null;

    var grossUsd = eq * ppg;
    var dedPct = isValidNumber(usedDeductionPct) ? usedDeductionPct : 0;
    if (dedPct < 0) dedPct = 0;
    if (dedPct >= 100) dedPct = 99.999;

    var deductionUsd = grossUsd * (dedPct / 100);
    var netUsd = grossUsd - deductionUsd;

    return {
      originalWeight: weightGrams,
      originalKarat: karat,
      targetKarat: TARGET_KARAT,
      equivalentWeight: eq,
      pricePerGram: ppg,
      grossUsd: grossUsd,
      usedDeductionPct: dedPct,
      deductionUsd: deductionUsd,
      netUsd: netUsd
    };
  }

  function saleValue(weightGrams, karat, ouncePrice) {
    // Sales do NOT apply used-gold deduction automatically
    return purchaseValue(weightGrams, karat, ouncePrice, 0);
  }

  function mithqalPrice(ouncePrice) {
    var ppg = pricePerGram23_88(ouncePrice);
    if (ppg == null) return null;
    var usd = ppg * MITHQAL_GRAMS;
    return {
      weightGrams: MITHQAL_GRAMS,
      karat: TARGET_KARAT,
      pricePerGram: ppg,
      usd: usd
    };
  }

  function unitPrice(unitWeightGrams, ouncePrice) {
    var ppg = pricePerGram23_88(ouncePrice);
    if (ppg == null || !isValidNumber(unitWeightGrams) || unitWeightGrams <= 0) return null;
    return {
      weightGrams: unitWeightGrams,
      pricePerGram: ppg,
      usd: unitWeightGrams * ppg
    };
  }

  function convertUsdToAfn(usd, rate) {
    if (!isValidNumber(usd) || !isValidNumber(rate) || rate <= 0) return null;
    return usd * rate;
  }

  /** Validate inputs; returns Persian error string or null if OK */
  function validatePurchase(weight, karat, dedPct, usdRate) {
    if (!isValidNumber(weight) || weight <= 0) return 'وزن باید بزرگ‌تر از صفر باشد';
    if (!isValidNumber(karat) || karat <= 0 || karat > 24) return 'عیار باید بین ۰ تا ۲۴ باشد';
    if (isValidNumber(dedPct) && (dedPct < 0 || dedPct >= 100)) return 'درصد کسر باید بین ۰ تا ۱۰۰ باشد';
    if (isValidNumber(usdRate) && usdRate <= 0) return 'نرخ دلار باید بزرگ‌تر از صفر باشد';
    return null;
  }

  global.MM_GOLD = {
    OUNCE_GRAMS: OUNCE_GRAMS,
    TARGET_KARAT: TARGET_KARAT,
    MITHQAL_GRAMS: MITHQAL_GRAMS,
    TOLA_GRAMS: TOLA_GRAMS,
    DEFAULT_USED_DEDUCTION: DEFAULT_USED_DEDUCTION,
    pricePerGram23_88: pricePerGram23_88,
    equivalentWeight: equivalentWeight,
    purchaseValue: purchaseValue,
    saleValue: saleValue,
    mithqalPrice: mithqalPrice,
    unitPrice: unitPrice,
    convertUsdToAfn: convertUsdToAfn,
    validatePurchase: validatePurchase
  };
})(window);
