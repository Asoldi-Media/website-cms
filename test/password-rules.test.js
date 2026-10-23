import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, SHIPPED_DEFAULT_PASSWORDS, isUsableEnvPassword, newPasswordProblem } from '../server/auth-hardening.js';

test('password rules for new passwords and the env password', () => {
  for (const weak of ['', 'short', 'admin', 'password', 'PASSWORD', 'changeme', ' changeme ', 'change-me', '        ', '       x', ' \t  abc \n ', null, undefined, 12345678, {}]) {
    assert.ok(newPasswordProblem(weak), String(weak));
  }
  assert.equal(newPasswordProblem('kort'), 'Passordet må ha minst 8 tegn.');
  assert.equal(newPasswordProblem('password'), 'Dette passordet er for enkelt å gjette. Velg et annet passord.');
  assert.equal(newPasswordProblem('        '), 'Passordet må ha minst 8 tegn.', 'spaces alone do not count');
  assert.equal(newPasswordProblem('p'.repeat(MAX_PASSWORD_LENGTH + 1)), 'Passordet kan ha høyst 1024 tegn.', 'longer than sign-in accepts');
  for (const fine of ['a-real-password', 'correct horse', '12345678x', ' padded-password ', 'p'.repeat(MAX_PASSWORD_LENGTH)]) {
    assert.equal(newPasswordProblem(fine), null, fine.slice(0, 20));
  }
  assert.equal(isUsableEnvPassword('changeme'), false);
  assert.equal(isUsableEnvPassword('        '), false);
  assert.equal(isUsableEnvPassword('a-strong-env-password'), true);
});

test('only the defaults that releases shipped are replaced at start', () => {
  assert.deepEqual([...SHIPPED_DEFAULT_PASSWORDS], ['changeme', 'change-me']);
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  for (const shipped of SHIPPED_DEFAULT_PASSWORDS) assert.ok(newPasswordProblem(shipped), 'a shipped default can never be set again');
});
