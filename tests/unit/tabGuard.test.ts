/**
 * Tab guard: confining a development run to one tab inside the production
 * spreadsheet. Pure — the "client" here is a fake that records calls. No
 * network, no Google API, no real spreadsheet.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitRange, quoteTab, rewriteRange } from '../../src/config/tabGuard.js';

const DEV_TAB = 'Test_Abhinav';

describe('range parsing', () => {
  test('splits a plain tab', () => {
    assert.deepEqual(splitRange('Blogs!A1:Z'), { tab: 'Blogs', cells: 'A1:Z' });
  });
  test('splits a quoted tab with a space', () => {
    assert.deepEqual(splitRange("'New Logic'!A1:Z"), { tab: 'New Logic', cells: 'A1:Z' });
  });
  test('a range with no tab has no tab component', () => {
    assert.deepEqual(splitRange('A1:Z'), { tab: null, cells: 'A1:Z' });
  });
});

describe('tab quoting', () => {
  test('simple names are left bare', () => {
    assert.equal(quoteTab('Test_Abhinav'), 'Test_Abhinav');
  });
  test('names with spaces are quoted', () => {
    assert.equal(quoteTab('New Logic'), "'New Logic'");
  });
});

describe('every live tab is rewritten onto the dev tab', () => {
  const liveTabs = [
    'Social Media', 'Blogs', 'Algo Reports', 'Content Pool',
    'New Logic', 'RSS Extraction', 'Newsletter',
  ];

  for (const tab of liveTabs) {
    test(`"${tab}" is redirected`, () => {
      const out = rewriteRange(`${quoteTab(tab)}!A1:Z100`, DEV_TAB);
      assert.equal(out, 'Test_Abhinav!A1:Z100');
      assert.ok(!out.includes(tab), `${out} must not still reference ${tab}`);
    });
  }

  test('the cell portion is preserved exactly', () => {
    assert.equal(rewriteRange("'New Logic'!B2:F500", DEV_TAB), 'Test_Abhinav!B2:F500');
    assert.equal(rewriteRange('Blogs!A1', DEV_TAB), 'Test_Abhinav!A1');
  });

  test('a tab-less range is given the dev tab, not left to default', () => {
    // Without "!", Sheets targets whichever tab is first — live data.
    assert.equal(rewriteRange('A1:Z', DEV_TAB), 'Test_Abhinav!A1:Z');
  });

  test('a dev tab needing quotes is quoted', () => {
    assert.equal(rewriteRange('Blogs!A1', 'Test Abhinav'), "'Test Abhinav'!A1");
  });

  test('rewriting is idempotent', () => {
    const once = rewriteRange('Blogs!A1:Z', DEV_TAB);
    assert.equal(rewriteRange(once, DEV_TAB), once);
  });
});
