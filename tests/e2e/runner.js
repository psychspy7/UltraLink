/**
 * UltraLink Master E2E Test Runner
 * File: tests/e2e/runner.js
 * 
 * Self-contained CLI test runner for UltraLink E2E test suites (Tiers 1-4).
 * Usage:
 *   node tests/e2e/runner.js [options]
 * Options:
 *   --tier=<1|2|3|4>    Filter tests by tier (1, 2, 3, or 4)
 *   --feature=<F01..F26> Filter tests by feature ID
 *   --verbose           Show detailed step-by-step logs for every test
 *   --json              Output machine-readable JSON results
 *   --tap               Output Test Anything Protocol (TAP) stream
 *   --help              Display help information
 */

'use strict';

const path = require('path');

// Load test suites
const tier1 = require('./tier1_features').tests;
const tier2 = require('./tier2_boundaries').tests;
const tier3 = require('./tier3_combinations').tests;
const tier4 = require('./tier4_scenarios').tests;
const tier5 = require('./tier5_adversarial').tests;

const ALL_TESTS = [...tier1, ...tier2, ...tier3, ...tier4, ...tier5];

// CLI Argument Parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    tier: null,
    feature: null,
    verbose: false,
    json: false,
    tap: false,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--tap') {
      options.tap = true;
    } else if (arg.startsWith('--tier=')) {
      options.tier = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--feature=')) {
      options.feature = arg.split('=')[1].toUpperCase();
    }
  }

  return options;
}

function printHelp() {
  console.log(`
UltraLink E2E Test Runner
=========================
Executes comprehensive opaque-box E2E test suites for UltraLink near-ultrasonic PWA.

Usage:
  node tests/e2e/runner.js [flags]

Flags:
  --tier=<1|2|3|4|5>     Filter tests to a specific tier:
                           1: Feature Coverage (130 tests across all 26 features)
                           2: Boundary & Corner Cases (130 tests across all 26 features)
                           3: Cross-Feature Combinations (30 pairwise interaction tests)
                           4: Real-World Application Scenarios (10 multi-step workflows)
                           5: Adversarial Stress Verification (20 adversarial stress tests)
  --feature=<F01..F26>   Filter tests for a specific feature ID (e.g., F01 to F26)
  --verbose              Print verbose test descriptions and timings
  --json                 Output complete test report as JSON
  --tap                  Output TAP-compatible stream
  --help                 Show this help message
`);
}

async function run() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Filter tests
  let selectedTests = ALL_TESTS;
  if (options.tier !== null) {
    selectedTests = selectedTests.filter(t => t.tier === options.tier);
  }
  if (options.feature !== null) {
    selectedTests = selectedTests.filter(t => t.feature === options.feature);
  }

  if (options.tap) {
    console.log(`1..${selectedTests.length}`);
  } else if (!options.json) {
    console.log('================================================================================');
    console.log('              ULTRALINK ACOUSTIC PWA — E2E TEST SUITE RUNNER                   ');
    console.log('================================================================================');
    console.log(`Discovered: ${ALL_TESTS.length} tests total (Tier 1: ${tier1.length}, Tier 2: ${tier2.length}, Tier 3: ${tier3.length}, Tier 4: ${tier4.length}, Tier 5: ${tier5.length})`);
    console.log(`Selected  : ${selectedTests.length} tests to run`);
    if (options.tier) console.log(`Filter Tier   : ${options.tier}`);
    if (options.feature) console.log(`Filter Feature: ${options.feature}`);
    console.log('--------------------------------------------------------------------------------\n');
  }

  const results = {
    total: selectedTests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    startTime: Date.now(),
    durationMs: 0,
    tierBreakdown: { 1: { pass: 0, fail: 0 }, 2: { pass: 0, fail: 0 }, 3: { pass: 0, fail: 0 }, 4: { pass: 0, fail: 0 }, 5: { pass: 0, fail: 0 } },
    featureCoverage: {},
    failures: []
  };

  // Initialize feature coverage
  for (let i = 1; i <= 26; i++) {
    const fid = `F${i.toString().padStart(2, '0')}`;
    results.featureCoverage[fid] = { tier1: 0, tier2: 0, passed: 0, total: 0 };
  }

  let index = 1;
  for (const test of selectedTests) {
    const testStart = Date.now();
    let status = 'PASS';
    let errorDetail = null;

    try {
      const res = test.fn();
      if (res && typeof res.then === 'function') {
        await res;
      }
      results.passed++;
      results.tierBreakdown[test.tier].pass++;
      if (results.featureCoverage[test.feature]) {
        results.featureCoverage[test.feature].passed++;
        if (test.tier === 1) results.featureCoverage[test.feature].tier1++;
        if (test.tier === 2) results.featureCoverage[test.feature].tier2++;
      }
    } catch (err) {
      status = 'FAIL';
      results.failed++;
      results.tierBreakdown[test.tier].fail++;
      errorDetail = err.message || String(err);
      results.failures.push({
        id: test.id,
        tier: test.tier,
        feature: test.feature,
        name: test.name,
        error: errorDetail
      });
    }

    if (results.featureCoverage[test.feature]) {
      results.featureCoverage[test.feature].total++;
    }

    const testDuration = Date.now() - testStart;

    if (options.tap) {
      const okStr = status === 'PASS' ? 'ok' : 'not ok';
      console.log(`${okStr} ${index} - [Tier ${test.tier}][${test.feature}] ${test.id}: ${test.name}`);
      if (status === 'FAIL') {
        console.log(`  ---`);
        console.log(`  message: "${errorDetail}"`);
        console.log(`  ...`);
      }
    } else if (!options.json) {
      if (options.verbose || status === 'FAIL') {
        const icon = status === 'PASS' ? '[PASS]' : '[FAIL]';
        console.log(`${icon} [Tier ${test.tier}][${test.feature}] ${test.id}: ${test.name} (${testDuration}ms)`);
        if (errorDetail) {
          console.log(`       Error: ${errorDetail}`);
        }
      } else {
        process.stdout.write(status === 'PASS' ? '.' : 'F');
        if (index % 50 === 0) process.stdout.write(`  [${index}/${selectedTests.length}]\n`);
      }
    }

    index++;
  }

  results.durationMs = Date.now() - results.startTime;

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.failed === 0 ? 0 : 1);
  }

  if (!options.tap) {
    console.log('\n\n================================================================================');
    console.log('                               EXECUTION SUMMARY                                ');
    console.log('================================================================================');
    console.log(`Total Executed : ${results.total}`);
    console.log(`Passed         : ${results.passed} (${((results.passed / (results.total || 1)) * 100).toFixed(1)}%)`);
    console.log(`Failed         : ${results.failed}`);
    console.log(`Duration       : ${results.durationMs}ms`);
    console.log('--------------------------------------------------------------------------------');
    console.log('Tier Breakdown:');
    console.log(`  Tier 1 (Feature Coverage)       : ${results.tierBreakdown[1].pass} / ${results.tierBreakdown[1].pass + results.tierBreakdown[1].fail} passed`);
    console.log(`  Tier 2 (Boundary & Corner Cases): ${results.tierBreakdown[2].pass} / ${results.tierBreakdown[2].pass + results.tierBreakdown[2].fail} passed`);
    console.log(`  Tier 3 (Cross-Feature Pairs)    : ${results.tierBreakdown[3].pass} / ${results.tierBreakdown[3].pass + results.tierBreakdown[3].fail} passed`);
    console.log(`  Tier 4 (Real-World Scenarios)   : ${results.tierBreakdown[4].pass} / ${results.tierBreakdown[4].pass + results.tierBreakdown[4].fail} passed`);
    console.log(`  Tier 5 (Adversarial Stress)     : ${results.tierBreakdown[5].pass} / ${results.tierBreakdown[5].pass + results.tierBreakdown[5].fail} passed`);
    console.log('--------------------------------------------------------------------------------');

    if (results.failed === 0) {
      console.log('OVERALL STATUS: ALL TESTS PASSED (100% SUCCESS RATE)\n');
    } else {
      console.log(`OVERALL STATUS: FAILED (${results.failed} tests failed)\n`);
      console.log('Failed Tests:');
      for (const f of results.failures) {
        console.log(`  - [Tier ${f.tier}][${f.feature}] ${f.id}: ${f.name}`);
        console.log(`    Error: ${f.error}`);
      }
    }
  }

  process.exit(results.failed === 0 ? 0 : 1);
}

run().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
