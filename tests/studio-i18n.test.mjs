import test from 'node:test';
import assert from 'node:assert/strict';
import { translations, translate, localeFor, validateTranslations } from '../demo/studio-i18n.mjs';

test('RU and EN catalogs are complete, nonempty and key-compatible', () => {
  assert.ok(validateTranslations() >= 50);
  assert.equal(Object.keys(translations.ru).length,Object.keys(translations.en).length);
  assert.equal(translate('ru','studio.inspector'),'Инспектор');
  assert.equal(translate('en','studio.inspector'),'Inspector');
});
test('stored explicit choice outranks browser and unsupported browser falls back to Russian', () => {
  assert.equal(localeFor({saved:'ru',languages:['en-US']}),'ru');
  assert.equal(localeFor({saved:'en',languages:['ru-RU']}),'en');
  assert.equal(localeFor({languages:['fr-FR','en-GB']}),'en');
  assert.equal(localeFor({languages:['de-DE']}),'ru');
  assert.equal(localeFor({languages:['ru-RU']}),'ru');
});
test('unknown localization keys are rejected instead of being silently untranslated', () => {
  assert.throws(() => translate('en','unknown'),/missing localization key/);
  assert.throws(() => translate('de','studio.inspector'),/unsupported locale/);
});
